/**
 * Lantern's Company Agent (PAP 0.3 §8): deterministic, with no model. The
 * Personal Agent sends a structured request in `data.request`; Lantern
 * answers with data and a short fixed sentence. Anything else gets the list
 * of requests it handles. Account requests answer with an `authorization`
 * event until the token has the scopes (§8.11). A refund for a missing item
 * is an Operations v2 operation in the reply, performed only when a later
 * message carries the User's approval.
 */
import type {
  ConversationHandler,
  ConversationTurn,
  Outcome,
  TurnResult,
} from "@poppy-lab/pap-company";
import {
  customers,
  DELIVERY_CENTS,
  hours,
  menu,
  PHONE,
  PHONE_HOURS,
  slots,
} from "./data.ts";

export type Refund = {
  order_id: string;
  dish_id: string;
  quantity: number;
  amount_cents: number;
  at: string;
};
type Deps = {
  /** The customer's scheduled orders, as the API shows them. */
  scheduled: (account: string) => unknown[];
  /** Refunds recorded for the customer (this tenant's state). */
  refunds: (account: string) => Refund[];
};

const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** What the Company Agent handles, returned for `help` and unknown input. */
export const agentRequests = [
  {
    request: "opening_hours",
    description: "Kitchen hours and closed days.",
    fields: {},
    scopes: [],
  },
  {
    request: "delivery_info",
    description: "Delivery slots and the delivery fee.",
    fields: {},
    scopes: [],
  },
  {
    request: "order_status",
    description:
      "The customer's scheduled orders and last delivery, with any refunds.",
    fields: {},
    scopes: ["orders:read"],
  },
  {
    request: "report_missing_item",
    description:
      "A dish was missing from a delivered order. Lantern proposes a refund for it, which the user approves.",
    fields: {
      order_id: "ID of the delivered order (see order_status)",
      dish_id: "ID of the missing dish",
      quantity: "Optional: how many were missing. Default: all of that dish.",
    },
    scopes: ["orders:read", "orders:write"],
  },
] as const;

export function deliveredView(account: string, refunds: Refund[]) {
  const customer = customers.find((c) => c.id === account);
  if (!customer) return undefined;
  const d = customer.delivered;
  return {
    id: d.id,
    status: "delivered",
    delivered_at: d.at,
    items: Object.entries(d.lines).map(([id, quantity]) => {
      const dish = menu.find((m) => m.id === id)!;
      const refunded = refunds
        .filter((r) => r.order_id === d.id && r.dish_id === id)
        .reduce((n, r) => n + r.quantity, 0);
      return {
        dish_id: id,
        name: dish.name,
        quantity,
        unit_price_cents: dish.price_cents,
        refunded_quantity: refunded,
      };
    }),
    refunds: refunds.filter((r) => r.order_id === d.id),
    note: "Fictional order: nothing was delivered or charged.",
  };
}

export function lanternAgent(deps: Deps): ConversationHandler {
  /** §8.11: the reply when the token lacks scopes (or there is none). */
  const needs = (turn: ConversationTurn, scopes: readonly string[]) =>
    !turn.account || scopes.some((s) => !turn.scopes.includes(s))
      ? ({
          replies: [
            {
              text: "That needs your Lantern account. Sign in, then send the request again.",
              data: { error: "sign_in_required", scopes },
            },
          ],
          authorization: scopes.join(" "),
        } satisfies TurnResult)
      : undefined;

  const catalogue = (note?: string): TurnResult => ({
    replies: [
      {
        text: `${note ? `${note} ` : ""}Lantern's automated agent answers structured requests: send one in data.request. To reach a person, ask for a handoff.`,
        data: {
          requests: agentRequests,
          handoff: "POST {conversation}/handoff",
        },
      },
    ],
  });

  /** A refund for missing dishes, as an Operations v2 action. */
  function refund(
    turn: ConversationTurn,
    want: { order_id: string; dish_id: string; quantity?: number },
  ): TurnResult {
    const account = turn.account!;
    const refunds = deps.refunds(account);
    const order = deliveredView(account, refunds);
    const item = order?.items.find((i) => i.dish_id === want.dish_id);
    if (!order || order.id !== want.order_id)
      return {
        replies: [
          {
            text: `I can't find delivered order ${want.order_id.slice(0, 40)} on your account.`,
            data: { error: "order_not_found", delivered_order: order?.id },
          },
        ],
      };
    if (!item)
      return {
        replies: [
          {
            text: `That dish wasn't part of order ${order.id}.`,
            data: {
              error: "dish_not_in_order",
              items: order.items.map((i) => i.dish_id),
            },
          },
        ],
      };
    const remaining = item.quantity - item.refunded_quantity;
    const quantity = want.quantity ?? remaining;
    if (remaining <= 0)
      return {
        replies: [
          {
            text: `${item.name} on order ${order.id} was already refunded.`,
            data: { error: "already_refunded", refunds: order.refunds },
          },
        ],
      };
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > remaining)
      return {
        replies: [
          {
            text: `Order ${order.id} had ${remaining} × ${item.name} that can still be refunded.`,
            data: { error: "invalid_quantity", refundable: remaining },
          },
        ],
      };
    if (!turn.operations)
      // Operations v2 §2: no operations for an agent without the extension.
      return {
        replies: [
          {
            text: `A refund needs your approval, which your agent can't send. Call ${PHONE} instead.`,
            data: { error: "approval_unavailable", phone: PHONE },
          },
        ],
      };
    const amount = item.unit_price_cents * quantity;
    turn.memory.pending = {
      order_id: order.id,
      dish_id: item.dish_id,
      quantity,
    };
    const outcome = turn.propose({
      // Includes what was refunded before, so a later report is a new action.
      key: `refund:${order.id}:${item.dish_id}:${item.refunded_quantity}`,
      terms: {
        order_id: order.id,
        dish_id: item.dish_id,
        quantity,
        refund_cents: amount,
        currency: "USD",
        method: "Simulated refund to the card used for the order",
      },
      summary: `Refund ${quantity} × ${item.name} (${usd(amount)}) missing from order ${order.id}, delivered ${order.delivered_at}, to the card used for it. Simulated: no real money moves.`,
      perform: (t) => {
        const record: Refund = {
          order_id: String(t.order_id),
          dish_id: String(t.dish_id),
          quantity: Number(t.quantity),
          amount_cents: Number(t.refund_cents),
          at: new Date().toISOString(),
        };
        refunds.push(record);
        // Kept as done: a repeated approval then adds nothing (§7).
        turn.memory.pending = {
          ...(turn.memory.pending as Record<string, unknown>),
          done: true,
        };
        return {
          summary: `Refunded ${usd(record.amount_cents)} for ${record.quantity} × ${item.name} on order ${record.order_id}. Simulated: no real money moves.`,
          data: { refund: record },
        };
      },
    });
    return outcomeReply(outcome, amount, item.name);
  }

  function outcomeReply(
    outcome: Outcome,
    amount: number,
    name: string,
  ): TurnResult {
    const body = outcome.body as {
      operation?: Record<string, unknown>;
      summary?: string;
      data?: unknown;
      operation_id?: string;
      error?: string;
    };
    // A repeated approval of a performed refund adds nothing (Operations v2 §7).
    if (outcome.replayed) return {};
    if (outcome.status === 403 && body.operation)
      return {
        replies: [
          {
            text: `I can refund ${usd(amount)} for the missing ${name}. I'll do it once you approve.`,
            operation: body.operation,
          },
        ],
      };
    if (outcome.status === 200)
      return {
        replies: [
          {
            text: body.summary ?? "Done.",
            data: {
              operation_id: body.operation_id,
              ...(object(body.data) ? body.data : {}),
            },
          },
        ],
      };
    return {
      replies: [
        {
          text:
            outcome.status === 409
              ? "The order changed since I proposed that. Ask again for fresh terms."
              : "I can't propose more changes right now. Try again later.",
          data: { error: body.error ?? "unavailable" },
        },
      ],
    };
  }

  return (turn) => {
    const data = turn.message.data ?? {};
    // The User's approval of the pending refund (Operations v2 §6).
    if (turn.approval) {
      const pending = turn.memory.pending;
      const missing = needs(turn, ["orders:read", "orders:write"]);
      if (missing) return missing;
      if (object(pending) && pending.done) return {};
      if (!object(pending))
        return {
          replies: [
            {
              text: "Nothing in this conversation is waiting for approval.",
              data: { error: "no_pending_operation" },
            },
          ],
        };
      return refund(turn, {
        order_id: String(pending.order_id),
        dish_id: String(pending.dish_id),
        quantity: Number(pending.quantity),
      });
    }
    const request = typeof data.request === "string" ? data.request : undefined;
    switch (request) {
      case undefined:
      case "help":
        return catalogue(
          turn.message.text && !request
            ? "I don't read free text, only structured requests."
            : undefined,
        );
      case "opening_hours":
        return {
          replies: [
            {
              text: "Here are the kitchen hours.",
              data: { hours, phone: PHONE, phone_hours: PHONE_HOURS },
            },
          ],
        };
      case "delivery_info":
        return {
          replies: [
            {
              text: `Scheduled orders go out in these slots. Delivery is ${usd(DELIVERY_CENTS)}.`,
              data: { slots, delivery_cents: DELIVERY_CENTS, currency: "USD" },
            },
          ],
        };
      case "order_status": {
        const missing = needs(turn, ["orders:read"]);
        if (missing) return missing;
        const refunds = deps.refunds(turn.account!);
        return {
          replies: [
            {
              text: "Here are your scheduled orders and your last delivery.",
              data: {
                scheduled: deps.scheduled(turn.account!),
                last_delivery: deliveredView(turn.account!, refunds),
              },
            },
          ],
        };
      }
      case "report_missing_item": {
        const missing = needs(turn, ["orders:read", "orders:write"]);
        if (missing) return missing;
        if (
          typeof data.order_id !== "string" ||
          typeof data.dish_id !== "string" ||
          (data.quantity !== undefined && typeof data.quantity !== "number")
        )
          return {
            replies: [
              {
                text: "Send order_id and dish_id (and optionally quantity).",
                data: {
                  error: "invalid_request",
                  fields: agentRequests[3].fields,
                },
              },
            ],
          };
        return refund(turn, {
          order_id: data.order_id,
          dish_id: data.dish_id,
          ...(data.quantity !== undefined
            ? { quantity: data.quantity as number }
            : {}),
        });
      }
      default:
        return catalogue(`Lantern doesn't handle “${request.slice(0, 64)}”.`);
    }
  };
}

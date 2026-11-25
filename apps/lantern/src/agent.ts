/**
 * Lantern's Company Agent (PAP 1.0 §8): deterministic, with no model. The
 * Personal Agent sends a structured request in `data.request`; Lantern
 * answers with data and a short fixed sentence. Anything else gets the list
 * of requests it handles. Account requests answer with an `authorization`
 * event until the token has the scopes (§8.11). A refund for a missing item
 * is an Operations v3 operation in the reply, performed only when a later
 * message carries the User's approval.
 *
 * Direct Conversations (§8.10): before refunding a whole order that never
 * arrived, Lantern asks to talk with the customer (`user_requested`). In the
 * Direct Conversation it asks one question, answered "yes" or "no" in the
 * customer's own words, and proposes the refund on "yes". It reads nothing
 * else there: anything more gets the phone number.
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
  {
    request: "order_not_delivered",
    description:
      "None of a delivered order arrived. Before refunding all of it, Lantern asks to talk with the customer directly.",
    fields: { order_id: "ID of the delivered order (see order_status)" },
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

  /** A refund for missing dishes, as an Operations v3 action. */
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
      // Operations v3 §2: no operations for an agent without the extension.
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

  /** What's still refundable on the delivered order, or a reply saying why not. */
  function refundable(turn: ConversationTurn, orderId: string) {
    const refunds = deps.refunds(turn.account!);
    const order = deliveredView(turn.account!, refunds);
    if (!order || order.id !== orderId)
      return {
        reply: {
          replies: [
            {
              text: `I can't find delivered order ${orderId.slice(0, 40)} on your account.`,
              data: { error: "order_not_found", delivered_order: order?.id },
            },
          ],
        } satisfies TurnResult,
      };
    const lines = Object.fromEntries(
      order.items
        .filter((i) => i.quantity > i.refunded_quantity)
        .map((i) => [i.dish_id, i.quantity - i.refunded_quantity]),
    );
    if (!Object.keys(lines).length)
      return {
        reply: {
          replies: [
            {
              text: `Order ${order.id} was already refunded.`,
              data: { error: "already_refunded", refunds: order.refunds },
            },
          ],
        } satisfies TurnResult,
      };
    const amount = order.items.reduce(
      (n, i) => n + (lines[i.dish_id] ?? 0) * i.unit_price_cents,
      0,
    );
    return { order, lines, amount, refunds };
  }

  /** A refund of everything still refundable on the order, after a word with the customer. */
  function wholeRefund(turn: ConversationTurn, orderId: string): TurnResult {
    const found = refundable(turn, orderId);
    if ("reply" in found) return found.reply;
    const { order, lines, amount, refunds } = found;
    turn.memory.pending = { kind: "whole", order_id: order.id };
    const outcome = turn.propose({
      key: `refund-all:${order.id}:${order.refunds.length}`,
      terms: {
        order_id: order.id,
        lines,
        refund_cents: amount,
        currency: "USD",
        method: "Simulated refund to the card used for the order",
      },
      summary: `Refund all of order ${order.id} (${usd(amount)}), which didn't arrive, to the card used for it. Simulated: no real money moves.`,
      perform: (t) => {
        const at = new Date().toISOString();
        const records = Object.entries(t.lines as Record<string, number>).map(
          ([dish_id, quantity]): Refund => ({
            order_id: String(t.order_id),
            dish_id,
            quantity,
            amount_cents:
              quantity * menu.find((m) => m.id === dish_id)!.price_cents,
            at,
          }),
        );
        refunds.push(...records);
        turn.memory.pending = { kind: "whole", order_id: order.id, done: true };
        return {
          summary: `Refunded ${usd(Number(t.refund_cents))} for order ${String(t.order_id)}. Simulated: no real money moves.`,
          data: { refunds: records },
        };
      },
    });
    return outcomeReply(outcome, amount, `order ${order.id}`);
  }

  /** §8.10: the customer, in their own words, in a Direct Conversation. */
  function direct(turn: ConversationTurn): TurnResult {
    const call = `For anything else, call ${PHONE} (${PHONE_HOURS}).`;
    const invite = turn.direct!.parent.invite;
    const orderId =
      turn.direct!.requested &&
      object(invite) &&
      typeof invite.order_id === "string"
        ? invite.order_id
        : undefined;
    // `asked` is the order while the question is open and false once it's
    // answered, so the question is asked once (unset means not asked yet).
    if (turn.opening || (orderId && turn.memory.asked === undefined)) {
      if (!orderId)
        return {
          replies: [
            { text: `This is Lantern. ${call}`, data: { phone: PHONE } },
          ],
        };
      turn.memory.asked = orderId;
      return {
        replies: [
          {
            text: `Hi, this is Lantern. Did none of order ${orderId} arrive? Reply yes or no.`,
            data: {
              question: "order_not_delivered",
              order_id: orderId,
              answers: ["yes", "no"],
            },
          },
        ],
      };
    }
    const asked =
      typeof turn.memory.asked === "string" ? turn.memory.asked : undefined;
    const said = (
      turn.message.author === "human" ? (turn.message.text ?? "") : ""
    )
      .trim()
      .toLowerCase();
    if (!asked)
      return {
        replies: [
          {
            text: `You're talking with Lantern directly. Nobody can join right now, and here our automated agent only answers questions it asked. ${call}`,
            data: { phone: PHONE, hours: PHONE_HOURS },
          },
        ],
      };
    if (/^(yes|y|yeah|yep|correct)\b/.test(said)) {
      // Signed out, the question stays open: "yes" counts after signing in.
      const missing = needs(turn, ["orders:read", "orders:write"]);
      if (missing) return missing;
      turn.memory.asked = false;
      return wholeRefund(turn, asked);
    }
    if (/^(no|n|nope)\b/.test(said)) {
      turn.memory.asked = false;
      return {
        replies: [
          {
            text: "Thanks. Then something did arrive: tell your agent which dish was missing, and it can report it. You can close this conversation.",
            data: { answer: "no" },
          },
        ],
      };
    }
    return {
      replies: [
        {
          text: `Please reply yes or no: did none of order ${asked} arrive? ${call}`,
          data: {
            question: "order_not_delivered",
            order_id: asked,
            answers: ["yes", "no"],
          },
        },
      ],
    };
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
    // A repeated approval of a performed refund adds nothing (Operations v3 §7).
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
    if (turn.direct && !turn.approval) return direct(turn);
    const data = turn.message.data ?? {};
    // The User's approval of the pending refund (Operations v3 §6).
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
      if (pending.kind === "whole")
        return wholeRefund(turn, String(pending.order_id));
      return refund(turn, {
        order_id: String(pending.order_id),
        dish_id: String(pending.dish_id),
        quantity: Number(pending.quantity),
      });
    }
    // §8.10: the Personal Agent says the User declined the invitation.
    if (data.user_requested === "declined" && turn.memory.invite) {
      delete turn.memory.invite;
      return {
        replies: [
          {
            text: `Understood. Without a word with you, Lantern can't refund the whole order here. Call ${PHONE} (${PHONE_HOURS}) when it suits you, or report the dishes that were missing one by one.`,
            data: { user_requested: "declined", phone: PHONE },
          },
        ],
      };
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
      case "order_not_delivered": {
        const missing = needs(turn, ["orders:read", "orders:write"]);
        if (missing) return missing;
        if (typeof data.order_id !== "string")
          return {
            replies: [
              {
                text: "Send order_id.",
                data: {
                  error: "invalid_request",
                  fields: agentRequests[4].fields,
                },
              },
            ],
          };
        if (!turn.operations)
          return {
            replies: [
              {
                text: `A refund needs your approval, which your agent can't send. Call ${PHONE} instead.`,
                data: { error: "approval_unavailable", phone: PHONE },
              },
            ],
          };
        const found = refundable(turn, data.order_id);
        if ("reply" in found) return found.reply;
        turn.memory.invite = { order_id: found.order.id };
        return {
          replies: [
            {
              text: `Refunding all of order ${found.order.id} (${usd(found.amount)}) needs a word with you first. I've asked to talk with you directly.`,
              data: {
                order_id: found.order.id,
                refund_cents: found.amount,
                next: "user_requested",
              },
            },
          ],
          requestUser: `Lantern wants to confirm with you that order ${found.order.id} never arrived before refunding all of it.`,
        };
      }
      default:
        return catalogue(`Lantern doesn't handle “${request.slice(0, 64)}”.`);
    }
  };
}

/** Deterministic Harborline Company Agent for PAP 1.0 conversations. */
import type {
  ConversationHandler,
  ConversationTurn,
  Outcome,
  TurnResult,
} from "@poppy-lab/pap-company";
import { FICTION_NOTICE, usd, withinGrant } from "./data.ts";
import type { CustomerState } from "./harborline.ts";

type Deps = { customerFor: (account: string) => CustomerState };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const agentRequests = [
  {
    request: "cash_position",
    description: "Owned accounts and total fictional available balance.",
    fields: {},
    scopes: ["accounts:read"],
  },
  {
    request: "spending_summary",
    description: "Recent debit totals by category and current budgets.",
    fields: {},
    scopes: ["transactions:read", "budgets:read"],
  },
  {
    request: "card_status",
    description: "Fictional cards and their active, frozen or inactive status.",
    fields: {},
    scopes: ["cards:read"],
  },
  {
    request: "freeze_card",
    description:
      "Propose freezing one active fictional card. The user separately approves the exact card and current version.",
    fields: { card_id: "Card ID returned by card_status or the cards API" },
    scopes: ["cards:read", "cards:write"],
  },
] as const;

export function harborlineAgent(deps: Deps): ConversationHandler {
  const needs = (turn: ConversationTurn, required: readonly string[]) =>
    !turn.account || required.some((scope) => !turn.scopes.includes(scope))
      ? ({
          replies: [
            {
              text: "That needs additional Harborline account access. Sign in or add the listed permissions, then send the request again.",
              data: { error: "sign_in_required", scopes: required },
            },
          ],
          authorization: required.join(" "),
        } satisfies TurnResult)
      : undefined;
  /**
   * The signed-in customer and what the grant may see and act on of it: the
   * accounts chosen at consent, or every account (`withinGrant`).
   */
  const reachOf = (turn: ConversationTurn) => {
    const customer = deps.customerFor(turn.account!);
    return { customer, ...withinGrant(customer, turn.resources) };
  };
  const catalogue = (note?: string): TurnResult => ({
    replies: [
      {
        text: `${note ? `${note} ` : ""}Harborline's automated guide accepts structured requests in data.request. No real banker, account or money is involved.`,
        data: { requests: agentRequests, notice: FICTION_NOTICE },
      },
    ],
  });
  const outcomeReply = (outcome: Outcome): TurnResult => {
    const body = outcome.body as {
      operation?: Record<string, unknown>;
      summary?: string;
      data?: unknown;
      error?: string;
      operation_id?: string;
    };
    if (outcome.replayed) return {};
    if (outcome.status === 403 && body.operation)
      return {
        replies: [
          {
            text: "I can freeze that fictional card after you approve the exact operation.",
            operation: body.operation,
          },
        ],
      };
    if (outcome.status === 200)
      return {
        replies: [
          {
            text: body.summary ?? "The fictional card change was completed.",
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
              ? "The card changed after the proposal. Ask again for fresh terms."
              : "Harborline can't propose that change right now.",
          data: { error: body.error ?? "unavailable" },
        },
      ],
    };
  };
  const freeze = (turn: ConversationTurn, cardId: string): TurnResult => {
    const card = reachOf(turn).cards.find((item) => item.id === cardId);
    if (!card)
      return {
        replies: [
          {
            text: "That card isn't on this fictional account.",
            data: { error: "card_not_found" },
          },
        ],
      };
    if (card.status === "inactive")
      return {
        replies: [
          {
            text: "That fictional card is inactive and can't be frozen.",
            data: { error: "card_inactive" },
          },
        ],
      };
    if (card.status === "frozen")
      return {
        replies: [
          {
            text: "That fictional card is already frozen.",
            data: { error: "card_already_frozen", card },
          },
        ],
      };
    if (!turn.operations)
      return {
        replies: [
          {
            text: "Freezing needs Operations v3 approval, which this request didn't declare.",
            data: { error: "approval_unavailable" },
          },
        ],
      };
    turn.memory.pending = { card_id: card.id, version: card.version };
    return outcomeReply(
      turn.propose({
        key: `freeze-card:${card.id}:${card.version}`,
        terms: {
          card_id: card.id,
          card_label: card.label,
          card_last4: card.last4,
          from_status: card.status,
          to_status: "frozen",
          card_version: card.version,
          notice: FICTION_NOTICE,
        },
        summary: `Freeze ${card.label} ending ${card.last4}. Current status active; new status frozen. Fictional card only.`,
        stale: (terms) =>
          card.version !== terms.card_version || card.status !== "active",
        perform: () => {
          card.status = "frozen";
          card.version++;
          turn.memory.pending = {
            ...(turn.memory.pending as Record<string, unknown>),
            done: true,
          };
          return {
            summary: `${card.label} ending ${card.last4} is now frozen. Fictional card only.`,
            data: { card },
          };
        },
      }),
    );
  };

  return (turn) => {
    if (turn.approval) {
      const missing = needs(turn, ["cards:read", "cards:write"]);
      if (missing) return missing;
      const pending = turn.memory.pending;
      if (object(pending) && pending.done) return {};
      if (!object(pending) || typeof pending.card_id !== "string")
        return {
          replies: [
            {
              text: "Nothing in this conversation is waiting for approval.",
              data: { error: "no_pending_operation" },
            },
          ],
        };
      return freeze(turn, pending.card_id);
    }
    const data = turn.message.data ?? {};
    const request = typeof data.request === "string" ? data.request : undefined;
    switch (request) {
      case undefined:
      case "help":
        return catalogue(
          turn.message.text && !request
            ? "I don't interpret free text in this deterministic demo."
            : undefined,
        );
      case "cash_position": {
        const missing = needs(turn, ["accounts:read"]);
        if (missing) return missing;
        const { accounts } = reachOf(turn);
        const total = accounts.reduce(
          (sum, account) => sum + account.available_cents,
          0,
        );
        return {
          replies: [
            {
              text: `Your total fictional available balance is ${usd(total)}.`,
              data: {
                accounts,
                total_available_cents: total,
                currency: "USD",
                notice: FICTION_NOTICE,
              },
            },
          ],
        };
      }
      case "spending_summary": {
        const missing = needs(turn, ["transactions:read", "budgets:read"]);
        if (missing) return missing;
        const { customer, transactions } = reachOf(turn);
        const spending: Record<string, number> = {};
        for (const transaction of transactions)
          if (transaction.amount_cents < 0)
            spending[transaction.category] =
              (spending[transaction.category] ?? 0) - transaction.amount_cents;
        return {
          replies: [
            {
              text: "Here is the fictional spending summary and current budgets.",
              data: {
                spending_by_category_cents: spending,
                budgets: customer.budgets,
                currency: "USD",
                notice: FICTION_NOTICE,
              },
            },
          ],
        };
      }
      case "card_status": {
        const missing = needs(turn, ["cards:read"]);
        if (missing) return missing;
        return {
          replies: [
            {
              text: "Here are the fictional cards and their current status.",
              data: {
                cards: reachOf(turn).cards,
                notice: FICTION_NOTICE,
              },
            },
          ],
        };
      }
      case "freeze_card": {
        const missing = needs(turn, ["cards:read", "cards:write"]);
        if (missing) return missing;
        if (typeof data.card_id !== "string")
          return {
            replies: [
              {
                text: "Send card_id from card_status or the cards API.",
                data: { error: "invalid_request" },
              },
            ],
          };
        return freeze(turn, data.card_id);
      }
      default:
        return catalogue(
          `Harborline doesn't handle “${request.slice(0, 64)}”.`,
        );
    }
  };
}

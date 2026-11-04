/**
 * Juniper's Company Agent (PAP 0.3 §8): deterministic, with no model. The
 * Personal Agent sends a structured request in `data.request`; Juniper
 * answers with data and a short fixed sentence. Reporting a problem proposes
 * a support case as an Operations v2 operation; a later message with the
 * User's approval opens it, and it then shows on the website like any case.
 */
import { randomId } from "@poppy-lab/pap-client/core";
import type {
  ConversationHandler,
  ConversationTurn,
  Session,
  TurnResult,
} from "@poppy-lab/pap-company";
import { faqs } from "./customer-services.js";

export const PHONE = "+1 555-0117";
export const PHONE_HOURS = "Monday to Saturday, 8am–7pm";
const TOPICS = ["delivery", "billing", "profile", "other"] as const;

export const agentRequests = [
  {
    request: "store_info",
    description: "Opening hours, delivery days and fees, and common answers.",
    fields: {},
    scopes: [],
  },
  {
    request: "delivery_status",
    description: "The recurring delivery and recent orders.",
    fields: {},
    scopes: ["poppy:read"],
  },
  {
    request: "report_problem",
    description:
      "Something went wrong with an order, a delivery or a bill. Juniper proposes a support case, which the user approves; a person reviews refunds.",
    fields: {
      topic: TOPICS.join(" | "),
      subject: "Short subject, up to 120 characters",
      message: "What happened, up to 2000 characters",
      order_id: "Optional: the order it is about",
    },
    scopes: ["poppy:read", "poppy:write"],
  },
] as const;

type Commerce = {
  view: (s: Session) => {
    delivery: unknown;
    orders: Array<{ id: string }>;
  };
  services: {
    apply: (
      s: Session,
      t: Record<string, unknown>,
    ) => { summary: string; data?: unknown };
    stale: (s: Session, t: Record<string, unknown>) => boolean;
  };
};

export function juniperAgent(
  commerce: Commerce,
  store: { hours: string; returns: string; delivery: Record<string, unknown> },
): ConversationHandler {
  // Juniper's business code reads the account from a Session.
  const sessionOf = (turn: ConversationTurn): Session => ({
    client: "conversation",
    user: "conversation",
    expires: 0,
    account: turn.account!,
  });
  const needs = (turn: ConversationTurn, scopes: readonly string[]) =>
    !turn.account || scopes.some((s) => !turn.scopes.includes(s))
      ? ({
          replies: [
            {
              text: "That needs your Juniper account. Sign in, then send the request again.",
              data: { error: "sign_in_required", scopes },
            },
          ],
          authorization: scopes.join(" "),
        } satisfies TurnResult)
      : undefined;
  const catalogue = (note?: string): TurnResult => ({
    replies: [
      {
        text: `${note ? `${note} ` : ""}Juniper's automated agent answers structured requests: send one in data.request. To reach a person, ask for a handoff.`,
        data: {
          requests: agentRequests,
          handoff: "POST {conversation}/handoff",
        },
      },
    ],
  });

  /** A support case, as an Operations v2 action (the case ID is fixed). */
  function proposeCase(
    turn: ConversationTurn,
    terms: Record<string, unknown>,
  ): TurnResult {
    const s = sessionOf(turn);
    if (commerce.services.stale(s, terms))
      return {
        replies: [
          {
            text: "I can't open that case: check the order ID, or close an old case first.",
            data: { error: "invalid_case" },
          },
        ],
      };
    turn.memory.pending = terms;
    const outcome = turn.propose({
      key: `case:${terms.case_id}`,
      terms,
      summary: `Open a fictional ${terms.topic} support case: “${terms.subject}”. Message: “${terms.message}”.${terms.order_id ? ` Order ${terms.order_id}.` : ""} It only creates a case; a person reviews any refund, and no order or amount changes now.`,
      perform: (t) => {
        const result = commerce.services.apply(s, t);
        turn.memory.pending = { ...t, done: true };
        return result;
      },
      stale: (t) => commerce.services.stale(s, t),
    });
    const body = outcome.body as {
      operation?: Record<string, unknown>;
      summary?: string;
      operation_id?: string;
      data?: { id?: string };
      error?: string;
    };
    if (outcome.replayed) return {};
    if (outcome.status === 403 && body.operation)
      return {
        replies: [
          {
            text: "I can open a support case with these details. I'll do it once you approve.",
            operation: body.operation,
          },
        ],
      };
    if (outcome.status === 200)
      return {
        replies: [
          {
            text: body.summary ?? "Case opened.",
            data: {
              operation_id: body.operation_id,
              case_id: body.data?.id,
              next: "A person reviews the case. It shows on the website under Support.",
            },
          },
        ],
      };
    return {
      replies: [
        {
          text: "I can't open the case right now. Try again later.",
          data: { error: body.error ?? "unavailable" },
        },
      ],
    };
  }

  return (turn) => {
    const data = turn.message.data ?? {};
    if (turn.approval) {
      const missing = needs(turn, ["poppy:read", "poppy:write"]);
      if (missing) return missing;
      const pending = turn.memory.pending as
        Record<string, unknown> | undefined;
      if (pending?.done) return {};
      if (!pending)
        return {
          replies: [
            {
              text: "Nothing in this conversation is waiting for approval.",
              data: { error: "no_pending_operation" },
            },
          ],
        };
      return proposeCase(turn, pending);
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
      case "store_info":
        return {
          replies: [
            {
              text: "Here are Juniper's hours, delivery and common answers.",
              data: {
                hours: store.hours,
                returns: store.returns,
                delivery: store.delivery,
                faqs,
                phone: PHONE,
              },
            },
          ],
        };
      case "delivery_status": {
        const missing = needs(turn, ["poppy:read"]);
        if (missing) return missing;
        const view = commerce.view(sessionOf(turn));
        return {
          replies: [
            {
              text: "Here is your recurring delivery and your recent orders.",
              data: {
                delivery: view.delivery,
                orders: view.orders.slice(0, 5),
              },
            },
          ],
        };
      }
      case "report_problem": {
        const missing = needs(turn, ["poppy:read", "poppy:write"]);
        if (missing) return missing;
        const { topic, subject, message, order_id } = data;
        if (
          typeof topic !== "string" ||
          !(TOPICS as readonly string[]).includes(topic) ||
          typeof subject !== "string" ||
          !subject.trim() ||
          subject.length > 120 ||
          typeof message !== "string" ||
          !message.trim() ||
          message.length > 2000 ||
          (order_id !== undefined &&
            (typeof order_id !== "string" || order_id.length > 100))
        )
          return {
            replies: [
              {
                text: "Send topic, subject and message (and optionally order_id).",
                data: {
                  error: "invalid_request",
                  fields: agentRequests[2].fields,
                },
              },
            ],
          };
        return proposeCase(turn, {
          kind: "support_case",
          case_id: `case_${randomId()}`,
          topic,
          subject: subject.trim(),
          message: message.trim(),
          ...(order_id ? { order_id } : {}),
        });
      }
      default:
        return catalogue(`Juniper doesn't handle “${request.slice(0, 64)}”.`);
    }
  };
}

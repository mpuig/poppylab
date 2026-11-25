/** Deterministic PAP 1.0 Company Agent for Northwind Air. */
import type {
  ConversationHandler,
  ConversationTurn,
  TurnResult,
} from "@poppy-lab/pap-company";
import {
  FICTION_NOTICE,
  PHONE,
  PHONE_HOURS,
  travelInformation,
} from "./data.ts";

type Deps = {
  booking: (account: string) => unknown;
  loyalty: (account: string) => unknown;
  status: (number: string, date: string) => unknown;
};

export const agentRequests = [
  {
    request: "flight_status",
    description: "Fictional status and gate for a flight number and date.",
    fields: { flight_number: "For example NA 402", date: "YYYY-MM-DD" },
    scopes: [],
  },
  {
    request: "travel_information",
    description: "Baggage, check-in or fare-condition information.",
    fields: { topic: "baggage, check_in or fares" },
    scopes: [],
  },
  {
    request: "trip_summary",
    description: "The signed-in customer's upcoming fictional booking.",
    fields: {},
    scopes: ["bookings:read"],
  },
  {
    request: "loyalty_summary",
    description: "Loyalty balance, tier and points due to expire.",
    fields: {},
    scopes: ["profile:read"],
  },
] as const;

export function northwindAgent(deps: Deps): ConversationHandler {
  const needs = (turn: ConversationTurn, scopes: string[]) =>
    !turn.account || scopes.some((scope) => !turn.scopes.includes(scope))
      ? ({
          replies: [
            {
              text: "That needs your fictional Northwind account. Sign in with the listed read permission, then send the request again.",
              data: { error: "sign_in_required", scopes },
            },
          ],
          authorization: scopes.join(" "),
        } satisfies TurnResult)
      : undefined;
  const help = (note?: string): TurnResult => ({
    replies: [
      {
        text: `${note ? `${note} ` : ""}Northwind's automated travel desk accepts structured requests in data.request. To reach a person, request a handoff.`,
        data: { requests: agentRequests, notice: FICTION_NOTICE },
      },
    ],
  });
  return (turn) => {
    const data = turn.message.data ?? {};
    const request = typeof data.request === "string" ? data.request : undefined;
    switch (request) {
      case undefined:
      case "help":
        return help(
          turn.message.text && !request
            ? "I don't interpret free text; use a structured request."
            : undefined,
        );
      case "flight_status": {
        if (
          typeof data.flight_number !== "string" ||
          typeof data.date !== "string"
        )
          return {
            replies: [
              {
                text: "Send flight_number and date.",
                data: {
                  error: "invalid_request",
                  fields: agentRequests[0].fields,
                },
              },
            ],
          };
        const status = deps.status(data.flight_number, data.date);
        return status
          ? {
              replies: [
                {
                  text: `Here is the fictional status for ${data.flight_number}.`,
                  data: { flight: status, notice: FICTION_NOTICE },
                },
              ],
            }
          : {
              replies: [
                {
                  text: "I couldn't find that fictional flight and date.",
                  data: { error: "flight_not_found" },
                },
              ],
            };
      }
      case "travel_information": {
        const topic = data.topic as keyof typeof travelInformation;
        const information = travelInformation[topic];
        return information
          ? {
              replies: [
                {
                  text: information.title,
                  data: { topic, ...information, notice: FICTION_NOTICE },
                },
              ],
            }
          : {
              replies: [
                {
                  text: "Choose baggage, check_in or fares.",
                  data: { error: "unknown_topic" },
                },
              ],
            };
      }
      case "trip_summary": {
        const missing = needs(turn, ["bookings:read"]);
        if (missing) return missing;
        return {
          replies: [
            {
              text: "Here is your upcoming fictional trip.",
              data: {
                booking: deps.booking(turn.account!),
                notice: FICTION_NOTICE,
              },
            },
          ],
        };
      }
      case "loyalty_summary": {
        const missing = needs(turn, ["profile:read"]);
        if (missing) return missing;
        return {
          replies: [
            {
              text: "Here is your fictional Northwind loyalty account.",
              data: {
                loyalty: deps.loyalty(turn.account!),
                notice: FICTION_NOTICE,
              },
            },
          ],
        };
      }
      default:
        return help(`Northwind doesn't handle “${request.slice(0, 64)}”.`);
    }
  };
}

export const handoff = {
  text: `Nobody can join this fictional conversation. Call ${PHONE} (${PHONE_HOURS}).`,
  data: { handoff: "unavailable", phone: PHONE, hours: PHONE_HOURS },
};

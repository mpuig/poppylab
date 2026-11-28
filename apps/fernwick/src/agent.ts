/**
 * Fernwick's deterministic Company Agent for PAP 1.0 conversations (§8):
 * structured requests in `data.request`, structured replies. It keeps to
 * the meters chosen at consent, as both APIs do (`withinGrant`), and its
 * one change, a rate plan switch, waits for Operations v3 approval.
 */
import type {
  ConversationHandler,
  ConversationTurn,
  Outcome,
  TurnResult,
} from "@poppy-lab/pap-company";
import {
  FICTION_NOTICE,
  kwh,
  planIds,
  plans,
  usd,
  type PlanId,
} from "./data.ts";
import { billsFor, monthToDate } from "./billing.ts";
import { nowSeconds } from "./time.ts";
import { withinGrant, type Customer, type Meter } from "./state.ts";
import { cannotSwitch, switchAction } from "./plans.ts";

type Deps = { customerFor: (account: string) => Customer };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const agentRequests = [
  {
    request: "usage_this_month",
    description:
      "Energy delivered (and sent to the grid) and its cost this month so far, per shared meter.",
    fields: {},
    scopes: ["account:read"],
  },
  {
    request: "last_bill",
    description: "The last closed monthly bill of each shared meter.",
    fields: {},
    scopes: ["account:read"],
  },
  {
    request: "change_plan",
    description:
      "Propose switching a shared meter between the flat and time-of-use plans from the next bill cycle. The user separately approves the exact terms.",
    fields: {
      usage_point_id: "Meter ID from the account API, such as UP-E1",
      plan: "flat or time-of-use",
    },
    scopes: ["account:read", "plan:write"],
  },
] as const;

/** What each scope lets the agent do, in the consent page's plain words. */
const permissions: Record<string, string> = {
  "account:read": "see your meters, rate plans and bills",
  "plan:write": "propose switching a meter's rate plan",
};

export function fernwickAgent(deps: Deps): ConversationHandler {
  // §8.11. A customer who is signed in is told which permission is
  // missing, not to sign in.
  const needs = (
    turn: ConversationTurn,
    required: readonly string[],
  ): TurnResult | undefined => {
    const missing = required.filter((scope) => !turn.scopes.includes(scope));
    if (turn.account && !missing.length) return undefined;
    return {
      replies: [
        turn.account
          ? {
              text: `You're signed in, but you haven't allowed this agent to ${missing.map((s) => permissions[s] ?? s).join(" or ")}. Allow it from your agent, then send the request again.`,
              data: { error: "insufficient_scope", scopes: required },
            }
          : {
              text: "That needs Fernwick account access. Sign in or add the listed permissions, then send the request again.",
              data: { error: "sign_in_required", scopes: required },
            },
      ],
      authorization: required.join(" "),
    };
  };
  /** The signed-in customer and the meters chosen at consent. */
  const reachOf = (turn: ConversationTurn) => {
    const customer = deps.customerFor(turn.account!);
    return { customer, meters: withinGrant(customer, turn.resources) };
  };
  const catalogue = (note?: string): TurnResult => ({
    replies: [
      {
        text: `${note ? `${note} ` : ""}I'm Fernwick's automated guide. I can show this month's energy use and its cost and your last bill, and switch a meter between the flat and time-of-use plans for you to approve. No real utility, meter or bill is involved.`,
        data: { requests: agentRequests, notice: FICTION_NOTICE },
      },
    ],
  });
  const reply = (text: string, data: Record<string, unknown>): TurnResult => ({
    replies: [{ text, data: { ...data, notice: FICTION_NOTICE } }],
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
            text: "I can schedule that plan change after you approve the exact terms.",
            operation: body.operation,
          },
        ],
      };
    if (outcome.status === 200)
      return {
        replies: [
          {
            text: body.summary ?? "The fictional plan change is scheduled.",
            data: {
              operation_id: body.operation_id,
              ...(object(body.data) ? body.data : {}),
            },
          },
        ],
      };
    return reply(
      outcome.status === 409
        ? "The meter changed after the proposal. Ask again for fresh terms."
        : "Fernwick can't propose that change right now.",
      { error: body.error ?? "unavailable" },
    );
  };
  const switchPlan = (
    turn: ConversationTurn,
    meterId: string,
    to: PlanId,
  ): TurnResult => {
    const { customer, meters } = reachOf(turn);
    const meter = meters.find((item: Meter) => item.seed.id === meterId);
    if (!meter)
      return reply("That meter isn't shared with this agent.", {
        error: "meter_not_found",
      });
    const now = nowSeconds();
    // An approval of a proposal this conversation made: the same meter
    // version, so the checks below don't turn away its own proposal.
    const pending = turn.memory.pending;
    const approving =
      !!turn.approval &&
      object(pending) &&
      pending.version === meter.state.version;
    const refused = approving ? undefined : cannotSwitch(meter, to, now);
    if (refused)
      return reply(
        refused === "plan_unchanged"
          ? `${meter.seed.label} is already on ${plans[to].name}.`
          : `${meter.seed.label} already has a plan change waiting for the next bill cycle.`,
        { error: refused },
      );
    if (!turn.operations)
      return reply(
        "A plan change needs Operations v3 approval, which this request didn't declare.",
        { error: "approval_unavailable" },
      );
    const version = meter.state.version;
    turn.memory.pending = { usage_point_id: meter.seed.id, plan: to, version };
    const action = switchAction({
      customer,
      meter,
      to,
      key: `agent-plan:${meter.seed.id}:${version}:${to}`,
      id: `chg_FPL_agent_${meter.seed.id}_${version}`,
      now,
    });
    return outcomeReply(
      turn.propose({
        ...action,
        perform: (terms) => {
          const done = action.perform(terms);
          turn.memory.pending = {
            ...(turn.memory.pending as Record<string, unknown>),
            done: true,
          };
          return done;
        },
      }),
    );
  };

  return (turn) => {
    if (turn.approval) {
      const missing = needs(turn, ["account:read", "plan:write"]);
      if (missing) return missing;
      const pending = turn.memory.pending;
      if (object(pending) && pending.done) return {};
      if (
        !object(pending) ||
        typeof pending.usage_point_id !== "string" ||
        !planIds.includes(pending.plan as PlanId)
      )
        return reply("Nothing in this conversation is waiting for approval.", {
          error: "no_pending_operation",
        });
      return switchPlan(turn, pending.usage_point_id, pending.plan as PlanId);
    }
    const data = turn.message.data ?? {};
    const request = typeof data.request === "string" ? data.request : undefined;
    const now = nowSeconds();
    switch (request) {
      case undefined:
      case "help":
        return catalogue(
          turn.message.text && !request
            ? "I can't read written messages, only the requests I handle."
            : undefined,
        );
      case "usage_this_month": {
        const missing = needs(turn, ["account:read"]);
        if (missing) return missing;
        const usage = reachOf(turn).meters.map((meter) => {
          const month = monthToDate(meter.seed, meter.history, now);
          return {
            usage_point_id: meter.seed.id,
            meter: meter.seed.label,
            from: new Date(month.start * 1000).toISOString(),
            to: new Date(month.to * 1000).toISOString(),
            delivered_kwh: (month.deliveredWh / 1000).toFixed(1),
            ...(month.receivedWh
              ? { sent_to_grid_kwh: (month.receivedWh / 1000).toFixed(1) }
              : {}),
            energy_cost_cents: Math.round(month.energyCost / 1000),
          };
        });
        const total = usage.reduce(
          (sum, item) => sum + item.energy_cost_cents,
          0,
        );
        return reply(
          usage.length
            ? `This month so far: ${usage.map((item) => `${item.meter} ${item.delivered_kwh} kWh`).join(", ")}; energy ${usd(total * 1000)} before the service charge.`
            : "No meter is shared with this agent.",
          { usage, energy_cost_cents: total, currency: "USD" },
        );
      }
      case "last_bill": {
        const missing = needs(turn, ["account:read"]);
        if (missing) return missing;
        const bills = reachOf(turn).meters.map((meter) => {
          const bill = billsFor(meter.seed, meter.history, now).at(-1)!;
          return {
            usage_point_id: meter.seed.id,
            meter: meter.seed.label,
            month: bill.id,
            plan: bill.plan,
            delivered_kwh: (bill.deliveredWh / 1000).toFixed(1),
            total_cents: Math.round(bill.total / 1000),
          };
        });
        return reply(
          bills.length
            ? bills
                .map(
                  (bill) =>
                    `${bill.meter}, ${bill.month}: ${kwh(Number(bill.delivered_kwh) * 1000)}, ${usd(bill.total_cents * 1000)}.`,
                )
                .join(" ")
            : "No meter is shared with this agent.",
          { bills, currency: "USD" },
        );
      }
      case "change_plan": {
        const missing = needs(turn, ["account:read", "plan:write"]);
        if (missing) return missing;
        const to = planIds.find((id) => id === data.plan);
        if (typeof data.usage_point_id !== "string" || !to)
          return reply(
            "Send usage_point_id from the account API and plan, flat or time-of-use.",
            { error: "invalid_request" },
          );
        return switchPlan(turn, data.usage_point_id, to);
      }
      default:
        return catalogue(`Fernwick doesn't handle “${request.slice(0, 64)}”.`);
    }
  };
}

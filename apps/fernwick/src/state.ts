/**
 * What Fernwick keeps per tenant: each meter's plans over time and the
 * plan changes performed. Everything else (usage, costs, bills) is
 * computed from the seeds on demand.
 */
import {
  customers,
  energyPersona,
  type CustomerSeed,
  type MeterSeed,
  type PlanId,
} from "./data.ts";
import { planAt, type PlanHistory } from "./billing.ts";

export type PlanChange = {
  id: string;
  usage_point_id: string;
  from_plan: PlanId;
  to_plan: PlanId;
  /** The UTC day it takes effect, the first of a bill cycle. */
  effective_date: string;
  created_at: string;
};
export type MeterState = {
  plans: Array<{ plan: PlanId; from: number }>;
  version: number;
};
export type CustomerState = {
  id: string;
  meters: Record<string, MeterState>;
  changes: PlanChange[];
};
export type State = { customers?: Record<string, CustomerState> };

export const freshCustomer = (seed: CustomerSeed): CustomerState => ({
  id: seed.id,
  meters: Object.fromEntries(
    seed.meters.map((meter) => [
      meter.id,
      { plans: [{ plan: meter.plan, from: 0 }], version: 1 },
    ]),
  ),
  changes: [],
});

/** A meter with its seed and its plans, as the APIs and the agent use it. */
export type Meter = {
  seed: MeterSeed;
  state: MeterState;
  history: PlanHistory;
};
/** The tenant's customers, created from the seeds on first use. */
export function customerStore(state: State) {
  const all = (state.customers ??= {});
  const customerFor = (id: string) => {
    const seed = energyPersona(id) ?? customers[0]!;
    const customer = (all[seed.id] ??= freshCustomer(seed));
    const meters: Meter[] = seed.meters.map((meter) => {
      const meterState = (customer.meters[meter.id] ??= {
        plans: [{ plan: meter.plan, from: 0 }],
        version: 1,
      });
      return { seed: meter, state: meterState, history: meterState.plans };
    });
    return { seed, customer, meters };
  };
  return customerFor;
}
export type Customer = ReturnType<ReturnType<typeof customerStore>>;

/**
 * The meters a grant reaches: those chosen at consent (`selectResources`).
 * The choice limits the whole grant, the ESPI-shaped API, Fernwick's own
 * API and the Company Agent alike. A grant without resources reaches none:
 * every Fernwick grant that can read a meter asked for the choice.
 */
export const withinGrant = (
  customer: Customer,
  resources: readonly string[] | undefined,
) => {
  const chosen = new Set(resources ?? []);
  return customer.meters.filter((meter) => chosen.has(meter.seed.id));
};

/** The plan in force now, and a change waiting for the next cycle. */
export function planStatus(meter: Meter, now: number) {
  const current = planAt(meter.history, now);
  const next = meter.history.find((entry) => entry.from > now);
  return {
    current,
    ...(next
      ? {
          scheduled: {
            plan: next.plan,
            effective_date: new Date(next.from * 1000)
              .toISOString()
              .slice(0, 10),
          },
        }
      : {}),
  };
}

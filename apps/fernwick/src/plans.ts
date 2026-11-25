/**
 * Switching a meter between the flat and time-of-use plans, the one change
 * Fernwick offers (Operations v3). The same proposal serves the own API and
 * the Company Agent: its exact terms name the meter, both plans, the
 * effective date (the next bill cycle, the 1st of next month) and the
 * estimated monthly difference, the last closed bill priced both ways.
 * Nothing changes before that date; performing it only schedules it.
 */
import type { Action } from "@poppy-lab/pap-company";
import { FICTION_NOTICE, kwh, plans, usd, type PlanId } from "./data.ts";
import { billFor, billsFor } from "./billing.ts";
import { isoDay, nextMonthStart } from "./time.ts";
import {
  planStatus,
  type Customer,
  type Meter,
  type PlanChange,
} from "./state.ts";

export const changeView = (change: PlanChange) => ({
  ...change,
  note: FICTION_NOTICE,
});
const month = (t: number) =>
  new Date(t * 1000).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const longDay = (t: number) =>
  new Date(t * 1000).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** Why a switch can't be proposed now, as an error code; or nothing. */
export function cannotSwitch(meter: Meter, to: PlanId, now: number) {
  const status = planStatus(meter, now);
  if (status.scheduled) return "change_already_scheduled";
  if (status.current === to) return "plan_unchanged";
  return undefined;
}

/** The estimate: the last closed bill, as billed and under `to`. */
export function estimate(meter: Meter, to: PlanId, now: number) {
  const last = billsFor(meter.seed, meter.history, now).at(-1)!;
  const other = billFor(meter.seed, meter.history, last.start, last.end, to);
  return { basis: last, difference: other.total - last.total };
}

/**
 * The Operations v3 action for switching `meter` to `to`, under `key`.
 * `id` names the change it performs, so a performed key is recognized.
 */
export function switchAction(input: {
  customer: Customer;
  meter: Meter;
  to: PlanId;
  key: string;
  id: string;
  now: number;
  extraTerms?: Record<string, unknown>;
}): Action & {
  result: (change: PlanChange) => { summary: string; data: unknown };
} {
  const { customer, meter, to, key, id, now } = input;
  const from = planStatus(meter, now).current;
  const effective = nextMonthStart(now);
  const { basis, difference } = estimate(meter, to, now);
  const label = `${meter.seed.label} (${meter.seed.id})`;
  const differenceText =
    difference === 0
      ? "the same"
      : `${usd(Math.abs(difference))} ${difference > 0 ? "more" : "less"}`;
  const result = (change: PlanChange) => ({
    summary: `${label} switches from ${plans[change.from_plan].name} to ${plans[change.to_plan].name} on ${change.effective_date}, the next bill cycle. Fictional plan change; no electricity is billed.`,
    data: { change: changeView(change) },
  });
  return {
    key,
    terms: {
      usage_point_id: meter.seed.id,
      meter: meter.seed.label,
      from_plan: from,
      to_plan: to,
      from_plan_name: plans[from].name,
      to_plan_name: plans[to].name,
      effective_date: isoDay(effective),
      estimate_basis_month: basis.id,
      estimate_basis_kwh: (basis.deliveredWh / 1000).toFixed(1),
      billed_cents: basis.total / 1000,
      on_new_plan_cents: (basis.total + difference) / 1000,
      estimated_monthly_difference_cents: difference / 1000,
      currency: "USD",
      meter_version: meter.state.version,
      ...input.extraTerms,
      notice: FICTION_NOTICE,
    },
    summary: `Switch ${label} from ${plans[from].name} to ${plans[to].name} from ${longDay(effective)}, the next bill cycle. On ${month(basis.start)}'s usage (${kwh(basis.deliveredWh)}) the bill would have been ${differenceText}: ${usd(basis.total + difference)} instead of ${usd(basis.total)}. An estimate, not a promise; nothing changes before then. Fictional.`,
    // A meter changed since the proposal (another switch, or a cycle that
    // began) is not switched on old terms.
    stale: (approved) =>
      customer.customer.changes.some((change) => change.id === id) ||
      meter.state.version !== approved.meter_version ||
      planStatus(meter, Math.floor(Date.now() / 1000)).current !==
        approved.from_plan ||
      isoDay(nextMonthStart(Math.floor(Date.now() / 1000))) !==
        approved.effective_date,
    perform: (approved) => {
      const at = nextMonthStart(Math.floor(Date.now() / 1000));
      meter.state.plans.push({ plan: approved.to_plan as PlanId, from: at });
      meter.state.version++;
      const change: PlanChange = {
        id,
        usage_point_id: meter.seed.id,
        from_plan: approved.from_plan as PlanId,
        to_plan: approved.to_plan as PlanId,
        effective_date: isoDay(at),
        created_at: new Date().toISOString(),
      };
      customer.customer.changes.push(change);
      return result(change);
    },
    result,
  };
}

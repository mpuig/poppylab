/**
 * Prices and bills, computed from the hourly curves on demand. A reading's
 * cost is its watt-hours times the price of the band its local hour falls
 * in, under the plan in force at that hour, in hundred-thousandths of USD
 * (ESPI's unit for `cost` and amounts). A bill covers one UTC calendar
 * month, closes on the 1st, and is the sum of its line items, each rounded
 * to the cent with ESPI's `rounding`.
 */
import {
  EXPORT_CREDIT_PER_WH,
  plans,
  type Band,
  type MeterSeed,
  type PlanId,
} from "./data.ts";
import { hourlyWh } from "./curves.ts";
import {
  HOUR,
  historyOf,
  isoDay,
  localTime,
  monthStart,
  nextMonthStart,
} from "./time.ts";

/** A meter's plans over time: each from its UTC second until the next. */
export type PlanHistory = ReadonlyArray<{ plan: PlanId; from: number }>;
export const planAt = (history: PlanHistory, t: number): PlanId => {
  let current = history[0]?.plan ?? "flat";
  for (const entry of history) if (entry.from <= t) current = entry.plan;
  return current;
};
export function bandAt(plan: PlanId, t: number): Band {
  const { hour } = localTime(t);
  const bands = plans[plan].bands;
  return (
    bands.find((band) =>
      band.from < band.to
        ? hour >= band.from && hour < band.to
        : hour >= band.from || hour < band.to,
    ) ?? bands[0]!
  );
}

export type Reading = {
  start: number;
  value: number;
  /** Delivered: what it costs; received: the credit it earns. */
  cost: number;
  /** The time-of-use band (1–3), on a time-of-use plan's delivered hours. */
  tou?: number;
};
/** One hour of a meter reading, priced. */
export function reading(
  meter: MeterSeed,
  flowDirection: 1 | 19,
  history: PlanHistory,
  start: number,
): Reading {
  const value = hourlyWh(meter, flowDirection, start);
  if (flowDirection === 19)
    return { start, value, cost: value * EXPORT_CREDIT_PER_WH };
  const plan = planAt(history, start);
  const band = bandAt(plan, start);
  return {
    start,
    value,
    cost: value * band.perWh,
    ...(plan === "time-of-use" ? { tou: band.tou } : {}),
  };
}
/** The hours in `[from, to)` of a meter reading. */
export function readings(
  meter: MeterSeed,
  flowDirection: 1 | 19,
  history: PlanHistory,
  from: number,
  to: number,
): Reading[] {
  const out: Reading[] = [];
  for (let t = from; t < to; t += HOUR)
    out.push(reading(meter, flowDirection, history, t));
  return out;
}

export type LineItem = {
  note: string;
  /** ESPI `ItemKind`: 2 delivery fee, 3 energy usage, 6 generation credit. */
  itemKind: 2 | 3 | 6;
  /** Exact, in hundred-thousandths of USD; negative for a credit. */
  amount: number;
  /** What brings `amount` to whole cents. */
  rounding: number;
  wh?: number;
  /** Per kWh, in hundred-thousandths of USD. */
  unitCost?: number;
};
export type Bill = {
  /** `YYYY-MM` of the month it covers. */
  id: string;
  usagePointId: string;
  start: number;
  end: number;
  plan: PlanId;
  deliveredWh: number;
  receivedWh: number;
  lines: LineItem[];
  /** The sum of the lines, rounded: whole cents. */
  total: number;
};
const line = (item: Omit<LineItem, "rounding">): LineItem => ({
  ...item,
  rounding: Math.round(item.amount / 1000) * 1000 - item.amount,
});

/** The bill of the month `[start, end)` under `plan`, from its intervals. */
export function billFor(
  meter: MeterSeed,
  history: PlanHistory,
  start: number,
  end: number,
  plan: PlanId = planAt(history, start),
): Bill {
  const fixed: PlanHistory = [{ plan, from: 0 }];
  const delivered = readings(meter, 1, fixed, start, end);
  const lines: LineItem[] = [
    line({
      note: "Basic service charge",
      itemKind: 2,
      amount: meter.serviceCharge,
    }),
  ];
  for (const band of plans[plan].bands) {
    const hours = delivered.filter((r) => (r.tou ?? 0) === band.tou);
    lines.push(
      line({
        note:
          plan === "flat"
            ? "Energy, flat rate"
            : `Energy, ${band.name.toLowerCase()}`,
        itemKind: 3,
        amount: hours.reduce((sum, r) => sum + r.cost, 0),
        wh: hours.reduce((sum, r) => sum + r.value, 0),
        unitCost: band.perWh * 1000,
      }),
    );
  }
  let receivedWh = 0;
  if (meter.readings.some((r) => r.flowDirection === 19)) {
    const received = readings(meter, 19, fixed, start, end);
    receivedWh = received.reduce((sum, r) => sum + r.value, 0);
    lines.push(
      line({
        note: "Credit for energy sent to the grid",
        itemKind: 6,
        amount: -received.reduce((sum, r) => sum + r.cost, 0),
        wh: receivedWh,
        unitCost: EXPORT_CREDIT_PER_WH * 1000,
      }),
    );
  }
  return {
    id: isoDay(start).slice(0, 7),
    usagePointId: meter.id,
    start,
    end,
    plan,
    deliveredWh: delivered.reduce((sum, r) => sum + r.value, 0),
    receivedWh,
    lines,
    total: lines.reduce((sum, item) => sum + item.amount + item.rounding, 0),
  };
}

/**
 * A meter's closed bills at `now`, oldest first: every month that has
 * ended and lies wholly inside the 92 days of history (two or three).
 */
export function billsFor(meter: MeterSeed, history: PlanHistory, now: number) {
  const { from } = historyOf(now);
  const bills: Bill[] = [];
  for (
    let start = monthStart(from) === from ? from : nextMonthStart(from);
    nextMonthStart(start) <= monthStart(now);
    start = nextMonthStart(start)
  )
    bills.push(billFor(meter, history, start, nextMonthStart(start)));
  return bills;
}

/**
 * The month so far: delivered and received energy and what it costs, from
 * the start of the UTC month to the last completed hour.
 */
export function monthToDate(
  meter: MeterSeed,
  history: PlanHistory,
  now: number,
) {
  const start = monthStart(now);
  const to = historyOf(now).to;
  const delivered = readings(meter, 1, history, start, to);
  const received = meter.readings.some((r) => r.flowDirection === 19)
    ? readings(meter, 19, history, start, to)
    : [];
  const sum = (list: Reading[], key: "value" | "cost") =>
    list.reduce((total, r) => total + r[key], 0);
  return {
    start,
    to,
    deliveredWh: sum(delivered, "value"),
    receivedWh: sum(received, "value"),
    /** Energy cost less export credit, without the service charge. */
    energyCost: sum(delivered, "cost") - sum(received, "cost"),
  };
}

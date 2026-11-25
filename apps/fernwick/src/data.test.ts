/**
 * Fernwick's data without HTTP: the daylight saving rule bitmap, the
 * deterministic curves, prices by band and the bill arithmetic.
 */
import { describe, expect, it, vi } from "vitest";
import { customers, plans } from "./data.ts";
import { hourlyWh } from "./curves.ts";
import { bandAt, billFor, billsFor, readings } from "./billing.ts";
import {
  DAY,
  decodeDstRule,
  encodeDstRule,
  historyOf,
  HOUR,
  localOffset,
  localTime,
  PACIFIC,
  ruleHex,
  ruleInstant,
} from "./time.ts";

const elena = customers[0]!,
  robin = customers[1]!;
const [home, ev] = elena.meters;
const solar = robin.meters[0]!;
const at = (iso: string) => Date.parse(iso) / 1000;

describe("LocalTimeParameters", () => {
  it("encodes the US rules as ESPI's 32-bit bitmap", () => {
    // Month 3 in bits 28–31, the second occurrence (3) in 25–27, Sunday (7)
    // in 17–19, 02:00 in 12–16.
    expect(ruleHex(PACIFIC.dstStartRule)).toBe("360E2000");
    // Month 11, the first occurrence (2), Sunday, 02:00.
    expect(ruleHex(PACIFIC.dstEndRule)).toBe("B40E2000");
    expect(PACIFIC.dstEndRule).toBe(0xb40e2000);
    expect(decodeDstRule(PACIFIC.dstStartRule)).toEqual({
      month: 3,
      operator: 3,
      dayOfMonth: 0,
      dayOfWeek: 7,
      hours: 2,
      seconds: 0,
    });
    // The schema's own example: the third Friday of March at 01:45.
    const example = {
      month: 3,
      operator: 4,
      dayOfMonth: 0,
      dayOfWeek: 5,
      hours: 1,
      seconds: 2700,
    };
    expect(decodeDstRule(encodeDstRule(example))).toEqual(example);
    expect(() => encodeDstRule({ ...example, month: 16 })).toThrow(RangeError);
    expect(() => encodeDstRule({ ...example, seconds: 3600.5 })).toThrow();
  });

  it("puts the changes where US rules put them", () => {
    // 2026: 8 March at 02:00 PST (10:00 UTC), 1 November at 02:00 PDT (09:00 UTC).
    expect(ruleInstant(PACIFIC.dstStartRule, 2026, -8 * HOUR)).toBe(
      at("2026-03-08T10:00:00Z"),
    );
    expect(ruleInstant(PACIFIC.dstEndRule, 2026, -7 * HOUR)).toBe(
      at("2026-11-01T09:00:00Z"),
    );
    // 2027: 14 March and 7 November.
    expect(ruleInstant(PACIFIC.dstStartRule, 2027, -8 * HOUR)).toBe(
      at("2027-03-14T10:00:00Z"),
    );
    expect(ruleInstant(PACIFIC.dstEndRule, 2027, -7 * HOUR)).toBe(
      at("2027-11-07T09:00:00Z"),
    );
    expect(localOffset(at("2026-03-08T09:59:59Z"))).toBe(-8 * HOUR);
    expect(localOffset(at("2026-03-08T10:00:00Z"))).toBe(-7 * HOUR);
    expect(localOffset(at("2026-11-01T08:59:59Z"))).toBe(-7 * HOUR);
    expect(localOffset(at("2026-11-01T09:00:00Z"))).toBe(-8 * HOUR);
    expect(localTime(at("2026-07-01T00:00:00Z"))).toMatchObject({
      hour: 17,
      daylight: true,
    });
    // The last-occurrence operator: the last Sunday of October 2026 is the 25th.
    const last = encodeDstRule({
      month: 10,
      operator: 7,
      dayOfMonth: 0,
      dayOfWeek: 7,
      hours: 1,
      seconds: 0,
    });
    expect(ruleInstant(last, 2026, 0)).toBe(at("2026-10-25T01:00:00Z"));
    // On or after: the first Sunday on or after 15 March 2026 is the 15th.
    const after = encodeDstRule({
      month: 3,
      operator: 1,
      dayOfMonth: 15,
      dayOfWeek: 7,
      hours: 0,
      seconds: 0,
    });
    expect(ruleInstant(after, 2026, 0)).toBe(at("2026-03-15T00:00:00Z"));
  });
});

describe("curves", () => {
  it("are a function of the meter and the hour, with no randomness", () => {
    const random = vi.spyOn(Math, "random");
    const t = at("2026-11-20T03:00:00Z");
    const first = readings(home!, 1, [{ plan: "flat", from: 0 }], t, t + DAY);
    const again = readings(home!, 1, [{ plan: "flat", from: 0 }], t, t + DAY);
    expect(again).toEqual(first);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    for (const r of first) {
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThan(100);
      expect(r.value).toBeLessThan(5000);
    }
  });

  it("charges the EV at night and sends solar to the grid around noon", () => {
    const from = at("2026-10-01T00:00:00Z");
    let night = 0,
      day = 0,
      exportedAtNight = 0,
      exportedAtNoon = 0;
    for (let t = from; t < from + 30 * DAY; t += HOUR) {
      const { hour } = localTime(t);
      const charging = hourlyWh(ev!, 1, t);
      if (hour >= 22 || hour < 6) night += charging;
      else if (hour >= 9 && hour < 18) day += charging;
      const sent = hourlyWh(solar, 19, t);
      if (hour < 6 || hour >= 20) exportedAtNight += sent;
      if (hour >= 11 && hour < 15) exportedAtNoon += sent;
      expect(hourlyWh(home!, 19, t)).toBe(0);
    }
    expect(night).toBeGreaterThan(200000);
    expect(day).toBeLessThan(3000);
    expect(exportedAtNight).toBe(0);
    expect(exportedAtNoon).toBeGreaterThan(50000);
  });
});

describe("billing", () => {
  it("prices each hour by the band of its local hour", () => {
    // 17:00 PST is 01:00 UTC the next day in November.
    expect(bandAt("time-of-use", at("2026-11-21T01:00:00Z")).name).toBe("Peak");
    expect(bandAt("time-of-use", at("2026-11-21T08:00:00Z")).name).toBe(
      "Off-peak",
    );
    expect(bandAt("time-of-use", at("2026-11-20T18:00:00Z")).name).toBe(
      "Mid-peak",
    );
    expect(bandAt("flat", at("2026-11-21T01:00:00Z")).perWh).toBe(24);
    const [r] = readings(
      ev!,
      1,
      [{ plan: "time-of-use", from: 0 }],
      at("2026-11-21T01:00:00Z"),
      at("2026-11-21T02:00:00Z"),
    );
    expect(r!.tou).toBe(3);
    expect(r!.cost).toBe(r!.value * 41);
  });

  it("adds up a bill from its hours, each line rounded to the cent", () => {
    const start = at("2026-10-01T00:00:00Z"),
      end = at("2026-11-01T00:00:00Z");
    for (const [meter, plan] of [
      [home!, "flat"],
      [ev!, "time-of-use"],
      [solar, "time-of-use"],
    ] as const) {
      const history = [{ plan, from: 0 }];
      const bill = billFor(meter, history, start, end);
      const hours = readings(meter, 1, history, start, end);
      expect(hours).toHaveLength(31 * 24);
      const energy = bill.lines.filter((line) => line.itemKind === 3);
      expect(energy).toHaveLength(plans[plan].bands.length);
      expect(energy.reduce((sum, line) => sum + line.amount, 0)).toBe(
        hours.reduce((sum, r) => sum + r.cost, 0),
      );
      expect(energy.reduce((sum, line) => sum + line.wh!, 0)).toBe(
        bill.deliveredWh,
      );
      for (const line of bill.lines) {
        expect(Math.abs((line.amount + line.rounding) % 1000)).toBe(0);
        expect(Math.abs(line.rounding)).toBeLessThanOrEqual(500);
      }
      expect(bill.total).toBe(
        bill.lines.reduce((sum, line) => sum + line.amount + line.rounding, 0),
      );
      expect(bill.lines[0]).toMatchObject({
        itemKind: 2,
        amount: meter.serviceCharge,
      });
    }
    const robinBill = billFor(
      solar,
      [{ plan: "time-of-use", from: 0 }],
      start,
      end,
    );
    const credit = robinBill.lines.find((line) => line.itemKind === 6)!;
    expect(credit.amount).toBe(-robinBill.receivedWh * 7);
    expect(credit.amount).toBeLessThan(0);
  });

  it("closes a bill on the 1st for every month inside the 92 days", () => {
    const now = at("2026-11-25T12:00:00Z");
    expect(historyOf(now)).toEqual({
      from: at("2026-08-26T00:00:00Z"),
      to: at("2026-11-25T12:00:00Z"),
    });
    const history = [{ plan: "flat" as const, from: 0 }];
    expect(billsFor(home!, history, now).map((bill) => bill.id)).toEqual([
      "2026-09",
      "2026-10",
    ]);
    expect(
      billsFor(home!, history, at("2026-12-01T00:30:00Z")).map(
        (bill) => bill.id,
      ),
    ).toEqual(["2026-09", "2026-10", "2026-11"]);
    // A plan that starts on the 1st prices that month and not the one before.
    const switched = [
      { plan: "flat" as const, from: 0 },
      { plan: "time-of-use" as const, from: at("2026-11-01T00:00:00Z") },
    ];
    expect(
      billsFor(home!, switched, at("2026-12-02T00:00:00Z")).map((b) => b.plan),
    ).toEqual(["flat", "time-of-use"]);
  });
});

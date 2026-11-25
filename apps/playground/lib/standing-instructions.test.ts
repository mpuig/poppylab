import { expect, it } from "vitest";
import {
  coveredBy,
  loadApprovals,
  parseLimit,
  recordApproval,
  type Instruction,
} from "./standing-instructions";

const op = (terms: Record<string, unknown>, extra = {}) => ({
  operation_id: "op_1",
  revision: "1",
  state: "proposed",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  terms,
  ...extra,
});
const rule: Instruction = { maxCents: 2000, currency: "USD" };

it("covers an exchange within the limit and says what approved it", () => {
  expect(coveredBy(op({ total_cents: 1450, currency: "USD" }), rule)).toEqual({
    cents: 1450,
    text: "$14.50 within your limit of $20.00",
  });
  expect(
    coveredBy(op({ total_cents: 2000, currency: "USD" }), rule),
  ).not.toBeNull();
});

it("leaves everything it cannot settle to the User", () => {
  const usd = { currency: "USD" };
  expect(coveredBy(op({ total_cents: 2001, ...usd }), rule)).toBeNull();
  expect(coveredBy(op({ total_cents: 100, currency: "EUR" }), rule)).toBeNull();
  expect(coveredBy(op({ refund_cents: 100, ...usd }), rule)).toBeNull();
  expect(coveredBy(op({ kind: "profile_change" }), rule)).toBeNull();
  expect(coveredBy(op({ total_cents: 100, ...usd }), undefined)).toBeNull();
  expect(
    coveredBy(op({ total_cents: 100, ...usd }, { state: "uncertain" }), rule),
  ).toBeNull();
  expect(
    coveredBy(
      op({ total_cents: 100, ...usd }, { expires_at: "2000-01-01T00:00:00Z" }),
      rule,
    ),
  ).toBeNull();
  // The summary quotes an amount the terms do not hold.
  expect(
    coveredBy(
      op({ total_cents: 100, ...usd }, { summary: "Order for $0.50." }),
      rule,
    ),
  ).toBeNull();
});

it("checks every amount in the terms, not only the headline total", () => {
  const usd = { currency: "USD" };
  // A small total with a large fee or price difference is not a small exchange.
  expect(
    coveredBy(op({ total_cents: 0, fee_cents: 7500, ...usd }), rule),
  ).toBeNull();
  expect(
    coveredBy(
      op({ new_total_cents: 100, price_difference_cents: 9000, ...usd }),
      rule,
    ),
  ).toBeNull();
  // Amounts nested in the terms count too.
  expect(
    coveredBy(
      op({
        total_cents: 100,
        items: [{ name: "x", line_total_cents: 5000 }],
        ...usd,
      }),
      rule,
    ),
  ).toBeNull();
  expect(
    coveredBy(
      op({
        total_cents: 1500,
        items: [{ name: "x", line_total_cents: 1500 }],
        ...usd,
      }),
      rule,
    ),
  ).not.toBeNull();
});

it("refuses any refund, nested or beside a total, and amounts it cannot read", () => {
  const usd = { currency: "USD" };
  expect(
    coveredBy(op({ total_cents: 100, refund_cents: 100, ...usd }), rule),
  ).toBeNull();
  expect(
    coveredBy(
      op({ total_cents: 100, credit: { refund_cents: 5 }, ...usd }),
      rule,
    ),
  ).toBeNull();
  expect(coveredBy(op({ total_cents: 100.5, ...usd }), rule)).toBeNull();
  expect(
    coveredBy(op({ total_cents: 100, fee_cents: -50, ...usd }), rule),
  ).toBeNull();
  expect(
    coveredBy(op({ total_cents: 100, fee_cents: "75", ...usd }), rule),
  ).toBeNull();
  // Deeper than a proposal needs: not settled.
  expect(
    coveredBy(
      op({ total_cents: 100, a: { b: { c: { d: { e: { f: 1 } } } } }, ...usd }),
      rule,
    ),
  ).toBeNull();
});

it("keeps a record of recent approvals for an hour, and ignores damaged ones", () => {
  const store = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  try {
    const now = 1_000_000_000;
    recordApproval(
      "https://a.example",
      { at: now - 4_000_000, cents: 100 },
      now,
    );
    recordApproval("https://a.example", { at: now - 1000, cents: 200 }, now);
    expect(loadApprovals("https://a.example", now)).toEqual([
      { at: now - 1000, cents: 200 },
    ]);
    expect(loadApprovals("https://b.example", now)).toEqual([]);
    store.set("poppy-lab:auto-approvals", "not json");
    expect(loadApprovals("https://a.example", now)).toEqual([]);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

it("reads a typed limit strictly", () => {
  expect(parseLimit("20", "USD")).toEqual({ maxCents: 2000, currency: "USD" });
  expect(parseLimit("14.5", "USD")).toEqual({
    maxCents: 1450,
    currency: "USD",
  });
  expect(parseLimit("0", "USD")).toBeNull();
  expect(parseLimit("-5", "USD")).toBeNull();
  expect(parseLimit("20", "dollars")).toBeNull();
  expect(parseLimit("1e3", "USD")).toBeNull();
  // The most a rule can allow is $1,000.00.
  expect(parseLimit("1000", "USD")).toEqual({
    maxCents: 100000,
    currency: "USD",
  });
  expect(parseLimit("1001", "USD")).toBeNull();
  expect(parseLimit("99999", "USD")).toBeNull();
});

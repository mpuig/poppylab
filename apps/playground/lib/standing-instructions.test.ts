import { expect, it } from "vitest";
import {
  coveredBy,
  parseLimit,
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
  expect(coveredBy(op({ total_cents: 1450, currency: "USD" }), rule)).toBe(
    "$14.50 within your limit of $20.00",
  );
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
});

import { it, expect } from "vitest";
import {
  money,
  changes,
  termValue,
  operationTitle,
  type ReviewOperation,
} from "./operation-presentation";
const op = (terms: Record<string, unknown>) => ({ terms }) as ReviewOperation;
it("labels support proposals without inventing historical case state", () => {
  expect(operationTitle(op({ kind: "support_case" }))).toBe(
    "Open support request",
  );
  expect(
    operationTitle(op({ order_id: "ord_LNB0907", refund_cents: 800 })),
  ).toBe("Review refund");
  expect(operationTitle(op({ kind: "support_resolution" }))).toBe(
    "Close support case",
  );
  expect(
    changes(
      op({
        kind: "support_resolution",
        from_status: "open",
        to_status: "resolved",
      }),
    ),
  ).toEqual([{ label: "Case status", before: "open", after: "resolved" }]);
  expect(changes(op({ kind: "support_resolution" }))).toEqual([]);
});
it("shows exact profile fields and labels missing before values", () => {
  const proposal = op({
    kind: "profile_change",
    before_profile: {
      name: "Elena",
      email: "a@example.invalid",
      address: "Old demo address",
    },
    after_profile: {
      name: "Elena Demo",
      email: "a@example.invalid",
      address: "New demo address",
    },
  });
  expect(operationTitle(proposal)).toBe("Update fictional profile");
  expect(changes(proposal)[2]).toEqual({
    label: "Future delivery address",
    before: "Old demo address",
    after: "New demo address",
  });
  expect(
    changes(
      op({ kind: "profile_change", after_profile: { name: "Elena" } }),
    )[0]!.before,
  ).toBe("Not provided");
});
it("formats cents without losing zero or inventing currency", () => {
  expect(money(0, "USD")).toBe("$0.00");
  expect(money(1950, "USD")).toBe("$19.50");
  expect(money(100, undefined)).toContain("currency not provided");
});
it("shows exact before/after quantities and removal, not guessed old values", () => {
  expect(
    changes(
      op({
        kind: "basket",
        product_name: "Oranges",
        from_quantity: 2,
        quantity: 0,
        unit: "bag",
      }),
    ),
  ).toEqual([{ label: "Basket · Oranges", before: "2 bag", after: "Removed" }]);
  expect(changes(op({ kind: "basket", quantity: 1 }))[0]!.before).toBe(
    "Not provided",
  );
});
it("shows days as changes and items as readable prices, never raw JSON", () => {
  expect(
    changes(op({ kind: "delivery", from: "Thursday", to: "Saturday" }))[0],
  ).toMatchObject({ before: "Thursday", after: "Saturday" });
  expect(
    termValue(
      "items",
      [{ quantity: 2, name: "Oranges", unit: "bag", line_total_cents: 900 }],
      { currency: "USD" },
    ),
  ).toBe("2 × Oranges (bag) · $9.00");
  expect(termValue("items", [], {})).toBe("No items");
});

import { approvalTotal, summaryDisagreements } from "./operation-presentation";

it("names the amount an approval commits to", () => {
  const op = {
    operation_id: "op_1",
    revision: "1",
    state: "proposed",
    expires_at: "2099-01-01T00:00:00Z",
    terms: { total_cents: 1450, currency: "USD" },
  };
  expect(approvalTotal(op)?.label).toBe("$14.50");
  expect(approvalTotal({ ...op, terms: {} })).toBeNull();
});

it("flags a summary that quotes an amount the terms lack", () => {
  const op = {
    operation_id: "op_1",
    revision: "1",
    state: "proposed",
    expires_at: "2099-01-01T00:00:00Z",
    terms: { subtotal_cents: 1000, total_cents: 1450, currency: "USD" },
  };
  expect(summaryDisagreements({ ...op, summary: "Order for $14.50." })).toEqual(
    [],
  );
  expect(
    summaryDisagreements({ ...op, summary: "Order for $9.99 total." }),
  ).toHaveLength(1);
  expect(summaryDisagreements({ ...op, summary: "No amounts here." })).toEqual(
    [],
  );
});

import { needsYou } from "./operation-presentation";

const pending = (terms: Record<string, unknown>, extra = {}) => ({
  operation_id: "op_1",
  revision: "1",
  state: "proposed",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  terms,
  ...extra,
});

it("says which operations wait for the User", () => {
  expect(needsYou(pending({}))).toBe(true);
  expect(needsYou(pending({}, { state: "uncertain" }))).toBe(true);
  expect(needsYou(pending({}, { state: "succeeded" }))).toBe(false);
  expect(needsYou(pending({}, { expires_at: "2000-01-01T00:00:00Z" }))).toBe(
    false,
  );
});

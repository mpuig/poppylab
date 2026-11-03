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
      name: "Alex",
      email: "a@example.invalid",
      address: "Old demo address",
    },
    after_profile: {
      name: "Alex Demo",
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
    changes(op({ kind: "profile_change", after_profile: { name: "Alex" } }))[0]!
      .before,
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

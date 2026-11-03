import { it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationReview } from "./operation-review";
const op = {
  operation_id: "op_test",
  revision: "r1",
  state: "proposed",
  summary: "Set basket quantity",
  terms: {
    kind: "basket",
    product_name: "Oranges",
    from_quantity: 1,
    quantity: 2,
    unit: "bag",
    unit_price_cents: 450,
    currency: "USD",
  },
  expires_at: new Date(Date.now() + 60000).toISOString(),
};
function render(state: string, expiry = op.expires_at) {
  const onAction = vi.fn();
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: { ...op, state, expires_at: expiry },
      company: "Juniper Market",
      busy: false,
      signedIn: true,
      onAction,
    }),
  );
  expect(onAction).not.toHaveBeenCalled();
  return html;
}
it("renders summary-only proposals honestly without invented prices or changes", () => {
  const { terms: _terms, ...summaryOnly } = op;
  void _terms;
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: summaryOnly,
      company: "Juniper Market",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(html).toContain(op.summary);
  expect(html).toContain("No structured terms supplied");
  expect(html).toContain("Approve this change");
  expect(html).not.toContain("$4.50");
  expect(html).not.toContain("Before</small>");
});
it("opens proposals with before/after and formatted money", () => {
  const html = render("proposed");
  expect(html.match(/^<details[^>]*>/)?.[0]).toContain("open=");
  expect(html).toContain("Before");
  expect(html).toContain("After");
  expect(html).toContain("$4.50");
  expect(html).toContain("Approve this change");
  expect(html).toContain("Juniper Market");
});
it.each(["succeeded", "cancelled", "failed", "expired"])(
  "collapses final state %s without a confirmation button",
  (state) => {
    const html = render(state);
    expect(html.match(/^<details[^>]*>/)?.[0]).not.toContain("open=");
    expect(html).not.toContain("Approve this change");
  },
);
it("preserves every nested Company field in the exact-terms disclosure", () => {
  const terms = {
    new: {
      lines: [
        {
          line_id: "li_1",
          product_id: "gyoza",
          variant_id: "pan_fried",
          unit_price: 800,
          quantity: 1,
        },
      ],
    },
    new_total: { amount: "47.49", currency: "USD" },
  };
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: { ...op, terms },
      company: "Food test",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(html).toContain("<pre");
  for (const value of [
    "line_id",
    "variant_id",
    "pan_fried",
    "unit_price",
    "800",
    "47.49",
  ])
    expect(html).toContain(value);
});
it("always asks for approval and shows a slot change and exact money from the terms", () => {
  const lantern = {
    ...op,
    summary:
      "Change order ord_LNB1001: move to Saturday 19:00 and add pork gyoza. New total USD 45.00.",
    terms: {
      order_id: "ord_LNB1001",
      from_slot: "fri-1830",
      to_slot: "sat-1900",
      before_total_cents: 3700,
      new_total_cents: 4500,
      price_difference_cents: 800,
      currency: "USD",
    },
  };
  const onAction = vi.fn();
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: lantern,
      company: "Lantern Noodle Bar",
      busy: false,
      signedIn: true,
      onAction,
    }),
  );
  expect(html).toContain("Approve this change");
  expect(html).toContain("Delivery slot");
  expect(html).toContain("sat-1900");
  expect(html).toContain("$45.00");
  expect(html).toContain("$8.00");
  expect(onAction).not.toHaveBeenCalled();
});
it("blocks expired proposals locally without offering another action", () => {
  const html = render("proposed", new Date(Date.now() - 1000).toISOString());
  expect(html).not.toContain("Approve this change");
  expect(html).not.toContain("Retry the same approval");
  expect(html).toContain("Expired");
});
it("offers only a retry of the same approval when the outcome is unknown", () => {
  const html = render("uncertain", new Date(Date.now() + 60000).toISOString());
  expect(html).toContain("Outcome unknown");
  expect(html).toContain("Retry the same approval");
  expect(html).not.toContain("Approve this change");
});

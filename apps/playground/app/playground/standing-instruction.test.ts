import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { leftToUser } from "@/lib/auto-approval";
import type { ReviewOperation } from "@/lib/operation-presentation";
import { StandingInstruction } from "./standing-instruction";

const instruction = { maxCents: 5000, currency: "USD" };
const op = (id: string, terms: Record<string, unknown>, extra = {}) => ({
  operation_id: id,
  revision: "1",
  state: "proposed",
  summary: `Summary of ${id}`,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  terms: { ...terms, currency: "USD" },
  ...extra,
});
const render = (operations: ReviewOperation[], held = {}) =>
  renderToStaticMarkup(
    createElement(StandingInstruction, {
      instruction,
      currency: "USD",
      onChange: vi.fn(),
      operations,
      leftToUser: (operation: ReviewOperation) =>
        leftToUser(
          operation,
          instruction,
          "Harborline Bank",
          (held as Record<string, string>)[operation.operation_id],
        ),
    }),
  );

it("says, for each waiting change it left to the User, which reason applies", () => {
  const html = render(
    [
      op("over", { amount_cents: 12500 }),
      op("unread", { limit_cents: 4000 }),
      // Lantern's order with a dish removed: $6.00 comes back.
      op("cheaper", {
        before_total_cents: 4300,
        new_total_cents: 3700,
        price_difference_cents: -600,
      }),
      op("hour", { amount_cents: 1000 }),
      op(
        "declined",
        { amount_cents: 2500 },
        { agentDeclined: { reason: "Approve money moves yourself." } },
      ),
      op("new-terms", { amount_cents: 2500 }, { agentSuperseded: true }),
    ],
    { hour: "it already approved 5 changes in the last hour" },
  );
  for (const line of [
    "Left to you: the amount, $125.00, is over your limit of $50.00.",
    "Left to you: the terms name no amount to pay or move.",
    "Left to you: the price difference, -$6.00, is below zero, and it approves only amounts you pay or move.",
    "Left to you: it already approved 5 changes in the last hour.",
    "Left to you: Harborline Bank declined the approval Iris sent on it. It says: “Approve money moves yourself.”",
    "Left to you: Harborline Bank answered the approval Iris sent on it with new terms.",
  ])
    expect(html).toContain(line);
});

it("lists what Iris approved, and nothing for a change the instruction is about to approve", () => {
  const html = render([
    op("covered", { amount_cents: 2500 }),
    op(
      "done",
      { total_cents: 1450 },
      {
        state: "succeeded",
        approvedBy: {
          approver: "agent",
          rule: "$14.50 within your limit of $50.00",
          reference: "apr_1",
        },
      },
    ),
    // Declined earlier, approved by the User since: the record stays.
    op(
      "was-declined",
      { amount_cents: 2500 },
      { state: "succeeded", agentDeclined: {} },
    ),
  ]);
  expect(html).not.toContain("Summary of covered");
  expect(html).toContain(
    "Approved by Iris · $14.50 within your limit of $50.00 · apr_1",
  );
  expect(html).toContain("Declined by the Company · left to you");
  expect(html).not.toContain("Left to you:");
});

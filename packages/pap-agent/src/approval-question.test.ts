import { describe, expect, it } from "vitest";
import {
  approvalQuestion,
  proposalName,
  spokenProposal,
  whichQuestion,
} from "./approval-question";
import type { ReviewOperation } from "./operation-presentation";

const now = Date.parse("2026-11-27T12:00:00Z");
const in10 = new Date(now + 10 * 60000).toISOString();
const op = (
  terms: Record<string, unknown>,
  summary?: string,
): ReviewOperation => ({
  operation_id: "op_1",
  revision: "r1",
  state: "proposed",
  expires_at: in10,
  terms,
  ...(summary ? { summary } : {}),
});

// As Lantern, Harborline and Juniper send them.
const order = op(
  {
    order_id: "ord_LNB1001",
    order_version: 3,
    from_slot: "sat-1230",
    to_slot: "sun-1300",
    lines: [{ dish_id: "matcha-ice", quantity: 1 }],
    before_total_cents: 7300,
    new_total_cents: 8800,
    price_difference_cents: 1500,
    currency: "USD",
    payment: "Simulated card on file — no real charge",
  },
  "Change order ord_LNB1001 for Elena. Reply YES to approve.",
);
const transfer = op({
  source_account_id: "acc_HLB_A100",
  destination_account_id: "acc_HLB_A200",
  amount_cents: 50000,
  idempotency_key: "k1",
  source_name: "Operating checking",
  destination_name: "Savings",
  source_balance_before_cents: 422000,
  source_balance_after_cents: 372000,
  destination_balance_before_cents: 100000,
  destination_balance_after_cents: 150000,
  currency: "USD",
});
const payment = op({
  source_account_id: "acc_HLB_A100",
  recipient_id: "rcp_1",
  amount_cents: 12500,
  memo: "quarterly report",
  recipient_name: "Beacon Studio",
  fee_cents: 0,
  currency: "USD",
});
const delivery = op({
  kind: "delivery",
  from: "Thursday",
  to: "Saturday",
  change_fee_cents: 0,
  currency: "USD",
});

describe("the agent's question about a proposal", () => {
  it("says the Company, what changes, the amount and the expiry, in its own words", () => {
    const asked = approvalQuestion(
      [{ op: order, company: "Lantern Noodle Bar" }],
      [],
      now,
    )!;
    expect(asked.text).toBe(
      "Lantern Noodle Bar proposes a change to your order: delivery slot from sat-1230 to sun-1300. The new total is $88.00, $15.00 more. The terms expire in 10 minutes. Approve it?",
    );
    // Never the Company's prose as the question.
    expect(asked.text).not.toContain("Reply YES");
    expect(asked.spoken).toBe(
      "Lantern Noodle Bar wants to change your order, for a new total of 88 dollars, 15 more. Approve it?",
    );
  });

  it.each([
    [
      transfer,
      "Harborline Bank",
      "Harborline Bank proposes a transfer of $500.00 from Operating checking to Savings. The terms expire in 10 minutes. Approve it?",
      "Harborline Bank wants to move 500 dollars from Operating checking to Savings. Approve it?",
    ],
    [
      payment,
      "Harborline Bank",
      "Harborline Bank proposes a payment of $125.00 to Beacon Studio. The terms expire in 10 minutes. Approve it?",
      "Harborline Bank wants to pay Beacon Studio 125 dollars. Approve it?",
    ],
    [
      delivery,
      "Juniper Market",
      "Juniper Market proposes a change to your recurring delivery day, from Thursday to Saturday. The fee is $0.00. The terms expire in 10 minutes. Approve it?",
      "Juniper Market wants to change your recurring delivery day from Thursday to Saturday. Approve it?",
    ],
  ])("asks about %#", (proposal, company, text, spoken) => {
    const asked = approvalQuestion([{ op: proposal, company }], [], now)!;
    expect(asked.text).toBe(text);
    expect(asked.spoken).toBe(spoken);
  });

  it("names each when another waits too, and asks which", () => {
    const asked = approvalQuestion(
      [{ op: transfer, company: "Harborline Bank" }],
      [{ op: order, company: "Lantern Noodle Bar" }],
      now,
    )!;
    expect(asked.text).toBe(
      "Harborline Bank proposes a transfer of $500.00 from Operating checking to Savings. The terms expire in 10 minutes. The $88.00 change at Lantern Noodle Bar waits for you too. Which do you approve: the $500.00 transfer at Harborline Bank or the $88.00 change at Lantern Noodle Bar?",
    );
    expect(asked.spoken).toBe(
      "Harborline Bank wants to move 500 dollars from Operating checking to Savings. Which do you approve: the transfer of 500 dollars at Harborline Bank or the change of 88 dollars at Lantern Noodle Bar?",
    );
    expect(
      whichQuestion(
        [
          { op: order, company: "Lantern Noodle Bar" },
          { op: transfer, company: "Harborline Bank" },
        ],
        "approve",
      ).text,
    ).toBe(
      "Which one do you approve: the $88.00 change at Lantern Noodle Bar or the $500.00 transfer at Harborline Bank? Say the company or the amount.",
    );
  });

  it("tells proposals apart by amount, kind and Company", () => {
    expect(proposalName(order, "Lantern Noodle Bar")).toBe(
      "the $88.00 change at Lantern Noodle Bar",
    );
    expect(proposalName(delivery, "Juniper Market")).toBe(
      "the change at Juniper Market",
    );
    expect(spokenProposal(transfer, "Harborline Bank")).not.toMatch(/acc_|k1/);
  });
});

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
it("renders a proposal without a summary from its exact terms (Operations v3 §3)", () => {
  const { summary: _summary, ...termsOnly } = op;
  void _summary;
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: termsOnly,
      company: "Juniper Market",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(html).toContain("Juniper Market sent no summary");
  // The exact terms open by default, and approval stays possible.
  expect(html).toMatch(/<details class="operation-terms" open/);
  expect(html).toContain("Approve this change");
});
it("shows a summary as text: its Markdown, links and images never render", () => {
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: {
        ...op,
        summary:
          "**Move** it. [Click](https://evil.example) ![x](https://evil.example/x.png)",
      },
      company: "Juniper Market",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("<img");
  expect(html).toContain("[Click](https://evil.example)");
});
it("shows the domain discovery proved next to the Company's claimed name (§10.3)", () => {
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op,
      company: "Juniper Market",
      domain: "grocery-demo.poppylab.dev",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(html).toContain(
    "Juniper Market · grocery-demo.poppylab.dev · terms revision",
  );
});
it("labels a Company's decline", () => {
  const html = render("refused");
  expect(html).toContain("Declined by the Company");
  expect(html).not.toContain("Approve this change");
});
it("says why new terms wait for the User after an agent approval, without calling it a decline", () => {
  const review = (marks: object) =>
    renderToStaticMarkup(
      createElement(OperationReview, {
        op: { ...op, ...marks },
        company: "Juniper Market",
        busy: false,
        signedIn: true,
        onAction: vi.fn(),
      }),
    );
  const html = review({ agentSuperseded: true });
  expect(html).toContain(
    "Juniper Market answered the approval Iris sent on your standing instruction with new terms, and did nothing.",
  );
  expect(html).not.toContain("declined the approval");
  // The User can still approve them.
  expect(html).toContain("Approve this change");
  // A decline keeps its own sentence.
  const declined = review({ agentDeclined: { reason: "Not this way." } });
  expect(declined).toContain("declined the approval Iris sent");
  expect(declined).not.toContain("with new terms");
});
it("punctuates a Company's reason for declining Iris's approval once", () => {
  const note = (reason?: string) => {
    const html = renderToStaticMarkup(
      createElement(OperationReview, {
        op: { ...op, agentDeclined: reason === undefined ? {} : { reason } },
        company: "Harborline Bank",
        busy: false,
        signedIn: true,
        onAction: vi.fn(),
      }),
    );
    return /<p class="operation-ledger declined" role="status">(.*?)<\/p>/
      .exec(html)?.[1]
      ?.replaceAll("&#x27;", "'");
  };
  const start =
    "Harborline Bank declined the approval Iris sent on your standing instruction, and did nothing.";
  // The reason's own full stop, question mark or closing bracket ends it.
  for (const reason of [
    "Your agent's standing instruction can't approve payments or transfers here.",
    "Why not approve it yourself?",
    "Approve it yourself (see your limits).",
    "Approve it yourself!",
  ])
    expect(note(reason)).toBe(
      `${start} It says: “${reason}” It's up to you now.`,
    );
  // A reason without one gets it, after the Company's words.
  expect(note("Not for agents")).toBe(
    `${start} It says: “Not for agents”. It's up to you now.`,
  );
  expect(note(" Not for agents \n")).toBe(
    `${start} It says: “Not for agents”. It's up to you now.`,
  );
  // No reason, or an empty one: nothing is quoted.
  for (const reason of [undefined, "", "  "])
    expect(note(reason)).toBe(`${start} It's up to you now.`);
});
it("says why the standing instruction left a proposal to the User, in one place", () => {
  const review = (marks: object, notApplied: string) =>
    renderToStaticMarkup(
      createElement(OperationReview, {
        op: { ...op, ...marks },
        company: "Harborline Bank",
        busy: false,
        signedIn: true,
        onAction: vi.fn(),
        notApplied,
      }),
    );
  const over = "the amount, $125.00, is over your limit of $50.00";
  expect(review({}, over)).toContain(
    `Your standing instruction did not apply: ${over}. It`,
  );
  // A settled or expired proposal has nothing left to explain.
  expect(review({ state: "succeeded" }, over)).not.toContain("did not apply");
  expect(
    review({ expires_at: new Date(Date.now() - 1000).toISOString() }, over),
  ).not.toContain("did not apply");
  // A decline already has its own note, with the Company's reason.
  const declined = review(
    { agentDeclined: { reason: "Approve money moves yourself." } },
    "Harborline Bank declined the approval Iris sent on it",
  );
  expect(declined).toContain("It says: “Approve money moves yourself.”");
  expect(declined).not.toContain("did not apply");
});
/** A card's closed entry: what shows without opening it. */
const entry = (marks: object, company = "Lantern Noodle Bar") => {
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: { ...op, ...marks },
      company,
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(html.match(/^<details[^>]*>/)?.[0]).not.toContain("open=");
  return html.slice(0, html.indexOf("</summary>"));
};
it("shows the Company's confirmation and who approved on a finished entry", () => {
  const refunded =
    "Refunded USD 37.00 for order ord_LNB0907. Simulated: no real money moves.";
  const own = entry({
    state: "succeeded",
    result: { summary: refunded },
    approvedBy: { approver: "user" },
  });
  expect(own).toContain("Completed");
  // Company content, marked as the Company's words.
  expect(own).toContain(
    `<span class="company-says"><small>Lantern Noodle Bar says:</small>${refunded}</span>`,
  );
  expect(own).toContain("Approved by you.");
  expect(
    entry({
      state: "succeeded",
      result: { summary: refunded },
      approvedBy: { approver: "agent", rule: "$37.00 within your limit" },
    }),
  ).toContain("Approved by Iris on your standing instruction.");
  // A Company that sent no confirmation is not quoted as saying one.
  const silent = entry({
    state: "succeeded",
    result: { summary: "The Company performed the approved operation." },
    approvedBy: { approver: "user" },
  });
  expect(silent).not.toContain("says:");
  expect(silent).toContain(
    "The Company performed the approved operation. Approved by you.",
  );
});
it("says on a closed entry why nothing was done and what to do next", () => {
  expect(
    entry({ state: "declined", result: { summary: "Declined." } }),
  ).toContain(
    "You declined this, and nothing was sent to Lantern Noodle Bar. Ask for the change again if you still want it.",
  );
  const reason =
    "Lantern Noodle Bar declined this approval and did nothing. Its reason: The kitchen has closed.";
  const refused = entry({ state: "refused", result: { summary: reason } });
  expect(refused).toContain("Declined by the Company");
  expect(refused).toContain(reason);
  expect(refused).not.toContain("says:");
  const replaced =
    "Lantern Noodle Bar offered new terms instead of performing these, so they can no longer be approved.";
  const superseded = entry({
    state: "superseded",
    result: { summary: replaced },
  });
  expect(superseded).toContain("Replaced by new terms");
  expect(superseded).toContain(replaced);
});
it("tells the customer what an expired proposal means", () => {
  const ranOut =
    "This proposal ran out before it was approved, so nothing was done. Ask for the change again to get new terms.";
  expect(entry({ state: "expired" })).toContain(ranOut);
  // Past its expiry on the page's own clock, whatever was noted before.
  expect(
    entry({
      expires_at: new Date(Date.now() - 1000).toISOString(),
      result: { summary: "The Company refused the request." },
    }),
  ).toContain(ranOut);
  // The route's own sentence, when a conversation ended.
  const ended =
    "The conversation this was proposed in has ended. Nothing was performed. Ask for the change again to get fresh terms.";
  const html = entry({ state: "expired", result: { summary: ended } });
  expect(html).toContain(ended);
  expect(html).not.toContain(ranOut);
});
it("shows what became of a refused approval as a notice above the controls of a waiting card", () => {
  const refusal =
    "Juniper Market refused the approved request, and nothing was performed. Approve again or ask for new terms.";
  expect(render("proposed")).not.toContain("operation-ledger declined");
  const waiting = renderToStaticMarkup(
    createElement(OperationReview, {
      op: { ...op, result: { summary: refusal } },
      company: "Juniper Market",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  // Still open and approvable, with the sentence as a notice, not a success.
  expect(waiting.match(/^<details[^>]*>/)?.[0]).toContain("open=");
  expect(waiting).toContain(
    `<p class="operation-ledger declined" role="status">${refusal}</p><div class="operation-actions">`,
  );
  expect(waiting).not.toContain("operation-result");
  expect(waiting).not.toContain("operation-outcome");
  expect(waiting).toContain("Approve this change");
  // The same for the note a retry leaves on an unknown outcome.
  const uncertain = renderToStaticMarkup(
    createElement(OperationReview, {
      op: { ...op, state: "uncertain", result: { summary: refusal } },
      company: "Juniper Market",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(uncertain).toContain(
    `<p class="operation-ledger declined" role="status">${refusal}</p><div class="operation-actions">`,
  );
  expect(uncertain).toContain("Retry the same approval");
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
  expect(html).toContain("Approve $45.00");
  expect(html).toContain("Delivery slot");
  expect(html).toContain("sat-1900");
  expect(html).toContain("$45.00");
  expect(html).toContain("$8.00");
  expect(onAction).not.toHaveBeenCalled();
});
it("names no amount to approve when an order's total does not rise", () => {
  const lantern = (before: number, after: number) =>
    renderToStaticMarkup(
      createElement(OperationReview, {
        op: {
          ...op,
          summary: "Change order ord_LNB1001. New total USD 37.00.",
          terms: {
            order_id: "ord_LNB1001",
            from_slot: "fri-1830",
            to_slot: "fri-1830",
            before_total_cents: before,
            new_total_cents: after,
            price_difference_cents: after - before,
            currency: "USD",
          },
        },
        company: "Lantern Noodle Bar",
        busy: false,
        signedIn: true,
        onAction: vi.fn(),
      }),
    );
  // A dish removed: $6.00 comes back. Nothing says "pay $37.00".
  const cheaper = lantern(4300, 3700);
  expect(cheaper).not.toContain("data-total");
  expect(cheaper).not.toContain("Approve $");
  expect(cheaper).toContain("Approve this change");
  // The totals and the difference stay in the rows.
  expect(cheaper).toContain("<dt>Previous total</dt><dd>$43.00</dd>");
  expect(cheaper).toContain("<dt>Difference</dt><dd>-$6.00</dd>");
  expect(cheaper).toContain("<dt>New total</dt><dd>$37.00</dd>");
  // The same order, unchanged in price.
  const same = lantern(3700, 3700);
  expect(same).not.toContain("data-total");
  expect(same).toContain("Approve this change");
  // A dish added: the new total leads and is on the button, as before.
  const dearer = lantern(3700, 4300);
  expect(dearer).toMatch(/data-total[^>]*><span>Total<\/span>/);
  expect(dearer).toContain("Approve $43.00");
});
it("leads a refund's card with the refund, and names it on the button", () => {
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: {
        ...op,
        summary:
          "Refund 1 × Pork gyoza ($8.00) missing from order ord_LNB0907.",
        terms: {
          order_id: "ord_LNB0907",
          dish_id: "gyoza",
          quantity: 1,
          refund_cents: 800,
          currency: "USD",
        },
      },
      company: "Lantern Noodle Bar",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(html).toContain("Review refund");
  expect(html).toMatch(/data-total[^>]*><span>Refund<\/span>/);
  expect(html).toContain("Approve $8.00");
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
it("quotes the summary as the Company's and warns when its amount is not in the terms", () => {
  const html = renderToStaticMarkup(
    createElement(OperationReview, {
      op: {
        ...op,
        summary: "Order for $9.99.",
        terms: { total_cents: 1450, currency: "USD" },
      },
      company: "Juniper Market",
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
  expect(html).toContain("Juniper Market says:");
  expect(html).toContain("Check before you approve");
  expect(html).toContain("$9.99");
  expect(html).toContain("Approve $14.50");
});

// Two Companies' terms, as their own code writes them.
const northwindUpgrade = {
  booking_reference: "NW7K2P",
  booking_version: 1,
  offer_id: "upg_elena_1",
  flight_id: "flt_na118_20270518",
  inventory_version: 1,
  from_cabin: "Economy",
  to_cabin: "Business",
  amount_due_cents: 24800,
  currency: "USD",
  refund_terms:
    "The fictional upgrade is refundable only if Northwind Air cancels this segment.",
  payment: "Simulated card on file — no real charge",
};
const harborlineTransfer = {
  source_account_id: "acct_checking",
  destination_account_id: "acct_savings",
  amount_cents: 2500,
  idempotency_key: "demo-transfer-1",
  source_name: "Operating checking",
  destination_name: "Reserve savings",
  source_version: 4,
  destination_version: 2,
  source_balance_before_cents: 1172000,
  source_balance_after_cents: 1169500,
  destination_balance_before_cents: 4350000,
  destination_balance_after_cents: 4352500,
  currency: "USD",
  notice:
    "Fictional Harborline Bank data. No real money moves; never enter real banking data or credentials.",
};
const card = (terms: Record<string, unknown>, company: string) =>
  renderToStaticMarkup(
    createElement(OperationReview, {
      op: { ...op, summary: "The Company's own summary.", terms },
      company,
      busy: false,
      signedIn: true,
      onAction: vi.fn(),
    }),
  );
/** The card without the exact terms, which hold every field name anyway. */
const readableCard = (terms: Record<string, unknown>, company: string) =>
  card(terms, company).replace(/<pre[\s\S]*?<\/pre>/, "");
it("presents an airline's terms as rows, with what is due as the headline", () => {
  const html = readableCard(northwindUpgrade, "Northwind Air");
  expect(html).toMatch(/data-total[^>]*><span>Amount due<\/span>/);
  expect(html).toContain("Approve $248.00");
  expect(html).toContain("<strong>Cabin</strong>");
  expect(html).toContain("Economy");
  expect(html).toContain("Business");
  expect(html).toContain("<dt>Booking reference</dt><dd>NW7K2P</dd>");
  expect(html).toContain("<dt>Amount due</dt><dd>$248.00</dd>");
  expect(html).toContain("<dt>Refund terms</dt>");
  expect(html).toContain("<dt>Payment</dt>");
  // Bookkeeping stays in the exact terms, one click away and closed.
  expect(html).not.toContain("version");
  expect(html).not.toContain("upg_elena_1");
  expect(card(northwindUpgrade, "Northwind Air")).toMatch(
    /<details class="operation-terms"><summary>All exact terms/,
  );
});
it("presents a bank's transfer: the amount moved, and each balance before and after", () => {
  const html = readableCard(harborlineTransfer, "Harborline Bank");
  expect(html).toMatch(/data-total[^>]*><span>Amount<\/span>/);
  expect(html).toContain("Approve $25.00");
  expect(html).toContain("<strong>Source balance</strong>");
  expect(html).toContain("$11,720.00");
  expect(html).toContain("$11,695.00");
  expect(html).toContain("<strong>Destination balance</strong>");
  expect(html).toContain("<dt>Source name</dt><dd>Operating checking</dd>");
  expect(html).toContain("<dt>Amount</dt><dd>$25.00</dd>");
  expect(html).not.toContain("demo-transfer-1");
});
it("labels a fee by its field, not as a change fee", () => {
  // Harborline's payment and Northwind's seat change both carry a zero fee.
  const html = readableCard(
    { amount_cents: 12500, fee_cents: 0, currency: "USD" },
    "Harborline Bank",
  );
  expect(html).toContain("<dt>Fee</dt><dd>$0.00</dd>");
  expect(html).not.toContain("Change fee");
  // Juniper's delivery-day change keeps its own label.
  expect(
    readableCard(
      {
        kind: "delivery",
        from: "Thursday",
        to: "Saturday",
        fee_cents: 0,
        currency: "USD",
      },
      "Juniper Market",
    ),
  ).toContain("<dt>Change fee</dt>");
});

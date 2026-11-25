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

import { ownLayout, termRows } from "./operation-presentation";

// The Companies' terms, as their own code writes them.
const usd = { currency: "USD" };
const northwind = {
  upgrade: {
    booking_reference: "NW7K2P",
    booking_version: 1,
    offer_id: "upg_elena_1",
    flight_id: "flt_na118_20270518",
    inventory_version: 1,
    from_cabin: "Economy",
    to_cabin: "Business",
    amount_due_cents: 24800,
    ...usd,
    refund_terms:
      "The fictional upgrade is refundable only if Northwind Air cancels this segment.",
    payment: "Simulated card on file — no real charge",
  },
  bag: {
    booking_reference: "NW7K2P",
    booking_version: 2,
    flight_id: "flt_na402_20270518",
    current_checked_bags: 1,
    additional_pieces: 1,
    new_checked_bags: 2,
    amount_due_cents: 4500,
    ...usd,
    refund_terms:
      "The fictional bag fee is refundable until 24 hours before departure; no real payment is taken.",
    payment: "Simulated card on file — no real charge",
  },
  seat: {
    booking_reference: "NW7K2P",
    booking_version: 1,
    flight_id: "flt_na118_20270518",
    inventory_version: 1,
    from_seat: null,
    to_seat: "14C",
    fee_cents: 0,
    ...usd,
    reversibility:
      "May be changed again while another standard seat is available.",
    payment: "No payment; fictional booking only",
  },
  flightChange: (amount_due_cents: number, refund_cents: number) => ({
    booking_reference: "NW7K2P",
    booking_version: 1,
    old_flight_id: "flt_na118_20270518",
    new_flight_id: "flt_na120_20270518",
    old_inventory_version: 1,
    new_inventory_version: 1,
    from: {
      flight_number: "NA 118",
      departure: "2027-05-18T08:20:00-04:00",
      fare_cents: 31200,
      seat: "12A",
      cabin: "Economy",
    },
    to: {
      flight_number: "NA 120",
      departure: "2027-05-18T13:05:00-04:00",
      fare_cents: 35000,
      seat: "9C",
      cabin: "Economy",
    },
    change_fee_cents: 7500,
    fare_difference_cents: 3800,
    amount_due_cents,
    refund_cents,
    ...usd,
    payment: "Simulated card on file — no real charge or refund",
  }),
  cancel: {
    booking_reference: "NW7K2P",
    booking_version: 1,
    fare: "Flex",
    paid_cents: 62400,
    cancellation_fee_cents: 5000,
    refund_cents: 57400,
    ...usd,
    refund_method: "Simulated return to the card on file",
  },
};
const harborline = {
  transfer: {
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
    ...usd,
    notice:
      "Fictional Harborline Bank data. No real money moves; never enter real banking data or credentials.",
  },
  payment: {
    source_account_id: "acct_checking",
    recipient_id: "rcp_landlord",
    amount_cents: 12500,
    memo: "June rent share",
    idempotency_key: "demo-payment-1",
    source_account_version: 4,
    source_balance_before_cents: 1172000,
    source_balance_after_cents: 1159500,
    recipient_name: "Maple Court Rentals",
    recipient_account_last4: "4471",
    recipient_version: 1,
    fee_cents: 0,
    ...usd,
    execution: "Immediate fictional payment after approval",
  },
  category: {
    transaction_id: "txn_1",
    description: "Harbor Grocer",
    amount_cents: -5420,
    ...usd,
    from_category: "groceries",
    to_category: "dining",
    transaction_version: 1,
  },
  budget: {
    budget_id: "bud_1",
    month: "2027-05",
    category: "dining",
    budget_version: 2,
    from_name: "Dining",
    to_name: "Eating out",
    from_limit_cents: 40000,
    to_limit_cents: 30000,
    spent_cents: 12000,
    ...usd,
  },
};
const lantern = {
  order: {
    order_id: "ord_LNB1001",
    order_version: 1,
    from_slot: "fri-1830",
    to_slot: "sun-1300",
    lines: { "shoyu-ramen": 2, edamame: 1, "matcha-ice": 1 },
    before_total_cents: 3700,
    new_total_cents: 4300,
    price_difference_cents: 600,
    ...usd,
    payment: "Simulated card on file — no real charge",
  },
  refund: {
    order_id: "ord_LNB0907",
    dish_id: "gyoza",
    quantity: 1,
    refund_cents: 800,
    ...usd,
    method: "Simulated refund to the card used for the order",
  },
};
const juniperCheckout = {
  kind: "checkout",
  tax_cents: 0,
  items: [{ quantity: 2, name: "Oranges", unit: "bag", line_total_cents: 900 }],
  subtotal_cents: 900,
  delivery_fee_cents: 500,
  total_cents: 1400,
  ...usd,
  delivery_day: "Saturday",
};
const headline = (terms: Record<string, unknown>) => {
  const total = approvalTotal(pending(terms));
  return total && `${total.text} ${total.label}`;
};

it("leads with what the customer pays or moves, labelled by its field", () => {
  expect(headline(northwind.upgrade)).toBe("Amount due $248.00");
  expect(headline(northwind.bag)).toBe("Amount due $45.00");
  expect(headline(harborline.transfer)).toBe("Amount $25.00");
  expect(headline(harborline.payment)).toBe("Amount $125.00");
  // What is due leads even beside a refund of zero; a refund leads only
  // where nothing is due.
  expect(headline(northwind.flightChange(11300, 0))).toBe("Amount due $113.00");
  expect(headline(northwind.flightChange(0, 2500))).toBe("Refund $25.00");
  expect(headline(northwind.cancel)).toBe("Refund $574.00");
  // Lantern's and Juniper's cards lead as they always have.
  expect(headline(lantern.order)).toBe("Total $43.00");
  expect(headline(lantern.refund)).toBe("Refund $8.00");
  expect(headline(juniperCheckout)).toBe("Total $14.00");
});

it("names no amount where the terms hold none to pay or move", () => {
  // A fee of zero, a posted transaction's amount, a budget's limits.
  expect(headline(northwind.seat)).toBeNull();
  expect(headline(harborline.category)).toBeNull();
  expect(headline(harborline.budget)).toBeNull();
});

it("calls it a refund only where the refund is the amount", () => {
  const title = (terms: Record<string, unknown>) =>
    operationTitle(pending(terms));
  expect(title(northwind.flightChange(11300, 0))).toBe(
    "Review Company proposal",
  );
  expect(title(northwind.flightChange(0, 2500))).toBe("Review refund");
  expect(title(lantern.refund)).toBe("Review refund");
  expect(title(lantern.order)).toBe("Review order change");
});

it("keeps Lantern's and Juniper's own layouts and reads the others from their shape", () => {
  for (const terms of [lantern.order, lantern.refund, juniperCheckout])
    expect(ownLayout(pending(terms))).toBe(true);
  for (const terms of [
    ...Object.values(northwind).map((t) =>
      typeof t === "function" ? t(0, 0) : t,
    ),
    ...Object.values(harborline),
  ])
    expect(ownLayout(pending(terms))).toBe(false);
});

it("reads an airline's terms as rows without knowing the airline", () => {
  expect(termRows(pending(northwind.upgrade))).toEqual({
    changes: [{ label: "Cabin", before: "Economy", after: "Business" }],
    rows: [
      { key: "booking_reference", label: "Booking reference", value: "NW7K2P" },
      { key: "amount_due_cents", label: "Amount due", value: "$248.00" },
      {
        key: "refund_terms",
        label: "Refund terms",
        value: northwind.upgrade.refund_terms,
      },
      {
        key: "payment",
        label: "Payment",
        value: "Simulated card on file — no real charge",
      },
    ],
  });
  const seat = termRows(pending(northwind.seat));
  // The Company named no seat before: said so, not guessed.
  expect(seat.changes).toEqual([
    { label: "Seat", before: "Not provided", after: "14C" },
  ]);
  // A fee is a fee: nothing says it is a change fee.
  expect(seat.rows).toContainEqual({
    key: "fee_cents",
    label: "Fee",
    value: "$0.00",
  });
  expect(
    termRows(pending(northwind.bag)).rows.map((r) => `${r.label}: ${r.value}`),
  ).toEqual([
    "Booking reference: NW7K2P",
    "Current checked bags: 1",
    "Additional pieces: 1",
    "New checked bags: 2",
    "Amount due: $45.00",
    `Refund terms: ${northwind.bag.refund_terms}`,
    "Payment: Simulated card on file — no real charge",
  ]);
  // `from` and `to` with the same fields: each field before and after.
  const change = termRows(pending(northwind.flightChange(11300, 0)));
  expect(change.changes).toEqual([
    { label: "Flight number", before: "NA 118", after: "NA 120" },
    {
      label: "Departure",
      before: "2027-05-18T08:20:00-04:00",
      after: "2027-05-18T13:05:00-04:00",
    },
    { label: "Fare", before: "$312.00", after: "$350.00" },
    { label: "Seat", before: "12A", after: "9C" },
    { label: "Cabin", before: "Economy", after: "Economy" },
  ]);
  expect(change.rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
    "Booking reference: NW7K2P",
    "Change fee: $75.00",
    "Fare difference: $38.00",
    "Amount due: $113.00",
    "Refund: $0.00",
    "Payment: Simulated card on file — no real charge or refund",
  ]);
});

it("reads a bank's terms as rows: balances before and after, no request keys", () => {
  const transfer = termRows(pending(harborline.transfer));
  expect(transfer.changes).toEqual([
    { label: "Source balance", before: "$11,720.00", after: "$11,695.00" },
    {
      label: "Destination balance",
      before: "$43,500.00",
      after: "$43,525.00",
    },
  ]);
  expect(transfer.rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
    "Amount: $25.00",
    "Source name: Operating checking",
    "Destination name: Reserve savings",
    `Notice: ${harborline.transfer.notice}`,
  ]);
  const payment = termRows(pending(harborline.payment));
  expect(payment.rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
    "Amount: $125.00",
    "Memo: June rent share",
    "Recipient name: Maple Court Rentals",
    "Recipient account last4: 4471",
    "Fee: $0.00",
    "Execution: Immediate fictional payment after approval",
  ]);
  expect(termRows(pending(harborline.budget)).changes).toEqual([
    { label: "Name", before: "Dining", after: "Eating out" },
    { label: "Limit", before: "$400.00", after: "$300.00" },
  ]);
  expect(termRows(pending(harborline.category)).changes).toEqual([
    { label: "Category", before: "groceries", after: "dining" },
  ]);
});

it("puts a list or nested fields into lines, and leaves an unknown currency unnamed", () => {
  const { changes: none, rows } = termRows(
    pending({
      from: "Thursday",
      to: "Saturday",
      lines: { "shoyu-ramen": 2, edamame: 1 },
      passengers: [{ name: "Elena Maren", seat: "12A", fare_cents: 31200 }],
      price_cents: 500,
    }),
  );
  // `from` and `to` that are not fields of the same thing stay two rows.
  expect(none).toEqual([]);
  expect(rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
    "From: Thursday",
    "To: Saturday",
    "Lines: shoyu-ramen 2 · edamame 1",
    "Passengers: - Elena Maren\n  Seat: 12A\n  Fare: 312.00",
    "Price: 500 cents (currency not provided)",
  ]);
});

import { expect, it } from "vitest";
import {
  coveredBy,
  loadApprovals,
  notCovered,
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

// The Companies' terms, as their own code writes them.
const transfer = {
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
  notice: "Fictional Harborline Bank data. No real money moves.",
};
const upgrade = {
  booking_reference: "NW7K2P",
  booking_version: 1,
  from_cabin: "Economy",
  to_cabin: "Business",
  amount_due_cents: 24800,
  currency: "USD",
  refund_terms:
    "The fictional upgrade is refundable only if Northwind Air cancels this segment.",
  payment: "Simulated card on file — no real charge",
};
const flightChange = (amount_due_cents: number, refund_cents: number) => ({
  booking_reference: "NW7K2P",
  from: { flight_number: "NA 118", fare_cents: 31200 },
  to: { flight_number: "NA 120", fare_cents: 35000 },
  change_fee_cents: 7500,
  fare_difference_cents: 3800,
  amount_due_cents,
  refund_cents,
  currency: "USD",
});
const lanternOrder = {
  order_id: "ord_LNB1001",
  from_slot: "fri-1830",
  to_slot: "fri-1830",
  lines: { "shoyu-ramen": 2, "matcha-ice": 1 },
  before_total_cents: 3700,
  new_total_cents: 4300,
  price_difference_cents: 600,
  currency: "USD",
};
const upTo = (dollars: number): Instruction => ({
  maxCents: dollars * 100,
  currency: "USD",
});

it("compares the limit with the amount paid or moved, not with a balance", () => {
  // Harborline's transfer: $25.00 moves, and each balance changes by $25.00.
  expect(coveredBy(op(transfer), upTo(50))).toEqual({
    cents: 2500,
    text: "$25.00 within your limit of $50.00",
  });
  expect(notCovered(op(transfer), upTo(50))).toBeNull();
  expect(notCovered(op(transfer), upTo(20))).toBe(
    "the amount, $25.00, is over your limit of $20.00",
  );
  // Northwind's upgrade and its flight change: what is due is the amount.
  expect(coveredBy(op(upgrade), upTo(300))?.cents).toBe(24800);
  expect(notCovered(op(upgrade), upTo(50))).toBe(
    "the amount due, $248.00, is over your limit of $50.00",
  );
  expect(coveredBy(op(flightChange(11300, 0)), upTo(500))).toEqual({
    cents: 11300,
    text: "$113.00 within your limit of $500.00",
  });
  // Lantern's new total, as before.
  expect(notCovered(op(lanternOrder), upTo(20))).toBe(
    "the new total, $43.00, is over your limit of $20.00",
  );
  expect(coveredBy(op(lanternOrder), upTo(50))?.cents).toBe(4300);
});

it("still holds every other amount to the limit, and each balance's change", () => {
  // A fare over the limit, though what is due is within it.
  expect(notCovered(op(flightChange(11300, 0)), upTo(200))).toBe(
    "the fare, $312.00, is over your limit of $200.00",
  );
  // The amount says $25.00, but the account would lose $600.00.
  expect(
    notCovered(
      op({ ...transfer, source_balance_after_cents: 1112000 }),
      upTo(50),
    ),
  ).toBe(
    "the change to the source balance, $600.00, is over your limit of $50.00",
  );
  expect(
    coveredBy(
      op({ ...transfer, source_balance_after_cents: 1112000 }),
      upTo(50),
    ),
  ).toBeNull();
});

it("does not cover terms it does not understand, and says which", () => {
  const usd = { currency: "USD" };
  // A balance without its other half: nothing says how it changes.
  const { source_balance_before_cents: _before, ...lone } = transfer;
  void _before;
  expect(notCovered(op(lone), upTo(50))).toBe(
    "it can't tell from the terms how the source balance changes",
  );
  expect(
    notCovered(op({ amount_cents: 100, balance_cents: 5000, ...usd }), rule),
  ).toBe("it can't tell from the terms how the balance changes");
  // Harborline's budget change and its category change move no money.
  expect(
    notCovered(
      op({ from_limit_cents: 1000, to_limit_cents: 1500, spent_cents: 0 }),
      rule,
    ),
  ).toBe("the terms name no amount to pay or move");
  // An amount that is not a whole number of cents is one it can't read.
  for (const fee_cents of ["75", 100.5, null, true])
    expect(notCovered(op({ total_cents: 100, fee_cents, ...usd }), rule)).toBe(
      "it can't read “Fee” in the terms",
    );
  expect(notCovered(op({ total_cents: 100, currency: "EUR" }), rule)).toBe(
    "the terms are in EUR and your limit is in USD",
  );
  expect(notCovered(op({ total_cents: 100 }), rule)).toBe(
    "the terms name no currency and your limit is in USD",
  );
  expect(
    notCovered(
      op({ total_cents: 100, ...usd }, { summary: "Order for $0.50." }),
      rule,
    ),
  ).toBe("the Company's summary names an amount its terms don't hold");
});

it("does not take a bare amount for one paid or moved unless a balance changes with it", () => {
  // Harborline's category change of a posted credit, as its own code
  // writes it: the amount is the transaction's, and approving moves nothing.
  const credit = {
    transaction_id: "txn_HLB_1",
    description: "Transfer from Everyday Checking",
    amount_cents: 2500,
    currency: "USD",
    from_category: "transfer",
    to_category: "income",
    transaction_version: 1,
    notice: "Fictional Harborline Bank data. No real money moves.",
  };
  expect(coveredBy(op(credit), upTo(50))).toBeNull();
  expect(notCovered(op(credit), upTo(50))).toBe(
    "it can't tell from the terms that the amount, $25.00, is paid or moved",
  );
  // Over the limit or not, the reason is the same: it is not a payment.
  expect(notCovered(op(credit), upTo(20))).toBe(
    "it can't tell from the terms that the amount, $25.00, is paid or moved",
  );
  // A balance that stays as it was shows nothing moving either.
  expect(
    notCovered(
      op({
        ...credit,
        balance_before_cents: 5000,
        balance_after_cents: 5000,
      }),
      upTo(50),
    ),
  ).toBe(
    "it can't tell from the terms that the amount, $25.00, is paid or moved",
  );
  // The same amount beside the balances it changes is a transfer.
  expect(coveredBy(op(transfer), upTo(50))?.cents).toBe(2500);
  // An amount due or a total says by its name that it is paid.
  expect(
    coveredBy(op({ amount_due_cents: 2500, currency: "USD" }), upTo(50)),
  ).not.toBeNull();
  expect(
    coveredBy(op({ total_cents: 2500, currency: "USD" }), upTo(50)),
  ).not.toBeNull();
});

it("reads an amount below zero, and says it approves only what is paid or moved", () => {
  const below = (what: string) =>
    `${what}, is below zero, and it approves only amounts you pay or move`;
  // Lantern's order with the ice cream removed: $6.00 comes back.
  const cheaper = {
    ...lanternOrder,
    lines: { "shoyu-ramen": 2 },
    before_total_cents: 4300,
    new_total_cents: 3700,
    price_difference_cents: -600,
  };
  expect(coveredBy(op(cheaper), upTo(50))).toBeNull();
  expect(notCovered(op(cheaper), upTo(50))).toBe(
    below("the price difference, -$6.00"),
  );
  // Northwind's change to a cheaper flight, and a posted payment whose
  // category Harborline changes: neither is an amount to pay or move.
  expect(
    notCovered(
      op({ ...flightChange(0, 2000), fare_difference_cents: -2000 }),
      upTo(500),
    ),
  ).toBe(below("the fare difference, -$20.00"));
  expect(
    notCovered(
      op({ amount_cents: -5420, from_category: "groceries", currency: "USD" }),
      rule,
    ),
  ).toBe(below("the amount, -$54.20"));
  // A balance below zero, on either side of the change, is said as one.
  for (const half of [
    { source_balance_before_cents: -100 },
    { source_balance_after_cents: -100 },
  ]) {
    expect(coveredBy(op({ ...transfer, ...half }), upTo(50))).toBeNull();
    expect(notCovered(op({ ...transfer, ...half }), upTo(50))).toBe(
      "the source balance, -$1.00, is below zero, which it never approves",
    );
  }
});

it("never covers a refund, but reads a refund of zero and words about refunds", () => {
  const refund = "the terms include a refund, which it never approves";
  expect(notCovered(op(flightChange(0, 2500)), upTo(500))).toBe(refund);
  expect(
    notCovered(op({ refund_cents: 800, currency: "USD" }), upTo(500)),
  ).toBe(refund);
  // A refund written as anything but zero cents, or as a nested object.
  for (const terms of [
    { total_cents: 100, refund: 5, currency: "USD" },
    { total_cents: 100, refund_cents: "0", currency: "USD" },
    { total_cents: 100, refund: { amount_cents: 0 }, currency: "USD" },
  ])
    expect(notCovered(op(terms), upTo(500))).toBe(refund);
  // Northwind's refund policy is text; its flight change refunds nothing.
  expect(coveredBy(op(upgrade), upTo(300))).not.toBeNull();
  expect(coveredBy(op(flightChange(11300, 0)), upTo(500))).not.toBeNull();
  // A refund of zero alone names nothing to pay.
  expect(notCovered(op({ refund_cents: 0, currency: "USD" }), upTo(500))).toBe(
    "the terms name no amount to pay or move",
  );
});

it("has nothing to say without an instruction or for an operation that no longer waits", () => {
  const big = { total_cents: 9900, currency: "USD" };
  expect(notCovered(op(big), undefined)).toBeNull();
  expect(notCovered(op(big, { state: "succeeded" }), rule)).toBeNull();
  expect(
    notCovered(op(big, { expires_at: "2000-01-01T00:00:00Z" }), rule),
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

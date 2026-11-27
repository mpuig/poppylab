import { expect, it } from "vitest";
import { notSentReply, readable } from "./demo-text";

it("turns a catalogue into bullets led by each item's name, with money", () => {
  const text = readable({
    currency: "USD",
    products: [
      {
        id: "oranges",
        name: "Cara cara oranges",
        price: 450,
        unit: "bag",
        stock: 24,
        image: "https://x/oranges.webp",
      },
      {
        id: "apples",
        name: "Pink lady apples",
        price: 390,
        unit: "bag",
        stock: 32,
      },
      {
        id: "coffee",
        name: "Juniper house coffee",
        price: 1400,
        unit: "250g bag",
        stock: 12,
      },
    ],
  });
  expect(text).toBe(
    [
      "Products (3):",
      "- Cara cara oranges: price $4.50 · unit bag · stock 24",
      "- Pink lady apples: price $3.90 · unit bag · stock 32",
      "- Juniper house coffee: price $14.00 · unit 250g bag · stock 12",
    ].join("\n"),
  );
  // No raw structure, and no bookkeeping.
  expect(text).not.toMatch(/[{}"]|image|oranges\.webp/);
});

it("shows one or two items in full, with their own lists", () => {
  const text = readable({
    orders: [
      {
        id: "ord_LNB1001",
        status: "scheduled",
        slot: { id: "sun-1300", label: "Sunday 13:00–13:30" },
        version: 2,
        currency: "USD",
        lines: [
          {
            dish_id: "shoyu-ramen",
            name: "Shoyu ramen",
            quantity: 2,
            price_cents: 1450,
          },
        ],
        total_cents: 3700,
        note: "Fictional order.",
      },
    ],
  });
  expect(text).toBe(
    [
      "Orders (1):",
      "- ord_LNB1001",
      "  Status: scheduled",
      "  Slot: Sunday 13:00–13:30",
      "  Lines (1):",
      "  - Shoyu ramen: quantity 2 · price $14.50",
      "  Total: $37.00",
    ].join("\n"),
  );
});

it("formats amounts in cents, negative ones and thousands, and reads times", () => {
  const text = readable({
    transactions: [
      {
        id: "txn_1",
        account_id: "acc_HLB_A100",
        description: "Payment to Beacon Studio LLC",
        amount_cents: -1234500,
        status: "on_time",
        occurred_at: "2026-11-25T10:58:47.415Z",
        currency: "USD",
      },
    ],
  });
  expect(text).toContain("- Payment to Beacon Studio LLC");
  expect(text).toContain("Amount: −$12,345.00");
  expect(text).toContain("Status: on time");
  expect(text).toContain("Occurred at: 2026-11-25 10:58");
  expect(text).not.toContain("acc_HLB_A100");
  // A plain number isn't money unless the answer says its currency.
  expect(readable({ stock: 24, price: 450 })).toBe("Stock: 24\nPrice: 450");
});

it("names a place by its city and keeps a segment on one line", () => {
  const text = readable({
    trips: [
      {
        booking_reference: "NW7K2P",
        itinerary: [
          {
            id: "flt_na402",
            flight_number: "NA 402",
            origin: { code: "PAU", city: "Port Aurora" },
            destination: { code: "CDB", city: "Cinder Bay" },
            departure: "2027-05-18T08:20:00-04:00",
            seat: "18A",
            checked_bags: 3,
          },
        ],
        upgrade_offer: null,
      },
    ],
  });
  expect(text).toContain("- NW7K2P");
  expect(text).toContain(
    "  - NA 402: departure 2027-05-18 08:20 · seat 18A · checked bags 3 · origin Port Aurora · destination Cinder Bay",
  );
});

it("says a held change and an error in words", () => {
  expect(
    readable({
      status: "approval_required",
      operation_id: "op_1",
      summary:
        "Transfer USD 500.00 from Operating checking to Reserve savings.",
    }),
  ).toBe(
    "The company is holding this change until you approve it:\nTransfer USD 500.00 from Operating checking to Reserve savings.",
  );
  // Asked for again while its approval's outcome is unknown: nothing is held.
  const unknown = readable({
    status: "outcome_unknown",
    operation_id: "op_1",
    summary: "Transfer USD 500.00 from Operating checking to Reserve savings.",
    terms: { amount_cents: 50000, currency: "USD" },
    note: "An approval of these terms was already sent.",
  });
  expect(unknown).toContain("its outcome is unknown");
  expect(unknown).toContain("Nothing new is waiting for your approval");
  expect(unknown).toContain("Retry the same approval");
  expect(unknown).toContain("Transfer USD 500.00");
  expect(unknown).not.toContain("until you approve");
  expect(readable({ error: "out_of_stock" })).toBe(
    "The company answered with an error: out of stock.",
  );
  expect(readable({})).toBe("The company answered with no details.");
  expect(readable(null)).toBe("No data.");
});

it("never says the company answered when Iris stopped before asking", () => {
  const changes = (scope: string) => scope === "poppy:write";
  const signedOut = {
    error: "sign_in_required",
    sent: false,
    instruction: "Ask the user to use the Sign in control in the chat.",
  };
  expect(readable(signedOut)).toBe(
    "Iris didn't send this request to the Company: this needs your account, and you are not signed in.",
  );
  expect(notSentReply(signedOut, "Juniper Market", changes)).toBe(
    "This needs your account at Juniper Market, and you are not signed in. Iris didn't send this request to the Company. Press “Sign in to Juniper Market”, then ask again.",
  );
  const readOnly = {
    error: "insufficient_scope",
    sent: false,
    missing: ["poppy:write"],
    instruction: "Ask the user to choose Request change permission.",
  };
  expect(readable(readOnly)).toBe(
    "Iris didn't send this request to the Company: your sign-in doesn't include a permission this needs.",
  );
  expect(notSentReply(readOnly, "Juniper Market", changes)).toBe(
    "This needs the change permission, which your sign-in to Juniper Market doesn't include. Iris didn't send this request to the Company. Press “Request change permission”, review the Company's consent, and ask again.",
  );
  // A read permission left unticked at consent: no change permission helps.
  expect(
    notSentReply(
      { ...readOnly, missing: ["cards:read"] },
      "Harborline Bank",
      changes,
    ),
  ).toBe(
    "This needs a permission your sign-in to Harborline Bank doesn't include. Iris didn't send this request to the Company. Sign out, then sign in again and keep every permission ticked on the Company's consent page.",
  );
  // The words are for the customer: never the model's instruction.
  for (const answer of [signedOut, readOnly])
    expect(readable(answer)).not.toContain("Ask the user");
  // An answer of the Company's, whatever its error, is not one of these.
  expect(
    notSentReply({ error: "sign_in_required" }, "Juniper Market", changes),
  ).toBeUndefined();
  expect(
    notSentReply({ orders: [] }, "Juniper Market", changes),
  ).toBeUndefined();
});

it("bounds long answers and points to the raw data", () => {
  const many = readable({
    items: Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}` })),
  });
  expect(many.split("\n")).toHaveLength(10);
  expect(many).toContain("…and 22 more");
  const wide = readable(
    Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field_${i}`, i])),
  );
  expect(wide.split("\n").at(-1)).toBe("…more under Data.");
});

import { expect, it, vi } from "vitest";
import {
  demoAside,
  demoChange,
  demoChangeKind,
  demoChangeReply,
  demoChangeReplyNow,
  demoMissing,
  demoMissingReport,
  type DemoTools,
} from "./demo-changes";
import { agentAnswer, readable } from "./demo-text";

const tool = (value: unknown) => ({ execute: vi.fn(async () => value) });
const key = () => "key_fixture_0001";

const restaurant = (): DemoTools => ({
  menu: tool({
    dishes: [
      { id: "shoyu-ramen", name: "Shoyu ramen" },
      { id: "miso-ramen", name: "Miso vegetable ramen" },
      { id: "pork-gyoza", name: "Pork gyoza (6)" },
      { id: "veg-gyoza", name: "Vegetable gyoza (6)" },
      { id: "edamame", name: "Salted edamame" },
      { id: "matcha-ice", name: "Matcha ice cream" },
    ],
  }),
  delivery_slots: tool({
    slots: [
      { id: "fri-1830", label: "Friday 18:30–19:00" },
      { id: "sat-1230", label: "Saturday 12:30–13:00" },
      { id: "sat-1900", label: "Saturday 19:00–19:30" },
      { id: "sun-1300", label: "Sunday 13:00–13:30" },
    ],
  }),
  my_orders: tool({
    orders: [
      { id: "ord_LNB1001", status: "scheduled", slot: { id: "fri-1830" } },
    ],
  }),
  change_order: tool({}),
});
const bank = (): DemoTools => ({
  accounts: tool({
    accounts: [
      {
        id: "acc_A100",
        name: "Operating checking",
        type: "checking",
        status: "active",
      },
      {
        id: "acc_A200",
        name: "Reserve savings",
        type: "savings",
        status: "active",
      },
    ],
  }),
  recipients: tool({
    recipients: [
      { id: "rcp_1", name: "Beacon Studio LLC", status: "active" },
      { id: "rcp_2", name: "Old Wharf Storage", status: "inactive" },
    ],
  }),
  transfer_between_accounts: tool({}),
  request_payment: tool({}),
});
const airline = (): DemoTools => ({
  upcoming_trips: tool({
    trips: [
      {
        booking_reference: "NW7K2P",
        itinerary: [
          { id: "flt_na402", flight_number: "NA 402" },
          { id: "flt_na118", flight_number: "NA 118" },
        ],
        upgrade_offer: { id: "upg_elena_1", flight_id: "flt_na118" },
      },
    ],
  }),
  accept_upgrade: tool({}),
  add_baggage: tool({}),
});

it("changes a scheduled order from what the menu, the slots and the order say", async () => {
  expect(
    await demoChange(
      "Add a matcha ice cream and move it to Sunday lunchtime.",
      restaurant(),
      key,
    ),
  ).toMatchObject({
    call: "change_order",
    args: {
      order_id: "ord_LNB1001",
      slot_id: "sun-1300",
      add: [{ dish_id: "matcha-ice", quantity: 1 }],
    },
  });
  // A dish that shares its words with another needs all of them.
  expect(
    await demoChange("add 2 vegetable gyoza", restaurant(), key),
  ).toMatchObject({ args: { add: [{ dish_id: "veg-gyoza", quantity: 2 }] } });
  expect(
    await demoChange("remove the edamame", restaurant(), key),
  ).toMatchObject({ args: { remove: ["edamame"] } });
  // Two slots on Saturday: dinner is the later one.
  expect(
    await demoChange("move my order to Saturday dinner", restaurant(), key),
  ).toMatchObject({ args: { slot_id: "sat-1900" } });
});

it("moves an order to the day it should go to, not the day it is on", async () => {
  // The order is on Friday 18:30.
  for (const message of [
    "Move my order from Friday to Sunday",
    "Move my order to Sunday from Friday",
    "I want to move my Friday order to Sunday",
    "Sunday instead of Friday, please move it",
  ])
    expect(await demoChange(message, restaurant(), key)).toMatchObject({
      call: "change_order",
      args: { order_id: "ord_LNB1001", slot_id: "sun-1300" },
      because: expect.stringContaining("move to Sunday 13:00–13:30"),
    });
  // Where it already is: nothing to ask the Company for.
  expect(
    await demoChange("move my order to Friday", restaurant(), key),
  ).toMatchObject({
    say: expect.stringContaining("already scheduled for Friday 18:30–19:00"),
  });
  expect(
    await demoChange("move it from Friday", restaurant(), key),
  ).toMatchObject({ say: expect.stringContaining("which day") });
  // A dish and the day it is already on: only the dish changes.
  const kept = await demoChange(
    "add edamame to my Friday order",
    restaurant(),
    key,
  );
  expect(kept).toMatchObject({
    args: { add: [{ dish_id: "edamame", quantity: 1 }] },
  });
  expect(kept).not.toHaveProperty("args.slot_id");
});

it("reads how many of a dish from the number beside its name", async () => {
  const added = async (message: string) =>
    (
      (await demoChange(message, restaurant(), key)) as {
        args?: { add?: unknown };
      }
    ).args?.add;
  // The portion size in the dish's own name is not a quantity.
  expect(await added("Add a pork gyoza (6)")).toEqual([
    { dish_id: "pork-gyoza", quantity: 1 },
  ]);
  // Nor is a time, wherever it is written.
  expect(await added("add edamame and move it to Saturday at 7")).toEqual([
    { dish_id: "edamame", quantity: 1 },
  ]);
  expect(await added("at 19:30 on Saturday, add 2 edamame")).toEqual([
    { dish_id: "edamame", quantity: 2 },
  ]);
  // Each dish has its own number, in digits or in words, before or after.
  expect(
    await added("add 2 vegetable gyoza, three more pork gyoza and edamame x4"),
  ).toEqual([
    { dish_id: "pork-gyoza", quantity: 3 },
    { dish_id: "veg-gyoza", quantity: 2 },
    { dish_id: "edamame", quantity: 4 },
  ]);
  expect(await added("add 2 of the pork gyoza (6)")).toEqual([
    { dish_id: "pork-gyoza", quantity: 2 },
  ]);
  // More than the demo adds: it says so instead of adding another number.
  expect(await demoChange("add 10 edamame", restaurant(), key)).toEqual({
    say: "The demo adds 1 to 5 of a dish at a time; you asked for 10 × Salted edamame.",
  });
  // Removing a dish takes no number.
  expect(
    await demoChange("remove the 2 pork gyoza", restaurant(), key),
  ).toMatchObject({ args: { remove: ["pork-gyoza"] } });
});

it("adds and removes dishes in one message, each by its own verb", async () => {
  const change = async (message: string) =>
    (
      (await demoChange(message, restaurant(), key)) as {
        args?: Record<string, unknown>;
      }
    ).args;
  expect(await change("Remove the edamame and add a matcha ice cream")).toEqual(
    {
      order_id: "ord_LNB1001",
      add: [{ dish_id: "matcha-ice", quantity: 1 }],
      remove: ["edamame"],
    },
  );
  expect(
    await change("add 2 pork gyoza, drop the edamame and the shoyu ramen"),
  ).toEqual({
    order_id: "ord_LNB1001",
    add: [{ dish_id: "pork-gyoza", quantity: 2 }],
    remove: ["shoyu-ramen", "edamame"],
  });
  expect(await change("swap the edamame for a matcha ice cream")).toEqual({
    order_id: "ord_LNB1001",
    add: [{ dish_id: "matcha-ice", quantity: 1 }],
    remove: ["edamame"],
  });
  // Named before any verb: the first one after it decides.
  expect(await change("The edamame, remove it")).toEqual({
    order_id: "ord_LNB1001",
    remove: ["edamame"],
  });
  expect(
    await demoChange(
      "Remove the edamame and add a matcha ice cream",
      restaurant(),
      key,
    ),
  ).toMatchObject({
    because: expect.stringContaining(
      "remove Salted edamame; add 1 × Matcha ice cream.",
    ),
  });
});

it("removes only a dish the order has, when the order lists its dishes", async () => {
  // As Lantern answers my_orders: the order with its items.
  const listed = () => {
    const tools = restaurant();
    tools.my_orders = tool({
      orders: [
        {
          id: "ord_LNB1001",
          status: "scheduled",
          slot: { id: "fri-1830" },
          items: [
            { dish_id: "shoyu-ramen", name: "Shoyu ramen", quantity: 2 },
            { dish_id: "edamame", name: "Salted edamame", quantity: 1 },
          ],
        },
      ],
    });
    return tools;
  };
  // On the menu, not in the order: the Company would refuse the request.
  expect(
    await demoChange("Remove the matcha ice cream", listed(), key),
  ).toEqual({
    say: "Matcha ice cream isn't in your order. Your order has 2 × Shoyu ramen and 1 × Salted edamame.",
  });
  // Nothing is sent for the rest of the message either.
  expect(
    await demoChange(
      "remove the pork gyoza and the matcha ice cream, and add edamame",
      listed(),
      key,
    ),
  ).toEqual({
    say: "Pork gyoza (6) and Matcha ice cream aren't in your order. Your order has 2 × Shoyu ramen and 1 × Salted edamame.",
  });
  // A dish it has is removed, and one it lacks can still be added.
  expect(
    await demoChange(
      "remove the edamame and add a matcha ice cream",
      listed(),
      key,
    ),
  ).toMatchObject({
    call: "change_order",
    args: {
      add: [{ dish_id: "matcha-ice", quantity: 1 }],
      remove: ["edamame"],
    },
  });
  // An order that doesn't list its dishes can't say: the Company decides.
  expect(
    await demoChange("Remove the matcha ice cream", restaurant(), key),
  ).toMatchObject({ call: "change_order", args: { remove: ["matcha-ice"] } });
});

it("asks instead of guessing a dish, a day or an order", async () => {
  expect(await demoChange("change my order", restaurant(), key)).toHaveProperty(
    "say",
  );
  expect(
    await demoChange("move it to Monday", restaurant(), key),
  ).toMatchObject({
    say: expect.stringContaining("no delivery slot on Monday"),
  });
  const none = restaurant();
  none.my_orders = tool({ orders: [{ id: "old", status: "delivered" }] });
  expect(await demoChange("add edamame", none, key)).toMatchObject({
    say: "There is no scheduled order to change.",
  });
});

it("transfers between the accounts the message names, in the direction it says", async () => {
  expect(
    await demoChange("Transfer $500 from checking to savings.", bank(), key),
  ).toMatchObject({
    call: "transfer_between_accounts",
    args: {
      source_account_id: "acc_A100",
      destination_account_id: "acc_A200",
      amount_cents: 50000,
      idempotency_key: "key_fixture_0001",
    },
  });
  expect(
    await demoChange(
      "I want to move $20.50 to checking from savings",
      bank(),
      key,
    ),
  ).toMatchObject({
    args: {
      source_account_id: "acc_A200",
      destination_account_id: "acc_A100",
      amount_cents: 2050,
    },
  });
  // Thousands grouped with commas are one amount, not the digits before the comma.
  expect(
    await demoChange("Transfer $1,000 from checking to savings", bank(), key),
  ).toMatchObject({ args: { amount_cents: 100000 } });
  expect(
    await demoChange(
      "Transfer 2,500.75 dollars from checking to savings",
      bank(),
      key,
    ),
  ).toMatchObject({ args: { amount_cents: 250075 } });
  // A number it can't read as one amount is never cut short.
  for (const unclear of ["$1,00", "$1.234", "12,50 dollars"])
    expect(
      await demoChange(
        `Transfer ${unclear} from checking to savings`,
        bank(),
        key,
      ),
    ).toMatchObject({ say: expect.stringContaining("How much?") });
  // No amount, or one account: it asks.
  expect(
    await demoChange("transfer from checking to savings", bank(), key),
  ).toMatchObject({ say: expect.stringContaining("How much?") });
  expect(
    await demoChange("transfer $5 to savings from savings", bank(), key),
  ).toMatchObject({ say: expect.stringContaining("Name both accounts") });
});

it("pays a saved recipient, never one it wasn't shown", async () => {
  expect(
    await demoChange(
      "Send Beacon Studio $125 for November design work.",
      bank(),
      key,
    ),
  ).toMatchObject({
    call: "request_payment",
    args: {
      source_account_id: "acc_A100",
      recipient_id: "rcp_1",
      amount_cents: 12500,
      memo: "November design work",
      idempotency_key: "key_fixture_0001",
    },
  });
  expect(await demoChange("pay my landlord $900", bank(), key)).toMatchObject({
    say: expect.stringContaining("Beacon Studio LLC"),
  });
  // An inactive recipient is neither matched (here on "old") nor offered.
  for (const message of [
    "pay my old landlord $900",
    "Send Old Wharf Storage $50 for the unit",
  ])
    expect(await demoChange(message, bank(), key)).toEqual({
      say: "Who should be paid? Your active saved recipients are Beacon Studio LLC.",
    });
});

it("pays from the account the message names, not one a word of it resembles", async () => {
  // As Robin's accounts at Harborline are named.
  const robin = (): DemoTools => ({
    ...bank(),
    accounts: tool({
      accounts: [
        {
          id: "acc_B100",
          name: "Everyday checking",
          type: "checking",
          status: "active",
        },
        {
          id: "acc_B200",
          name: "Rainy day savings",
          type: "savings",
          status: "active",
        },
      ],
    }),
    recipients: tool({
      recipients: [{ id: "rcp_3", name: "Morrow Workshop", status: "active" }],
    }),
  });
  const source = async (message: string) =>
    (
      (await demoChange(message, robin(), key)) as {
        args?: { source_account_id?: string };
      }
    ).args?.source_account_id;
  // "Day" is in Friday and today, and is no account's name on its own; what
  // the payment is for is its memo, where a word of a name ("rainy") or the
  // default account itself is no reason to ask.
  for (const message of [
    "Pay Morrow Workshop $120 for Friday's class",
    "Pay Morrow Workshop $120 today",
    "Send Morrow Workshop $120 a day early",
    "Pay Morrow Workshop $120 for a rainy day",
    "Pay Morrow Workshop $120 for checking the kiln",
  ])
    expect(await source(message), message).toBe("acc_B100");
  // Named before the memo, or in it after a word that says it pays.
  for (const message of [
    "Pay Morrow Workshop $120 from savings",
    "Pay Morrow Workshop $120 from my rainy day savings for Friday's class",
    "Pay Morrow Workshop $120 for Friday's class from savings",
    "Pay Morrow Workshop $120 for rent using my savings",
    "Pay Morrow Workshop $120 for rent out of savings",
    "Pay Morrow Workshop $120 for rent with my rainy day savings",
  ])
    expect(await source(message), message).toBe("acc_B200");
  // Named outright in the memo and nothing says it pays: the demo asks, and
  // the answer it asks for settles it either way.
  for (const message of [
    "Pay Morrow Workshop $120 for savings advice",
    "Pay Morrow Workshop $120 for rent, savings account",
    "Pay Morrow Workshop $120 for the rainy-day savings talk",
  ])
    expect(await demoChange(message, robin(), key), message).toEqual({
      say: "Which account should pay, Everyday checking or Rainy day savings? The message mentions Rainy day savings only in what the payment is for, and the demo doesn't guess. Nothing was sent; say it again with “from Everyday checking” or “from Rainy day savings”.",
    });
  expect(
    await source(
      "Pay Morrow Workshop $120 for savings advice from Everyday checking",
    ),
  ).toBe("acc_B100");
  expect(
    await source(
      "Pay Morrow Workshop $120 from Rainy day savings for savings advice",
    ),
  ).toBe("acc_B200");
  // A transfer names its accounts the same way.
  expect(
    await demoChange("Move $50 today from savings to checking", robin(), key),
  ).toMatchObject({
    args: { source_account_id: "acc_B200", destination_account_id: "acc_B100" },
  });
});

it("keeps a payment or transfer within what the bank's tools take", async () => {
  // As Harborline describes them: up to $10,000.00, a memo of 1 to 120 characters.
  const described = () => {
    const tools = bank();
    const amount_cents = { type: "integer", minimum: 1, maximum: 1000000 };
    tools.transfer_between_accounts!.schema = { properties: { amount_cents } };
    tools.request_payment!.schema = {
      properties: {
        amount_cents,
        memo: { type: "string", minLength: 1, maxLength: 120 },
      },
    };
    return tools;
  };
  const tools = described();
  for (const message of [
    "Transfer $20000 from checking to savings",
    "Send Beacon Studio $20,000 for the retainer",
  ])
    expect(await demoChange(message, tools, key)).toEqual({
      say: "$20000.00 is more than this bank takes in one request: $10000.00 at most. Nothing was sent; ask for a smaller amount.",
    });
  expect(
    await demoChange("Transfer $10,000 from checking to savings", tools, key),
  ).toMatchObject({ args: { amount_cents: 1000000 } });
  // A memo of nothing but punctuation is no memo: the demo's own stands in.
  expect(
    await demoChange("Pay Beacon Studio $125 for .", tools, key),
  ).toMatchObject({ args: { memo: "Payment asked for in the demo" } });
  expect(
    await demoChange("Pay Beacon Studio $125 for   ", bank(), key),
  ).toMatchObject({ args: { memo: "Payment asked for in the demo" } });
});

it("accepts the upgrade offer on the flight named, and adds bags", async () => {
  expect(
    await demoChange("Upgrade my NA 118 flight to Business.", airline(), key),
  ).toMatchObject({
    call: "accept_upgrade",
    args: { booking_reference: "NW7K2P", offer_id: "upg_elena_1" },
  });
  expect(await demoChange("upgrade NA 402", airline(), key)).toMatchObject({
    say: expect.stringContaining("no upgrade offer on NA 402"),
  });
  expect(
    await demoChange("add 2 bags to NA 402", airline(), key),
  ).toMatchObject({
    call: "add_baggage",
    args: {
      booking_reference: "NW7K2P",
      flight_id: "flt_na402",
      additional_pieces: 2,
    },
  });
  // The number beside "bag", not a date or a time elsewhere in the message.
  expect(
    await demoChange("add a bag to NA 402 on May 5", airline(), key),
  ).toMatchObject({ args: { flight_id: "flt_na402", additional_pieces: 1 } });
  expect(
    await demoChange("add two more checked bags to NA 118", airline(), key),
  ).toMatchObject({ args: { flight_id: "flt_na118", additional_pieces: 2 } });
  expect(await demoChange("add 3 bags to NA 402", airline(), key)).toEqual({
    say: "The demo adds 1 or 2 checked bags at a time; you asked for 3.",
  });
});

it("upgrades the flight with an offer when the request names none, for each passenger", async () => {
  // The playground's suggestion, which fits Elena and Robin alike.
  const ask = "Upgrade my flight to Business.";
  expect(await demoChange(ask, airline(), key)).toMatchObject({
    call: "accept_upgrade",
    args: { booking_reference: "NW7K2P", offer_id: "upg_elena_1" },
    because: expect.stringContaining("upgrade offer on NA 118"),
  });
  const robin: DemoTools = {
    ...airline(),
    upcoming_trips: tool({
      trips: [
        {
          booking_reference: "NW4D8R",
          itinerary: [{ id: "flt_na274", flight_number: "NA 274" }],
          upgrade_offer: { id: "upg_robin_1", flight_id: "flt_na274" },
        },
      ],
    }),
  };
  expect(await demoChange(ask, robin, key)).toMatchObject({
    args: { booking_reference: "NW4D8R", offer_id: "upg_robin_1" },
    because: expect.stringContaining("upgrade offer on NA 274"),
  });
});

it("takes a flight number only from the flights that are booked", async () => {
  // "to 118" and "my 13" have the shape of a flight number and are not one.
  expect(await demoChange("add 2 bags to 118", airline(), key)).toMatchObject({
    call: "add_baggage",
    args: { flight_id: "flt_na118", additional_pieces: 2 },
  });
  expect(
    await demoChange("upgrade my 13:10 flight", airline(), key),
  ).toMatchObject({
    call: "accept_upgrade",
    args: { offer_id: "upg_elena_1" },
  });
  expect(
    await demoChange("Upgrade me on na118 to Business", airline(), key),
  ).toMatchObject({ call: "accept_upgrade" });
  // A date is not a flight: with two flights and none named, it asks which.
  expect(
    await demoChange("Add a bag to my flight on 18 May", airline(), key),
  ).toEqual({
    say: "Which flight should the bag go on? Your flights are NA 402 and NA 118. For example: “Add a bag to NA 402.”",
  });
  // With one flight there is nothing to ask.
  const one = airline();
  one.upcoming_trips = tool({
    trips: [
      {
        booking_reference: "NW1ONE",
        itinerary: [{ id: "flt_na402", flight_number: "NA 402" }],
        upgrade_offer: null,
      },
    ],
  });
  expect(
    await demoChange("Add a bag to my flight on 18 May", one, key),
  ).toMatchObject({ args: { flight_id: "flt_na402", additional_pieces: 1 } });
  // A flight of the same airline that isn't booked is named, and refused.
  for (const message of ["upgrade NA 999", "add a bag to NA 999"])
    expect(await demoChange(message, airline(), key)).toEqual({
      say: "NA 999 isn't in your bookings. Your flights are NA 402 and NA 118.",
    });
});

it("answers a question about a change by reading, never by asking for the change", async () => {
  const called = async (message: string, tools: DemoTools) => {
    expect(demoChangeKind(message, tools)).toBeUndefined();
    expect(await demoChange(message, tools, key)).toBeUndefined();
    // Not even the account is read on the way to deciding.
    for (const each of Object.values(tools))
      expect(each!.execute).not.toHaveBeenCalled();
  };
  await called("Is there an upgrade available on my trip?", airline());
  await called("What upgrades do I have", airline());
  await called("How much is an extra bag?", airline());
  await called("An upgrade on NA 118?", airline());
  await called("Did you remove the edamame?", restaurant());
  await called("Which day can I move my order to?", restaurant());
  await called("How do I transfer $500 to savings?", bank());
  // Asking the demo to do it is still a request, with or without "?".
  expect(
    await demoChange("Can you upgrade my NA 118 flight?", airline(), key),
  ).toMatchObject({ call: "accept_upgrade" });
  expect(
    await demoChange("Could I add a bag to NA 402?", airline(), key),
  ).toMatchObject({ call: "add_baggage" });
  expect(
    await demoChange("Please move my order to Sunday?", restaurant(), key),
  ).toMatchObject({ call: "change_order" });
});

it("says so when the account can't be read, instead of planning from nothing", async () => {
  // Signed in without recipients:read, the read is answered with an error.
  const unread = bank();
  unread.recipients = tool({ error: "insufficient_scope" });
  const plan = await demoChange("Send Beacon Studio $5", unread, key);
  expect(plan).toMatchObject({
    say: expect.stringContaining("couldn't read your account"),
  });
  expect((plan as { say: string }).say).not.toContain("recipients are none");
  expect(unread.request_payment!.execute).not.toHaveBeenCalled();
  for (const [tools, name, message] of [
    [bank(), "accounts", "Transfer $500 from checking to savings"],
    [restaurant(), "menu", "add edamame"],
    [restaurant(), "my_orders", "add edamame"],
    [restaurant(), "delivery_slots", "move my order to Sunday"],
    [airline(), "upcoming_trips", "add a bag to NA 402"],
  ] as const) {
    tools[name] = tool({ error: "insufficient_scope" });
    expect(await demoChange(message, tools, key)).toMatchObject({
      say: expect.stringContaining("Nothing was sent to the Company"),
    });
  }
});

it("never says a change is held for approval when it wasn't sent", () => {
  const plan = {
    call: "transfer_between_accounts",
    args: {},
    because: "The demo read your accounts and asked to transfer $500.00.",
  };
  const show = vi.fn((answer: unknown) => JSON.stringify(answer, null, 2));
  // Signed in to read only: the request stops before the Company.
  const refused = demoChangeReply(
    plan,
    {
      error: "insufficient_scope",
      instruction: "Ask the user to choose Request change permission.",
    },
    show,
  );
  // Nothing of the Company's to show, in lines or as data.
  expect(show).not.toHaveBeenCalled();
  expect(refused).toContain("nothing was sent to the Company");
  expect(refused).toContain("Request change permission");
  expect(refused).not.toContain("asked to transfer");
  expect(refused).not.toContain("until you click Approve");
  expect(refused).not.toContain("Ask the user");
  // Sent and held: the Company's answer, and what happens next.
  const held = demoChangeReply(
    plan,
    { status: "approval_required", operation_id: "op_1" },
    show,
  );
  expect(held).toContain("asked to transfer $500.00");
  expect(held).toContain('"operation_id": "op_1"');
  expect(held).toContain("until you click Approve");
  // Asked for again while its approval's outcome is unknown (Operations v3
  // §7): the card offers only Retry, so there is no Approve to click.
  const unknown = demoChangeReply(
    plan,
    { status: "outcome_unknown", operation_id: "op_1" },
    readable,
  );
  expect(unknown).toContain("asked to transfer $500.00");
  expect(unknown).toContain("its outcome is unknown");
  expect(unknown).toContain("Retry the same approval");
  expect(unknown).not.toContain("until you");
  expect(unknown).not.toContain("click Approve");
});

it("says Iris approved the change once the standing instruction did, not that it is held", () => {
  const plan = {
    call: "change_order",
    args: {},
    because:
      "The demo read your scheduled order ord_LNB1001 and asked for: add 1 × Matcha ice cream.",
  };
  const summary = "Change order ord_LNB1001. New total USD 43.00.";
  const result = { status: "approval_required", operation_id: "op_1", summary };
  const text = demoChangeReply(plan, result, readable);
  const data = JSON.stringify(result);
  const waits =
    "The Company holds a change until you click Approve. For natural-language reasoning, select a model.";
  expect(text.endsWith(waits)).toBe(true);
  // While it waits for the person, or after they approved it themselves,
  // the answer stays as it was written.
  expect(demoChangeReplyNow(text, data, () => false)).toBe(text);
  // Approved by Iris: nothing is held, and there is no Approve to click.
  const approved = vi.fn((id: string) => id === "op_1");
  const now = demoChangeReplyNow(text, data, approved);
  expect(approved).toHaveBeenCalledWith("op_1");
  expect(now).toBe(
    `${plan.because}\n\nThe company answered:\n\nThe company held this change until it was approved:\n${summary}\n\nIris approved this change on your standing instruction, so there is nothing for you to approve. For natural-language reasoning, select a model.`,
  );
  expect(now).not.toContain("holds a change");
  expect(now).not.toContain("click Approve");
  // Another operation was approved, not this answer's.
  expect(demoChangeReplyNow(text, data, (id) => id === "op_2")).toBe(text);
  // Only the demo's own sentences change, never the same words in a
  // Company's summary.
  const quoting = demoChangeReply(
    plan,
    {
      ...result,
      summary: "The Company holds a change until you click Approve. Really.",
    },
    readable,
  );
  expect(demoChangeReplyNow(quoting, data, () => true)).toContain(
    "approved:\nThe Company holds a change until you click Approve. Really.\n\nIris approved this change",
  );
  // An answer that proposed nothing, or whose data is missing or cut short,
  // is left as it is.
  for (const other of [undefined, "", "{", "null", '{"orders":[]}'])
    expect(demoChangeReplyNow(text, other, () => true)).toBe(text);
  expect(demoChangeReplyNow("Your orders: none.", data, () => true)).toBe(
    "Your orders: none.",
  );
});

it("leaves reading questions and unknown Companies to the other rules", async () => {
  expect(await demoChange("my orders", restaurant(), key)).toBeUndefined();
  expect(await demoChange("my account balances", bank(), key)).toBeUndefined();
  expect(await demoChange("my upcoming trips", airline(), key)).toBeUndefined();
  // Juniper's tools have other names: its own rules handle it.
  expect(
    await demoChange(
      "move my recurring delivery to Saturday",
      { propose_delivery_change: tool({}), my_deliveries: tool({}) },
      key,
    ),
  ).toBeUndefined();
});

it("reads words for the agent or for feedback outside a payment's memo only", async () => {
  const company = (tools: DemoTools): DemoTools => ({
    ...tools,
    company_agent_send: tool({}),
    report_unsupported_task: tool({}),
  });
  // What a payment is for is its memo, not a request for either.
  for (const message of [
    "Send Beacon Studio $125 for the quarterly report",
    "Send Beacon Studio $125 for November design support",
    "Pay Beacon Studio $40 for the gift card we owe someone",
  ]) {
    expect(demoAside(message, company(bank()))).toBeUndefined();
    expect(await demoChange(message, company(bank()), key)).toMatchObject({
      call: "request_payment",
    });
  }
  // The demo's own ways in still work, at a bank too.
  expect(demoAside("Pay with a gift card", company(bank()))).toBe("feedback");
  expect(
    demoAside("Pay for my order with a gift card", company(restaurant())),
  ).toBe("feedback");
  expect(demoAside("I want to talk to a person", company(bank()))).toBe(
    "agent",
  );
  expect(
    demoAside(
      "Talk to someone about a transfer for my landlord",
      company(bank()),
    ),
  ).toBe("agent");
  // Outside a memo the words count, wherever they are.
  expect(
    demoAside("Transfer $5 to savings, then send feedback", company(bank())),
  ).toBe("feedback");
  // A Company with neither is asked for neither.
  expect(demoAside("talk to support about a voucher", bank())).toBeUndefined();
});

it("reports a dish missing from the last delivery to the Company's agent, from what it lists", async () => {
  const message =
    "The pork gyoza was missing from my last delivery. Can I get a refund?";
  // As Lantern's agent answers, through company_agent_send.
  const send = {
    execute: vi.fn(async (input?: Record<string, unknown>) => {
      const data = input?.data as Record<string, unknown>;
      return data.request === "order_status"
        ? {
            replies: [
              {
                author: "agent",
                data: {
                  scheduled: [],
                  last_delivery: {
                    id: "ord_LNB0907",
                    status: "delivered",
                    items: [
                      { dish_id: "shoyu-ramen", name: "Shoyu ramen" },
                      { dish_id: "pork-gyoza", name: "Pork gyoza (6)" },
                    ],
                  },
                },
              },
            ],
          }
        : {
            replies: [{ author: "agent", text: "I can refund USD 8.00." }],
            approval: { status: "approval_required" },
          };
    }),
  };
  const tools = { ...restaurant(), company_agent_send: send };
  // Not a change, not feedback: before, "delivery" picked the slots.
  expect(demoChangeKind(message, tools)).toBeUndefined();
  expect(demoAside(message, tools)).toBeUndefined();
  expect(demoMissing(message, tools)).toBe(true);
  const lantern = (answer: unknown) =>
    agentAnswer(answer, "Lantern Noodle Bar");
  const said = await demoMissingReport(message, send, lantern);
  expect(send.execute).toHaveBeenLastCalledWith({
    data: {
      request: "report_missing_item",
      order_id: "ord_LNB0907",
      dish_id: "pork-gyoza",
    },
  });
  // The agent's reply is shown above as Lantern's own content.
  expect(said).toBe(
    "Told the Company's agent that Pork gyoza (6) was missing from order ord_LNB0907. Lantern Noodle Bar answered; its reply is shown above.\n\nIf it proposes a refund, approve or decline it in Needs you, above the message box.",
  );
  // A dish the delivery didn't have is asked about, and nothing is reported.
  send.execute.mockClear();
  expect(
    await demoMissingReport(
      "The edamame was missing from my order",
      send,
      lantern,
    ),
  ).toBe(
    "Which dish was missing? Your last delivery, order ord_LNB0907, had Shoyu ramen and Pork gyoza (6). Nothing was sent to the Company's agent.",
  );
  expect(send.execute).toHaveBeenCalledTimes(1);
  // Words that aren't about a delivery, or a Company without an agent, aren't.
  expect(demoMissing("My card is missing", tools)).toBe(false);
  expect(demoMissing(message, restaurant())).toBe(false);
});

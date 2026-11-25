import { expect, it, vi } from "vitest";
import { demoChange, type DemoTools } from "./demo-changes";

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

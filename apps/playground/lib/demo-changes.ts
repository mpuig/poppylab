/**
 * Protocol demo (no model): the changes it can propose at a Company other
 * than Juniper. A Company is recognised by its tools, never by its name:
 * scheduled orders (`change_order`), bank accounts (`transfer_between_accounts`,
 * `request_payment`) and flight bookings (`accept_upgrade`, `add_baggage`).
 *
 * The demo never invents an identifier. It reads the account first (orders,
 * accounts, recipients, trips) and builds the request from what it read; the
 * Company still answers `approval_required` and holds the change for the
 * User. When the message doesn't say enough, the demo asks instead of guessing.
 */
import { HOLDING } from "./demo-text";

type Tool = {
  execute: (input?: Record<string, unknown>) => Promise<unknown>;
  /** The Company's own description of the arguments, when it gave one. */
  schema?: Record<string, unknown>;
};
export type DemoTools = Record<string, Tool | undefined>;
export type DemoPlan =
  /** The tool to call, its exact arguments, and how they were chosen. */
  | { call: string; args: Record<string, unknown>; because: string }
  /** Not enough to go on: what to say instead. */
  | { say: string };

const list = (value: unknown, key: string): Array<Record<string, unknown>> => {
  const items = (value as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(items)
    ? items.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object",
      )
    : [];
};
const text = (value: unknown) => (typeof value === "string" ? value : "");
/** The error a tool answered with instead of data, if it did. */
const refusal = (value: unknown) => {
  const error = (value as Record<string, unknown> | null | undefined)?.error;
  return typeof error === "string" ? error : undefined;
};
/** A read that was answered with an error: there is nothing to plan from. */
class Unread extends Error {}
/**
 * Reads a list from the account. Signed in without the permission a read
 * needs, the answer is an error, not data: that is never an empty list.
 */
const read = async (tool: Tool, key: string) => {
  const value = await tool.execute();
  const error = refusal(value);
  if (error) throw new Unread(error);
  return list(value, key);
};
/** Says why nothing was sent, from an error code that is safe to show. */
const unsent = (error: string) =>
  error === "insufficient_scope"
    ? "your access to this Company doesn't include the permission it needs"
    : error === "sign_in_required"
      ? "you're not signed in"
      : `the answer was an error${/^[a-z_]{1,40}$/.test(error) ? ` (${error})` : ""}`;
const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 2);
/**
 * The message as words in order. "18:30", "2.50" and "1,000" stay whole, so
 * a time or an amount is never read as a count.
 */
const tokens = (message: string) =>
  message.toLowerCase().match(/[a-z0-9]+(?:[:.,]\d+)*|×/g) ?? [];
const NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const numeral = (token?: string) =>
  token === undefined
    ? undefined
    : /^\d+$/.test(token)
      ? Number(token)
      : NUMBERS.includes(token)
        ? NUMBERS.indexOf(token)
        : undefined;
/** Words that may stand between a count and what it counts: "2 more of the…". */
const BETWEEN = new Set([
  "x",
  "×",
  "of",
  "the",
  "more",
  "extra",
  "additional",
  "checked",
  "portion",
  "portions",
  "serving",
  "servings",
]);
/**
 * How many the User asked for of the thing named at `start`…`end` in `said`:
 * the number written right before it ("2 pork gyoza", "two more bags",
 * "3 x edamame") or right after it ("edamame x2"). Undefined when they wrote
 * none there: a number elsewhere in the message counts something else.
 */
function howMany(said: string[], start: number, end: number) {
  let before = start - 1;
  while (before >= 0 && BETWEEN.has(said[before]!)) before--;
  const written = numeral(said[before]);
  if (written !== undefined) return written;
  const after = said[end + 1];
  const times = after?.match(/^x(\d+)$/)?.[1];
  if (times) return Number(times);
  return after === "x" || after === "×" ? numeral(said[end + 2]) : undefined;
}
/**
 * The flight a message names, judged against the flights that are `booked`
 * and never by its shape alone: "on 18", "to 118" and "my 13:10" look like
 * a flight number and are not one. A booked flight is named by its number as
 * people write it ("NA 118", "na118") or by its digits ("118", when only one
 * booked flight has them). `unknown` is a flight of a booked airline that
 * isn't booked ("NA 999"): named, but not the User's.
 */
function flightNamed(message: string, booked: string[]) {
  const lowered = message.toLowerCase();
  // Not the tail of a word or number, nor the hour of a time or a decimal.
  const ends = String.raw`(?![a-z0-9]|[:.,]\d)`;
  const parts = booked.flatMap((number) => {
    const match = number.toLowerCase().match(/^([a-z0-9]{2,3}?)\s?(\d{1,4})$/);
    return match ? [{ number, code: match[1]!, digits: match[2]! }] : [];
  });
  const whole = parts.find(({ code, digits }) =>
    new RegExp(String.raw`(?<![a-z0-9])${code}\s?${digits}${ends}`).test(
      lowered,
    ),
  );
  if (whole) return { booked: whole.number };
  const bare = parts.filter(
    ({ digits }) =>
      digits.length > 2 &&
      new RegExp(String.raw`(?<![a-z0-9:.,$])${digits}${ends}`).test(lowered),
  );
  if (new Set(bare.map(({ number }) => number)).size === 1)
    return { booked: bare[0]!.number };
  for (const code of new Set(parts.map((part) => part.code))) {
    const other = lowered.match(
      new RegExp(String.raw`(?<![a-z0-9])${code}\s?(\d{1,4})${ends}`),
    );
    if (other) return { unknown: `${code.toUpperCase()} ${other[1]}` };
  }
  return {};
}

/**
 * Names the User mentioned among `items`: a word only that item has, or
 * every word of its name ("vegetable gyoza" beside "pork gyoza"). Each comes
 * with the words of its name (`own`) and those no other item shares (`unique`).
 */
function mentioned<T extends Record<string, unknown>>(
  message: string,
  items: T[],
  nameOf: (item: T) => string,
) {
  const said = new Set(words(message));
  const names = items.map((item) => words(nameOf(item)));
  return items
    .map((item, index) => {
      const own = names[index]!;
      const unique = own.filter(
        (word) =>
          !names.some((other, i) => i !== index && other.includes(word)),
      );
      return { item, own, unique };
    })
    .filter(
      ({ own, unique }) =>
        own.length > 0 &&
        (unique.some((word) => said.has(word)) ||
          own.every((word) => said.has(word))),
    );
}
/**
 * Where in `said` an item is named: the first run of its own words that has
 * one only it has, or all of them. "Gyoza" in "pork gyoza" is not where
 * "vegetable gyoza" is named.
 */
function namedAt(
  said: string[],
  { own, unique }: { own: string[]; unique: string[] },
) {
  for (let start = 0; start < said.length; start++) {
    if (!own.includes(said[start]!)) continue;
    let end = start;
    while (end + 1 < said.length && own.includes(said[end + 1]!)) end++;
    const run = said.slice(start, end + 1);
    if (
      unique.some((word) => run.includes(word)) ||
      own.every((word) => run.includes(word))
    )
      return { start, end };
    start = end;
  }
  return undefined;
}

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
/** The weekdays a message names, in the order it names them. */
const daysIn = (message: string) =>
  DAYS.map((name) => ({ name, at: message.indexOf(name) }))
    .filter((day) => day.at >= 0)
    .sort((a, b) => a.at - b.at);
/**
 * The day an order should move to. "From Friday to Sunday" names two days:
 * the one after "from" and the one the order is on now are where it is, not
 * where it goes. Of the rest, the destination follows the last " to ";
 * without one, it is the last day named.
 */
function destinationDay(
  message: string,
  days: ReturnType<typeof daysIn>,
  current: string,
) {
  const origin = message.match(
    /\bfrom\s+(?:(?:this|next|the)\s+)?([a-z]+day)\b/,
  )?.[1];
  let left = days.filter((day) => day.name !== origin);
  // Naming only the day it is on already is answered as such, not ignored.
  if (left.length > 1)
    left = left.filter((day) => !current.startsWith(day.name));
  const toAt = message.lastIndexOf(" to ");
  return (left.find((day) => toAt >= 0 && day.at > toAt) ?? left.at(-1))?.name;
}

const REMOVE = new Set(["remove", "without", "drop", "cancel"]);
const ADD = new Set(["add", "include", "plus"]);
/**
 * Whether the dish named at `start`…`end` in `said` is to be removed. Each
 * dish follows the nearest verb before it, so "remove the edamame and add a
 * matcha ice cream" does one of each; "swap X for Y" removes X and adds Y.
 * A dish named before any verb ("the edamame, remove it") follows the first
 * verb after it. Named with no verb at all, it is added.
 */
function removes(said: string[], start: number, end: number) {
  const takeOff = said.includes("take") && said.includes("off");
  const swapAt = said.indexOf("swap");
  const asks = (index: number) => {
    const word = said[index]!;
    if (REMOVE.has(word) || word === "swap" || (word === "take" && takeOff))
      return true;
    if (
      ADD.has(word) ||
      ((word === "for" || word === "with") && swapAt >= 0 && swapAt < index)
    )
      return false;
    return undefined;
  };
  for (let index = start - 1; index >= 0; index--) {
    const asked = asks(index);
    if (asked !== undefined) return asked;
  }
  for (let index = end + 1; index < said.length; index++) {
    const asked = asks(index);
    if (asked !== undefined) return asked;
  }
  return false;
}

/** Scheduled orders: add or remove dishes, move the delivery slot. */
async function orderChange(
  message: string,
  tools: DemoTools,
): Promise<DemoPlan> {
  const lowered = message.toLowerCase();
  const dishes = await read(tools.menu!, "dishes");
  const named = mentioned(lowered, dishes, (dish) => text(dish.name));
  const days = daysIn(lowered);
  const unclear = {
    say: "Which dish should be added or removed, or which day should the order move to? For example: “Add a matcha ice cream and move it to Sunday lunchtime.”",
  };
  if (!named.length && !days.length) return unclear;
  const order = (await read(tools.my_orders!, "orders")).find(
    (item) => item.status === "scheduled",
  );
  if (!order) return { say: "There is no scheduled order to change." };
  let slot: Record<string, unknown> | undefined;
  if (days.length) {
    const slots = await read(tools.delivery_slots!, "slots");
    const now = (order.slot ?? {}) as Record<string, unknown>;
    const nowLabel =
      text(now.label) || text(slots.find((item) => item.id === now.id)?.label);
    const day = destinationDay(lowered, days, nowLabel.toLowerCase());
    const sameDay = day
      ? slots.filter((item) => text(item.label).toLowerCase().startsWith(day))
      : [];
    // Slots come in time order: lunch is the first of the day, dinner the last.
    slot = /dinner|evening|night|tonight/.test(lowered)
      ? sameDay.at(-1)
      : sameDay[0];
    if (day && !slot)
      return {
        say: `There is no delivery slot on ${day[0]!.toUpperCase()}${day.slice(1)}. Ask “Which delivery slots are there?” to see them.`,
      };
    // Moving it to where it already is changes nothing: the Company would refuse.
    if (slot && slot.id === now.id) {
      if (!named.length)
        return {
          say: `Your order is already scheduled for ${text(slot.label)}. Name another day to move it.`,
        };
      slot = undefined;
    }
  }
  if (!named.length && !slot) return unclear;
  // How many of each dish: the number beside its name, never one elsewhere
  // in the message or the portion size in the name itself ("Pork gyoza (6)").
  const said = tokens(lowered);
  const picked = named.map((dish) => {
    const at = namedAt(said, dish);
    const sizes: string[] = text(dish.item.name).match(/\d+/g) ?? [];
    let end = at?.end ?? 0;
    while (at && sizes.includes(said[end + 1]!)) end++;
    return {
      dish_id: text(dish.item.id),
      name: text(dish.item.name),
      quantity: (at && howMany(said, at.start, end)) ?? 1,
      remove: at ? removes(said, at.start, end) : removes(said, 0, -1),
    };
  });
  const add = picked.filter((dish) => !dish.remove);
  const remove = picked.filter((dish) => dish.remove);
  const tooMany = add.find(({ quantity }) => quantity < 1 || quantity > 5);
  if (tooMany)
    return {
      say: `The demo adds 1 to 5 of a dish at a time; you asked for ${tooMany.quantity} × ${tooMany.name}.`,
    };
  // A dish comes off only an order that has it: the Company refuses any
  // other. An order that doesn't list its dishes can't say, so it is asked.
  const has = list(order, "items").filter((item) => text(item.dish_id));
  const absent = has.length
    ? remove.filter(
        ({ dish_id }) => !has.some((item) => item.dish_id === dish_id),
      )
    : [];
  if (absent.length)
    return {
      say: `${absent.map(({ name }) => name).join(" and ")} ${absent.length === 1 ? "isn't" : "aren't"} in your order. Your order has ${has.map((item) => `${typeof item.quantity === "number" ? `${item.quantity} × ` : ""}${text(item.name) || text(item.dish_id)}`).join(" and ")}.`,
    };
  return {
    call: "change_order",
    args: {
      order_id: order.id,
      ...(slot ? { slot_id: slot.id } : {}),
      ...(add.length
        ? { add: add.map(({ dish_id, quantity }) => ({ dish_id, quantity })) }
        : {}),
      ...(remove.length
        ? { remove: remove.map(({ dish_id }) => dish_id) }
        : {}),
    },
    because: `The demo read your scheduled order ${text(order.id)}, the menu and the delivery slots, and asked for: ${[
      remove.length
        ? `remove ${remove.map(({ name }) => name).join(", ")}`
        : "",
      add.length
        ? `add ${add.map(({ name, quantity }) => `${quantity} × ${name}`).join(", ")}`
        : "",
      slot ? `move to ${text(slot.label)}` : "",
    ]
      .filter(Boolean)
      .join("; ")}.`,
  };
}

/**
 * An amount the User wrote, in cents: "$500", "$1,000", "125.50 dollars".
 * Thousands may be grouped with commas. A number that goes on after the
 * match ("$1,00", "$1.234") is not read as a shorter one: the demo asks.
 */
const cents = (message: string) => {
  const number = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,9})(\.\d{1,2})?(?![.,]?\d)`;
  const match = message.match(
    new RegExp(
      String.raw`\$\s?${number}|(?<![\d.,])${number}\s?(?:usd|dollars?)\b`,
      "i",
    ),
  );
  const amount = Number(
    `${match?.[1] ?? match?.[3]}${match?.[2] ?? match?.[4] ?? ""}`.replaceAll(
      ",",
      "",
    ),
  );
  return Number.isFinite(amount) && amount > 0
    ? Math.round(amount * 100)
    : undefined;
};
const usd = (amount: number) => `$${(amount / 100).toFixed(2)}`;
/**
 * A limit the Company's description of a tool puts on one argument, such as
 * the most a bank takes in one request. Undefined when it states none.
 */
const limit = (
  tool: Tool | undefined,
  argument: string,
  name: "maximum" | "maxLength",
) => {
  const properties = tool?.schema?.properties as
    Record<string, Record<string, unknown> | undefined> | undefined;
  const value = properties?.[argument]?.[name];
  return typeof value === "number" ? value : undefined;
};
/** Says an amount is over what the tool takes, if it is. */
const overLimit = (tool: Tool | undefined, amount: number) => {
  const most = limit(tool, "amount_cents", "maximum");
  return most !== undefined && amount > most
    ? {
        say: `${usd(amount)} is more than this bank takes in one request: ${usd(most)} at most. Nothing was sent; ask for a smaller amount.`,
      }
    : undefined;
};

/** What a payment is for, in the User's words: "… for November design work". */
const MEMO = /\bfor\s+(.{1,100})$/i;
/** Words in an account's name that any message may use for something else. */
const GENERIC = new Set([
  "account",
  "accounts",
  "and",
  "day",
  "for",
  "from",
  "the",
]);

/** Bank accounts: a transfer between two of them, or a payment to a saved recipient. */
async function moneyChange(
  message: string,
  tools: DemoTools,
  key: () => string,
): Promise<DemoPlan> {
  const lowered = message.toLowerCase();
  const amount = cents(message);
  if (!amount)
    return {
      say: "How much? Write the amount with a dollar sign, for example: “Transfer $500 from checking to savings.”",
    };
  const accounts = (await read(tools.accounts!, "accounts")).filter(
    (account) => account.status === "active",
  );
  // Where `said` mentions each account, by its type ("checking") or a word
  // of its name, as a whole word: "day" in "Rainy day savings" is not in
  // "Friday" or "today", and is no account's name on its own.
  const position = (account: Record<string, unknown>, said: string) => {
    const at = words(`${text(account.type)} ${text(account.name)}`)
      .filter((word) => !GENERIC.has(word))
      .map((word) => said.search(new RegExp(String.raw`\b${word}\b`)))
      .filter((index) => index >= 0);
    return at.length ? Math.min(...at) : -1;
  };
  const namedIn = (said: string) =>
    accounts
      .map((account) => ({ account, at: position(account, said) }))
      .filter((entry) => entry.at >= 0)
      .sort((a, b) => a.at - b.at);

  const paying = /\b(pay|send)\b/.test(lowered) && !!tools.request_payment;
  if (paying && tools.recipients) {
    // Only a recipient the bank would pay: an inactive one is not offered,
    // and a word of its name ("old") is not taken for it.
    const recipients = (await read(tools.recipients, "recipients")).filter(
      (item) => item.status === "active",
    );
    const to = mentioned(lowered, recipients, (item) => text(item.name))[0]
      ?.item;
    if (!to)
      return {
        say: `Who should be paid? Your active saved recipients are ${recipients.map((item) => text(item.name)).join(" and ") || "none"}.`,
      };
    // What the payment is for is its memo: an account's word there ("for a
    // rainy day") is not where the money comes from, unless the memo goes
    // on to say so ("for design work from savings", "for rent using my
    // savings").
    const purpose = lowered.match(MEMO)?.[1] ?? "";
    const paidAt = purpose.search(/\b(?:from|out of|using|with my)\s/);
    const about = paidAt < 0 ? purpose : purpose.slice(0, paidAt);
    const named = namedIn(
      lowered.replace(MEMO, () => purpose.slice(about.length)),
    )[0]?.account;
    const from =
      named ??
      accounts.find((account) => account.type === "checking") ??
      accounts[0];
    if (!from) return { say: "There is no active account to pay from." };
    // The rest of the memo may still name another account outright, by its
    // type or its whole name ("for rent, savings account"), where a word of
    // the name alone ("rainy") would not. It may be what pays or only what
    // the payment is about, so the demo asks.
    const outright = (account: Record<string, unknown>) =>
      [text(account.type), text(account.name)].some((name) => {
        const phrase = words(name).join(" ");
        return phrase && ` ${words(about).join(" ")} `.includes(` ${phrase} `);
      });
    const other = named
      ? undefined
      : accounts.find((account) => account !== from && outright(account));
    if (other)
      return {
        say: `Which account should pay, ${text(from.name)} or ${text(other.name)}? The message mentions ${text(other.name)} only in what the payment is for, and the demo doesn't guess. Nothing was sent; say it again with “from ${text(from.name)}” or “from ${text(other.name)}”.`,
      };
    const over = overLimit(tools.request_payment, amount);
    if (over) return over;
    // What the payment is for; a memo of nothing but punctuation is none.
    const memo = (
      message.match(MEMO)?.[1]?.replace(/[\s.!?]+$/, "") ||
      "Payment asked for in the demo"
    ).slice(0, limit(tools.request_payment, "memo", "maxLength") ?? 100);
    return {
      call: "request_payment",
      args: {
        source_account_id: from.id,
        recipient_id: to.id,
        amount_cents: amount,
        memo,
        idempotency_key: key(),
      },
      because: `The demo read your accounts and saved recipients, and asked to pay ${text(to.name)} ${usd(amount)} from ${text(from.name)}.`,
    };
  }

  if (!tools.transfer_between_accounts)
    return { say: "This bank doesn't offer transfers to agents." };
  const over = overLimit(tools.transfer_between_accounts, amount);
  if (over) return over;
  // "from X to Y" when the words are there (the last "to": "I want to…"
  // comes earlier); otherwise the order the accounts were named in.
  const named = namedIn(lowered);
  const toAt = lowered.lastIndexOf(" to "),
    fromAt = lowered.indexOf(" from ");
  const destination =
    toAt >= 0 ? named.find((entry) => entry.at > toAt)?.account : undefined;
  const from =
    (fromAt >= 0
      ? named.find(
          (entry) => entry.at > fromAt && entry.account !== destination,
        )?.account
      : undefined) ??
    named.find((entry) => entry.account !== destination)?.account;
  const to =
    destination ?? named.find((entry) => entry.account !== from)?.account;
  if (!from || !to || from === to)
    return {
      say: `Name both accounts. Yours are ${accounts.map((account) => `${text(account.name)} (${text(account.type)})`).join(" and ")}. For example: “Transfer $500 from checking to savings.”`,
    };
  return {
    call: "transfer_between_accounts",
    args: {
      source_account_id: from.id,
      destination_account_id: to.id,
      amount_cents: amount,
      idempotency_key: key(),
    },
    because: `The demo read your accounts and asked to transfer ${usd(amount)} from ${text(from.name)} to ${text(to.name)}.`,
  };
}

const BAGS = /^(bag|bags|baggage|luggage|suitcase)$/;
/** Flight bookings: accept an upgrade offer, or add checked bags. */
async function tripChange(
  message: string,
  tools: DemoTools,
): Promise<DemoPlan> {
  const lowered = message.toLowerCase();
  const trips = await read(tools.upcoming_trips!, "trips");
  if (!trips.length) return { say: "There is no upcoming trip to change." };
  const segments = (trip: Record<string, unknown>) => list(trip, "itinerary");
  const booked = trips
    .flatMap((trip) => segments(trip).map((item) => text(item.flight_number)))
    .filter(Boolean);
  const yours = `Your flights are ${booked.join(" and ") || "none"}.`;
  const flight = flightNamed(message, booked);
  if (flight.unknown)
    return { say: `${flight.unknown} isn't in your bookings. ${yours}` };
  const wanted = flight.booked;
  const onFlight = (segment: Record<string, unknown>) =>
    !wanted || text(segment.flight_number) === wanted;

  if (/upgrad/.test(lowered) && tools.accept_upgrade) {
    for (const trip of trips) {
      const offer = trip.upgrade_offer as Record<string, unknown> | null;
      if (!offer) continue;
      const segment = segments(trip).find(
        (item) => item.id === offer.flight_id,
      );
      if (!segment || !onFlight(segment)) continue;
      return {
        call: "accept_upgrade",
        args: { booking_reference: trip.booking_reference, offer_id: offer.id },
        because: `The demo read your trips and found an upgrade offer on ${text(segment.flight_number)} in booking ${text(trip.booking_reference)}, and asked to accept it.`,
      };
    }
    return {
      say: `There is no upgrade offer${wanted ? ` on ${wanted}` : ""} in your bookings.`,
    };
  }
  if (
    /\b(bag|bags|baggage|luggage|suitcase)\b/.test(lowered) &&
    tools.add_baggage
  ) {
    // How many bags: the number beside the word, not one elsewhere ("on 18 May").
    const said = tokens(lowered);
    const bagAt = said.findIndex((word) => BAGS.test(word));
    const pieces = howMany(said, bagAt, bagAt) ?? 1;
    if (pieces < 1 || pieces > 2)
      return {
        say: `The demo adds 1 or 2 checked bags at a time; you asked for ${pieces}.`,
      };
    // A bag goes on one flight: with several and none named, the demo asks.
    if (!wanted && booked.length > 1)
      return {
        say: `Which flight should the ${pieces === 1 ? "bag" : "bags"} go on? ${yours} For example: “Add a bag to ${booked[0]}.”`,
      };
    for (const trip of trips) {
      const segment = segments(trip).find(onFlight);
      if (!segment) continue;
      return {
        call: "add_baggage",
        args: {
          booking_reference: trip.booking_reference,
          flight_id: segment.id,
          additional_pieces: pieces,
        },
        because: `The demo read your trips and asked to add ${pieces} checked ${pieces === 1 ? "bag" : "bags"} to ${text(segment.flight_number)} in booking ${text(trip.booking_reference)}.`,
      };
    }
    return { say: "There is no flight in your bookings to add a bag to." };
  }
  return {
    say: "The demo can accept an upgrade offer or add a checked bag here. For example: “Upgrade my flight to Business.”",
  };
}

/**
 * The change this message asks for, if the Company's tools are of a kind the
 * demo knows and the message reads as a change. `undefined` leaves the
 * message to the demo's reading rules.
 */
export async function demoChange(
  message: string,
  tools: DemoTools,
  /** A fresh idempotency key for a payment or transfer. */
  key: () => string,
): Promise<DemoPlan | undefined> {
  try {
    switch (demoChangeKind(message, tools)) {
      case "order":
        return await orderChange(message, tools);
      case "money":
        return await moneyChange(message, tools, key);
      case "trip":
        return await tripChange(message, tools);
      default:
        return undefined;
    }
  } catch (error) {
    if (!(error instanceof Unread)) throw error;
    return {
      say: `The demo couldn't read your account to prepare this change: ${unsent(error.message)}. Nothing was sent to the Company. Sign in again and keep every permission ticked on the Company's consent page.`,
    };
  }
}

/** The parts of the demo's answer about a change that the page reads again. */
const ANSWERED = "The company answered:\n\n",
  HOLDS = "The Company holds a change until you click Approve. ",
  MODEL = "For natural-language reasoning, select a model.";

/**
 * What the demo says after asking the Company for the change in `plan`;
 * `show` puts the Company's answer into lines. Signed in to read only, the
 * request is never sent: the answer is an error, there is nothing of the
 * Company's to show, and saying it holds a change for approval would be false.
 * It would be false too for a change whose approval was already sent with an
 * unknown outcome (Operations v3 §7): its card has no Approve to click.
 */
export function demoChangeReply(
  plan: Extract<DemoPlan, { call: string }>,
  result: unknown,
  show: (answer: unknown) => string,
  /** The conversation's operations at this Company, as the runtime keeps them. */
  earlier: readonly Earlier[] = [],
) {
  const error = refusal(result);
  if (error)
    return `The demo read your account and prepared this change, but nothing was sent to the Company: ${unsent(error)}.${error === "insufficient_scope" ? " Press “Request change permission”, review the Company's consent, and ask again." : ""}`;
  const held =
    (result as { status?: unknown } | null)?.status !== "outcome_unknown";
  const again = held ? madeBefore(plan, earlier) : undefined;
  return `${again ? `${again}\n\n` : ""}${plan.because}\n\n${ANSWERED}${show(result)}\n\n${held ? HOLDS : ""}${MODEL}`;
}

type Earlier = { state: string; terms?: Record<string, unknown> };
/**
 * Says so when the User already approved this same transfer or payment in
 * the conversation and the Company made it: the same words again ask for
 * it a second time, under a new idempotency key. The demo still asks, as
 * the User may mean it; the line keeps the new card from passing for the
 * one approved before.
 */
function madeBefore(
  plan: Extract<DemoPlan, { call: string }>,
  earlier: readonly Earlier[],
) {
  const what =
    plan.call === "transfer_between_accounts"
      ? "transfer"
      : plan.call === "request_payment"
        ? "payment"
        : undefined;
  if (!what) return undefined;
  const same = [
    "source_account_id",
    "destination_account_id",
    "recipient_id",
    "amount_cents",
  ].filter((key) => key in plan.args);
  return earlier.some(
    (op) =>
      op.state === "succeeded" &&
      same.every((key) => op.terms?.[key] === plan.args[key]),
  )
    ? `You approved this same ${what} earlier in this conversation, and it was made. This asks for a second one.`
    : undefined;
}

/**
 * The demo's answer about a change, as it reads once Iris approved that
 * change on the User's standing instruction. The answer is written while
 * the Company holds the change, before the page checks the instruction, so
 * it says the change waits for a click. Once Iris approved it nothing is
 * held, and the demo's two sentences about that say what happened instead.
 *
 * `data` is the Company's exact answer, which names the operation, and
 * `approvedByIris` says whether the instruction approved that one. The
 * answer stays as written while the change waits for the User and after
 * they approved it themselves, and so does an answer about anything else.
 * A Company's own words are never changed: only the demo's sentences, where
 * the demo puts them.
 */
export function demoChangeReplyNow(
  text: string,
  data: string | undefined,
  approvedByIris: (operationId: string) => boolean,
) {
  let answer: { status?: unknown; operation_id?: unknown } | null;
  try {
    answer = JSON.parse(data ?? "");
  } catch {
    return text;
  }
  if (
    answer?.status !== "approval_required" ||
    typeof answer.operation_id !== "string" ||
    !approvedByIris(answer.operation_id)
  )
    return text;
  const said = text.replace(
    `${ANSWERED}${HOLDING}`,
    () => `${ANSWERED}The company held this change until it was approved:`,
  );
  return said.endsWith(HOLDS + MODEL)
    ? `${said.slice(0, -(HOLDS + MODEL).length)}Iris approved this change on your standing instruction, so there is nothing for you to approve. ${MODEL}`
    : said;
}

/**
 * A question about a change is not a request for one: "Is there an upgrade
 * available on my trip?" is answered by reading, and must never file an
 * upgrade. A message that opens with a question word is a question; so is
 * one that ends in "?", unless it asks the demo to act ("Can you…?",
 * "Could I…?", "Please…?").
 */
const asking = (message: string) => {
  const said = message.trim();
  return (
    /^(is|are|was|were|do|does|did|what|which|how|when|where|why|who|any|have|has)\b/.test(
      said,
    ) ||
    (said.endsWith("?") && !/^(please|can|could|would|will|may|i)\b/.test(said))
  );
};

/**
 * Whether the message asks for a change the demo knows how to prepare here,
 * decided from the words and the tools alone: nothing is read yet, so the
 * caller can ask for sign-in first.
 */
export function demoChangeKind(message: string, tools: DemoTools) {
  const lowered = message.toLowerCase();
  if (asking(lowered)) return undefined;
  if (
    tools.change_order &&
    tools.my_orders &&
    tools.menu &&
    tools.delivery_slots &&
    /\b(add|remove|without|drop|move|change|reschedule|swap)\b/.test(lowered)
  )
    return "order" as const;
  if (
    tools.accounts &&
    (tools.transfer_between_accounts || tools.request_payment) &&
    /\b(transfer|move|pay|send)\b/.test(lowered)
  )
    return "money" as const;
  if (
    tools.upcoming_trips &&
    (tools.accept_upgrade || tools.add_baggage) &&
    /upgrad|\b(add|extra|another|more)\b.*\b(bag|bags|baggage|luggage|suitcase)\b/.test(
      lowered,
    )
  )
    return "trip" as const;
  return undefined;
}

/**
 * What the demo says to a change of a booking it has no rule for, such as
 * "Cancel my booking" or "Change my NA 402 flight to a later one": that it
 * can't ask for it, what it can ask for there, and that a model can do more.
 * Without this the trips were shown, as if that answered the request.
 */
export function demoUnsupported(message: string, tools: DemoTools) {
  const lowered = message.toLowerCase();
  if (
    asking(lowered) ||
    demoChangeKind(message, tools) ||
    !tools.upcoming_trips ||
    !/\b(cancel|change|rebook|reschedule|move|switch)\b/.test(lowered)
  )
    return undefined;
  const can = [
    tools.accept_upgrade ? "accept an upgrade offer" : "",
    tools.add_baggage ? "add a checked bag" : "",
  ].filter(Boolean);
  if (!can.length) return undefined;
  return `The demo can't ask for that change. Here it can only ${can.join(" or ")}${tools.accept_upgrade ? ", such as “Upgrade my flight to Business.”" : "."} Select a model to ask for anything else.`;
}

/**
 * Whether the message is for the Company's agent or is feedback: the demo's
 * two other ways in, each by its own words. In a payment with an amount,
 * what it is for is the memo, in the User's words to the recipient: "for
 * the quarterly report" or "for design support" asks for neither.
 */
export function demoAside(message: string, tools: DemoTools) {
  const lowered = message.toLowerCase();
  const said =
    demoChangeKind(message, tools) === "money" && cents(message)
      ? lowered.replace(MEMO, "")
      : lowered;
  if (
    tools.company_agent_send &&
    /customer service|support|company'?s agent|talk to|speak to|a person|human|someone/.test(
      said,
    )
  )
    return "agent" as const;
  if (
    tools.report_unsupported_task &&
    /gift ?card|voucher|report|feedback|can'?t do/.test(said)
  )
    return "feedback" as const;
  return undefined;
}

/**
 * Whether the message says a dish was missing from a delivered order: "The
 * pork gyoza was missing from my last delivery". It goes to the Company's
 * agent, which can refund it; "delivery" alone would read the slots.
 */
export const demoMissing = (message: string, tools: DemoTools) => {
  const lowered = message.toLowerCase();
  return (
    !!tools.company_agent_send &&
    /\bmissing\b|\b(?:wasn'?t|weren'?t) in\b|\bleft out\b/.test(lowered) &&
    /\b(deliver\w*|order)\b/.test(lowered)
  );
};

/**
 * Reports a missing dish to the Company's agent (`report_missing_item`),
 * which may propose a refund for the User to approve. The order and the
 * dish come from the last delivery the agent lists (`order_status`), never
 * from the message alone; `show` says what the agent answered, in a
 * sentence or more (see `agentAnswer`).
 */
export async function demoMissingReport(
  message: string,
  send: Tool,
  show: (answer: unknown) => string,
) {
  const status = await send.execute({ data: { request: "order_status" } });
  const delivery = list(status, "replies")
    .map(
      (reply) =>
        (reply.data as Record<string, unknown> | undefined)?.last_delivery,
    )
    .find(
      (value): value is Record<string, unknown> =>
        !!value &&
        typeof value === "object" &&
        !!text((value as Record<string, unknown>).id),
    );
  if (!delivery) {
    // Signed out, the agent's answer asks for sign-in, which says it all.
    const signIn = !!(status as Record<string, unknown> | null)?.sign_in;
    return `Asked the Company's agent for your last delivery first. ${show(status)}${signIn ? "" : "\n\nIt listed no last delivery, so the demo can't report a missing dish here. With a model, Iris can ask the Company's agent in other ways."}`;
  }
  const order = text(delivery.id);
  const items = list(delivery, "items");
  const named = mentioned(message.toLowerCase(), items, (item) =>
    text(item.name),
  );
  if (named.length !== 1)
    return `Which dish was missing? Your last delivery, order ${order}, had ${items.map((item) => text(item.name)).join(" and ") || "no dishes listed"}. Nothing was sent to the Company's agent.`;
  const dish = named[0]!.item;
  const result = await send.execute({
    data: {
      request: "report_missing_item",
      order_id: order,
      dish_id: text(dish.dish_id),
    },
  });
  return `Told the Company's agent that ${text(dish.name)} was missing from order ${order}. ${show(result)}\n\nIf it proposes a refund, approve or decline it in Needs you, above the message box.`;
}

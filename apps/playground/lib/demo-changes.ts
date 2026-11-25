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
type Tool = { execute: (input?: Record<string, unknown>) => Promise<unknown> };
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
  // Where each account is mentioned, by its type ("checking") or its name.
  const position = (account: Record<string, unknown>) => {
    const at = [text(account.type), ...words(text(account.name))]
      .filter(Boolean)
      .map((word) => lowered.indexOf(word.toLowerCase()))
      .filter((index) => index >= 0);
    return at.length ? Math.min(...at) : -1;
  };
  const named = accounts
    .map((account) => ({ account, at: position(account) }))
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
    const from =
      named[0]?.account ??
      accounts.find((account) => account.type === "checking") ??
      accounts[0];
    if (!from) return { say: "There is no active account to pay from." };
    const memo =
      message.match(/\bfor\s+(.{1,100})$/i)?.[1]?.replace(/[.!?]+$/, "") ??
      "Payment asked for in the demo";
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
  // "from X to Y" when the words are there (the last "to": "I want to…"
  // comes earlier); otherwise the order the accounts were named in.
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
    say: "The demo can accept an upgrade offer or add a checked bag here. For example: “Upgrade my NA 118 flight to Business.”",
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

/**
 * What the demo says after asking the Company for the change in `plan`;
 * `show` puts the Company's answer into lines. Signed in to read only, the
 * request is never sent: the answer is an error, there is nothing of the
 * Company's to show, and saying it holds a change for approval would be false.
 */
export function demoChangeReply(
  plan: Extract<DemoPlan, { call: string }>,
  result: unknown,
  show: (answer: unknown) => string,
) {
  const error = refusal(result);
  if (error)
    return `The demo read your account and prepared this change, but nothing was sent to the Company: ${unsent(error)}.${error === "insufficient_scope" ? " Press “Request change permission”, review the Company's consent, and ask again." : ""}`;
  return `${plan.because}\n\nThe company answered:\n\n${show(result)}\n\nThe Company holds a change until you click Approve. For natural-language reasoning, select a model.`;
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

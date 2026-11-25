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
const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 2);
/** A number the User wrote, within bounds, or the default. */
const count = (message: string, max: number, fallback = 1) => {
  const found = Number(message.match(/\b([1-9])\b/)?.[1] ?? fallback);
  return Math.min(Math.max(found, 1), max);
};
/** A flight number as people write it: "NA 118", "na118". */
const flightNumber = (message: string) => {
  const match = message.match(/\b([a-z]{2})\s?(\d{2,4})\b/i);
  return match ? `${match[1]!.toUpperCase()} ${match[2]}` : undefined;
};

/**
 * Names the User mentioned among `items`: a word only that item has, or
 * every word of its name ("vegetable gyoza" beside "pork gyoza").
 */
function mentioned<T extends Record<string, unknown>>(
  message: string,
  items: T[],
  nameOf: (item: T) => string,
) {
  const said = new Set(words(message));
  const names = items.map((item) => words(nameOf(item)));
  return items.filter((_, index) => {
    const own = names[index]!;
    if (!own.length) return false;
    const unique = own.filter(
      (word) => !names.some((other, i) => i !== index && other.includes(word)),
    );
    return (
      unique.some((word) => said.has(word)) ||
      own.every((word) => said.has(word))
    );
  });
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

/** Scheduled orders: add or remove dishes, move the delivery slot. */
async function orderChange(
  message: string,
  tools: DemoTools,
): Promise<DemoPlan> {
  const lowered = message.toLowerCase();
  const dishes = list(await tools.menu!.execute(), "dishes");
  const named = mentioned(lowered, dishes, (dish) => text(dish.name));
  const removing = /\b(remove|without|drop|take off|cancel)\b/.test(lowered);
  const day = DAYS.find((name) => lowered.includes(name));
  let slot: Record<string, unknown> | undefined;
  if (day) {
    const sameDay = list(await tools.delivery_slots!.execute(), "slots").filter(
      (item) => text(item.label).toLowerCase().startsWith(day),
    );
    // Slots come in time order: lunch is the first of the day, dinner the last.
    slot = /dinner|evening|night|tonight/.test(lowered)
      ? sameDay.at(-1)
      : sameDay[0];
    if (!slot)
      return {
        say: `There is no delivery slot on ${day[0]!.toUpperCase()}${day.slice(1)}. Ask “Which delivery slots are there?” to see them.`,
      };
  }
  if (!named.length && !slot)
    return {
      say: "Which dish should be added or removed, or which day should the order move to? For example: “Add a matcha ice cream and move it to Sunday lunchtime.”",
    };
  const order = list(await tools.my_orders!.execute(), "orders").find(
    (item) => item.status === "scheduled",
  );
  if (!order) return { say: "There is no scheduled order to change." };
  const ids = named.map((dish) => text(dish.id));
  const quantity = count(lowered, 5);
  return {
    call: "change_order",
    args: {
      order_id: order.id,
      ...(slot ? { slot_id: slot.id } : {}),
      ...(ids.length && !removing
        ? { add: ids.map((dish_id) => ({ dish_id, quantity })) }
        : {}),
      ...(ids.length && removing ? { remove: ids } : {}),
    },
    because: `The demo read your scheduled order ${text(order.id)}, the menu and the delivery slots, and asked for: ${[
      ids.length
        ? `${removing ? "remove" : `add ${quantity} ×`} ${named.map((dish) => text(dish.name)).join(", ")}`
        : "",
      slot ? `move to ${text(slot.label)}` : "",
    ]
      .filter(Boolean)
      .join("; ")}.`,
  };
}

/** An amount the User wrote, in cents: "$500", "125.50". */
const cents = (message: string) => {
  const match = message.match(
    /\$\s?(\d{1,6}(?:\.\d{1,2})?)|\b(\d{1,6}(?:\.\d{1,2})?)\s?(?:usd|dollars?)\b/i,
  );
  const amount = Number(match?.[1] ?? match?.[2]);
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
  const accounts = list(await tools.accounts!.execute(), "accounts").filter(
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
    const recipients = list(await tools.recipients.execute(), "recipients");
    const to = mentioned(lowered, recipients, (item) => text(item.name))[0];
    if (!to)
      return {
        say: `Who should be paid? Your saved recipients are ${recipients.map((item) => text(item.name)).join(" and ") || "none"}.`,
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

/** Flight bookings: accept an upgrade offer, or add checked bags. */
async function tripChange(
  message: string,
  tools: DemoTools,
): Promise<DemoPlan> {
  const lowered = message.toLowerCase();
  const trips = list(await tools.upcoming_trips!.execute(), "trips");
  if (!trips.length) return { say: "There is no upcoming trip to change." };
  const wanted = flightNumber(message);
  const segments = (trip: Record<string, unknown>) => list(trip, "itinerary");
  const onFlight = (segment: Record<string, unknown>) =>
    !wanted || text(segment.flight_number).toUpperCase() === wanted;

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
    for (const trip of trips) {
      const segment = segments(trip).find(onFlight);
      if (!segment) continue;
      const pieces = count(lowered, 2);
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
    return { say: `${wanted ?? "That flight"} isn't in your bookings.` };
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
  switch (demoChangeKind(message, tools)) {
    case "order":
      return orderChange(message, tools);
    case "money":
      return moneyChange(message, tools, key);
    case "trip":
      return tripChange(message, tools);
    default:
      return undefined;
  }
}

/**
 * Whether the message asks for a change the demo knows how to prepare here,
 * decided from the words and the tools alone: nothing is read yet, so the
 * caller can ask for sign-in first.
 */
export function demoChangeKind(message: string, tools: DemoTools) {
  const lowered = message.toLowerCase();
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

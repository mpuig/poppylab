/**
 * "connect with Lantern", typed in the chat. The User's own message can
 * connect a Company to the conversation or remove one, at any moment of
 * it. Only the User's message is ever read here: never Company content, a
 * tool's result or a model's words. The chat route reads it before any
 * model or rule of the demo sees the message.
 *
 * A Company is matched by name against the Companies it is given (the
 * lab's, and the ones the conversation is connected to), and against
 * nothing else: a name is never turned into an address.
 *
 * English only. Two kinds of wording:
 *
 * - "connect with …", "connect to …" and "disconnect from …" are only
 *   ever meant for this, so with a name that fits no Company the User is
 *   told so.
 * - "add …", "also …", "remove …" and the like are also what a person
 *   says to a Company ("add a matcha ice cream", "remove the oranges"),
 *   so they count only when what follows is a Company's name and nothing
 *   else. Otherwise the message is left as it is.
 *
 * Plain data and no I/O.
 */
import { namedBy, namedIn, type Nameable } from "./company-names";

export type ConnectCommand = {
  verb: "connect" | "remove";
} & (
  | {
      /** The Companies named, each one of those given, in order. */
      companies: Nameable[];
      /** What else the message asks for, in the User's words, or "". */
      rest: string;
    }
  /** The words fit several Companies: the User is asked which. */
  | { which: Nameable[] }
  /** The words fit none; "" when the message names nothing at all. */
  | { unknown: string }
);

/** Words before the request that change nothing about it. */
const POLITE =
  /^(?:(?:hey|hi|hello|ok|okay)[,!]?\s+)?(?:iris[,:]?\s+)?(?:please\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|i(?:'d|’d| would)\s+like\s+(?:you\s+)?to\s+|i\s+want\s+(?:you\s+)?to\s+|let(?:'|’)?s\s+)?/i;

/**
 * How a request about the Companies begins. `sure`: these words are only
 * ever meant for this.
 */
const WORDINGS: Array<{
  verb: "connect" | "remove";
  sure: boolean;
  start: RegExp;
}> = [
  {
    verb: "connect",
    sure: true,
    start: /^(?:also\s+)?connect(?:\s+(?:with|to)\b\s*|[.!?]*$)/i,
  },
  { verb: "remove", sure: true, start: /^disconnect\s+from\b\s*/i },
  {
    verb: "connect",
    sure: false,
    start:
      /^(?:also\s+)?(?:connect\s+(?:me|us)\s+(?:with|to)|connect|add|link(?:\s+(?:with|to))?|include|bring\s+in)\s+/i,
  },
  { verb: "connect", sure: false, start: /^(?:also|plus)\s+/i },
  {
    verb: "remove",
    sure: false,
    start: /^(?:disconnect|remove|drop|leave|stop\s+using)\s+/i,
  },
];

/** Where one thing asked for ends and the next begins. */
const NEXT =
  /\s*(?:[,;]\s*and\s+then\s+|[,;]\s*and\s+also\s+|[,;]\s*and\s+|[,;]\s*then\s+|\s+and\s+then\s+|\s+and\s+also\s+|\s+and\s+|\s+then\s+|[,;.!?]\s+)/i;

/** "a company", "another one": the message names nothing. */
const NOTHING =
  /^(?:(?:a|an|another|one|some|new|other|company|companies|something|more)\s*)*$/i;

/** A name as it was said, without what is only manners. */
const tidy = (words: string) =>
  words
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\s+(?:please|too|as well|now|for me)$/i, "")
    .trim();

const place = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/** One Company for each place, whichever of its names was matched. */
function distinct(found: Nameable[]): Nameable[] {
  const places = found.map((c) => place(c.url));
  return found.filter((_, i) => places.indexOf(places[i]!) === i);
}

/**
 * The Companies the words begin with ("Lantern and the bank"), then
 * whatever else is asked ("and show me the menu"). With `sure`, a name
 * inside a few first words will do ("the Lantern restaurant").
 */
function named(words: string, pool: readonly Nameable[], sure: boolean) {
  const companies: Nameable[] = [];
  let left = words;
  while (left.trim()) {
    const next = NEXT.exec(left);
    const first = next ? left.slice(0, next.index) : left;
    let fits = distinct(namedBy(tidy(first), pool));
    if (
      !fits.length &&
      !companies.length &&
      sure &&
      first.trim().split(/\s+/).length <= 4
    )
      fits = distinct(namedIn(first, pool));
    if (!fits.length) break;
    if (fits.length > 1) return { which: fits };
    const one = fits[0]!;
    if (!companies.some((c) => place(c.url) === place(one.url)))
      companies.push(one);
    left = next ? left.slice(next.index + next[0].length) : "";
  }
  // "…, please" asks for nothing else.
  const rest = /^(?:please|thanks|thank you|now)[.!]*$/i.test(left.trim())
    ? ""
    : left.trim();
  return companies.length ? { companies, rest } : undefined;
}

/**
 * What the message asks about the conversation's Companies, if it does.
 * `connected` are the conversation's Companies, each by its own name, and
 * `lab` the lab's. A name is looked for among all of them. Whether the
 * Company named can be connected, or removed, is for the caller to say.
 */
export function connectCommand(
  message: string,
  known: { connected: readonly Nameable[]; lab: readonly Nameable[] },
): ConnectCommand | undefined {
  const text = message.trim().replace(POLITE, "");
  // A connected Company of the lab's goes by its own name, and by the
  // lab's name and words for it as well.
  const labAt = (url: string) =>
    known.lab.find((c) => place(c.url) === place(url));
  const pool: Nameable[] = [
    ...known.connected.map((c) => {
      const listed = labAt(c.url);
      return listed
        ? { ...c, words: [listed.name, ...(listed.words ?? [])] }
        : c;
    }),
    ...known.lab.filter(
      (c) => !known.connected.some((own) => place(own.url) === place(c.url)),
    ),
  ];
  for (const { verb, sure, start } of WORDINGS) {
    const begins = start.exec(text);
    if (!begins) continue;
    const words = text.slice(begins[0].length);
    const found = named(words, pool, sure);
    if (found) return { verb, ...found };
    if (!sure) continue;
    const said = tidy(words.split(NEXT)[0] ?? "");
    return { verb, unknown: NOTHING.test(said) ? "" : said.slice(0, 80) };
  }
  // "Harborline too": a Company's name and nothing else.
  const too = /^(.+?)\s+(?:too|as well)[.!]?$/i.exec(text);
  const also = too ? distinct(namedBy(tidy(too[1]!), pool)) : [];
  return also.length === 1
    ? { verb: "connect", companies: also, rest: "" }
    : undefined;
}

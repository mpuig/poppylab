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
 * In English, and in Spanish, Catalan and French only their plainest
 * wordings with a Company's name ("quita Lantern de esta conversación",
 * "ajoute Harborline"): otherwise, or with a typo, the message goes on to
 * the model, which can ask for the same with a Company's name alone
 * (`namedCommand`). Two kinds of wording:
 *
 * - "connect with …", "connect to …" and "disconnect from …" are only
 *   ever meant for this (`sure`). After them a Company can be named by
 *   its name or by a plain word for the kind of company it is ("the
 *   bank"), the message can go on to ask something else, and with words
 *   that fit no Company the User is told so.
 * - "add …", "also …", "remove …", "drop …", "leave …", "… too" and the
 *   like are also what a person says to a Company about an order ("add a
 *   matcha ice cream", "remove the noodles", "leave the restaurant"). They
 *   count only when everything that follows is the name of a Company, or
 *   several names: never a plain word, and never with something else
 *   asked. Otherwise the message is left as it is. The caller asks before
 *   it removes a Company on words like these.
 *
 * Plain data and no I/O.
 */
import { agentName } from "./agent";
import { namedBy, namedIn, namedPlainly, type Nameable } from "./company-names";

export type ConnectCommand = {
  verb: "connect" | "remove";
  /**
   * The words are only ever meant for connecting or removing a Company.
   * When they are not, they counted because nothing but a Company's name
   * followed, and a person may still have meant an order.
   */
  sure: boolean;
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

/**
 * Words before the request that change nothing about it, the agent's own
 * name among them ("Iris, connect with Lantern").
 */
const polite = () => {
  const name = agentName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`^(?:(?:hey|hi|hello|ok|okay)[,!]?\s+)?(?:${name}[,:]?\s+)?` +
      String.raw`(?:please\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|i(?:'d|’d| would)\s+like\s+(?:you\s+)?to\s+|i\s+want\s+(?:you\s+)?to\s+|let(?:'|’)?s\s+)?`,
    "i",
  );
};

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
  // The plainest of the same in Spanish, Catalan and French: a name must
  // follow, and nothing else ("añade 2 gyoza" is about an order).
  {
    verb: "connect",
    sure: false,
    start:
      /^(?:con[eé]ctame\s+(?:con|a)|conecta(?:\s+(?:con|a))?|a[ñn]ade|agrega|connecta'?m\s+(?:amb|a)|connecta(?:\s+(?:amb|a))?|afegeix|connecte-moi\s+(?:[àa]|avec)|connecte(?:\s+(?:[àa]|avec))?|ajoute)\s+/i,
  },
  {
    verb: "remove",
    sure: false,
    start:
      /^(?:quita|elimina|desconecta|saca|treu|desconnecta|retire|supprime|enl[èe]ve|d[ée]connecte)\s+/i,
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
    .replace(
      /\s+(?:please|too|as well|now|for me|por favor|si us plau|s'il (?:te|vous) pla[iî]t)$/i,
      "",
    )
    // "… from this conversation", "… de esta conversación".
    .replace(
      /\s+(?:(?:from|to|in)\s+(?:this|the)\s+(?:conversation|chat)|(?:de|a|en)\s+(?:esta|la)\s+conversaci[oó]n|(?:d'|de\s+|a\s+)(?:aquesta|la)\s+conversa|(?:de|[àa])\s+(?:cette|la)\s+conversation)$/i,
      "",
    )
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
 * The Companies the words begin with ("Lantern and Harborline"), then
 * whatever else is asked ("and show me the menu").
 *
 * With `sure`, a plain word for a kind of company names one too ("the
 * bank"), and so does a name inside a few first words ("the Lantern
 * restaurant"). Without it only names count, and only when nothing else
 * is asked: anything left over means the message is no request about the
 * Companies.
 */
function named(words: string, pool: readonly Nameable[], sure: boolean) {
  const fit = (text: string) =>
    distinct((sure ? namedPlainly : namedBy)(tidy(text), pool));
  // One name can hold an "and": everything said, as one name, comes first.
  const whole = fit(words);
  if (whole.length === 1) return { companies: whole, rest: "" };
  const companies: Nameable[] = [];
  let left = words;
  while (left.trim()) {
    const next = NEXT.exec(left);
    const first = next ? left.slice(0, next.index) : left;
    let fits = fit(first);
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
  return companies.length && (sure || !rest) ? { companies, rest } : undefined;
}

/** The Companies a request can name: the conversation's, then the lab's. */
export type Known = {
  connected: readonly Nameable[];
  lab: readonly Nameable[];
};

/**
 * Every Company a name is looked for among, once each. A connected Company
 * of the lab's goes by its own name, and by the lab's name and words for
 * it as well.
 */
export function namePool(known: Known): Nameable[] {
  const labAt = (url: string) =>
    known.lab.find((c) => place(c.url) === place(url));
  return [
    ...known.connected.map((c) => {
      const listed = labAt(c.url);
      return listed
        ? {
            ...c,
            alias: listed.name,
            ...(listed.words ? { words: listed.words } : {}),
          }
        : c;
    }),
    ...known.lab.filter(
      (c) => !known.connected.some((own) => place(own.url) === place(c.url)),
    ),
  ];
}

/**
 * What the message asks about the conversation's Companies, if it does.
 * `connected` are the conversation's Companies, each by its own name, and
 * `lab` the lab's. A name is looked for among all of them. Whether the
 * Company named can be connected, or removed, is for the caller to say.
 */
export function connectCommand(
  message: string,
  known: Known,
): ConnectCommand | undefined {
  const text = message.trim().replace(polite(), "");
  const pool = namePool(known);
  for (const { verb, sure, start } of WORDINGS) {
    const begins = start.exec(text);
    if (!begins) continue;
    const words = text.slice(begins[0].length);
    const found = named(words, pool, sure);
    if (found) return { verb, sure, ...found };
    if (!sure) continue;
    const said = tidy(words.split(NEXT)[0] ?? "");
    return {
      verb,
      sure,
      unknown: NOTHING.test(said) ? "" : said.slice(0, 80),
    };
  }
  // "Harborline too": a Company's name and nothing else.
  const too = /^(.+?)\s+(?:too|as well)[.!]?$/i.exec(text);
  const also = too ? distinct(namedBy(tidy(too[1]!), pool)) : [];
  return also.length === 1
    ? { verb: "connect", sure: false, companies: also, rest: "" }
    : undefined;
}

/**
 * The same request, when a model read it from the User's message, in
 * whatever language it was written, and gives the Company's name alone
 * (`companies-tool.ts`). The name is matched as it is after "connect
 * with", against the same Companies and nothing else, and has to be all
 * that is given: a name and something more names nothing. A removal is
 * never `sure`, so Iris asks the User before it removes anything, as for
 * "remove …": the model's reading of the message is no confirmation.
 */
export function namedCommand(
  verb: "connect" | "remove",
  name: string,
  known: Known,
): ConnectCommand {
  const sure = verb === "connect";
  const found = named(name, namePool(known), true);
  if (found && "which" in found) return { verb, sure, ...found };
  if (found && !found.rest) return { verb, sure, ...found };
  const said = tidy(name);
  return { verb, sure, unknown: NOTHING.test(said) ? "" : said.slice(0, 80) };
}

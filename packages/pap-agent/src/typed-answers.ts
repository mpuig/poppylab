/**
 * What the User types in answer to a question of the agent's own: "yes",
 * "no", "approve the Lantern one", "decline the transfer". The agent's
 * code reads these, never the model: an approval is the User's word, and
 * only their own message counts, never Company content, a tool's result
 * or a model's answer. The caller binds the answer to the question that
 * was asked, and to the message that follows it, and to nothing else.
 *
 * English only, a short list of words, and nothing guessed: a message
 * that says anything more is no answer, and goes on as a message.
 *
 * Plain data and no I/O, so the page can read a typed "yes" the same way
 * (a sign-in has to open its tab in the same keystroke).
 */
import { plain } from "./company-names";

/** Longer than this, a message is a message and no answer. */
const LONGEST = 120;

/** A yes to any question. Each kind of question adds its own verbs. */
const YES = [
  "yes",
  "y",
  "yeah",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
  "alright",
  "all right",
  "fine",
  "go ahead",
  "go for it",
  "do it",
  "please do",
  "confirm",
  "confirmed",
  "correct",
  "absolutely",
  "of course",
  "definitely",
  "sounds good",
  "i do",
];

/** The verbs that say yes to each kind of question. */
export const SAYS_YES = {
  approve: ["approve", "approved", "i approve", "accept", "agree"],
  signin: ["sign in", "sign me in", "log in", "log me in", "allow"],
  signout: ["sign out", "sign me out", "log out", "log me out"],
  resume: ["go on", "carry on", "continue", "ask it", "ask again"],
  invitation: ["talk", "talk to them", "accept", "join"],
} as const;

const NO = new Set([
  "no",
  "n",
  "nope",
  "nah",
  "not now",
  "not yet",
  "later",
  "never mind",
  "nevermind",
  "cancel",
  "decline",
  "reject",
  "deny",
  "refuse",
  "stop",
  "dont",
  "do not",
  "i decline",
  "leave",
  "skip",
]);

/**
 * Words that change nothing about yes or no: manners, and the pronouns
 * and articles a person puts around them ("yes, approve it please").
 */
const AROUND =
  /\b(?:please|thanks|thank you|thankyou|it|that|this|them|one|the|a|an|then|now|just|so)\b/g;

/** The words, with manners and pronouns left out. */
const bare = (words: string) =>
  words.replace(AROUND, " ").replace(/\s+/g, " ").trim();

/**
 * Whether these words are a yes or a no, and nothing else: "yes", "yes
 * please", "ok, go ahead", "no thanks", "not now". `verbs` are the words
 * that also say yes to the question asked ("approve", "sign in"). Mixed
 * or other words are neither.
 */
export function yesOrNo(
  text: string,
  verbs: readonly string[] = [],
): "yes" | "no" | undefined {
  if (text.length > LONGEST) return undefined;
  const said = plain(text);
  if (!said) return undefined;
  const yes = new Set([...YES, ...verbs]);
  const sayings = [said, bare(said)].filter(Boolean);
  // "yes approve", "ok go ahead", "no dont": said twice, still one answer.
  const words = bare(said).split(" ");
  const twice = (set: Set<string>) =>
    [1, 2].some((cut) => {
      const head = words.slice(0, cut).join(" ");
      const tail = words.slice(cut).join(" ");
      return words.length > cut && set.has(head) && set.has(tail);
    });
  if (sayings.some((s) => yes.has(s)) || twice(yes)) return "yes";
  if (sayings.some((s) => NO.has(s)) || twice(NO)) return "no";
  // "dont do it", "no, dont approve".
  if (
    /^(?:no )?(?:dont|do not)(?: do| (?:approve|accept|send|sign in|sign out|go on))?$/.test(
      bare(said),
    )
  )
    return "no";
  return undefined;
}

/** "Try again", typed after a message that failed. */
export function tryAgain(text: string) {
  if (text.length > LONGEST) return false;
  const said = plain(text)
    .replace(/\b(?:please|ok|okay|yes|can you|could you)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:try (?:it |that )?again|retry|again|one more time|send (?:it |that )?again)$/.test(
    said,
  );
}

/** One proposal as an answer can name it. */
export type Named = {
  /** The Company's names and the plain words for its kind. */
  names: readonly string[];
  /** The amount the question named, in cents, if it named one. */
  cents?: number | undefined;
  /** What kind of change it is, in one word: "transfer", "payment", "change". */
  noun: string;
};

/** Words that name a kind of change. */
const NOUNS = new Set([
  "change",
  "transfer",
  "payment",
  "order",
  "booking",
  "upgrade",
  "delivery",
  "proposal",
]);
/** Words that say where, or what for, beside a name or an amount. */
const LINKS =
  /\b(?:at|for|from|of|to|with|in|on|by|and|both|one|ones|dollars?|usd|bucks?)\b/g;

/** The amounts in the words, in cents: "$88", "88.00", "$1,000". */
function amounts(text: string) {
  const figures = text
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .matchAll(/(?<![\d.])(\d+)(?:\.(\d{1,2}))?(?![\d])/g);
  return [...figures].map((m) =>
    Math.round(Number(`${m[1]}.${(m[2] ?? "0").padEnd(2, "0")}`) * 100),
  );
}

/** A name and the words it begins with, the longest first. */
const ways = (name: string) => {
  const words = plain(name)
    .replace(/^(?:the|a|an|my) /, "")
    .split(" ")
    .filter(Boolean);
  return words.map((_, i) => words.slice(0, words.length - i).join(" "));
};

/**
 * The answer to "Approve it?", or to "Which do you approve: A or B?",
 * read from the User's words alone. `asked` are the proposals the
 * question named, in its order. A reference by a Company's name, by the
 * amount the question gave or by the kind of change picks among them; a
 * bare yes or no picks the one there is. `which` says the question asked
 * which one, so a reference alone is the answer ("the Lantern one").
 *
 * - `{ decision, picked }`: the index of the one proposal meant.
 * - `{ unclear }`: an answer, but not which proposal: ask again.
 * - `undefined`: no answer at all; the message goes on as a message.
 */
export function readApproval(
  text: string,
  asked: readonly Named[],
  which = false,
):
  | { decision: "approve" | "decline"; picked: number }
  | { unclear: "approve" | "decline" }
  | undefined {
  if (text.length > LONGEST || !asked.length) return undefined;
  const figures = amounts(text);
  let said = ` ${plain(text).replace(/\b\d+\b/g, " ")} `.replace(/\s+/g, " ");
  // Which proposals the words point at: by a Company's name or kind…
  const byName = new Set<number>();
  const named = asked.flatMap((one, i) =>
    one.names.flatMap((name) => ways(name).map((way) => ({ way, i }))),
  );
  for (const { way, i } of named.sort((a, b) => b.way.length - a.way.length))
    if (said.includes(` ${way} `)) {
      byName.add(i);
      said = said.replaceAll(` ${way} `, " ");
    }
  // …by its amount…
  const byAmount = new Set<number>();
  for (const cents of figures)
    asked.forEach((one, i) => {
      if (one.cents === cents) byAmount.add(i);
    });
  // …or by the kind of change, when that tells one from another.
  const byNoun = new Set<number>();
  let nouns = 0;
  for (const word of said.trim().split(" ")) {
    const noun = word.replace(/s$/, "");
    if (!NOUNS.has(noun)) continue;
    nouns++;
    said = said.replace(` ${word} `, " ");
    asked.forEach((one, i) => {
      if (one.noun === noun) byNoun.add(i);
    });
  }
  const rest = bare(said.replace(LINKS, " "));
  const answer = rest ? yesOrNo(rest, SAYS_YES.approve) : undefined;
  // Words besides the references that are no yes or no: a message.
  if (rest && !answer) return undefined;
  const referred = byName.size > 0 || figures.length > 0 || nouns > 0;
  // A reference alone answers only "which one?".
  if (!answer && !(which && referred)) return undefined;
  const decision = answer === "no" ? "decline" : "approve";
  // Every reference given has to hold for the one picked. A kind of change
  // that none of them is doesn't rule any out: "the change" fits a transfer.
  const sets = [
    ...(byName.size ? [byName] : []),
    ...(figures.length ? [byAmount] : []),
    ...(byNoun.size ? [byNoun] : []),
  ];
  const fits = asked
    .map((_, i) => i)
    .filter((i) => sets.every((set) => set.has(i)));
  if (fits.length === 1) return { decision, picked: fits[0]! };
  return { unclear: decision };
}

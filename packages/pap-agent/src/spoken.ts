/**
 * What the agent says, in a form fit to be read aloud by a voice client:
 * one or two short sentences, with no table, list or markdown, no
 * identifier ("your order", not `ord_LNB1001`) and amounts as they are
 * said ("88 dollars"). It is made here, by fixed rules, from the same
 * words or facts as the text, and never by a model: a model rewriting a
 * Company's content could make it say something the Company didn't.
 *
 * Amounts are said in the conversation's language (`language.ts`).
 *
 * Plain data and no I/O.
 */
import type { Language } from "./language";

/** At most this many sentences, and about this many characters. */
const SENTENCES = 2;
const LONGEST = 280;

/** Each currency's names: one, many, and its hundredth. */
const UNITS: Record<
  Language,
  Record<string, [one: string, many: string, cent: string]>
> = {
  en: {
    USD: ["dollar", "dollars", "cents"],
    EUR: ["euro", "euros", "cents"],
    GBP: ["pound", "pounds", "pence"],
  },
  es: {
    USD: ["dólar", "dólares", "centavos"],
    EUR: ["euro", "euros", "céntimos"],
    GBP: ["libra", "libras", "peniques"],
  },
  ca: {
    USD: ["dòlar", "dòlars", "cèntims"],
    EUR: ["euro", "euros", "cèntims"],
    GBP: ["lliura", "lliures", "penics"],
  },
  fr: {
    USD: ["dollar", "dollars", "cents"],
    EUR: ["euro", "euros", "centimes"],
    GBP: ["livre", "livres", "pence"],
  },
};
const SIGNS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
const MINUS: Record<Language, string> = {
  en: "minus",
  es: "menos",
  ca: "menys",
  fr: "moins",
};
/** What joins the hundredths to the whole: "12 dólares con 50". */
const AND: Record<Language, string> = {
  en: "",
  es: "con ",
  ca: "amb ",
  fr: "",
};

/** An amount as it is said: "88 dollars", "12 dollars 50", "1,000 dollars". */
export function spokenAmount(
  cents: number,
  currency = "USD",
  language: Language = "en",
) {
  const unit = UNITS[language][currency];
  const minus = cents < 0 ? `${MINUS[language]} ` : "";
  const whole = Math.floor(Math.abs(cents) / 100);
  const part = Math.abs(cents) % 100;
  const number = whole.toLocaleString("en-US");
  if (!unit) return `${minus}${number}${part ? `.${part}` : ""} ${currency}`;
  if (!whole && part) return `${minus}${part} ${unit[2]}`;
  return `${minus}${number} ${whole === 1 ? unit[0] : unit[1]}${part ? ` ${AND[language]}${part}` : ""}`;
}

/** "$88.00", "-$6.00", "€5", "USD 9.99" in words. */
function sayAmounts(text: string, language: Language) {
  return text
    .replace(
      /(-)?([$€£])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g,
      (_, minus: string | undefined, sign: string, whole: string, part) =>
        spokenAmount(
          (minus ? -1 : 1) *
            (Number(whole.replaceAll(",", "")) * 100 +
              Number((part ?? "0").padEnd(2, "0"))),
          SIGNS[sign],
          language,
        ),
    )
    .replace(
      /\b(USD|EUR|GBP)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\b/g,
      (_, currency: string, whole: string, part) =>
        spokenAmount(
          Number(whole.replaceAll(",", "")) * 100 +
            Number((part ?? "0").padEnd(2, "0")),
          currency,
          language,
        ),
    );
}

/**
 * Whether a word is an identifier, which a voice would only spell out: a
 * key (`delivery_001`, `amount_cents`), a code that mixes letters and
 * digits with a dash (`sun-1300`, `ord-LNB1001`), or a long token of mixed
 * case and digits (a revision). Flight numbers and plain numbers are words.
 */
const ID =
  /(?<![\w-])(?:[A-Za-z]+_[\w-]*|(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+|(?=\w*\d)(?=\w*[a-z])(?=\w*[A-Z])\w{12,})(?![\w-])/g;

/** Markdown and layout, as plain sentences. */
function unformatted(text: string) {
  return (
    text
      // Code blocks and tables are for reading, not for saying.
      .replace(/```[\s\S]*?```/g, " ")
      .split("\n")
      .filter((line) => !/^\s*\|/.test(line) && !/^\s*[-=:|\s]{3,}$/.test(line))
      .map((line) =>
        line
          .replace(/^\s*#{1,6}\s+/, "")
          .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
          .trim(),
      )
      .filter(Boolean)
      // A line is a sentence of its own.
      .map((line) => (/[.!?:…]["'”’)]*$/.test(line) ? line : `${line}.`))
      .join(" ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      // Not a single "_", which joins the words of a key.
      .replace(/(\*\*|__|\*)(\S(?:.*?\S)?)\1/g, "$2")
      .replace(/https?:\/\/\S+/g, " ")
  );
}

/** Spaces and stops left right after words were taken out. */
const tidied = (text: string) =>
  text
    .replace(/\(\s*[,;:]?\s*\)/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?=[.!?])/g, "")
    .replace(/([,;:]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

/** The first sentences, within the length a voice says at once. */
function opening(text: string) {
  const sentences = text.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g) ?? [text];
  let said = "";
  for (const sentence of sentences.slice(0, SENTENCES)) {
    const next = `${said} ${sentence.trim()}`.trim();
    if (said && next.length > LONGEST) break;
    said = next;
  }
  if (said.length <= LONGEST) return said;
  const cut = said.slice(0, LONGEST);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

/**
 * The spoken form of something the agent wrote: its first sentence or
 * two, plain, without identifiers, with amounts in words. Empty for words
 * that hold nothing to say.
 */
export function spokenText(text: string, language: Language = "en") {
  const plainText = unformatted(
    text.replace(/^Protocol demo \(no LLM\)\.\s*/, ""),
  );
  return opening(tidied(sayAmounts(plainText, language).replace(ID, " ")));
}

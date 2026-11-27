/**
 * The language the agent's own lines are written in: the one the User
 * writes in. It is read from the User's own typed messages and nothing
 * else: never Company content, a tool's result, a model's answer or a
 * button's label. It stays the same through a conversation until the User
 * clearly writes in another, and is English until they write in one of
 * the others.
 *
 * Fixed word lists, no guessing beyond them: a message that holds no word
 * of any list ("ok", a Company's name, an amount) changes nothing.
 *
 * Plain data and no I/O, so a page can read its own conversation the same
 * way.
 */

export const LANGUAGES = ["en", "es", "ca", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

/**
 * Words that say a message is in a language: its common short words, and
 * the words people use with the agent. A word in several lists counts for
 * each of them. Lowercase, with accents, as people type them; a word
 * typed without its accent is read too (`withoutAccents`).
 */
const words = (list: string) => list.trim().split(/\s+/);

const WORDS: Record<Language, readonly string[]> = {
  en: words(`
    the and is are my me you your what whats show please yes yeah can could
    would of for with i it do does how when where which want this that from
    sign approve decline thanks thank hello hi move change order orders
    balance bill pay much many there have has need not dont go on to in at be
    an a all some any delivery basket plan account money send
  `),
  es: words(`
    el la los las de del que qué y en es mi mis me por para con un una sí si
    vale cuál cual cuánto cuanto cuándo cuando dónde donde cómo como
    muéstrame muestrame enséñame ensename quiero puedes hola gracias mueve
    cambia pedido pedidos aprueba apruébalo apruebalo rechaza sesión sesion
    saldo cuenta factura está esta hay lo le al pero también tambien ahora
    sigue adelante nada todo tengo cuánta dime ver entrega cesta pagar paga
    dinero transferencia ahorros hazlo claro acuerdo inicia cierra conecta
    conéctate quita porfa favor usted tiene hoy mañana
  `),
  ca: words(`
    el la els les de del que què i a en és meu meva meus meves per amb un una
    sí d'acord vull puc pots mostra'm mostra ensenya'm quin quina quins quant
    quanta quan on com comanda comandes hola gràcies gracies aprova rebutja
    entra compte saldo factura ara també tambe però pero endavant res tot
    això aixo aquest aquesta tinc digues veure lliurament cistella pagar paga
    diners transferència transferencia estalvis fes-ho sessió sessio tanca
    connecta treu continua segueix avui demà dema hi ho l' m' d'
  `),
  fr: words(`
    le la les de des du que et est mon ma mes je tu vous votre vos pour avec
    un une oui non d'accord quel quelle quels combien quand où comment
    montre-moi montre montrez-moi veux peux pouvez bonjour salut merci
    commande commandes approuve refuse connecte-moi compte solde facture
    maintenant aussi mais vas-y allez-y rien ce cette c'est j'ai j' l' qu' n'
    ai suis sur livraison panier payer paie argent virement épargne epargne
    s'il plaît plait continue retire aujourd'hui demain très pas ne à toi
    moi connecte connecte-toi
  `),
};

/** Phrases of more than one word, in the same way. */
const PHRASES: Record<Language, readonly string[]> = {
  en: ["thank you", "go ahead"],
  es: ["por favor", "de acuerdo"],
  ca: ["si us plau", "d'acord"],
  fr: ["s'il vous plaît", "s'il te plaît"],
};

/** Marks that only Spanish uses. */
const SPANISH_MARKS = /[¿¡ñ]/;
/** Letters that only Catalan uses. */
const CATALAN_MARKS = /l·l/;
/** Letters French uses and the others don't. */
const FRENCH_MARKS = /[êâûôœëî]/;

const withoutAccents = (word: string) =>
  word.normalize("NFKD").replace(/[̀-ͯ]/g, "");

const SETS = Object.fromEntries(
  LANGUAGES.map((language) => [
    language,
    new Set(
      [...WORDS[language], ...PHRASES[language]].flatMap((w) => [
        w,
        withoutAccents(w),
      ]),
    ),
  ]),
) as Record<Language, Set<string>>;

/** The words of a message, as the lists hold them. */
function wordsOf(text: string) {
  const lower = text.toLowerCase().replace(/[’`]/g, "'");
  const words: string[] = [];
  for (const [token] of lower.matchAll(/[\p{L}·]+(?:['-][\p{L}·]+)*'?/gu)) {
    words.push(token);
    // "l'adreça", "d'accord", "mostra'm", "montre-moi": the whole, and
    // each part, alone and as an elision ("l'", "d'", "m'").
    const parts = token.split(/['-]/).filter(Boolean);
    if (parts.length > 1 || token.endsWith("'"))
      for (const part of parts) words.push(part, `${part}'`);
  }
  // Two-word phrases in the lists ("si us plau").
  const plain = lower.replace(/[^\p{L}' ]+/gu, " ");
  for (const list of Object.values(PHRASES))
    for (const phrase of list)
      if (` ${plain} `.includes(` ${phrase} `)) words.push(phrase);
  return words;
}

/** How many words of each language's list a message holds. */
export function languageScores(text: string): Record<Language, number> {
  const scores = { en: 0, es: 0, ca: 0, fr: 0 } as Record<Language, number>;
  for (const word of wordsOf(text))
    for (const language of LANGUAGES)
      if (SETS[language].has(word) || SETS[language].has(withoutAccents(word)))
        scores[language]++;
  if (SPANISH_MARKS.test(text)) scores.es += 2;
  if (CATALAN_MARKS.test(text)) scores.ca += 2;
  if (FRENCH_MARKS.test(text)) scores.fr += 1;
  return scores;
}

/** Ties among the others go this way, the most widely spoken first. */
const ORDER: readonly Language[] = ["en", "es", "fr", "ca"];

/**
 * The language the conversation goes on in after the User's message:
 * `current` unless the message holds more words of another language than
 * of it. "ok", "sí" after Catalan, "Lantern" or "$88" change nothing.
 */
export function followLanguage(
  current: Language | undefined,
  text: string,
): Language {
  const now = current ?? "en";
  const scores = languageScores(text);
  const best = Math.max(...LANGUAGES.map((l) => scores[l]));
  if (best === 0 || scores[now] === best) return now;
  return ORDER.find((l) => scores[l] === best)!;
}

/** A conversation's language, as it is kept: English until it is another. */
export function languageOf(run: { language?: unknown } | undefined): Language {
  const kept = run?.language;
  return isLanguage(kept) ? kept : "en";
}

/**
 * The User's own typed message, read for the conversation's language.
 * Only ever called with what the User typed: never a button's label, a
 * Company's words or a model's answer.
 */
export function noteLanguage(run: { language?: Language }, typed: string) {
  const next = followLanguage(languageOf(run), typed);
  if (next === "en" && run.language === undefined) return;
  run.language = next;
}

/** The language of a conversation, from the User's own messages in order. */
export const languageFrom = (messages: readonly string[]) =>
  messages.reduce<Language>((now, text) => followLanguage(now, text), "en");

/** "A", "A and B", "A, B or C", in the language. */
export function listIn(
  language: Language,
  names: readonly string[],
  last: "and" | "or" = "and",
) {
  if (names.length < 2) return names[0] ?? "";
  const word = {
    en: { and: "and", or: "or" },
    es: { and: "y", or: "o" },
    ca: { and: "i", or: "o" },
    fr: { and: "et", or: "ou" },
  }[language][last];
  return `${names.slice(0, -1).join(", ")} ${word} ${names.at(-1)}`;
}

/** The User's own words, quoted as each language quotes. */
export function quoteIn(language: Language, words: string) {
  if (language === "en") return `“${words}”`;
  if (language === "fr") return `« ${words} »`;
  return `«${words}»`;
}

export const capital = (words: string) =>
  words.charAt(0).toUpperCase() + words.slice(1);

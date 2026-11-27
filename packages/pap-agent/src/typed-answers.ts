/**
 * What the User types in answer to a question of the agent's own: "yes",
 * "no", "approve the Lantern one", "decline the transfer". The agent's
 * code reads these, never the model: an approval is the User's word, and
 * only their own message counts, never Company content, a tool's result
 * or a model's answer. The caller binds the answer to the question that
 * was asked, and to the message that follows it, and to nothing else.
 *
 * In the languages the agent speaks (`language.ts`): English, Spanish,
 * Catalan and French. A fixed list of words for each, written as `plain`
 * leaves them (lowercase, no accents or apostrophes: "sí" is "si",
 * "d'acord" is "dacord"), and nothing guessed: a message that says
 * anything more is no answer, and goes on as a message.
 *
 * Plain data and no I/O, so the page can read a typed "yes" the same way
 * (a sign-in has to open its tab in the same keystroke).
 */
import { plain } from "./company-names";

/** Longer than this, a message is a message and no answer. */
const LONGEST = 120;

/** "a b, c d": the words of a list, each one or more words. */
const words = (list: string) =>
  list
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

/** A yes to any question. Each kind of question adds its own verbs. */
const YES = [
  ...words(`yes, y, yeah, yep, yup, sure, ok, okay, alright, all right, fine,
    go ahead, go for it, do it, please do, confirm, confirmed, correct,
    absolutely, of course, definitely, sounds good, i do`),
  // Spanish
  ...words(`si, vale, claro, de acuerdo, dale, adelante, hazlo, por supuesto,
    perfecto, correcto, venga, bueno, conforme, claro que si, sin problema`),
  // Catalan
  ...words(`dacord, endavant, fes ho, fes, es clar, perfecte, correcte, va,
    som hi, vinga, molt be, i tant`),
  // French
  ...words(`oui, ouais, daccord, bien sur, vas y, allez y, fais, faites,
    parfait, ca marche, entendu, exact, volontiers, avec plaisir,
    absolument, carrement`),
];

/** The verbs that say yes to each kind of question. */
export const SAYS_YES = {
  approve: [
    ...words("approve, approved, i approve, accept, agree"),
    ...words(`aprueba, aprobar, apruebo, apruebalo, apruebala, acepta,
      aceptar, acepto, aceptalo`),
    ...words("aprova, aprovar, aprovo, laprovo, accepta, acceptar, accepto"),
    ...words(`approuve, approuver, approuvez, japprouve, accepte, accepter,
      jaccepte, valide, valider`),
  ],
  signin: [
    ...words("sign in, sign me in, log in, log me in, allow"),
    ...words("inicia sesion, iniciar sesion, entra, entrar, permite, permitir"),
    ...words("inicia sessio, iniciar sessio, permet, permetre"),
    ...words(`connecte moi, connectez moi, me connecter, se connecter,
      autorise, autoriser`),
  ],
  signout: [
    ...words("sign out, sign me out, log out, log me out"),
    ...words("cierra sesion, cerrar sesion, desconecta, desconectar"),
    ...words("tanca sessio, tancar sessio, desconnecta, desconnectar"),
    ...words(`deconnecte moi, deconnectez moi, me deconnecter,
      se deconnecter`),
  ],
  resume: [
    ...words("go on, carry on, continue, ask it, ask again"),
    ...words("sigue, seguir, continua, continuar, sigue adelante"),
    ...words("segueix"),
    ...words("continuez, continuer, poursuis, poursuivez"),
  ],
  invitation: [
    ...words("talk, talk to them, accept, join"),
    ...words("hablar, hablemos, acepta, aceptar, habla con ellos"),
    ...words("parlar, parlem, accepta, acceptar"),
    ...words("parler, parlons, accepte, accepter, rejoindre"),
  ],
} as const;

/**
 * The answer to the agent asking whether to remove a Company: the verbs
 * that say remove it, and those that say keep it (`typedAnswer`). Apart
 * from `SAYS_YES`, which the agent's other questions read together.
 */
export const SAYS_REMOVE = {
  yes: [
    ...words("remove, remove them, confirm"),
    ...words(`quita, quitala, quitalas, quitar, elimina, eliminala, eliminar,
      borra, borrala`),
    ...words("treu, treure, eliminar"),
    ...words("retire, retirer, supprime, supprimer, enleve, enlever"),
  ],
  no: [
    ...words("keep, keep them"),
    ...words("mantener, mantenla, mantenlas, dejala, dejalas, no quites"),
    ...words("mantenir, mantingues, no treguis"),
    ...words("garde, garder, gardez, ne retire pas"),
  ],
} as const;

const NO = new Set([
  ...words(`no, n, nope, nah, not now, not yet, later, never mind, nevermind,
    cancel, decline, reject, deny, refuse, stop, dont, do not, i decline,
    leave, skip`),
  // Spanish
  ...words(`ahora no, todavia no, aun no, mas tarde, luego, cancela,
    cancelar, rechaza, rechazar, rechazalo, rechazala, no hagas, dejalo,
    olvidalo, mejor no, para nada, de ninguna manera, nunca, no apruebes,
    no aceptes`),
  // Catalan
  ...words(`ara no, encara no, mes tard, despres, cancella, rebutja, rebutjar,
    no facis, deixa, oblida, millor no, de cap manera, mai, no aprovis`),
  // French
  ...words(`non, pas maintenant, pas encore, plus tard, annule, annuler,
    refuse, refuser, rejette, rejeter, ne fais pas, laisse, laisse tomber,
    surtout pas, jamais, pas question, napprouve pas, ne lapprouve pas`),
]);

/**
 * Words that change nothing about yes or no: manners, and the pronouns
 * and articles a person puts around them ("yes, approve it please", "sí,
 * apruébalo por favor", "oui, approuve-le s'il te plaît").
 */
const AROUND = new RegExp(
  `\\b(?:${[
    ...words(`please, thanks, thank you, thankyou, it, that, this, them, one,
      the, a, an, then, now, just, so`),
    ...words(`por favor, porfa, gracias, lo, la, los, las, eso, esto, ya,
      pues, entonces`),
    ...words("si us plau, gracies, ho, el, les, aixo, ja, doncs, ara mateix"),
    ...words(`sil vous plait, sil te plait, stp, svp, merci, le, ca, cela,
      alors, donc`),
  ]
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b`,
  "g",
);

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
  /** The words that also say no to the question asked ("keep it"). */
  noVerbs: readonly string[] = [],
): "yes" | "no" | undefined {
  if (text.length > LONGEST) return undefined;
  const said = plain(text);
  if (!said) return undefined;
  const yes = new Set([...YES, ...verbs]);
  const no = new Set([...NO, ...noVerbs]);
  const sayings = [said, bare(said)].filter(Boolean);
  // "yes approve", "ok go ahead", "no dont": said twice, still one answer.
  const parts = bare(said).split(" ");
  const twice = (set: Set<string>) =>
    [1, 2].some((cut) => {
      const head = parts.slice(0, cut).join(" ");
      const tail = parts.slice(cut).join(" ");
      return parts.length > cut && set.has(head) && set.has(tail);
    });
  if (sayings.some((s) => yes.has(s)) || twice(yes)) return "yes";
  if (sayings.some((s) => no.has(s)) || twice(no)) return "no";
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
    .replace(
      /\b(?:please|ok|okay|yes|can you|could you|por favor|si|vale|puedes|si us plau|pots|sil vous plait|sil te plait|oui|pouvez vous|peux tu)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:try (?:it |that )?again|retry|again|one more time|send (?:it |that )?again|intentalo (?:de nuevo|otra vez)|vuelve a intentarlo|prueba (?:de nuevo|otra vez)|otra vez|de nuevo|reintenta(?:r|lo)?|torna (?:ho )?a provar|prova ho (?:de nou|un altre cop)|un altre cop|una altra vegada|de nou|reessaie|reessayez|reessayer|encore une fois|essaie (?:encore|a nouveau)|recommence|recommencez)$/.test(
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

/**
 * Words that name a kind of change, each with the English word for it,
 * which is the kind a proposal goes by (`proposalNoun`).
 */
const NOUNS = new Map<string, string>([
  ...words(
    "change, transfer, payment, order, booking, upgrade, delivery, proposal",
  ).map((w): [string, string] => [w, w]),
  ...(
    [
      ["change", "cambio, canvi, modification, changement"],
      ["transfer", "transferencia, virement, transfert"],
      ["payment", "pago, pagament, paiement"],
      ["order", "pedido, comanda, commande"],
      ["booking", "reserva, reservation"],
      ["delivery", "entrega, lliurament, livraison"],
      ["proposal", "propuesta, proposta, proposition"],
    ] as const
  ).flatMap(([kind, list]) =>
    words(list).map((w): [string, string] => [w, kind]),
  ),
]);
/** Words that say where, or what for, beside a name or an amount. */
const LINKS = new RegExp(
  `\\b(?:${[
    ...words(`at, for, from, of, to, with, in, on, by, and, both, one, ones,
      dollars?, usd, bucks?`),
    // Not "y" or "i", which are also a yes and a pronoun.
    ...words(`de, del, en, a, al, con, para, por, el, la, los, las, un, una,
      uno, dolar, dolares, las dos, ambas`),
    ...words("per, amb, els, les, dolars, totes dues"),
    ...words("chez, pour, avec, du, des, le, une, et, les deux, dollar"),
  ].join("|")})\\b`,
  "g",
);

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
    const noun = NOUNS.get(word) ?? NOUNS.get(word.replace(/s$/, ""));
    if (!noun) continue;
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

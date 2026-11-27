/**
 * The agent's question when a Company holds a change for the User's
 * approval (Operations extension: the Personal Agent shows the Company's
 * name and the revision's terms, and takes the answer through its own
 * interface). It is written here in the agent's own words, from the
 * exact terms: the Company, what changes, the amount that matters, when
 * the terms run out. The Company's summary is never the question: it is
 * the Company's to say, and its card quotes it as the Company's words.
 *
 * The facts are the terms' own, filled in by code: amounts, names, the
 * before and after, the expiry. The sentence around them is in the
 * conversation's language (`language.ts`).
 *
 * Plain data and no I/O.
 */
import { capital, listIn, type Language } from "./language";
import {
  amountToApprove,
  approvalTotal,
  changes,
  money,
  ownLayout,
  termRows,
  type ReviewOperation,
} from "./operation-presentation";
import { spokenAmount, spokenText } from "./spoken";
import type { Named } from "./typed-answers";
import { dateIn, monthIn, valueIn } from "./words";

/** One proposal as a question names it: its Company and its exact revision. */
export type ProposalRef = {
  /** The Company's origin. */
  company: string;
  proposal: string;
  revision: string;
};

type Noun = "transfer" | "payment" | "change";

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const cents = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const currencyOf = (terms: Record<string, unknown>) =>
  typeof terms.currency === "string" && /^[A-Z]{3}$/.test(terms.currency)
    ? terms.currency
    : undefined;

/** What kind of change the terms are, in one word a person would say. */
export function proposalNoun(op: ReviewOperation): Noun {
  const t = op.terms ?? {};
  if (text(t.source_name) && text(t.destination_name)) return "transfer";
  if (text(t.recipient_name) && cents(t.amount_cents) !== undefined)
    return "payment";
  return "change";
}

/** The amount the question names, if the terms hold one to name. */
export function questionCents(op: ReviewOperation) {
  const shown = amountToApprove(op) ?? approvalTotal(op);
  return shown ? cents(op.terms?.[shown.key]) : undefined;
}

/** Each kind of change, with its article, and the word for "at". */
const NOUNS: Record<Language, Record<Noun, string> & { at: string }> = {
  en: { transfer: "transfer", payment: "payment", change: "change", at: "at" },
  es: {
    transfer: "la transferencia",
    payment: "el pago",
    change: "el cambio",
    at: "en",
  },
  ca: {
    transfer: "la transferència",
    payment: "el pagament",
    change: "el canvi",
    at: "a",
  },
  fr: {
    transfer: "le virement",
    payment: "le paiement",
    change: "la modification",
    at: "chez",
  },
};

/** "the $88.00 change at Lantern Noodle Bar": one proposal, told apart. */
export function proposalName(
  op: ReviewOperation,
  company: string,
  language: Language = "en",
) {
  const amount = questionCents(op);
  const currency = currencyOf(op.terms ?? {});
  const shown =
    amount !== undefined && currency ? money(amount, currency) : undefined;
  return nameIn(language, proposalNoun(op), company, shown);
}

/** "the transfer of 500 dollars at Harborline Bank", to say aloud. */
function spokenName(op: ReviewOperation, company: string, language: Language) {
  const amount = questionCents(op);
  const currency = currencyOf(op.terms ?? {});
  const said =
    amount !== undefined && currency
      ? spokenAmount(amount, currency, language)
      : undefined;
  if (language === "en")
    return `the ${proposalNoun(op)}${said ? ` of ${said}` : ""} at ${company}`;
  return nameIn(language, proposalNoun(op), company, said);
}

function nameIn(
  language: Language,
  noun: Noun,
  company: string,
  amount: string | undefined,
) {
  const words = NOUNS[language];
  if (language === "en")
    return `the ${amount ? `${amount} ` : ""}${words[noun]} at ${company}`;
  return `${words[noun]}${amount ? ` de ${amount}` : ""} ${words.at} ${company}`;
}

/** What it is to an answer: its Company's names, its amount and its kind. */
export const named = (
  op: ReviewOperation,
  names: readonly string[],
): Named => ({
  names,
  cents: questionCents(op),
  noun: proposalNoun(op),
});

/** What the terms change, as they name it, before and after. */
function changed(op: ReviewOperation) {
  // A field the terms also name in words ("plan" beside "plan name") is
  // said in those words, once (`termRows`).
  const rows = ownLayout(op) ? changes(op) : termRows(op).changes;
  // A balance follows from the change; the change itself is what to say.
  return rows
    .filter(
      (row) =>
        !/balance/i.test(row.label) && row.before !== row.after && row.after,
    )
    .slice(0, 2);
}

const lower = (label: string) =>
  `${label.charAt(0).toLowerCase()}${label.slice(1)}`;

/** The first thing the terms change, in words: "plan from Time of use to Flat rate". */
export function firstChange(op: ReviewOperation) {
  const row = changed(op)[0];
  return row
    ? `${lower(row.label)} from ${valueIn("en", row.before)} to ${valueIn("en", row.after)}`
    : undefined;
}

type Subject =
  | "deliveryDay"
  | "delivery"
  | "basket"
  | "checkout"
  | "profile"
  | "order"
  | "booking";

/** What the order or booking is, when the terms say. */
function subjectOf(op: ReviewOperation): Subject | undefined {
  const t = op.terms ?? {};
  if (t.kind === "delivery") return "deliveryDay";
  if (t.kind === "delivery_items") return "delivery";
  if (t.kind === "basket") return "basket";
  if (t.kind === "checkout") return "checkout";
  if (t.kind === "profile_change") return "profile";
  if (t.order_id) return "order";
  if (t.booking_reference || t.booking_id) return "booking";
  return undefined;
}

/** Each subject, as "your …", and the row label that is the subject itself. */
const SUBJECTS: Record<Language, Record<Subject, string>> = {
  en: {
    deliveryDay: "your recurring delivery day",
    delivery: "your recurring delivery",
    basket: "your basket",
    checkout: "a new order from your basket",
    profile: "your profile",
    order: "your order",
    booking: "your booking",
  },
  es: {
    deliveryDay: "el día de tu entrega periódica",
    delivery: "tu entrega periódica",
    basket: "tu cesta",
    checkout: "un pedido nuevo con tu cesta",
    profile: "tu perfil",
    order: "tu pedido",
    booking: "tu reserva",
  },
  ca: {
    deliveryDay: "el dia de la teva entrega periòdica",
    delivery: "la teva entrega periòdica",
    basket: "la teva cistella",
    checkout: "una comanda nova amb la teva cistella",
    profile: "el teu perfil",
    order: "la teva comanda",
    booking: "la teva reserva",
  },
  fr: {
    deliveryDay: "le jour de votre livraison récurrente",
    delivery: "votre livraison récurrente",
    basket: "votre panier",
    checkout: "une nouvelle commande avec votre panier",
    profile: "votre profil",
    order: "votre commande",
    booking: "votre réservation",
  },
};

/**
 * The labels the lab's terms use, in each language: with "the" and with
 * "your". Any other label is the Company's field name, said as it is.
 */
const LABELS: Record<
  string,
  Record<Exclude<Language, "en">, [string, string]>
> = {
  "delivery slot": {
    es: ["la franja de entrega", "tu franja de entrega"],
    ca: ["la franja d'entrega", "la teva franja d'entrega"],
    fr: ["le créneau de livraison", "votre créneau de livraison"],
  },
  "recurring delivery day": {
    es: ["el día de la entrega periódica", "el día de tu entrega periódica"],
    ca: [
      "el dia de l'entrega periòdica",
      "el dia de la teva entrega periòdica",
    ],
    fr: [
      "le jour de livraison récurrente",
      "le jour de votre livraison récurrente",
    ],
  },
  plan: {
    es: ["la tarifa", "tu tarifa"],
    ca: ["la tarifa", "la teva tarifa"],
    fr: ["l'offre", "votre offre"],
  },
  "case status": {
    es: ["el estado del caso", "el estado de tu caso"],
    ca: ["l'estat del cas", "l'estat del teu cas"],
    fr: ["le statut du dossier", "le statut de votre dossier"],
  },
  name: {
    es: ["el nombre", "tu nombre"],
    ca: ["el nom", "el teu nom"],
    fr: ["le nom", "votre nom"],
  },
  "test email": {
    es: ["el correo de prueba", "tu correo de prueba"],
    ca: ["el correu de prova", "el teu correu de prova"],
    fr: ["l'e-mail de test", "votre e-mail de test"],
  },
  "future delivery address": {
    es: ["la dirección de entrega futura", "tu dirección de entrega futura"],
    ca: [
      "l'adreça de lliurament futura",
      "la teva adreça de lliurament futura",
    ],
    fr: ["la future adresse de livraison", "votre future adresse de livraison"],
  },
};

/** "Basket · Apples": the kind, then the item, as the card says it. */
const ITEM_KINDS: Record<string, Record<Exclude<Language, "en">, string>> = {
  basket: { es: "Cesta", ca: "Cistella", fr: "Panier" },
  "recurring delivery": {
    es: "Entrega periódica",
    ca: "Entrega periòdica",
    fr: "Livraison récurrente",
  },
};

/** A row's label with "the", or with "your", in the language. */
function labelIn(language: Language, label: string, your: boolean) {
  if (language === "en") return `${your ? "your" : "the"} ${lower(label)}`;
  const item = /^(.+?) · (.+)$/.exec(label);
  if (item) {
    const kind = ITEM_KINDS[item[1]!.toLowerCase()]?.[language] ?? item[1];
    return `${kind} · ${item[2]}`;
  }
  const known = LABELS[label.toLowerCase()]?.[language];
  if (known) return known[your ? 1 : 0];
  return lower(label);
}

/**
 * "from Saturday at 12:30 to Sunday at 13:00", in the language, with each
 * value said as a person says it (`valueIn`).
 */
export function fromTo(language: Language, before: string, after: string) {
  const b = valueIn(language, before);
  const a = valueIn(language, after);
  if (language === "en") return `from ${b} to ${a}`;
  if (language === "es")
    return `${b.startsWith("el ") ? `del ${b.slice(3)}` : `de ${b}`} ${a.startsWith("el ") ? `al ${a.slice(3)}` : `a ${a}`}`;
  if (language === "ca") return `${deCa(b)} a ${a}`;
  return `${b.startsWith("le ") ? `du ${b.slice(3)}` : deFr(b)} ${a.startsWith("le ") ? `au ${a.slice(3)}` : `à ${a}`}`;
}

const VOWEL = /^[aeiouàâèéêíïîòóôúüûh]/i;
/** Catalan "de", elided before a vowel: "d'octubre", "de desembre". */
export const deCa = (word: string) =>
  VOWEL.test(word) ? `d'${word}` : `de ${word}`;
/** French "de", elided the same way: "d'Operating checking". */
const deFr = deCa;

/** ", starting 1 December", when the terms say when the change applies. */
function starting(language: Language, op: ReviewOperation, now: number) {
  const date = text(op.terms?.effective_date);
  const day = date ? dateIn(language, date, now) : undefined;
  if (!day) return "";
  return {
    en: `, starting ${day}`,
    es: `, a partir del ${day}`,
    ca: `, a partir del dia ${day}`,
    fr: `, à partir du ${day}`,
  }[language];
}

const VERBS: Record<
  Language,
  { wants: string; change: string; make: string; move: string; pay: string }
> = {
  en: {
    wants: "wants to",
    change: "change",
    make: "make a change",
    move: "move",
    pay: "pay",
  },
  es: {
    wants: "quiere",
    change: "cambiar",
    make: "hacer un cambio",
    move: "transferir",
    pay: "pagar",
  },
  ca: {
    wants: "vol",
    change: "canviar",
    make: "fer un canvi",
    move: "transferir",
    pay: "pagar",
  },
  fr: {
    wants: "veut",
    change: "modifier",
    make: "faire une modification",
    move: "virer",
    pay: "payer",
  },
};

/**
 * The sentence that says what is proposed, in the agent's words, without
 * its full stop. `voice` says the amounts as they are spoken, and leaves
 * out a detail a voice can't say.
 */
function proposed(
  op: ReviewOperation,
  company: string,
  language: Language,
  now: number,
  voice = false,
) {
  const t = op.terms ?? {};
  const currency = currencyOf(t);
  const amount = cents(t.amount_cents);
  const v = VERBS[language];
  const say = (value: number) =>
    voice
      ? spokenAmount(value, currency ?? "USD", language)
      : money(value, currency);
  const noun = proposalNoun(op);
  const source = text(t.source_name)!;
  const destination = text(t.destination_name)!;
  if (noun === "transfer") {
    const where = {
      en: `from ${source} to ${destination}`,
      es: `de ${source} a ${destination}`,
      ca: `${deCa(source)} a ${destination}`,
      fr: `${deFr(source)} vers ${destination}`,
    }[language];
    if (amount === undefined)
      return {
        en: `${company} wants to make a transfer ${where}`,
        es: `${company} quiere hacer una transferencia ${where}`,
        ca: `${company} vol fer una transferència ${where}`,
        fr: `${company} veut faire un virement ${where}`,
      }[language];
    return `${company} ${v.wants} ${v.move} ${say(amount)} ${where}`;
  }
  if (noun === "payment") {
    const recipient = text(t.recipient_name)!;
    return {
      en: `${company} wants to pay ${recipient} ${say(amount!)}`,
      es: `${company} quiere pagar ${say(amount!)} a ${recipient}`,
      ca: `${company} vol pagar ${say(amount!)} a ${recipient}`,
      fr: `${company} veut payer ${say(amount!)} à ${recipient}`,
    }[language];
  }
  const subject = subjectOf(op);
  const rows = changed(op);
  const when = starting(language, op, now);
  if (subject === "checkout")
    return {
      en: `${company} wants to place ${SUBJECTS.en.checkout}`,
      es: `${company} quiere hacer ${SUBJECTS.es.checkout}`,
      ca: `${company} vol fer ${SUBJECTS.ca.checkout}`,
      fr: `${company} veut passer ${SUBJECTS.fr.checkout}`,
    }[language];
  // With a total to say aloud, a voice says the total, not the rows.
  const spokenRows =
    voice &&
    cents(t.new_total_cents) !== undefined &&
    cents(t.before_total_cents) !== undefined
      ? []
      : rows.filter(
          (row) =>
            !voice ||
            spokenText(
              `${valueIn(language, row.before)} ${valueIn(language, row.after)}`,
            ).includes(" "),
        );
  const what = subject ? SUBJECTS[language][subject] : undefined;
  const lead = `${company} ${v.wants} ${v.change}`;
  // One change that is the very thing named: said once.
  if (
    spokenRows.length === 1 &&
    subject &&
    SUBJECTS.en[subject] === `your ${lower(spokenRows[0]!.label)}`
  )
    return `${lead} ${what} ${fromTo(language, spokenRows[0]!.before, spokenRows[0]!.after)}${when}`;
  const details = spokenRows.map(
    (row, i) =>
      `${labelIn(language, row.label, !what && i === 0)} ${fromTo(language, row.before, row.after)}`,
  );
  const and = { en: ", and ", es: ", y ", ca: ", i ", fr: ", et " }[language];
  if (!what)
    return details.length
      ? `${lead} ${details.join(and)}${when}`
      : `${company} ${v.wants} ${v.make}${when}`;
  if (!details.length) return `${lead} ${what}${when}`;
  return `${lead} ${what}${language === "fr" ? " :" : ":"} ${details.join(and)}${when}`;
}

/**
 * An amount the terms give as the Company's estimate, not as a payment
 * (`estimated_monthly_difference_cents`): what it estimates, and how much.
 */
export function estimateOf(op: ReviewOperation) {
  const t = op.terms ?? {};
  const found = Object.entries(t).find(
    ([key, value]) =>
      /^estimated_[a-z_]+_cents$/.test(key) && cents(value) !== undefined,
  );
  if (!found) return undefined;
  const words = found[0]
    .replace(/^estimated_/, "")
    .replace(/_cents$/, "")
    .replaceAll("_", " ");
  return { words, cents: found[1] as number, currency: currencyOf(t) };
}

/**
 * The Company's estimate in a sentence of the agent's that says whose it
 * is: "Fernwick Power & Light estimates it would have cost $32.54 more in
 * October." Never the Company's own wording, which its card quotes.
 */
function estimateSentence(
  op: ReviewOperation,
  company: string,
  language: Language,
) {
  const estimate = estimateOf(op);
  if (!estimate) return "";
  const { words, cents: value, currency } = estimate;
  const difference = /difference/.test(words);
  if (value === 0)
    return difference
      ? {
          en: `${company} estimates no difference`,
          es: `${company} calcula que no habría diferencia`,
          ca: `${company} calcula que no hi hauria diferència`,
          fr: `${company} estime qu'il n'y aurait pas de différence`,
        }[language]
      : {
          en: `${company} estimates no ${words}`,
          es: `${company} calcula ${words}: ninguna`,
          ca: `${company} calcula ${words}: cap`,
          fr: `${company} estime ${words} : aucune`,
        }[language];
  const amount = money(Math.abs(value), currency);
  if (!difference)
    return {
      en: `${company} estimates the ${words} at ${value < 0 ? "minus " : ""}${amount}`,
      es: `${company} calcula ${words}: ${value < 0 ? "menos " : ""}${amount}`,
      ca: `${company} calcula ${words}: ${value < 0 ? "menys " : ""}${amount}`,
      fr: `${company} estime ${words} à ${value < 0 ? "moins " : ""}${amount}`,
    }[language];
  const more = value > 0;
  const month = monthOf(op, language);
  if (month)
    return {
      en: `${company} estimates it would have cost ${amount} ${more ? "more" : "less"} in ${month}`,
      es: `${company} calcula que en ${month} habría costado ${amount} ${more ? "más" : "menos"}`,
      ca: `${company} calcula que el mes ${deCa(month)} hauria costat ${amount} ${more ? "més" : "menys"}`,
      fr: `${company} estime qu'en ${month}, cela aurait coûté ${amount} de ${more ? "plus" : "moins"}`,
    }[language];
  const monthly = /monthly/.test(words);
  return {
    en: `${company} estimates the ${words} at ${amount} ${more ? "more" : "less"}`,
    es: `${company} calcula una diferencia${monthly ? " mensual" : ""} de ${amount} ${more ? "más" : "menos"}`,
    ca: `${company} calcula una diferència${monthly ? " mensual" : ""} de ${amount} ${more ? "més" : "menys"}`,
    fr: `${company} estime une différence${monthly ? " mensuelle" : ""} de ${amount} de ${more ? "plus" : "moins"}`,
  }[language];
}

/** The month the Company based its estimate on, when the terms say. */
function monthOf(op: ReviewOperation, language: Language) {
  const basis = text(op.terms?.estimate_basis_month);
  const m = basis ? /^\d{4}-(\d{2})$/.exec(basis) : null;
  return m ? monthIn(language, Number(m[1])) : undefined;
}

/** A label the lab's amounts go by, in each language. */
const AMOUNT_LABELS: Record<string, Record<Exclude<Language, "en">, string>> = {
  total: { es: "Total", ca: "Total", fr: "Total" },
  "amount due": {
    es: "Importe a pagar",
    ca: "Import a pagar",
    fr: "Montant dû",
  },
  amount: { es: "Importe", ca: "Import", fr: "Montant" },
  refund: { es: "Reembolso", ca: "Reemborsament", fr: "Remboursement" },
};

/** The amount that matters, in its own sentence. */
function amountSentence(
  op: ReviewOperation,
  company: string,
  language: Language,
) {
  const t = op.terms ?? {};
  const currency = currencyOf(t);
  if (proposalNoun(op) !== "change") return "";
  const total = cents(t.new_total_cents);
  const before = cents(t.before_total_cents);
  if (total !== undefined && before !== undefined) {
    const difference = total - before;
    const by = money(Math.abs(difference), currency);
    const now = money(total, currency);
    if (difference === 0)
      return {
        en: `The total stays at ${now}.`,
        es: `El total se queda en ${now}.`,
        ca: `El total es queda en ${now}.`,
        fr: `Le total reste de ${now}.`,
      }[language];
    const more = difference > 0;
    return {
      en: `The new total is ${now}, ${by} ${more ? "more" : "less"} than before.`,
      es: `El total nuevo es de ${now}, ${by} ${more ? "más" : "menos"} que antes.`,
      ca: `El total nou és de ${now}, ${by} ${more ? "més" : "menys"} que abans.`,
      fr: `Le nouveau total est de ${now}, soit ${by} de ${more ? "plus" : "moins"} qu'avant.`,
    }[language];
  }
  const shown = amountToApprove(op);
  if (shown) {
    const label =
      language === "en"
        ? shown.text
        : (AMOUNT_LABELS[shown.text.toLowerCase()]?.[language] ?? shown.text);
    return `${label}: ${shown.label}.`;
  }
  const fee = Object.entries(t).find(
    ([key, value]) => /fee_cents$/.test(key) && cents(value) !== undefined,
  );
  if (fee) {
    const value = fee[1] as number;
    if (value === 0)
      return {
        en: "There's no fee.",
        es: "No hay comisión.",
        ca: "No hi ha cap comissió.",
        fr: "Il n'y a pas de frais.",
      }[language];
    const amount = money(value, currency);
    return {
      en: `The fee is ${amount}.`,
      es: `La comisión es de ${amount}.`,
      ca: `La comissió és de ${amount}.`,
      fr: `Les frais sont de ${amount}.`,
    }[language];
  }
  // Nothing to pay in the terms. A Company's estimate is not a payment,
  // and is said as the Company's.
  const estimate = estimateSentence(op, company, language);
  if (estimate)
    return {
      en: `Nothing to pay now; ${estimate}.`,
      es: `Ahora no hay nada que pagar; ${estimate}.`,
      ca: `Ara no cal pagar res; ${estimate}.`,
      fr: `Rien à payer maintenant ; ${estimate}.`,
    }[language];
  return {
    en: "These terms name no payment.",
    es: "Estas condiciones no incluyen ningún pago.",
    ca: "Aquestes condicions no inclouen cap pagament.",
    fr: "Ces conditions ne prévoient aucun paiement.",
  }[language];
}

/** When the terms run out, from now. */
function expiry(op: ReviewOperation, now: number, language: Language) {
  const left = Math.round((Date.parse(op.expires_at) - now) / 60000);
  if (!Number.isFinite(left)) return "";
  if (left <= 1)
    return {
      en: "It expires in a minute.",
      es: "Caduca en un minuto.",
      ca: "Caduca d'aquí a un minut.",
      fr: "La proposition expire dans une minute.",
    }[language];
  return {
    en: `It expires in ${left} minutes.`,
    es: `Caduca en ${left} minutos.`,
    ca: `Caduca d'aquí a ${left} minuts.`,
    fr: `La proposition expire dans ${left} minutes.`,
  }[language];
}

/** The part of a spoken proposal that says what it costs. */
function spokenOwed(op: ReviewOperation, language: Language) {
  const t = op.terms ?? {};
  const currency = currencyOf(t) ?? "USD";
  const noun = proposalNoun(op);
  if (noun !== "change") return "";
  const total = cents(t.new_total_cents);
  const before = cents(t.before_total_cents);
  const bare = (value: number) =>
    spokenAmount(value, currency, language).replace(
      / (dollars?|euros?|pounds?|dólar(?:es)?|dòlars?|lliures?|libras?|livres?)/,
      "",
    );
  if (total !== undefined && before !== undefined) {
    const difference = total - before;
    const by = bare(Math.abs(difference));
    const more = difference > 0;
    const of = spokenAmount(total, currency, language);
    const diff =
      difference === 0
        ? ""
        : {
            en: `, ${by} ${more ? "more" : "less"}`,
            es: `, ${by} ${more ? "más" : "menos"}`,
            ca: `, ${by} ${more ? "més" : "menys"}`,
            fr: `, ${by} de ${more ? "plus" : "moins"}`,
          }[language];
    return {
      en: `, for a new total of ${of}${diff}`,
      es: `, por un total nuevo de ${of}${diff}`,
      ca: `, per un total nou de ${of}${diff}`,
      fr: `, pour un nouveau total de ${of}${diff}`,
    }[language];
  }
  const shown = questionCents(op);
  if (shown !== undefined && shown > 0) {
    const of = spokenAmount(shown, currency, language);
    return {
      en: `, for ${of}`,
      es: `, por ${of}`,
      ca: `, per ${of}`,
      fr: `, pour ${of}`,
    }[language];
  }
  // An estimate is the Company's, and no payment: a voice says only that
  // nothing is paid now, as the written question does.
  if (estimateOf(op))
    return {
      en: ", with nothing to pay now",
      es: ", sin nada que pagar ahora",
      ca: ", sense res a pagar ara",
      fr: ", sans rien à payer maintenant",
    }[language];
  return "";
}

/**
 * A proposal said aloud: the Company, what it wants, and how much, in one
 * sentence made from the terms ("Lantern Noodle Bar wants to change your
 * order, for a new total of 88 dollars, 15 more.").
 */
export function spokenProposal(
  op: ReviewOperation,
  company: string,
  language: Language = "en",
  now = Date.now(),
) {
  return `${proposed(op, company, language, now, true)}${spokenOwed(op, language)}.`;
}

/** "Shall I approve it?", and the questions about several. */
const ASK: Record<
  Language,
  {
    one: string;
    alsoWait: (names: string, many: boolean) => string;
    which: (names: string) => string;
  }
> = {
  en: {
    one: "Shall I approve it?",
    alsoWait: (names, many) =>
      `${capital(names)} ${many ? "are" : "is"} waiting for you too.`,
    which: (names) => `Which one should I approve: ${names}?`,
  },
  es: {
    one: "¿Lo apruebo?",
    alsoWait: (names, many) =>
      `También te ${many ? "esperan" : "espera"} ${names}.`,
    which: (names) => `¿Cuál apruebo: ${names}?`,
  },
  ca: {
    one: "L'aprovo?",
    alsoWait: (names, many) =>
      `També t'${many ? "esperen" : "espera"} ${names}.`,
    which: (names) => `Quina aprovo: ${names}?`,
  },
  fr: {
    one: "Je l'approuve ?",
    alsoWait: (names, many) =>
      `${capital(names)} vous ${many ? "attendent" : "attend"} aussi.`,
    which: (names) => `Laquelle dois-je approuver : ${names} ?`,
  },
};

/**
 * The question about proposals that wait: `fresh` came in the turn just
 * answered, `others` already waited. With one, "Shall I approve it?";
 * with more, the agent asks which, naming each.
 */
export function approvalQuestion(
  fresh: ReadonlyArray<{ op: ReviewOperation; company: string }>,
  others: ReadonlyArray<{ op: ReviewOperation; company: string }>,
  now = Date.now(),
  language: Language = "en",
) {
  const all = [...fresh, ...others];
  const lead = fresh[0] ?? all[0];
  if (!lead) return undefined;
  const ask = ASK[language];
  const about = [
    `${proposed(lead.op, lead.company, language, now)}.`,
    amountSentence(lead.op, lead.company, language),
    expiry(lead.op, now, language),
  ].filter(Boolean);
  const spokenLead = spokenProposal(lead.op, lead.company, language, now);
  const also = all.slice(1);
  if (!also.length)
    return {
      text: [...about, ask.one].join(" "),
      spoken: `${spokenLead} ${ask.one}`,
    };
  const names = all.map(({ op, company }) =>
    proposalName(op, company, language),
  );
  const waiting = also.map(({ op, company }) =>
    proposalName(op, company, language),
  );
  return {
    text: [
      ...about,
      ask.alsoWait(listIn(language, waiting), waiting.length > 1),
      ask.which(listIn(language, names, "or")),
    ].join(" "),
    spoken: `${spokenLead} ${ask.which(
      listIn(
        language,
        all.map(({ op, company }) => spokenName(op, company, language)),
        "or",
      ),
    )}`,
  };
}

/** Asked again when the answer didn't say which proposal. */
export function whichQuestion(
  asked: ReadonlyArray<{ op: ReviewOperation; company: string }>,
  decision: "approve" | "decline",
  language: Language = "en",
) {
  const list = (names: string[]) => listIn(language, names, "or");
  const written = list(
    asked.map(({ op, company }) => proposalName(op, company, language)),
  );
  const spoken = list(
    asked.map(({ op, company }) => spokenName(op, company, language)),
  );
  const approve = decision === "approve";
  const q = (names: string) =>
    ({
      en: `Which one do you want to ${decision}: ${names}?`,
      es: `¿Cuál quieres ${approve ? "aprobar" : "rechazar"}: ${names}?`,
      ca: `Quina vols ${approve ? "aprovar" : "rebutjar"}: ${names}?`,
      fr: `Laquelle voulez-vous ${approve ? "approuver" : "refuser"} : ${names} ?`,
    })[language];
  const hint = {
    en: "You can say the company or the amount.",
    es: "Puedes decir la empresa o el importe.",
    ca: "Pots dir l'empresa o l'import.",
    fr: "Vous pouvez dire l'entreprise ou le montant.",
  }[language];
  return { text: `${q(written)} ${hint}`, spoken: q(spoken) };
}

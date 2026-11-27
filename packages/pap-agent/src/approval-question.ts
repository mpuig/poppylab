/**
 * The agent's question when a Company holds a change for the User's
 * approval (Operations extension: the Personal Agent shows the Company's
 * name and the revision's terms, and takes the answer through its own
 * interface). It is written here in the agent's own words, from the
 * exact terms: the Company, what changes, the amount that matters, when
 * the terms run out. The Company's summary is never the question: it is
 * the Company's to say, and its card quotes it as the Company's words.
 *
 * Plain data and no I/O.
 */
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

/** One proposal as a question names it: its Company and its exact revision. */
export type ProposalRef = {
  /** The Company's origin. */
  company: string;
  proposal: string;
  revision: string;
};

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const cents = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const currencyOf = (terms: Record<string, unknown>) =>
  typeof terms.currency === "string" && /^[A-Z]{3}$/.test(terms.currency)
    ? terms.currency
    : undefined;

/** What kind of change the terms are, in one word a person would say. */
export function proposalNoun(op: ReviewOperation) {
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

/** "the $88.00 change at Lantern Noodle Bar": one proposal, told apart. */
export function proposalName(op: ReviewOperation, company: string) {
  const amount = questionCents(op);
  const currency = currencyOf(op.terms ?? {});
  return `the ${amount !== undefined && currency ? `${money(amount, currency)} ` : ""}${proposalNoun(op)} at ${company}`;
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

/** The first thing the terms change, in words: "plan from Time of use to Flat rate". */
export function firstChange(op: ReviewOperation) {
  const row = changed(op)[0];
  return row
    ? `${row.label.charAt(0).toLowerCase()}${row.label.slice(1)} from ${row.before} to ${row.after}`
    : undefined;
}

/** What the order or booking is, when the terms say. */
function subject(op: ReviewOperation) {
  const t = op.terms ?? {};
  if (t.kind === "delivery") return "your recurring delivery day";
  if (t.kind === "delivery_items") return "your recurring delivery";
  if (t.kind === "basket") return "your basket";
  if (t.kind === "checkout") return "a new order from your basket";
  if (t.kind === "profile_change") return "your profile";
  if (t.order_id) return "your order";
  if (t.booking_reference || t.booking_id) return "your booking";
  return undefined;
}

/** The sentence that says what is proposed, in the agent's words. */
function proposed(op: ReviewOperation, company: string) {
  const t = op.terms ?? {};
  const currency = currencyOf(t);
  const amount = cents(t.amount_cents);
  if (proposalNoun(op) === "transfer")
    return `${company} proposes a transfer${amount !== undefined ? ` of ${money(amount, currency)}` : ""} from ${text(t.source_name)} to ${text(t.destination_name)}.`;
  if (proposalNoun(op) === "payment")
    return `${company} proposes a payment of ${money(amount, currency)} to ${text(t.recipient_name)}.`;
  const what = subject(op);
  const rows = changed(op);
  const lower = (label: string) =>
    `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  if (t.kind === "checkout") return `${company} proposes ${what}.`;
  // One change that is the very thing named: said once.
  if (rows.length === 1 && what === `your ${lower(rows[0]!.label)}`)
    return `${company} proposes a change to ${what}, from ${rows[0]!.before} to ${rows[0]!.after}.`;
  const detail = rows
    .map((row) => `${lower(row.label)} from ${row.before} to ${row.after}`)
    .join(", and ");
  return `${company} proposes ${what ? `a change to ${what}` : "a change"}${detail ? `: ${detail}` : ""}.`;
}

/** "the transfer of 500 dollars at Harborline Bank", to say aloud. */
function spokenName(op: ReviewOperation, company: string) {
  const amount = questionCents(op);
  const currency = currencyOf(op.terms ?? {});
  return `the ${proposalNoun(op)}${amount !== undefined && currency ? ` of ${spokenAmount(amount, currency)}` : ""} at ${company}`;
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
 * is: "Fernwick Power & Light estimates the monthly difference at $32.54
 * more." Never the Company's own wording, which its card quotes.
 */
function estimateSentence(op: ReviewOperation, company: string) {
  const estimate = estimateOf(op);
  if (!estimate) return "";
  const { words, cents: value, currency } = estimate;
  if (value === 0) return `${company} estimates no ${words}.`;
  const amount = money(Math.abs(value), currency);
  return /difference/.test(words)
    ? `${company} estimates the ${words} at ${amount} ${value > 0 ? "more" : "less"}.`
    : `${company} estimates the ${words} at ${value < 0 ? "minus " : ""}${amount}.`;
}

/** The amount that matters, in its own sentence. */
function amountSentence(op: ReviewOperation, company: string) {
  const t = op.terms ?? {};
  const currency = currencyOf(t);
  if (proposalNoun(op) !== "change") return "";
  const total = cents(t.new_total_cents);
  const before = cents(t.before_total_cents);
  if (total !== undefined && before !== undefined) {
    const difference = total - before;
    return `The new total is ${money(total, currency)}${
      difference > 0
        ? `, ${money(difference, currency)} more`
        : difference < 0
          ? `, ${money(-difference, currency)} less`
          : ", the same as before"
    }.`;
  }
  const shown = amountToApprove(op);
  if (shown) return `${shown.text}: ${shown.label}.`;
  const fee = Object.entries(t).find(
    ([key, value]) => /fee_cents$/.test(key) && cents(value) !== undefined,
  );
  if (fee) return `The fee is ${money(fee[1], currency)}.`;
  // Nothing to pay in the terms. A Company's estimate is not a payment,
  // and is said as the Company's.
  const estimate = estimateSentence(op, company);
  return estimate
    ? `There is no payment now. ${estimate}`
    : "The terms name no payment.";
}

/** When the terms run out, from now. */
function expiry(op: ReviewOperation, now: number) {
  const left = Math.round((Date.parse(op.expires_at) - now) / 60000);
  if (!Number.isFinite(left)) return "";
  if (left <= 1) return "The terms expire in a minute.";
  return `The terms expire in ${left} minutes.`;
}

/**
 * A proposal said aloud: the Company, what it wants, and how much, in one
 * sentence made from the terms ("Lantern Noodle Bar wants to change your
 * order, for a new total of 88 dollars, 15 more.").
 */
export function spokenProposal(op: ReviewOperation, company: string) {
  const t = op.terms ?? {};
  const currency = currencyOf(t) ?? "USD";
  const amount = cents(t.amount_cents);
  if (proposalNoun(op) === "transfer" && amount !== undefined)
    return `${company} wants to move ${spokenAmount(amount, currency)} from ${text(t.source_name)} to ${text(t.destination_name)}.`;
  if (proposalNoun(op) === "payment" && amount !== undefined)
    return `${company} wants to pay ${text(t.recipient_name)} ${spokenAmount(amount, currency)}.`;
  const first = changed(op)[0];
  // Without a subject the terms name, the thing that changes is it.
  const what =
    subject(op) ??
    (first
      ? `your ${first.label.charAt(0).toLowerCase()}${first.label.slice(1)}`
      : "something");
  const total = cents(t.new_total_cents);
  const before = cents(t.before_total_cents);
  const verb = t.kind === "checkout" ? "place" : "change";
  if (total !== undefined && before !== undefined) {
    const difference = total - before;
    return `${company} wants to ${verb} ${what}, for a new total of ${spokenAmount(total, currency)}${
      difference > 0
        ? `, ${spokenAmount(difference, currency).replace(/ (dollars?|euros?|pounds?)/, "")} more`
        : difference < 0
          ? `, ${spokenAmount(-difference, currency).replace(/ (dollars?|euros?|pounds?)/, "")} less`
          : ""
    }.`;
  }
  const shown = questionCents(op);
  // The before and after, when they are words a voice can say.
  const rows = changed(op).filter((row) =>
    spokenText(`${row.before} ${row.after}`).includes(" "),
  );
  const detail = rows[0]
    ? ` from ${spokenText(rows[0].before).replace(/\.$/, "")} to ${spokenText(rows[0].after).replace(/\.$/, "")}`
    : "";
  // An estimate is the Company's, and no payment: a voice says only that
  // nothing is paid now, as the written question does.
  const owed =
    shown !== undefined && shown > 0
      ? `, for ${spokenAmount(shown, currency)}`
      : estimateOf(op)
        ? ", with no payment now"
        : "";
  return `${company} wants to ${verb} ${what}${detail}${owed}.`;
}

/**
 * The question about proposals that wait: `fresh` came in the turn just
 * answered, `others` already waited. With one, "Approve it?"; with more,
 * the agent asks which, naming each.
 */
export function approvalQuestion(
  fresh: ReadonlyArray<{ op: ReviewOperation; company: string }>,
  others: ReadonlyArray<{ op: ReviewOperation; company: string }>,
  now = Date.now(),
) {
  const all = [...fresh, ...others];
  const lead = fresh[0] ?? all[0];
  if (!lead) return undefined;
  const about = [
    proposed(lead.op, lead.company),
    amountSentence(lead.op, lead.company),
    expiry(lead.op, now),
  ].filter(Boolean);
  const also = all.slice(1);
  if (!also.length)
    return {
      text: [...about, "Approve it?"].join(" "),
      spoken: `${spokenProposal(lead.op, lead.company)} Approve it?`,
    };
  const names = all.map(({ op, company }) => proposalName(op, company));
  const waiting = also.map(({ op, company }) => proposalName(op, company));
  return {
    text: [
      ...about,
      `${capital(listed(waiting))} ${waiting.length > 1 ? "wait" : "waits"} for you too.`,
      `Which do you approve: ${listed(names, "or")}?`,
    ].join(" "),
    spoken: `${spokenProposal(lead.op, lead.company)} Which do you approve: ${listed(
      all.map(({ op, company }) => spokenName(op, company)),
      "or",
    )}?`,
  };
}

/** Asked again when the answer didn't say which proposal. */
export function whichQuestion(
  asked: ReadonlyArray<{ op: ReviewOperation; company: string }>,
  decision: "approve" | "decline",
) {
  const names = asked.map(({ op, company }) => proposalName(op, company));
  return {
    text: `Which one do you ${decision}: ${listed(names, "or")}? Say the company or the amount.`,
    spoken: `Which one do you ${decision}: ${listed(
      asked.map(({ op, company }) => spokenName(op, company)),
      "or",
    )}?`,
  };
}

const capital = (words: string) =>
  words.charAt(0).toUpperCase() + words.slice(1);

/** "A", "A and B", "A, B or C". */
function listed(names: readonly string[], last: "and" | "or" = "and") {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1)}`;
}

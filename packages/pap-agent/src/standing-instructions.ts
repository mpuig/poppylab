import {
  approvalTotal,
  fieldLabel,
  money,
  sides,
  summaryDisagreements,
  type ReviewOperation,
} from "./operation-presentation";

/** A rule the User wrote for one Company: exchanges up to an amount. */
export type Instruction = { maxCents: number; currency: string };

const KEY = "poppy-lab:standing-instructions";
/** The most a rule can allow per exchange: $1,000.00. */
const MAX = 1_000_00;

const wholeCents = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const belowZero = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value < 0;
const BALANCE = /(^|_)balance(_|$)/;
/** A field's name as it reads inside a sentence: "amount due". */
const named = (key: string) => fieldLabel(key).toLowerCase();

/**
 * Every money amount in the terms, however deeply nested, each with the name
 * of its field. A fee or a price difference commits the User as much as the
 * headline amount does, so the check looks at all of them.
 *
 * A balance is the one exception. It says what an account holds, not what
 * the approval commits, so it is not compared with the limit; what the
 * approval does to it is. A balance is read only as a pair, before and
 * after, and the difference between the two counts as an amount.
 *
 * Instead of the amounts, the reason the terms cannot be settled: an amount
 * that is not whole cents, an amount or a balance below zero, a balance
 * without both halves, a refund, or more structure than a proposal needs.
 * Words about refunds (a refund policy) are text like any other, which this
 * check never reads, and a refund of zero is none.
 */
function amounts(
  terms: Record<string, unknown>,
): { label: string; cents: number; balance?: true }[] | { why: string } {
  const found: { label: string; cents: number; balance?: true }[] = [];
  let visited = 0,
    why = "";
  const fail = (reason: string) => {
    why = reason;
    return false;
  };
  // Whole cents below zero are read. They are not an amount paid or moved
  // (a lower price returns money), so the reason names them as they are.
  const below = (key: string, cents: number) =>
    fail(
      BALANCE.test(key)
        ? `the ${named(sides(key)?.name || key)}, ${money(cents, terms.currency)}, is below zero, which it never approves`
        : `the ${named(key)}, ${money(cents, terms.currency)}, is below zero, and it approves only amounts you pay or move`,
    );
  const walk = (value: unknown, depth: number): boolean => {
    if (!value || typeof value !== "object") return true;
    if (depth > 4) return fail("the terms hold more than it can check");
    const fields = value as Record<string, unknown>;
    for (const [key, v] of Object.entries(fields)) {
      if (++visited > 200) return fail("the terms hold more than it can check");
      if (/refund/i.test(key)) {
        if (key.endsWith("_cents") ? v === 0 : typeof v === "string") continue;
        return fail("the terms include a refund, which it never approves");
      }
      if (!key.endsWith("_cents")) {
        if (!walk(v, depth + 1)) return false;
        continue;
      }
      if (belowZero(v)) return below(key, v);
      if (!wholeCents(v))
        return fail(`it can't read “${fieldLabel(key)}” in the terms`);
      if (!BALANCE.test(key)) {
        found.push({ label: `the ${named(key)}`, cents: v });
        continue;
      }
      const side = sides(key);
      const before = side?.name ? fields[side.from] : undefined,
        after = side?.name ? fields[side.to] : undefined;
      // This half is at or above zero; the other may not be.
      const low = [before, after].find(belowZero);
      if (low !== undefined) return below(key, low);
      if (!side || !wholeCents(before) || !wholeCents(after))
        return fail(
          `it can't tell from the terms how the ${named(side?.name || key)} changes`,
        );
      // Counted once, at the first half.
      if (key === side.from)
        found.push({
          label: `the change to the ${named(side.name)}`,
          cents: Math.abs(after - before),
          balance: true,
        });
    }
    return true;
  };
  return walk(terms, 0) ? found : { why };
}

/**
 * The fixed check of an operation's exact terms against a standing
 * instruction: what it covers, or why it doesn't.
 *
 * The limit is compared with the amount the User pays or moves
 * (`approvalTotal`: `amount_due_cents`, `amount_cents`, `new_total_cents`,
 * `total_cents`, in that order). The card leads with the same amount, except
 * for an order's total that did not rise (`amountToApprove`), which is still
 * the amount here. A balance after the change, a "before" value or a version
 * is not that amount: each describes the account or the order, not what the
 * approval commits. Every other amount in the terms must be within the limit
 * too (a fee, a difference, a previous total, a line), and so must the
 * change to each balance. The terms must be in the instruction's currency,
 * hold no refund, and agree with the Company's summary.
 *
 * An amount due and a total say by their names that they are paid. A bare
 * `amount_cents` does not: it is taken as moved only where the terms show a
 * balance changing with it, as Harborline's payment and transfer do. Its
 * category change names the amount of a transaction already posted, beside
 * no balance, and approving it moves nothing; a credit there is a small
 * positive amount, which the limit alone would let through.
 *
 * Terms the check doesn't understand are not covered: no amount to pay or
 * move, an amount it can't read, a balance it can't follow. Nor are terms
 * with an amount below zero, which it reads and says so.
 */
function check(
  op: ReviewOperation,
  instruction: Instruction,
): { cents: number; text: string } | { why: string } {
  const terms = op.terms ?? {};
  const all = amounts(terms);
  if (!Array.isArray(all)) return all;
  const total = approvalTotal(op);
  const cents = total ? terms[total.key] : undefined;
  // A refund of zero is all these terms name.
  if (!total || total.key === "refund_cents" || !wholeCents(cents))
    return { why: "the terms name no amount to pay or move" };
  // An amount that names no payment, beside no balance that changes.
  if (
    total.key === "amount_cents" &&
    !all.some((amount) => amount.balance && amount.cents > 0)
  )
    return {
      why: `it can't tell from the terms that the amount, ${money(cents, terms.currency)}, is paid or moved`,
    };
  if (terms.currency !== instruction.currency)
    return {
      why: `the terms ${typeof terms.currency === "string" ? `are in ${terms.currency.slice(0, 12)}` : "name no currency"} and your limit is in ${instruction.currency}`,
    };
  // The amount itself first, then any other.
  const over = [{ label: `the ${named(total.key)}`, cents }, ...all].find(
    (amount) => amount.cents > instruction.maxCents,
  );
  if (over)
    return {
      why: `${over.label}, ${money(over.cents, instruction.currency)}, is over your limit of ${formatLimit(instruction)}`,
    };
  if (summaryDisagreements(op).length)
    return {
      why: "the Company's summary names an amount its terms don't hold",
    };
  return {
    cents,
    text: `${total.label} within your limit of ${formatLimit(instruction)}`,
  };
}

const waiting = (op: ReviewOperation, now: number) =>
  op.state === "proposed" && Date.parse(op.expires_at) > now;

/**
 * Whether a standing instruction covers an operation, decided only from its
 * exact terms (see `check`). Anything the check cannot settle is not covered
 * and comes to the User, and so does a proposal that has expired. Returns
 * the amount it covers and what to say about it, for the record.
 */
export function coveredBy(
  op: ReviewOperation,
  instruction: Instruction | undefined,
  now = Date.now(),
): { cents: number; text: string } | null {
  if (!instruction || !waiting(op, now)) return null;
  const result = check(op, instruction);
  return "why" in result ? null : result;
}

/**
 * Why a standing instruction doesn't cover a waiting operation, as the end
 * of a sentence ("the amount due, $248.00, is over your limit of $50.00").
 * Null when it covers it, or when there is nothing to say: no instruction,
 * or an operation that no longer waits.
 */
export function notCovered(
  op: ReviewOperation,
  instruction: Instruction | undefined,
  now = Date.now(),
): string | null {
  if (!instruction || !waiting(op, now)) return null;
  const result = check(op, instruction);
  return "why" in result ? result.why : null;
}

export function formatLimit({ maxCents, currency }: Instruction) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    maxCents / 100,
  );
}

/** A limit typed by the User, in whole currency units or cents, or null. */
export function parseLimit(
  value: string,
  currency: string,
): Instruction | null {
  const match = /^\s*(\d{1,4})(?:\.(\d{1,2}))?\s*$/.exec(value);
  if (!match || !/^[A-Z]{3}$/.test(currency)) return null;
  const maxCents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
  return maxCents > 0 && maxCents <= MAX ? { maxCents, currency } : null;
}

/** An instruction sent to the server, checked as strictly as a saved one. */
export function parseInstruction(value: unknown): Instruction | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Instruction>;
  return typeof v.maxCents === "number" &&
    Number.isInteger(v.maxCents) &&
    v.maxCents > 0 &&
    v.maxCents <= MAX &&
    typeof v.currency === "string" &&
    /^[A-Z]{3}$/.test(v.currency)
    ? { maxCents: v.maxCents, currency: v.currency }
    : null;
}

type Store = Record<string, Instruction>;

function read(): Store {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const clean: Store = {};
    for (const [origin, value] of Object.entries(parsed)) {
      const v = value as Partial<Instruction>;
      if (
        typeof v.maxCents === "number" &&
        Number.isInteger(v.maxCents) &&
        v.maxCents > 0 &&
        v.maxCents <= MAX &&
        typeof v.currency === "string" &&
        /^[A-Z]{3}$/.test(v.currency)
      )
        clean[origin] = { maxCents: v.maxCents, currency: v.currency };
    }
    return clean;
  } catch {
    return {};
  }
}

export const loadInstruction = (origin: string) => read()[origin];

export function saveInstruction(
  origin: string,
  instruction: Instruction | null,
) {
  try {
    const store = read();
    if (instruction) store[origin] = instruction;
    else delete store[origin];
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage can be blocked; the instruction then lasts until reload.
  }
}

/**
 * Every Company's instruction removed, as a reset of the demo data does: the
 * rules were given for the old test customers' accounts. The hour's record
 * of approvals stays, so a reset never widens the allowance.
 */
export function clearInstructions() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked; nothing was kept there then.
  }
}

/** One approval a standing instruction made, kept so a rule cannot be chained without end. */
export type Approval = { at: number; cents: number };
const APPROVALS_KEY = "poppy-lab:auto-approvals";
const HOUR = 3_600_000;

export function loadApprovals(origin: string, now = Date.now()): Approval[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(APPROVALS_KEY) ?? "{}",
    );
    const list = (parsed as Record<string, unknown> | null)?.[origin];
    if (!Array.isArray(list)) return [];
    return list.flatMap((a: Partial<Approval>) =>
      typeof a?.at === "number" &&
      typeof a.cents === "number" &&
      Number.isFinite(a.at) &&
      Number.isInteger(a.cents) &&
      // A time in the future cannot be trusted to expire: it counts.
      a.at > now - HOUR
        ? [{ at: a.at, cents: a.cents }]
        : [],
    );
  } catch {
    return [];
  }
}

export function recordApproval(
  origin: string,
  approval: Approval,
  now = Date.now(),
) {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(APPROVALS_KEY) ?? "{}",
    );
    const store: Record<string, Approval[]> =
      parsed && typeof parsed === "object" ? { ...parsed } : {};
    store[origin] = [...loadApprovals(origin, now), approval].slice(-20);
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(store));
  } catch {
    // Storage can be blocked; the limit then holds until the page reloads.
  }
}

import {
  approvalTotal,
  summaryDisagreements,
  type ReviewOperation,
} from "./operation-presentation";

/** A rule the User wrote for one Company: exchanges up to an amount. */
export type Instruction = { maxCents: number; currency: string };

const KEY = "poppy-lab:standing-instructions";
/** The most a rule can allow per exchange: $1,000.00. */
const MAX = 1_000_00;

/**
 * Every money amount in the terms, however deeply nested. A fee or a price
 * difference commits the User as much as the headline total does, so the
 * check looks at all of them. Null when the terms hold anything it cannot
 * settle: an amount that is not whole non-negative cents, a refund, or more
 * structure than a proposal needs.
 */
function amounts(terms: unknown): number[] | null {
  const found: number[] = [];
  let visited = 0;
  const walk = (value: unknown, depth: number): boolean => {
    if (!value || typeof value !== "object") return true;
    if (depth > 4) return false;
    for (const [key, v] of Object.entries(value)) {
      if (++visited > 200 || /refund/i.test(key)) return false;
      if (key.endsWith("_cents")) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
          return false;
        found.push(v);
      } else if (!walk(v, depth + 1)) return false;
    }
    return true;
  };
  return walk(terms, 0) ? found : null;
}

/**
 * Whether a standing instruction covers an operation, decided only from its
 * exact terms. Anything the check cannot settle is not covered and comes to
 * the User: no amount, another currency, any refund, a summary that
 * disagrees with the terms, a proposal that has expired, or any amount in
 * the terms (a fee included) over the limit. Returns the total it covers
 * and what to say about it, for the record.
 */
export function coveredBy(
  op: ReviewOperation,
  instruction: Instruction | undefined,
  now = Date.now(),
): { cents: number; text: string } | null {
  if (!instruction) return null;
  if (op.state !== "proposed" || !(Date.parse(op.expires_at) > now))
    return null;
  const total = approvalTotal(op);
  if (!total || total.key === "refund_cents") return null;
  const cents = op.terms?.[total.key];
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0)
    return null;
  if (op.terms?.currency !== instruction.currency) return null;
  const all = amounts(op.terms);
  if (!all || Math.max(cents, ...all) > instruction.maxCents) return null;
  if (summaryDisagreements(op).length) return null;
  return {
    cents,
    text: `${total.label} within your limit of ${formatLimit(instruction)}`,
  };
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

import {
  approvalTotal,
  summaryDisagreements,
  type ReviewOperation,
} from "./operation-presentation";

/** A rule the User wrote for one Company: exchanges up to an amount. */
export type Instruction = { maxCents: number; currency: string };

const KEY = "poppy-lab:standing-instructions";
const MAX = 100_000_00;

/**
 * Whether a standing instruction covers an operation, decided only from its
 * exact terms. Anything the check cannot settle is not covered and comes to
 * the User: no amount, another currency, a refund, a summary that disagrees
 * with the terms, a proposal that has expired, or a total over the limit.
 * Returns what the instruction approved, for the record.
 */
export function coveredBy(
  op: ReviewOperation,
  instruction: Instruction | undefined,
  now = Date.now(),
): string | null {
  if (!instruction) return null;
  if (op.state !== "proposed" || !(Date.parse(op.expires_at) > now))
    return null;
  const total = approvalTotal(op);
  if (!total || total.key === "refund_cents") return null;
  const cents = op.terms?.[total.key];
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0)
    return null;
  if (op.terms?.currency !== instruction.currency) return null;
  if (cents > instruction.maxCents) return null;
  if (summaryDisagreements(op).length) return null;
  return `${total.label} within your limit of ${formatLimit(instruction)}`;
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
  const match = /^\s*(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(value);
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

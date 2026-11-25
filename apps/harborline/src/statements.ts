/**
 * Harborline's fictional monthly statements, derived from an account's own
 * records: never stored, never invented. A statement is a closed cycle of
 * posted transactions with the balances before and after it, worked back
 * from the account's current balance.
 *
 * Harborline's rules, not FDX's:
 * - A cycle runs from the 21st of one month through the 20th of the next,
 *   in UTC days. The seed transactions (15–19 November 2026) fall in the
 *   21 October – 20 November 2026 cycle.
 * - The fictional accounts were opened on 21 August 2026, so the first
 *   cycle ends on 20 September 2026. A cycle is issued the day after it
 *   closes, and the newest `MAX_STATEMENTS` are offered. Cycles without
 *   activity are statements too, with equal opening and closing balances.
 * - `balance_cents` is the posted (ledger) balance. Pending transactions
 *   aren't in it and aren't on statements.
 */
import type { Account, Transaction } from "./data.ts";

/** The day each cycle closes, and the first day of the first cycle. */
export const CYCLE_CLOSES_ON = 20;
export const STATEMENTS_FROM = "2026-08-21";
/** Statements offered per account, newest first. */
export const MAX_STATEMENTS = 12;

export type Statement = {
  statementId: string;
  accountId: string;
  /** The cycle's first and last days; the last is the statement's date. */
  startDate: string;
  endDate: string;
  /** Posted transactions in the cycle, oldest first. */
  transactions: Transaction[];
  openingCents: number;
  closingCents: number;
};

const day = (value: Date) => value.toISOString().slice(0, 10);
const utc = (year: number, month: number, date: number) =>
  new Date(Date.UTC(year, month, date));

/** The cycles closed before `today` (YYYY-MM-DD), oldest first. */
export function closedCycles(today: string) {
  const cycles: Array<{ startDate: string; endDate: string }> = [];
  const first = new Date(`${STATEMENTS_FROM}T00:00:00.000Z`);
  for (let n = 0; ; n++) {
    const start = utc(first.getUTCFullYear(), first.getUTCMonth() + n, 21);
    const end = utc(
      first.getUTCFullYear(),
      first.getUTCMonth() + n + 1,
      CYCLE_CLOSES_ON,
    );
    if (day(end) >= today) break;
    cycles.push({ startDate: day(start), endDate: day(end) });
  }
  return cycles.slice(-MAX_STATEMENTS);
}

/** `stmt_` + the account + the closing day, so the same cycle keeps its ID. */
export const statementId = (accountId: string, endDate: string) =>
  `stmt_${accountId}_${endDate.replaceAll("-", "")}`;

/**
 * The account's statements as of `now`, newest first. Balances work back
 * from the current posted balance: a cycle closes at the balance less
 * everything posted after it, and opens at that less its own activity.
 */
export function statementsFor(
  account: Account,
  transactions: readonly Transaction[],
  now: Date,
): Statement[] {
  const posted = transactions
    .filter((t) => t.account_id === account.id && t.status === "posted")
    .map((t) => ({ t, day: t.occurred_at.slice(0, 10) }));
  return closedCycles(day(now))
    .map(({ startDate, endDate }) => {
      const after = posted
        .filter((p) => p.day > endDate)
        .reduce((sum, p) => sum + p.t.amount_cents, 0);
      const inCycle = posted
        .filter((p) => p.day >= startDate && p.day <= endDate)
        .map((p) => p.t)
        .sort(
          (a, b) =>
            a.occurred_at.localeCompare(b.occurred_at) ||
            a.id.localeCompare(b.id),
        );
      const closingCents = account.balance_cents - after;
      return {
        statementId: statementId(account.id, endDate),
        accountId: account.id,
        startDate,
        endDate,
        transactions: inCycle,
        openingCents:
          closingCents - inCycle.reduce((sum, t) => sum + t.amount_cents, 0),
        closingCents,
      };
    })
    .reverse();
}

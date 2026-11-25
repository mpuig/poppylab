/**
 * Harborline's fictional statements: which cycles exist, the balances worked
 * back from the current one, and the hand-written PDF (deterministic, with a
 * cross-reference table that matches its bytes).
 */
import { describe, expect, it } from "vitest";
import { customers, FICTION_NOTICE, type Transaction } from "./data.ts";
import {
  amount,
  MAX_STATEMENT_ROWS,
  NO_REAL_ACCOUNT,
  pdfString,
  statementPdf,
} from "./statement-pdf.ts";
import {
  closedCycles,
  MAX_STATEMENTS,
  statementId,
  statementsFor,
  type Statement,
} from "./statements.ts";
import { readPdf } from "./test-harness.ts";

const elena = customers[0]!;
const checking = elena.accounts[0]!;
const now = new Date("2026-11-25T12:00:00.000Z");

const synthetic = (count: number): Statement => {
  const transactions: Transaction[] = Array.from({ length: count }, (_, i) => ({
    id: `txn_test_${String(i).padStart(3, "0")}`,
    account_id: checking.id,
    description: `Fictional shop number ${i} (test)`,
    amount_cents: i % 4 ? -(i * 101) : 50000,
    category: "other",
    status: "posted",
    occurred_at: "2026-11-01T10:00:00.000Z",
    version: 1,
  }));
  const net = transactions.reduce((sum, t) => sum + t.amount_cents, 0);
  return {
    statementId: statementId(checking.id, "2026-11-20"),
    accountId: checking.id,
    startDate: "2026-10-21",
    endDate: "2026-11-20",
    transactions,
    openingCents: 100000,
    closingCents: 100000 + net,
  };
};

describe("Harborline statements", () => {
  it("offers the cycles closed before today, from 21 August 2026, at most twelve", () => {
    expect(closedCycles("2026-11-25")).toEqual([
      { startDate: "2026-08-21", endDate: "2026-09-20" },
      { startDate: "2026-09-21", endDate: "2026-10-20" },
      { startDate: "2026-10-21", endDate: "2026-11-20" },
    ]);
    // Issued the day after a cycle closes, not on its last day.
    expect(closedCycles("2026-11-20").map((c) => c.endDate)).toEqual([
      "2026-09-20",
      "2026-10-20",
    ]);
    expect(closedCycles("2026-11-21")).toHaveLength(3);
    expect(closedCycles("2026-09-20")).toEqual([]);
    // Across a year end, and capped to the newest twelve.
    const later = closedCycles("2028-02-01");
    expect(later).toHaveLength(MAX_STATEMENTS);
    expect(later.at(-1)).toEqual({
      startDate: "2027-12-21",
      endDate: "2028-01-20",
    });
    expect(later[0]).toEqual({
      startDate: "2027-01-21",
      endDate: "2027-02-20",
    });
  });

  it("works balances back from the current posted balance, with only posted transactions", () => {
    const [november, october, september] = statementsFor(
      checking,
      elena.transactions,
      now,
    );
    expect(november).toMatchObject({
      statementId: "stmt_acc_HLB_A100_20261120",
      accountId: "acc_HLB_A100",
      startDate: "2026-10-21",
      endDate: "2026-11-20",
      // 12,845.00 less the payroll deposit, plus the two debits.
      openingCents: 1284500 - 325000 + 8642 + 2400,
      closingCents: 1284500,
    });
    expect(november!.transactions.map((t) => t.id)).toEqual([
      "txn_HLB_A303",
      "txn_HLB_A302",
      "txn_HLB_A301",
    ]);
    // Months without activity: equal balances, no transactions.
    for (const quiet of [october!, september!]) {
      expect(quiet.transactions).toEqual([]);
      expect(quiet.openingCents).toBe(november!.openingCents);
      expect(quiet.closingCents).toBe(november!.openingCents);
    }
    // A later posting moves the current balance, not a closed statement.
    const later: Transaction = {
      ...elena.transactions[0]!,
      id: "txn_later",
      amount_cents: -50001,
      occurred_at: "2026-11-24T10:00:00.000Z",
    };
    const after = statementsFor(
      { ...checking, balance_cents: checking.balance_cents - 50001 },
      [later, ...elena.transactions],
      now,
    );
    expect(after[0]).toEqual(november);
    // Pending transactions are in neither the balance nor a statement.
    const robin = customers[1]!;
    const [robinNovember] = statementsFor(
      robin.accounts[0]!,
      robin.transactions,
      now,
    );
    expect(robinNovember!.transactions.map((t) => t.id)).toEqual([
      "txn_HLB_J301",
    ]);
    expect(robinNovember!.openingCents).toBe(382740 + 1875);
    // Another account's transactions never count.
    expect(
      statementsFor(elena.accounts[1]!, elena.transactions, now)[0],
    ).toMatchObject({ transactions: [], openingCents: 4250000 });
  });

  it("writes a deterministic PDF with the header, the account, the period, the balances and the fiction notice", () => {
    const [november] = statementsFor(checking, elena.transactions, now);
    const pdf = statementPdf(november!, checking, elena.name);
    expect(statementPdf(november!, checking, elena.name)).toEqual(pdf);
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
    const { pages, text, size } = readPdf(pdf);
    expect(pages).toBe(1);
    expect(size).toBeLessThan(8192);
    for (const line of [
      "Harborline Bank \x97 fictional statement",
      NO_REAL_ACCOUNT,
      FICTION_NOTICE,
      "Account: Operating checking \x95 ending",
      "Customer: Elena Maren",
      "Period: 2026-10-21 to 2026-11-20 (UTC days)",
      "Statement ID: stmt_acc_HLB_A100_20261120",
      "Opening balance",
      "USD 9,705.42",
      "USD 12,845.00",
      "Fictional payroll deposit",
      "3,250.00",
      "-86.42",
      "Page 1 of 1",
      "FDX-shaped, not FDX-conformant or certified",
    ])
      expect(text).toContain(line);
    // No clock and no random ID anywhere in the file.
    const file = String.fromCharCode(...pdf);
    expect(file).not.toMatch(/CreationDate|ModDate|\/ID/);
    // A cycle without activity says so.
    const quiet = statementsFor(checking, elena.transactions, now)[1]!;
    expect(readPdf(statementPdf(quiet, checking, elena.name)).text).toContain(
      "No posted transactions in this period.",
    );
  });

  it("spreads long statements over pages, prints at most 100 transactions and says when it cut", () => {
    const long = synthetic(130);
    const { pages, text, size } = readPdf(
      statementPdf(long, checking, elena.name),
    );
    expect(pages).toBe(3);
    expect(text).toContain("Page 3 of 3");
    expect(text).toContain("(continued)");
    expect(text).toContain(
      `Showing the first ${MAX_STATEMENT_ROWS} of 130 posted transactions in this period.`,
    );
    expect(text).toContain("Fictional shop number 99 (test)");
    expect(text).not.toContain("Fictional shop number 100 (test)");
    // Bounded: a cut statement is as big as any statement gets.
    expect(size).toBeLessThan(32768);
    expect(
      statementPdf(synthetic(1000), checking, elena.name).byteLength,
    ).toBeLessThan(32768);
    // Every page carries the notice.
    expect(text.split(NO_REAL_ACCOUNT).length - 1).toBeGreaterThanOrEqual(3);
  });

  it("writes text as escaped WinAnsi and amounts from the digits", () => {
    expect(pdfString("a (b) \\ c")).toBe("(a \\(b\\) \\\\ c)");
    expect(pdfString("Café — ✓")).toBe("(Caf\\351 \\227 ?)");
    expect(pdfString("line\nbreak")).toBe("(line?break)");
    expect(amount(1284500)).toBe("12,845.00");
    expect(amount(-8642)).toBe("-86.42");
    expect(amount(5)).toBe("0.05");
    expect(amount(-123456789)).toBe("-1,234,567.89");
  });
});

import { it, expect, vi } from "vitest";
import {
  demoFdxAnswer,
  demoFdxRead,
  demoFdxReply,
  formatFdx,
} from "./demo-fdx";

const fdx = (accounts: unknown) => ({
  fdx_list_accounts: { execute: vi.fn(async () => accounts) },
  fdx_list_transactions: {
    execute: vi.fn(async (input?: Record<string, unknown>) => ({
      accountId: input?.accountId,
      transactions: [],
    })),
  },
});

it("reads balances and transactions through the FDX tools only when they exist (Use FDX on)", () => {
  const tools = fdx({ accounts: [] });
  expect(demoFdxRead("my account balances", tools)).toBe("balances");
  expect(demoFdxRead("¿Cuál es mi saldo?", tools)).toBe("balances");
  expect(demoFdxRead("my recent transactions", tools)).toBe("transactions");
  expect(demoFdxRead("últimos movimientos", tools)).toBe("transactions");
  expect(demoFdxRead("freeze my card", tools)).toBeUndefined();
  // Use FDX off: no FDX tools, the demo keeps its other rules.
  expect(demoFdxRead("my account balances", {})).toBeUndefined();
});

it("asks for balances, and reads each shared account's transactions by the id the bank gave", async () => {
  const tools = fdx({
    accounts: [{ accountId: "acc_HLB_A100" }, { accountId: "acc_HLB_A200" }],
  });
  await demoFdxAnswer("balances", tools);
  expect(tools.fdx_list_accounts.execute).toHaveBeenLastCalledWith({
    balances: true,
  });
  expect(await demoFdxAnswer("transactions", tools)).toEqual({
    accounts: [
      { accountId: "acc_HLB_A100", transactions: [] },
      { accountId: "acc_HLB_A200", transactions: [] },
    ],
  });
  expect(tools.fdx_list_accounts.execute).toHaveBeenLastCalledWith({});
});

it("passes an error answer on, with what to do next", async () => {
  const tools = fdx({ error: "sign_in_required" });
  const answer = await demoFdxAnswer("transactions", tools);
  expect(answer).toEqual({ error: "sign_in_required" });
  expect(tools.fdx_list_transactions.execute).not.toHaveBeenCalled();
  expect(demoFdxReply(answer, () => "error: sign_in_required")).toContain(
    "Sign in first",
  );
});

it("words FDX-shaped balances and transactions for the User, with the account's currency and direction", async () => {
  const account = {
    accountId: "acc_HLB_A100",
    productName: "Operating checking",
    accountNumberDisplay: "0479",
    accountType: "CHECKING",
    status: "OPEN",
    currency: { currencyCode: "USD" },
  };
  expect(
    formatFdx({
      accounts: [
        {
          ...account,
          currentBalance: 12845,
          availableBalance: 12800.5,
          balanceAsOf: "2026-11-25T13:55:00Z",
        },
      ],
    }),
  ).toBe(
    "- Operating checking ···0479 · checking · open\n  Balance $12,845.00 · available $12,800.50 · as of 2026-11-25 13:55 UTC",
  );
  const tools = {
    fdx_list_accounts: {
      execute: vi.fn(async () => ({ accounts: [account] })),
    },
    fdx_list_transactions: {
      execute: vi.fn(async () => ({
        accountId: "acc_HLB_A100",
        transactions: [
          {
            transactionId: "txn_1",
            transactionTimestamp: "2026-11-17T09:10:00Z",
            description: "Cloudline Software",
            amount: 24,
            debitCreditMemo: "DEBIT",
            status: "POSTED",
            category: "software",
          },
          {
            transactionId: "txn_2",
            transactionTimestamp: "2026-11-15T12:00:00Z",
            description: "Payroll",
            amount: 3250,
            debitCreditMemo: "CREDIT",
            status: "PENDING",
            category: "income",
          },
        ],
      })),
    },
  };
  expect(formatFdx(await demoFdxAnswer("transactions", tools))).toBe(
    [
      "Operating checking ···0479:",
      "  - 2026-11-17 09:10 · Cloudline Software · −$24.00 · posted · software",
      "  - 2026-11-15 12:00 · Payroll · $3,250.00 · pending · income",
    ].join("\n"),
  );
  // Balances left out (no fdx:ACCOUNT_DETAILED): no balance line.
  expect(formatFdx({ accounts: [account] })).toBe(
    "- Operating checking ···0479 · checking · open",
  );
  // Anything else is shown as it is by the caller.
  expect(formatFdx({ error: "fdx_error" })).toBeUndefined();
  expect(formatFdx({ something: 1 })).toBeUndefined();
});

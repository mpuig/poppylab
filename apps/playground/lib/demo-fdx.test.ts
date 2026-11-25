import { it, expect, vi } from "vitest";
import { demoFdxAnswer, demoFdxRead, demoFdxReply } from "./demo-fdx";

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

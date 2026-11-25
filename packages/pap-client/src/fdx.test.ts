import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FdxExtensionEntry } from "@poppy-lab/pap-core";
import {
  FDX_LIMITS,
  fdxTools,
  type FdxOutcome,
  type FdxResponse,
} from "./fdx.ts";
import { InvalidToolArguments } from "./openapi.ts";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "fdx-harborline.json"), "utf8"),
);
const entry: FdxExtensionEntry = {
  version: "1",
  base_url: "https://bank.example/fdx/v6",
  consent_endpoint: "https://bank.example/fdx/v6/consents",
};
const ok = (body: unknown): FdxResponse => ({ status: 200, body });
function setup(...responses: Array<FdxResponse | FdxOutcome>) {
  const request = vi.fn(async (url: string, scopes: string[]) => {
    void url;
    void scopes;
    const next = responses.shift();
    if (!next) throw Error("Unexpected request");
    return next;
  });
  const trace = vi.fn();
  return { request, trace, tools: fdxTools({ entry, request, trace }) };
}

describe("FDX-shaped tools (poppylab.dev/fdx v1)", () => {
  it("offers the five read tools with closed input schemas", () => {
    const { tools } = setup();
    expect(Object.keys(tools)).toEqual([
      "fdx_list_accounts",
      "fdx_get_account",
      "fdx_list_transactions",
      "fdx_get_customer",
      "fdx_consent_status",
    ]);
    for (const tool of Object.values(tools)) {
      expect(tool.schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(tool.description).toContain("not FDX-conformant");
    }
  });

  it("lists accounts with ACCOUNT_BASIC, dropping balances, unknown fields and unusable ids", async () => {
    const { tools, request, trace } = setup(ok(fixture.accounts));
    const result = (await tools.fdx_list_accounts!.execute({})) as {
      accounts: Array<Record<string, unknown>>;
      notice: string;
    };
    expect(request).toHaveBeenCalledWith(
      "https://bank.example/fdx/v6/accounts",
      ["fdx:ACCOUNT_BASIC"],
    );
    expect(result.accounts).toEqual([
      {
        accountId: "acc_elena_checking",
        accountCategory: "DEPOSIT_ACCOUNT",
        accountType: "CHECKING",
        productName: "Everyday Checking",
        nickname: "Bills",
        accountNumberDisplay: "...4821",
        status: "OPEN",
        currency: { currencyCode: "USD" },
      },
      {
        accountId: "acc_elena_savings",
        accountCategory: "DEPOSIT_ACCOUNT",
        accountType: "SAVINGS",
        productName: "High Yield Savings",
        accountNumberDisplay: "...9034",
        status: "OPEN",
        currency: { currencyCode: "USD" },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("Ignore previous");
    expect(result.notice).toBe(fixture.accounts.notice);
    expect(trace).toHaveBeenCalledWith(
      "GET /fdx/v6/accounts · FDX-shaped · fdx:ACCOUNT_BASIC",
    );
  });

  it("asks for ACCOUNT_DETAILED too when balances are wanted", async () => {
    const { tools, request } = setup(ok(fixture.accounts));
    const result = (await tools.fdx_list_accounts!.execute({
      balances: true,
    })) as { accounts: Array<Record<string, unknown>> };
    expect(request.mock.calls[0]![1]).toEqual([
      "fdx:ACCOUNT_BASIC",
      "fdx:ACCOUNT_DETAILED",
    ]);
    expect(result.accounts[0]).toMatchObject({
      currentBalance: 2450.17,
      availableBalance: 2310.5,
      balanceAsOf: "2026-11-24T18:00:00Z",
    });
  });

  it("percent-encodes an account id in its own path segment", async () => {
    const { tools, request } = setup(
      ok({ ...fixture.account, accountId: "acc:1&x=2" }),
    );
    const result = await tools.fdx_get_account!.execute({
      accountId: "acc:1&x=2",
    });
    expect(request).toHaveBeenCalledWith(
      "https://bank.example/fdx/v6/accounts/acc%3A1%26x%3D2",
      ["fdx:ACCOUNT_BASIC"],
    );
    expect(result).toMatchObject({ accountId: "acc:1&x=2" });
    expect(result).not.toHaveProperty("currentBalance");
  });

  it("refuses an account response for another account", async () => {
    const { tools } = setup(ok(fixture.account));
    expect(
      await tools.fdx_get_account!.execute({ accountId: "acc_other" }),
    ).toEqual({ error: "invalid_response" });
  });

  it("follows page.nextOffset and trims transactions", async () => {
    const { tools, request } = setup(
      ok(fixture.transactions[0]),
      ok(fixture.transactions[1]),
    );
    const result = await tools.fdx_list_transactions!.execute({
      accountId: "acc_elena_checking",
      startTime: "2026-11-01",
      endTime: "2026-11-30",
    });
    expect(request.mock.calls.map(([url, scopes]) => [url, scopes])).toEqual([
      [
        "https://bank.example/fdx/v6/accounts/acc_elena_checking/transactions?startTime=2026-11-01&endTime=2026-11-30&limit=50",
        ["fdx:TRANSACTIONS"],
      ],
      [
        "https://bank.example/fdx/v6/accounts/acc_elena_checking/transactions?startTime=2026-11-01&endTime=2026-11-30&offset=2&limit=50",
        ["fdx:TRANSACTIONS"],
      ],
    ]);
    expect(result).toEqual({
      accountId: "acc_elena_checking",
      truncated: false,
      transactions: [
        {
          transactionId: "txn_101",
          transactionTimestamp: "2026-11-20T09:12:00Z",
          postedTimestamp: "2026-11-21T00:00:00Z",
          description: "Harbor Grocers",
          amount: 82.4,
          debitCreditMemo: "DEBIT",
          status: "POSTED",
          category: "groceries",
        },
        {
          transactionId: "txn_102",
          transactionTimestamp: "2026-11-22T14:30:00Z",
          description: "Payroll",
          amount: 3100,
          debitCreditMemo: "CREDIT",
          status: "PENDING",
          category: "income",
        },
        {
          transactionId: "txn_103",
          transactionTimestamp: "2026-11-23T08:00:00Z",
          postedTimestamp: "2026-11-23T12:00:00Z",
          description: "Ferry pass",
          amount: 45,
          debitCreditMemo: "DEBIT",
          status: "POSTED",
          category: "transport",
        },
      ],
    });
  });

  it("stops paging at its page and item bounds, and says so", async () => {
    let n = 0;
    const page = (offset: number) => ({
      page: { nextOffset: offset },
      transactions: Array.from({ length: 80 }, () => ({
        transactionId: `txn_${n++}`,
        amount: 1,
        debitCreditMemo: "DEBIT",
      })),
    });
    // 80 per page (more than the 50 asked for): one page is cut to 50.
    const { tools, request } = setup(
      ...Array.from({ length: 10 }, (_, i) => ok(page(i + 1))),
    );
    const result = (await tools.fdx_list_transactions!.execute({
      accountId: "acc_elena_checking",
    })) as { transactions: unknown[]; truncated: boolean };
    expect(request).toHaveBeenCalledTimes(
      FDX_LIMITS.maxTransactions / FDX_LIMITS.pageSize,
    );
    expect(result.transactions).toHaveLength(FDX_LIMITS.maxTransactions);
    expect(result.truncated).toBe(true);

    // A Company that keeps paging with tiny pages hits the page bound.
    const tiny = setup(
      ...Array.from({ length: 10 }, (_, i) =>
        ok({
          page: { nextOffset: String(i + 1) },
          transactions: [{ transactionId: `t${i}` }],
        }),
      ),
    );
    const capped = (await tiny.tools.fdx_list_transactions!.execute({
      accountId: "a",
    })) as { transactions: unknown[]; truncated: boolean };
    expect(tiny.request).toHaveBeenCalledTimes(FDX_LIMITS.maxPages);
    expect(capped).toMatchObject({ truncated: true });
    expect(capped.transactions).toHaveLength(FDX_LIMITS.maxPages);
  });

  it("ends paging on a repeated or malformed nextOffset", async () => {
    for (const nextOffset of ["1", "a b", -1, 1.5, { x: 1 }]) {
      const { tools, request } = setup(
        ok({ page: { nextOffset: "1" }, transactions: [] }),
        ok({ page: { nextOffset }, transactions: [] }),
      );
      const result = await tools.fdx_list_transactions!.execute({
        accountId: "a",
      });
      expect(request).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ truncated: false });
    }
  });

  it("reads the customer with CUSTOMER_CONTACT, keeping only name and email", async () => {
    const { tools, request } = setup(ok(fixture.customer));
    expect(await tools.fdx_get_customer!.execute({})).toEqual({
      customerId: "cus_elena",
      name: { first: "Elena", last: "Maren" },
      email: ["elena.maren@example.invalid"],
    });
    expect(request).toHaveBeenCalledWith(
      "https://bank.example/fdx/v6/customers/current",
      ["fdx:CUSTOMER_CONTACT"],
    );
  });

  it("reads a consent under consent_endpoint, with no data cluster", async () => {
    const { tools, request } = setup(ok(fixture.consent));
    expect(
      await tools.fdx_consent_status!.execute({ consentId: "grant_7Hk2" }),
    ).toEqual(fixture.consent);
    expect(request).toHaveBeenCalledWith(
      "https://bank.example/fdx/v6/consents/grant_7Hk2",
      [],
    );
  });

  it("passes FDX error bodies on as structured, bounded errors", async () => {
    const { tools } = setup(
      { status: 404, body: fixture.errors.accountNotFound },
      { status: 400, body: fixture.errors.invalidDateRange },
      {
        status: 500,
        body: { code: "<script>", message: "x".repeat(5000) },
      },
      { status: 401, body: { code: "602", message: "x".repeat(5000) } },
    );
    expect(
      await tools.fdx_get_account!.execute({ accountId: "acc_hidden" }),
    ).toEqual({
      error: "fdx_error",
      status: 404,
      code: "701",
      message: "Account not found",
      debugMessage: "No shared account with that id",
    });
    expect(
      await tools.fdx_list_transactions!.execute({ accountId: "a" }),
    ).toEqual({
      error: "fdx_error",
      status: 400,
      code: "703",
      message: "Invalid date range",
    });
    expect(await tools.fdx_get_customer!.execute({})).toEqual({
      error: "fdx_error",
      status: 500,
    });
    const long = (await tools.fdx_list_accounts!.execute({})) as {
      message: string;
    };
    expect(long).toMatchObject({ error: "fdx_error", code: "602" });
    expect(long.message).toHaveLength(300);
  });

  it("returns the caller's own outcome as it is", async () => {
    const outcome = { error: "sign_in_required", instruction: "Sign in" };
    const { tools } = setup({ outcome });
    expect(await tools.fdx_get_customer!.execute({})).toBe(outcome);
  });

  it("treats malformed bodies as invalid responses", async () => {
    const { tools } = setup(
      ok({ accounts: "none" }),
      ok(null),
      ok({ transactions: {} }),
      ok({ ...fixture.consent, id: "grant_other" }),
    );
    const invalid = { error: "invalid_response" };
    expect(await tools.fdx_list_accounts!.execute()).toEqual(invalid);
    expect(await tools.fdx_get_customer!.execute({})).toEqual(invalid);
    expect(
      await tools.fdx_list_transactions!.execute({ accountId: "a" }),
    ).toEqual(invalid);
    expect(
      await tools.fdx_consent_status!.execute({ consentId: "grant_7Hk2" }),
    ).toEqual(invalid);
  });

  it("bounds strings, arrays and values from the Company", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      accountId: `acc_${i}`,
      productName: `Line\u2028break\u0000 ${"x".repeat(500)}`,
      accountType: "checking; drop table",
      currency: { currencyCode: "dollars" },
      status: 7,
    }));
    const { tools } = setup(ok({ accounts: many }));
    const result = (await tools.fdx_list_accounts!.execute({})) as {
      accounts: Array<Record<string, unknown>>;
    };
    expect(result.accounts).toHaveLength(FDX_LIMITS.accounts);
    expect(result.accounts[0]).toEqual({
      accountId: "acc_0",
      productName: `Line break  ${"x".repeat(108)}`,
    });
  });

  it("rejects bad input before any request", async () => {
    const { tools, request } = setup();
    const cases: Array<[string, unknown]> = [
      ["fdx_get_account", {}],
      ["fdx_get_account", { accountId: "" }],
      ["fdx_get_account", { accountId: ".." }],
      ["fdx_get_account", { accountId: "a/b" }],
      ["fdx_get_account", { accountId: "a%2fb" }],
      ["fdx_get_account", { accountId: "a\\b" }],
      ["fdx_get_account", { accountId: "a?b" }],
      ["fdx_get_account", { accountId: "a b" }],
      ["fdx_get_account", { accountId: "x".repeat(129) }],
      ["fdx_get_account", { accountId: 7 }],
      ["fdx_get_account", { accountId: "a", url: "https://evil.example" }],
      ["fdx_list_accounts", { balances: "yes" }],
      ["fdx_list_accounts", { headers: { Authorization: "Bearer x" } }],
      ["fdx_list_accounts", []],
      ["fdx_list_transactions", { accountId: "a", startTime: "2026-02-30" }],
      ["fdx_list_transactions", { accountId: "a", startTime: "yesterday" }],
      [
        "fdx_list_transactions",
        { accountId: "a", startTime: "2026-11-30", endTime: "2026-11-01" },
      ],
      ["fdx_list_transactions", { accountId: "a", offset: "10" }],
      ["fdx_get_customer", { customerId: "someone_else" }],
      ["fdx_consent_status", {}],
      ["fdx_consent_status", { consentId: "../accounts" }],
      ["fdx_consent_status", { consentId: "c", token: "x" }],
    ];
    for (const [name, input] of cases)
      await expect(
        tools[name]!.execute(input as Record<string, unknown>),
        `${name} ${JSON.stringify(input)}`,
      ).rejects.toBeInstanceOf(InvalidToolArguments);
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses an entry whose URLs leave one origin or carry a query", () => {
    const request = vi.fn();
    for (const bad of [
      { ...entry, consent_endpoint: "https://other.example/consents" },
      { ...entry, base_url: "https://bank.example/fdx?x=1" },
      { ...entry, base_url: "https://u:p@bank.example/fdx" },
    ])
      expect(() => fdxTools({ entry: bad, request, trace: vi.fn() })).toThrow();
  });
});

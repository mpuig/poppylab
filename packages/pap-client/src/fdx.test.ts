import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FdxExtensionEntry } from "@poppy-lab/pap-core";
import {
  FDX_LIMITS,
  fdxStatementPdf,
  fdxTools,
  type FdxDocument,
  type FdxOutcome,
  type FdxRequestOptions,
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
function setup(...responses: Array<FdxResponse | FdxDocument | FdxOutcome>) {
  const request = vi.fn(
    async (url: string, scopes: string[], options?: FdxRequestOptions) => {
      void url;
      void scopes;
      void options;
      const next = responses.shift();
      if (!next) throw Error("Unexpected request");
      return next;
    },
  );
  const trace = vi.fn();
  return { request, trace, tools: fdxTools({ entry, request, trace }) };
}

describe("FDX-shaped tools (poppylab.dev/fdx v1)", () => {
  it("offers the seven read tools with closed input schemas", () => {
    const { tools } = setup();
    expect(Object.keys(tools)).toEqual([
      "fdx_list_accounts",
      "fdx_get_account",
      "fdx_list_transactions",
      "fdx_list_statements",
      "fdx_get_statement",
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
      note: string;
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
        accountNumberDisplay: "4821",
        status: "OPEN",
        currency: { currencyCode: "USD" },
      },
      {
        accountId: "acc_elena_savings",
        accountCategory: "DEPOSIT_ACCOUNT",
        accountType: "SAVINGS",
        productName: "High Yield Savings",
        accountNumberDisplay: "9034",
        status: "OPEN",
        currency: { currencyCode: "USD" },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("Ignore previous");
    expect(result.note).toBe(fixture.accounts.note);
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
    expect(result).toMatchObject({
      accountId: "acc:1&x=2",
      accountNumberDisplay: "4821",
      note: fixture.account.note,
    });
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
      totalElements: 3,
      note: fixture.transactions[0].note,
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
    for (const nextOffset of ["1", "a b", "2a", "-2", -1, 1.5, { x: 1 }]) {
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
      note: fixture.customer.note,
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

  it("reads the caller's own consent when it keeps the id, so the model needn't name one", async () => {
    let known: string | undefined = "grant_7Hk2";
    const request = vi.fn(async (): Promise<FdxResponse> =>
      ok(fixture.consent),
    );
    const tools = fdxTools({
      entry,
      request,
      trace: vi.fn(),
      consentId: () => known,
    });
    expect(tools.fdx_consent_status!.schema.required ?? []).toEqual([]);
    expect(await tools.fdx_consent_status!.execute({})).toEqual(
      fixture.consent,
    );
    expect(request).toHaveBeenLastCalledWith(
      "https://bank.example/fdx/v6/consents/grant_7Hk2",
      [],
    );
    // An id the model names still goes through the same checks.
    await expect(
      tools.fdx_consent_status!.execute({ consentId: "../accounts" }),
    ).rejects.toBeInstanceOf(InvalidToolArguments);
    // A base64url id may start with - or _ (a Poppy grant ID often does).
    for (const id of ["-Hk2_a", "_Hk2-a"]) {
      known = id;
      await tools.fdx_consent_status!.execute({});
      expect(request).toHaveBeenLastCalledWith(
        `https://bank.example/fdx/v6/consents/${id}`,
        [],
      );
    }
    // None kept, or one that couldn't be a path segment: nothing is sent.
    for (const value of [undefined, "../x", ".", ".."]) {
      known = value;
      expect(await tools.fdx_consent_status!.execute({})).toMatchObject({
        error: "consent_unknown",
      });
    }
    // The two base64url ids above, besides the first read.
    expect(request).toHaveBeenCalledTimes(3);
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
      ["fdx_list_statements", {}],
      ["fdx_list_statements", { accountId: "a", startTime: "2026-13-01" }],
      [
        "fdx_list_statements",
        { accountId: "a", startTime: "2026-11-30", endTime: "2026-11-01" },
      ],
      ["fdx_get_statement", { accountId: "a" }],
      ["fdx_get_statement", { accountId: "a", statementId: "../x" }],
      ["fdx_get_statement", { accountId: "a", statementId: "s?x=1" }],
      ["fdx_get_statement", { accountId: "a/b", statementId: "s" }],
      [
        "fdx_get_statement",
        { accountId: "a", statementId: "s", accept: "text/html" },
      ],
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

  it("lists statements with fdx:STATEMENTS, keeping known fields of this account's statements only", async () => {
    const { tools, request, trace } = setup(ok(fixture.statements));
    const result = await tools.fdx_list_statements!.execute({
      accountId: "acc_elena_checking",
      startTime: "2026-09-01",
    });
    expect(request).toHaveBeenCalledWith(
      "https://bank.example/fdx/v6/accounts/acc_elena_checking/statements?startTime=2026-09-01&limit=50",
      ["fdx:STATEMENTS"],
    );
    expect(trace).toHaveBeenCalledWith(
      "GET /fdx/v6/accounts/acc_elena_checking/statements?startTime=2026-09-01&limit=50 · FDX-shaped · fdx:STATEMENTS",
    );
    expect(result).toEqual({
      accountId: "acc_elena_checking",
      statements: [
        {
          statementId: "stmt_elena_checking_20261120",
          accountId: "acc_elena_checking",
          statementDate: "2026-11-20",
          description: "Monthly statement, 2026-10-21 to 2026-11-20",
          status: "AVAILABLE",
          startDate: "2026-10-21",
          endDate: "2026-11-20",
        },
        // An impossible date is dropped, the statement kept.
        {
          statementId: "stmt_elena_checking_20261020",
          accountId: "acc_elena_checking",
          status: "AVAILABLE",
        },
      ],
      truncated: false,
      totalElements: 4,
      note: fixture.statements.note,
    });
    expect(JSON.stringify(result)).not.toContain("evil.example");
  });

  it("pages statements as it pages transactions, within its bounds", async () => {
    const item = (n: number) => ({
      statementId: `stmt_${n}`,
      statementDate: "2026-11-20",
    });
    const pages = Array.from({ length: FDX_LIMITS.maxPages + 1 }, (_, p) =>
      ok({
        statements: Array.from({ length: FDX_LIMITS.pageSize }, (_, i) =>
          item(p * FDX_LIMITS.pageSize + i),
        ),
        page: { nextOffset: String((p + 1) * FDX_LIMITS.pageSize) },
      }),
    );
    const { tools, request } = setup(...pages);
    const result = (await tools.fdx_list_statements!.execute({
      accountId: "a",
    })) as { statements: unknown[]; truncated: boolean };
    expect(result.statements).toHaveLength(FDX_LIMITS.maxStatements);
    expect(result.truncated).toBe(true);
    // A full first page is all one call keeps: no second request.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("checks a statement is a bounded PDF and gives the model only its size and hash", async () => {
    const pdf = new Uint8Array(
      Buffer.from("%PDF-1.4\n%\xe2\xe3\n1 0 obj\n", "latin1"),
    );
    const document = (
      bytes: Uint8Array,
      contentType = "application/pdf",
    ): FdxDocument => ({ status: 200, contentType, bytes });
    const { tools, request, trace } = setup(document(pdf));
    const result = await tools.fdx_get_statement!.execute({
      accountId: "acc_elena_checking",
      statementId: "stmt_elena_checking_20261120",
    });
    expect(request).toHaveBeenCalledWith(
      "https://bank.example/fdx/v6/accounts/acc_elena_checking/statements/stmt_elena_checking_20261120",
      ["fdx:STATEMENTS"],
      { accept: "application/pdf", maxBytes: FDX_LIMITS.statementBytes },
    );
    expect(trace).toHaveBeenCalledWith(
      "GET /fdx/v6/accounts/acc_elena_checking/statements/stmt_elena_checking_20261120 · FDX-shaped · fdx:STATEMENTS · application/pdf",
    );
    expect(result).toEqual({
      statementId: "stmt_elena_checking_20261120",
      accountId: "acc_elena_checking",
      contentType: "application/pdf",
      bytes: pdf.byteLength,
      sha256: createHash("sha256").update(pdf).digest("hex"),
    });
    // Not PDF magic, another type, too big, too small or JSON: invalid.
    const big = new Uint8Array(FDX_LIMITS.statementBytes + 1);
    big.set(pdf);
    const bad = setup(
      document(new Uint8Array(Buffer.from("<html><body>%PDF-</body>"))),
      document(pdf, "text/html"),
      document(big),
      document(pdf.slice(0, 8)),
      ok({ statementId: "stmt_1" }),
      { status: 204, body: null },
      // A transport that lost the document's shape.
      { status: 200, contentType: undefined, bytes: "%PDF-1.4" } as never,
    );
    for (let i = 0; i < 7; i++)
      expect(
        await bad.tools.fdx_get_statement!.execute({
          accountId: "a",
          statementId: "s",
        }),
      ).toEqual({ error: "invalid_response" });
    // Parameters of the type are fine.
    const typed = setup(document(pdf, "Application/PDF; qs=1"));
    expect(
      await typed.tools.fdx_get_statement!.execute({
        accountId: "a",
        statementId: "s",
      }),
    ).toMatchObject({ contentType: "application/pdf" });
  });

  it("passes statement errors and outcomes through, and hands the bytes only to its own caller", async () => {
    const outcome = { error: "sign_in_required", instruction: "Sign in" };
    const { tools } = setup(
      { status: 404, body: fixture.errors.statementNotFound },
      {
        status: 406,
        body: { code: "not_acceptable", message: "Not acceptable" },
      },
      { outcome },
    );
    const input = { accountId: "a", statementId: "s" };
    expect(await tools.fdx_get_statement!.execute(input)).toEqual({
      error: "fdx_error",
      status: 404,
      code: "statement_not_found",
      message: "Statement not found",
    });
    expect(await tools.fdx_get_statement!.execute(input)).toMatchObject({
      error: "fdx_error",
      status: 406,
      code: "not_acceptable",
    });
    expect(await tools.fdx_get_statement!.execute(input)).toBe(outcome);
    // The runtime's own download: the same checks, and the bytes.
    const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n".repeat(4)));
    const own = setup({
      status: 200,
      contentType: "application/pdf",
      bytes: pdf,
    });
    const read = await fdxStatementPdf(
      { entry, request: own.request, trace: own.trace },
      "a",
      "s",
    );
    expect(read.pdf).toBe(pdf);
    expect(read.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      fdxStatementPdf(
        { entry, request: own.request, trace: own.trace },
        "a",
        "../s",
      ),
    ).rejects.toBeInstanceOf(InvalidToolArguments);
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

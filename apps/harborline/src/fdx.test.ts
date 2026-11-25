/**
 * Harborline's FDX-shaped API (`poppylab.dev/fdx` v1): discovery, the
 * extension requirement (§3.3), scopes per data cluster, the accounts chosen
 * at consent, pagination and dates, statements and their PDF, the consent
 * API and revocation both ways, and parity with Harborline's own API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FICTION_NOTICE } from "./data.ts";
import { decimal } from "./fdx.ts";
import { fdxScopes, scopes } from "./scopes.ts";
import { inject, origin, readPdf, setup } from "./test-harness.ts";

const BOTH = '"operations";v="3", "poppylab.dev/fdx";v="1"';
const declared = { "Poppy-Extensions": BOTH };
const fdx = [...fdxScopes];
type Harness = Awaited<ReturnType<typeof setup>>;
/**
 * Statements depend on the day: from here on it is 25 November 2026, when
 * the cycles ending 20 September, October and November have closed.
 */
const onStatementDay = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T12:00:00.000Z"));
};

/** A GET or PUT that declares the FDX extension. */
const fdxCall =
  (h: Harness, user = "usr_harborline") =>
  (
    access: string,
    url: string,
    method: "GET" | "PUT" = "GET",
    payload?: Record<string, unknown>,
  ) =>
    h.call(access, method, url, payload, undefined, user, declared);

/** The customer portal, signed in as `account`. */
async function portal(account: "elena" | "robin") {
  const login = await inject("/site/login");
  const loginCookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const signed = await inject({
    method: "POST",
    url: "/site/login",
    headers: { cookie: loginCookie, origin },
    payload: { account },
  });
  return String(signed.headers["set-cookie"])
    .split(",")
    .find((value) => value.includes("harborline_web="))!
    .trim()
    .split(";")[0]!;
}

describe("Harborline FDX-shaped API", () => {
  let h: Harness;
  let get: ReturnType<typeof fdxCall>;
  beforeEach(async () => {
    h = await setup();
    get = fdxCall(h);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the extension, the FDX-shaped OpenAPI and its scopes in discovery, signed out", async () => {
    const discovery = (await inject("/.well-known/poppy.json")).json();
    expect(discovery.extensions).toEqual({
      operations: [{ version: "3" }],
      "poppylab.dev/fdx": [
        {
          version: "1",
          fdx_version: "6.4",
          base_url: `${origin}/fdx/v6`,
          resources: ["customer", "accounts", "transactions", "statements"],
          consent_endpoint: `${origin}/fdx/v6/consents`,
        },
      ],
    });
    expect(discovery.apis).toHaveLength(2);
    expect(discovery.apis[0].url).toBe(`${origin}/openapi.json`);
    expect(discovery.apis[1]).toMatchObject({
      type: "openapi",
      url: `${origin}/openapi/fdx.json`,
    });
    expect(discovery.apis[1].description).toContain(
      "Not FDX-conformant or certified",
    );
    expect(Object.keys(discovery.auth.scopes)).toEqual([...scopes]);
    for (const scope of fdx)
      expect(discovery.auth.scope_hints[scope]).toEqual({
        changes: "none",
        personal_data: true,
      });
    const openapi = await inject("/openapi/fdx.json");
    expect(openapi.statusCode).toBe(200);
    const document = openapi.json();
    expect(document.info.description).toContain("not FDX-conformant");
    expect(document.info.description).toContain(FICTION_NOTICE);
    expect(
      document.paths["/fdx/v6/accounts/{accountId}/transactions"].get[
        "x-poppy-scopes"
      ],
    ).toEqual(["fdx:TRANSACTIONS"]);
    expect(
      document.paths["/fdx/v6/consents/{consentId}/revocation"].put,
    ).toMatchObject({ operationId: "fdx_revoke_consent" });
    for (const path of [
      "/fdx/v6/accounts/{accountId}/statements",
      "/fdx/v6/accounts/{accountId}/statements/{statementId}",
    ])
      expect(document.paths[path].get["x-poppy-scopes"]).toEqual([
        "fdx:STATEMENTS",
      ]);
    expect(
      Object.keys(
        document.paths["/fdx/v6/accounts/{accountId}/statements/{statementId}"]
          .get.responses["200"].content,
      ),
    ).toEqual(["application/pdf"]);
    // Statements are served now; tax documents stay out of the protocol.
    const tasks = (await inject("/poppy/tasks")).json();
    const excluded = tasks.excluded_tasks.map(
      (item: { task: string }) => item.task,
    );
    expect(excluded).toContain("Export tax documents");
    expect(excluded.join(" ")).not.toMatch(/statement/i);
  });

  it("refuses FDX routes without the declaration, before the token, and verifies the Session there", async () => {
    const token = await h.sign("elena", fdx);
    for (const extensions of [
      '"operations";v="3"',
      '"poppylab.dev/fdx";v="2"',
    ]) {
      const r = await h.call(
        token.access_token,
        "GET",
        "/fdx/v6/accounts",
        undefined,
        undefined,
        "usr_harborline",
        { "Poppy-Extensions": extensions },
      );
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({
        error: "extension_required",
        extension: "poppylab.dev/fdx",
      });
      expect(r.headers["www-authenticate"]).toBeUndefined();
    }
    // No Session header: a Poppy error, not an FDX one (§5.3).
    const bare = await inject("/fdx/v6/accounts");
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toEqual({ error: "invalid_session" });
    // Signed out: the gateway's token challenge, with the cluster's scope.
    const signedOut = await get("", "/fdx/v6/accounts");
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.headers["www-authenticate"]).toBe(
      'DPoP scope="fdx:ACCOUNT_BASIC"',
    );
  });

  it("answers per data cluster, with balances only alongside fdx:ACCOUNT_DETAILED", async () => {
    const basic = await h.sign("elena", ["fdx:ACCOUNT_BASIC"]);
    const listed = await get(basic.access_token, "/fdx/v6/accounts");
    expect(listed.statusCode).toBe(200);
    expect(listed.json().note).toBe(FICTION_NOTICE);
    const [checking] = listed.json().accounts;
    expect(checking).toEqual({
      accountId: "acc_HLB_A100",
      accountCategory: "DEPOSIT_ACCOUNT",
      accountType: "CHECKING",
      productName: "Operating checking",
      nickname: "Operating checking",
      accountNumberDisplay: expect.stringMatching(/^\d{4}$/),
      status: "OPEN",
      currency: { currencyCode: "USD" },
    });
    expect(listed.json().accounts[1]).toMatchObject({ accountType: "SAVINGS" });
    for (const [url, scope] of [
      ["/fdx/v6/accounts/acc_HLB_A100/transactions", "fdx:TRANSACTIONS"],
      ["/fdx/v6/customers/current", "fdx:CUSTOMER_CONTACT"],
    ] as const) {
      const refused = await get(basic.access_token, url);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toEqual({ error: "insufficient_scope" });
      expect(refused.headers["www-authenticate"]).toContain(`scope="${scope}"`);
    }

    const detailed = await h.sign("elena", [
      "fdx:ACCOUNT_BASIC",
      "fdx:ACCOUNT_DETAILED",
    ]);
    const account = (
      await get(detailed.access_token, "/fdx/v6/accounts/acc_HLB_A100")
    ).json();
    expect(account).toMatchObject({
      accountId: "acc_HLB_A100",
      currentBalance: 12845,
      availableBalance: 12845,
      balanceAsOf: expect.any(String),
      note: FICTION_NOTICE,
    });
    // A token refreshed without the cluster loses the balances.
    const narrowed = await h.token({
      grant_type: "refresh_token",
      refresh_token: detailed.refresh_token,
      scope: "fdx:ACCOUNT_BASIC",
    });
    const again = (
      await get(narrowed.access_token, "/fdx/v6/accounts/acc_HLB_A100")
    ).json();
    expect(again).not.toHaveProperty("currentBalance");

    const customer = await h.sign("robin", ["fdx:CUSTOMER_CONTACT"]);
    expect(
      (await get(customer.access_token, "/fdx/v6/customers/current")).json(),
    ).toEqual({
      customerId: "robin",
      name: { first: "Robin", last: "Ito" },
      email: ["robin.ito@example.invalid"],
      note: FICTION_NOTICE,
    });
  });

  it("converts cents to exact decimal amounts", () => {
    expect(decimal(1284500)).toBe(12845);
    expect(decimal(-9230)).toBe(-92.3);
    expect(decimal(1)).toBe(0.01);
    expect(decimal(-7)).toBe(-0.07);
    expect(decimal(10)).toBe(0.1);
    expect(decimal(123456789)).toBe(1234567.89);
    expect(() => decimal(0.5)).toThrow();
  });

  it("shows only the accounts chosen at consent, and answers 701 for the rest whether or not they exist", async () => {
    const token = await h.sign("elena", fdx, {
      fdxAccounts: ["acc_HLB_A200"],
    });
    const listed = (await get(token.access_token, "/fdx/v6/accounts")).json();
    expect(
      listed.accounts.map((item: { accountId: string }) => item.accountId),
    ).toEqual(["acc_HLB_A200"]);
    for (const id of ["acc_HLB_A100", "acc_HLB_J100", "acc_nope"])
      for (const url of [
        `/fdx/v6/accounts/${id}`,
        `/fdx/v6/accounts/${id}/transactions`,
      ]) {
        const r = await get(token.access_token, url);
        expect(r.statusCode).toBe(404);
        expect(r.json()).toEqual({
          code: "701",
          message: "Account not found",
          note: FICTION_NOTICE,
        });
      }
    // Harborline's own API needs its own scopes, and is limited by the same
    // choice (see account-choice.test.ts).
    const own = await h.call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(own.statusCode).toBe(403);
    const both = await h.sign("elena", ["accounts:read", ...fdx], {
      fdxAccounts: ["acc_HLB_A200"],
    });
    expect(
      (await h.call(both.access_token, "GET", "/api/account/accounts"))
        .json()
        .accounts.map((item: { id: string }) => item.id),
    ).toEqual(["acc_HLB_A200"]);
  });

  it("keeps only the chosen persona's accounts, and turns down an FDX consent with none", async () => {
    // Robin's account ticked while approving as Elena: ignored.
    const mixed = await h.sign("elena", fdx, {
      fdxAccounts: ["acc_HLB_J100", "acc_HLB_A100"],
    });
    const listed = (await get(mixed.access_token, "/fdx/v6/accounts")).json();
    expect(
      listed.accounts.map((item: { accountId: string }) => item.accountId),
    ).toEqual(["acc_HLB_A100"]);
    for (const fdxAccounts of [[], ["acc_HLB_J100"]]) {
      const { consent } = await h.authorize("elena", fdx, { fdxAccounts });
      expect(consent.statusCode).toBe(400);
      expect(consent.json()).toEqual({
        error: "invalid_request",
        error_description: expect.stringContaining(
          "Choose at least one account",
        ),
      });
    }
    // Without FDX scopes, no account choice is needed.
    const plain = await h.authorize("elena", ["accounts:read"], {
      fdxAccounts: [],
    });
    expect(plain.consent.statusCode).toBe(302);
  });

  it("shows an account choice per persona on the consent page only for FDX scopes, without scripts", async () => {
    const { page } = await h.authorize("elena", ["accounts:read", ...fdx]);
    expect(page.body).toContain("Accounts for the FDX-shaped API");
    // The choice limits the whole grant, and the page says so.
    expect(page.body).toContain(
      "The accounts you choose are the only ones the agent can see or act on, through Harborline's own API or the FDX-shaped one.",
    );
    expect(page.body).not.toContain("not limited by this choice");
    for (const id of [
      "acc_HLB_A100",
      "acc_HLB_A200",
      "acc_HLB_J100",
      "acc_HLB_J200",
    ])
      expect(page.body).toContain(`name="fdx_account_${id}" value="yes"`);
    expect(page.body).toContain('data-persona="robin"');
    expect(page.body).toContain(
      'form:has(#account option[value="elena"]:checked) .fdx-persona[data-persona="elena"]{display:block}',
    );
    expect(page.body).not.toContain("<script");
    expect(page.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(page.headers["content-security-policy"]).not.toContain("script-src");
    const plain = await h.authorize("elena", ["accounts:read"]);
    expect(plain.page.body).not.toContain("fdx_account_");
  });

  it("pages through transactions newest first, with bounded limits and date ranges", async () => {
    const token = await h.sign("elena", fdx);
    const url = "/fdx/v6/accounts/acc_HLB_A100/transactions";
    const all = (await get(token.access_token, url)).json();
    expect(all.page).toEqual({ totalElements: 3 });
    expect(all.note).toBe(FICTION_NOTICE);
    expect(all.transactions[0]).toEqual({
      transactionId: "txn_HLB_A301",
      accountId: "acc_HLB_A100",
      description: "North Pier Grocer",
      amount: 86.42,
      debitCreditMemo: "DEBIT",
      status: "POSTED",
      transactionTimestamp: "2026-11-18T15:42:00.000Z",
      postedTimestamp: "2026-11-18T15:42:00.000Z",
      category: "groceries",
    });
    expect(all.transactions[2]).toMatchObject({
      transactionId: "txn_HLB_A303",
      amount: 3250,
      debitCreditMemo: "CREDIT",
    });
    const first = (await get(token.access_token, `${url}?limit=2`)).json();
    expect(first.page).toEqual({ nextOffset: "2", totalElements: 3 });
    expect(first.transactions).toHaveLength(2);
    const second = (
      await get(token.access_token, `${url}?offset=2&limit=2`)
    ).json();
    expect(second.page).toEqual({ totalElements: 3 });
    expect(
      second.transactions.map(
        (t: { transactionId: string }) => t.transactionId,
      ),
    ).toEqual(["txn_HLB_A303"]);
    // A larger limit is capped at 100, never refused.
    expect(
      (await get(token.access_token, `${url}?limit=5000`)).statusCode,
    ).toBe(200);
    for (const query of ["limit=0", "offset=-1", "limit=two"]) {
      const bad = await get(token.access_token, `${url}?${query}`);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe("invalid_parameter");
    }
    const range = (
      await get(
        token.access_token,
        `${url}?startTime=2026-11-17&endTime=2026-11-17`,
      )
    ).json();
    expect(
      range.transactions.map((t: { transactionId: string }) => t.transactionId),
    ).toEqual(["txn_HLB_A302"]);
    for (const query of [
      "startTime=2026-11-18&endTime=2026-11-01",
      "startTime=2026-02-30",
      "endTime=yesterday",
    ]) {
      const bad = await get(token.access_token, `${url}?${query}`);
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({
        code: "703",
        message: "Invalid date range",
        debugMessage: expect.any(String),
      });
    }
    // A pending transaction has no posted time.
    const robin = await h.sign("robin", fdx);
    const pending = (
      await fdxCall(h, "usr_robin")(
        robin.access_token,
        "/fdx/v6/accounts/acc_HLB_J100/transactions",
      )
    ).json().transactions;
    const electric = pending.find(
      (t: { transactionId: string }) => t.transactionId === "txn_HLB_J302",
    );
    expect(electric).toMatchObject({ status: "PENDING", amount: 92.3 });
    expect(electric).not.toHaveProperty("postedTimestamp");
  });

  it("returns consent_id at sign-in and refresh, and the consent record to its own tokens only", async () => {
    const token = await h.sign("elena", [...fdx, "offline_access"], {
      allowOffline: true,
      fdxAccounts: ["acc_HLB_A100"],
    });
    expect(token.consent_id).toEqual(expect.any(String));
    const refreshed = await h.token({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    expect(refreshed.consent_id).toBe(token.consent_id);
    const record = await get(
      token.access_token,
      `/fdx/v6/consents/${token.consent_id}`,
    );
    expect(record.statusCode).toBe(200);
    expect(record.json()).toEqual({
      id: token.consent_id,
      status: "ACTIVE",
      parties: [
        { name: "Harborline Bank", type: "DATA_PROVIDER" },
        { name: "localhost:3000", type: "DATA_RECIPIENT" },
      ],
      createdTime: expect.any(String),
      expirationTime: expect.any(String),
      durationType: "TIME_BOUND",
      durationPeriod: 7,
      resources: [
        {
          resourceType: "ACCOUNT",
          resourceId: "acc_HLB_A100",
          dataClusters: [
            "ACCOUNT_BASIC",
            "ACCOUNT_DETAILED",
            "TRANSACTIONS",
            "STATEMENTS",
          ],
        },
      ],
      note: FICTION_NOTICE,
    });
    const once = await h.sign("elena", ["fdx:ACCOUNT_BASIC"]);
    const onceRecord = (
      await get(once.access_token, `/fdx/v6/consents/${once.consent_id}`)
    ).json();
    expect(onceRecord.durationType).toBe("ONE_TIME");
    expect(onceRecord).not.toHaveProperty("durationPeriod");
    // Another grant's consent, even the same User's: not found.
    const other = await get(
      once.access_token,
      `/fdx/v6/consents/${token.consent_id}`,
    );
    expect(other.statusCode).toBe(404);
    expect(other.json()).toMatchObject({ code: "consent_not_found" });
    // Harborline's own scopes alone carry no consent_id.
    const own = await h.sign("elena", ["accounts:read"]);
    expect(own).not.toHaveProperty("consent_id");
  });

  it("revokes the Poppy grant through the FDX consent API", async () => {
    const token = await h.sign("elena", ["accounts:read", ...fdx]);
    const path = `/fdx/v6/consents/${token.consent_id}/revocation`;
    const invalid = await get(token.access_token, path, "PUT", {
      reason: "because",
    });
    expect(invalid.statusCode).toBe(400);
    const revoked = await get(token.access_token, path, "PUT", {
      reason: "USER_ACTION",
      initiator: "INDIVIDUAL",
    });
    expect(revoked.statusCode).toBe(204);
    for (const url of [
      "/fdx/v6/accounts",
      `/fdx/v6/consents/${token.consent_id}`,
    ]) {
      const after = await get(token.access_token, url);
      expect(after.statusCode).toBe(401);
      expect(after.headers["www-authenticate"]).toContain("invalid_token");
    }
    // The same grant: Harborline's own API stops too, and so does refresh.
    const own = await h.call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(own.statusCode).toBe(401);
    const refresh = await h.token({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    expect(refresh.error).toBe("invalid_grant");
  });

  it("ends FDX access when the customer disconnects the agent in the portal", async () => {
    const token = await h.sign("elena", fdx);
    const cookie = await portal("elena");
    const access = (
      await inject({ url: "/site/access", headers: { cookie } })
    ).json();
    const grant = access.grants.find(
      (item: { id: string }) => item.id === token.consent_id,
    );
    expect(grant).toMatchObject({
      resources: ["acc_HLB_A100", "acc_HLB_A200"],
    });
    const revoked = await inject({
      method: "POST",
      url: `/site/access/${token.consent_id}/revoke`,
      headers: { cookie, origin, "x-harborline-account": "elena" },
    });
    expect(revoked.statusCode).toBe(200);
    const after = await get(
      token.access_token,
      `/fdx/v6/consents/${token.consent_id}`,
    );
    expect(after.statusCode).toBe(401);
  });

  it("shows changes approved through Harborline's own API identically through FDX", async () => {
    onStatementDay();
    const token = await h.sign("elena", [...scopes]);
    const closed = `/fdx/v6/accounts/acc_HLB_A100/statements/stmt_acc_HLB_A100_20261120`;
    const statementBefore = (await get(token.access_token, closed)).bytes;
    const transfer = {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_HLB_A200",
      amount_cents: 50001,
      idempotency_key: "fdx-parity-transfer",
    };
    const proposed = await h.call(
      token.access_token,
      "POST",
      "/api/account/transfers",
      transfer,
    );
    const op = proposed.json().operation;
    expect(
      (
        await h.call(
          token.access_token,
          "POST",
          "/api/account/transfers",
          transfer,
          op,
        )
      ).statusCode,
    ).toBe(200);
    const category = { category: "dining", expected_version: 1 };
    const categoryPath = "/api/account/transactions/txn_HLB_A301/category";
    const categoryOp = (
      await h.call(token.access_token, "POST", categoryPath, category)
    ).json().operation;
    await h.call(
      token.access_token,
      "POST",
      categoryPath,
      category,
      categoryOp,
    );

    const own = (
      await h.call(token.access_token, "GET", "/api/account/accounts")
    ).json().accounts;
    const shaped = (await get(token.access_token, "/fdx/v6/accounts")).json()
      .accounts;
    expect(
      shaped.map((a: { accountId: string; currentBalance: number }) => [
        a.accountId,
        a.currentBalance,
      ]),
    ).toEqual(
      own.map((a: { id: string; balance_cents: number }) => [
        a.id,
        decimal(a.balance_cents),
      ]),
    );
    expect(shaped[0].currentBalance).toBe(12344.99);
    // A transfer posted today changes no closed statement.
    expect((await get(token.access_token, closed)).bytes).toEqual(
      statementBefore,
    );
    const ownTransactions = (
      await h.call(token.access_token, "GET", "/api/account/transactions")
    ).json().transactions;
    const shapedTransactions = (
      await get(
        token.access_token,
        "/fdx/v6/accounts/acc_HLB_A100/transactions",
      )
    ).json().transactions;
    const ownA100 = ownTransactions.filter(
      (t: { account_id: string }) => t.account_id === "acc_HLB_A100",
    );
    expect(
      shapedTransactions.map(
        (t: { transactionId: string; amount: number; category: string }) => [
          t.transactionId,
          t.amount,
          t.category,
        ],
      ),
    ).toEqual(
      ownA100.map(
        (t: { id: string; amount_cents: number; category: string }) => [
          t.id,
          decimal(Math.abs(t.amount_cents)),
          t.category,
        ],
      ),
    );
    expect(shapedTransactions[0]).toMatchObject({
      description: "Transfer to Reserve savings",
      amount: 500.01,
      debitCreditMemo: "DEBIT",
    });
    expect(
      shapedTransactions.find(
        (t: { transactionId: string }) => t.transactionId === "txn_HLB_A301",
      ).category,
    ).toBe("dining");
  });

  it("lists a chosen account's statements newest first, paged and by statement date", async () => {
    onStatementDay();
    const token = await h.sign("elena", fdx);
    const url = "/fdx/v6/accounts/acc_HLB_A100/statements";
    const listed = await get(token.access_token, url);
    expect(listed.statusCode).toBe(200);
    const body = listed.json();
    expect(body.note).toBe(FICTION_NOTICE);
    expect(body.page).toEqual({ totalElements: 3 });
    expect(body.statements[0]).toEqual({
      statementId: "stmt_acc_HLB_A100_20261120",
      accountId: "acc_HLB_A100",
      statementDate: "2026-11-20",
      description: "Monthly statement, 2026-10-21 to 2026-11-20",
      status: "AVAILABLE",
      startDate: "2026-10-21",
      endDate: "2026-11-20",
    });
    expect(
      body.statements.map((s: { statementDate: string }) => s.statementDate),
    ).toEqual(["2026-11-20", "2026-10-20", "2026-09-20"]);
    const first = (await get(token.access_token, `${url}?limit=2`)).json();
    expect(first.page).toEqual({ nextOffset: "2", totalElements: 3 });
    const rest = (
      await get(token.access_token, `${url}?offset=2&limit=2`)
    ).json();
    expect(
      rest.statements.map((s: { statementId: string }) => s.statementId),
    ).toEqual(["stmt_acc_HLB_A100_20260920"]);
    const october = (
      await get(
        token.access_token,
        `${url}?startTime=2026-10-01&endTime=2026-10-31`,
      )
    ).json();
    expect(
      october.statements.map((s: { statementDate: string }) => s.statementDate),
    ).toEqual(["2026-10-20"]);
    for (const [query, code] of [
      ["startTime=2026-11-30&endTime=2026-11-01", "703"],
      ["endTime=2026-13-01", "703"],
      ["limit=0", "invalid_parameter"],
    ] as const) {
      const bad = await get(token.access_token, `${url}?${query}`);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe(code);
    }
  });

  it("serves a statement as a deterministic PDF attachment, only to fdx:STATEMENTS and only as PDF", async () => {
    onStatementDay();
    const token = await h.sign("elena", fdx);
    const url =
      "/fdx/v6/accounts/acc_HLB_A100/statements/stmt_acc_HLB_A100_20261120";
    const pdf = await get(token.access_token, url, "GET", undefined);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toBe(
      'attachment; filename="harborline-stmt_acc_HLB_A100_20261120.pdf"',
    );
    expect(pdf.headers["cache-control"]).toBe("no-store");
    expect(pdf.headers["x-content-type-options"]).toBe("nosniff");
    expect(Number(pdf.headers["content-length"])).toBe(pdf.bytes.byteLength);
    expect(String.fromCharCode(...pdf.bytes.slice(0, 5))).toBe("%PDF-");
    const read = readPdf(pdf.bytes);
    expect(read.pages).toBe(1);
    expect(read.text).toContain("No real account exists.");
    expect(read.text).toContain("Operating checking");
    expect(read.text).toContain("USD 12,845.00");
    // The same statement, the same bytes; and the same for another grant.
    expect((await get(token.access_token, url)).bytes).toEqual(pdf.bytes);
    const again = await h.sign("elena", fdx);
    expect((await get(again.access_token, url)).bytes).toEqual(pdf.bytes);

    // Accept: a PDF, any application type, anything, or nothing at all.
    const accepting = (accept: string) =>
      h.call(token.access_token, "GET", url, undefined, undefined, undefined, {
        ...declared,
        ...(accept ? { Accept: accept } : {}),
      });
    for (const accept of [
      "application/pdf",
      "*/*",
      "application/*",
      "text/html, application/pdf;q=0.5",
      "",
    ])
      expect((await accepting(accept)).statusCode).toBe(200);
    for (const accept of [
      "application/json",
      "text/html",
      "application/pdf;q=0",
    ]) {
      const refused = await accepting(accept);
      expect(refused.statusCode).toBe(406);
      expect(refused.headers["content-type"]).toContain("application/json");
      expect(refused.json()).toEqual({
        code: "not_acceptable",
        message: "Not acceptable",
        debugMessage: "Statements are served as application/pdf only",
        note: FICTION_NOTICE,
      });
    }

    // Statements need their own data cluster, list and document alike.
    const withoutStatements = await h.sign(
      "elena",
      fdx.filter((s) => s !== "fdx:STATEMENTS"),
    );
    for (const path of ["/fdx/v6/accounts/acc_HLB_A100/statements", url]) {
      const refused = await get(withoutStatements.access_token, path);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toEqual({ error: "insufficient_scope" });
      expect(refused.headers["www-authenticate"]).toContain(
        'scope="fdx:STATEMENTS"',
      );
    }
    const only = await h.sign("elena", ["fdx:STATEMENTS"]);
    expect((await get(only.access_token, url)).statusCode).toBe(200);
    // And the extension declared, before the token.
    const undeclared = await h.call(token.access_token, "GET", url);
    expect(undeclared.statusCode).toBe(403);
    expect(undeclared.json()).toMatchObject({ error: "extension_required" });
  });

  it("answers 701 for statements of unchosen accounts, and statement_not_found for unknown statements", async () => {
    onStatementDay();
    const token = await h.sign("elena", fdx, {
      fdxAccounts: ["acc_HLB_A200"],
    });
    for (const url of [
      "/fdx/v6/accounts/acc_HLB_A100/statements",
      "/fdx/v6/accounts/acc_HLB_A100/statements/stmt_acc_HLB_A100_20261120",
      "/fdx/v6/accounts/acc_HLB_J100/statements",
      "/fdx/v6/accounts/acc_HLB_J100/statements/stmt_acc_HLB_J100_20261120",
      "/fdx/v6/accounts/acc_nope/statements/stmt_acc_nope_20261120",
    ]) {
      const r = await get(token.access_token, url);
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({
        code: "701",
        message: "Account not found",
        note: FICTION_NOTICE,
      });
    }
    for (const id of [
      // Another account's, a cycle not closed yet, one before the first,
      // and nothing like an ID.
      "stmt_acc_HLB_A100_20261120",
      "stmt_acc_HLB_A200_20261220",
      "stmt_acc_HLB_A200_20260820",
      "nope",
    ]) {
      const r = await get(
        token.access_token,
        `/fdx/v6/accounts/acc_HLB_A200/statements/${id}`,
      );
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({
        code: "statement_not_found",
        message: "Statement not found",
        note: FICTION_NOTICE,
      });
    }
    const savings = await get(
      token.access_token,
      "/fdx/v6/accounts/acc_HLB_A200/statements/stmt_acc_HLB_A200_20261120",
    );
    expect(savings.statusCode).toBe(200);
    expect(readPdf(savings.bytes).text).toContain(
      "No posted transactions in this period.",
    );
  });

  it("keeps each visitor's FDX view to their own copy", async () => {
    h = await setup({ isolation: "visitor" });
    const a = await h.sign("elena", [...scopes]);
    const b = await h.sign("elena", fdx);
    const transfer = {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_HLB_A200",
      amount_cents: 1000,
      idempotency_key: "fdx-visitor-transfer",
    };
    const first = (
      await h.call(
        a.access_token,
        "POST",
        "/api/account/transfers",
        transfer,
        undefined,
        "usr_a",
      )
    ).json().operation;
    await h.call(
      a.access_token,
      "POST",
      "/api/account/transfers",
      transfer,
      first,
      "usr_a",
    );
    const ofA = (
      await fdxCall(h, "usr_a")(a.access_token, "/fdx/v6/accounts/acc_HLB_A100")
    ).json();
    const ofB = (
      await fdxCall(h, "usr_b")(b.access_token, "/fdx/v6/accounts/acc_HLB_A100")
    ).json();
    expect(ofA.currentBalance).toBe(12835);
    expect(ofB.currentBalance).toBe(12845);
    // A's token serves only A.
    const stolen = await fdxCall(h, "usr_b")(
      a.access_token,
      "/fdx/v6/accounts",
    );
    expect(stolen.statusCode).toBe(401);
    // B can't read A's consent.
    const peek = await fdxCall(h, "usr_b")(
      b.access_token,
      `/fdx/v6/consents/${a.consent_id}`,
    );
    expect(peek.statusCode).toBe(404);
  });

  it("leaves Harborline unchanged for an agent that doesn't declare the extension", async () => {
    const token = await h.sign("robin", ["accounts:read", "transactions:read"]);
    expect(token).not.toHaveProperty("consent_id");
    const accounts = await h.call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(accounts.statusCode).toBe(200);
    expect(accounts.json().accounts[0].balance_cents).toBe(382740);
    const page = await h.authorize("robin", ["accounts:read"]);
    expect(page.page.body).not.toContain("FDX-shaped API</legend>");
  });
});

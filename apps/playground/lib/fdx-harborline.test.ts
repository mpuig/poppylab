/**
 * End to end, in process: Iris's routes and runtime against the real
 * Harborline app, with Use FDX on (`poppylab.dev/fdx` v1). Only the network
 * is replaced: DNS answers loopback and the pinned fetch hands each request
 * to the Harborline app, so the transport's own checks (no redirects, error
 * parsing, DPoP nonces, sizes) still run. No model: tools are called
 * directly, and demo-mode chat turns read balances and statements. A
 * statement's PDF is downloaded from the account row's route.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    app: undefined as
      | {
          request: (
            url: string,
            init?: RequestInit,
          ) => Response | Promise<Response>;
        }
      | undefined,
    cookies: new Map<string, string>(),
    /** Every URL Iris requested. */
    seen: [] as string[],
  };
});
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "127.0.0.1", family: 4 }],
}));
// The undici that pap-client's pinned fetch imports (it isn't the
// playground's own dependency).
const undici = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  return createRequire(
    fileURLToPath(new URL("../../../packages/pap-client/", import.meta.url)),
  ).resolve("undici");
});
vi.mock(undici, () => ({
  Agent: class {
    destroy() {}
  },
  fetch: async (
    url: URL | string,
    init: RequestInit & { dispatcher?: unknown },
  ) => {
    const { dispatcher, ...rest } = init;
    void dispatcher;
    net.seen.push(String(url));
    return net.app!.request(String(url), rest);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      net.cookies.has(name) ? { value: net.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => {
      if (value) net.cookies.set(name, value);
      else net.cookies.delete(name);
    },
    delete: (name: string) => net.cookies.delete(name),
  }),
}));
import {
  createIdentity,
  FDX_LIMITS,
  ProtocolError,
  proof,
  protocolRequest,
  signSessionHeader,
} from "@poppy-lab/pap-client";
import {
  lab,
  origin,
  client,
  redirect,
  setup,
} from "../../harborline/src/test-harness";
import { POST as discover } from "../app/api/discover/route";
import { GET as account, POST as act } from "../app/api/account/route";
import { GET as callback } from "../app/api/account/callback/route";
import { POST as chat } from "../app/api/chat/route";
import {
  acquireRun,
  releaseRun,
  visitorOf,
  type Held,
} from "@poppy-lab/pap-agent/runs";
import { onlyConnection } from "@poppy-lab/pap-agent/connections";
import {
  clientFor,
  connect,
  ensureSession,
  localOrigins,
  papRequest,
  renewAccount,
  type Connection,
} from "@poppy-lab/pap-agent/runtime";

const base = `${origin}/fdx/v6`;
const agent = "http://localhost:3000";
const raw = "f".repeat(43);
let visitor: string;
let conversation: string;

const post = (
  handler: (r: Request) => Promise<Response>,
  path: string,
  body: unknown,
) =>
  handler(
    new Request(`${agent}${path}`, {
      method: "POST",
      headers: {
        origin: agent,
        "Content-Type": "application/json",
        ...(conversation ? { "X-Poppy-Conversation": conversation } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
/**
 * Holds the conversation's run for direct runtime calls at its Company,
 * then saves it.
 */
async function withRun<T>(work: (run: Connection) => Promise<T>) {
  const held = (await acquireRun(visitor, conversation)) as Held;
  try {
    return await work(onlyConnection(held.run));
  } finally {
    await releaseRun(visitor, held);
  }
}
async function tools(trace: string[] = []) {
  return withRun((run) => connect(run, trace));
}
/** The User on Harborline's consent page: Elena, sharing one account. */
async function consent(url: string, accounts: string[]) {
  const page = await net.app!.request(url);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("acc_HLB_A200");
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const form = new URLSearchParams({
    nonce: cookie.split("=")[1]!,
    decision: "approve",
    account: "elena",
  });
  for (const id of accounts) form.set(`fdx_account_${id}`, "yes");
  const approved = await net.app!.request(`${origin}/oauth/authorize`, {
    method: "POST",
    headers: {
      cookie,
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  expect(approved.status).toBe(302);
  return approved.headers.get("location")!;
}

describe("Use FDX against Harborline, end to end", () => {
  const pageSize = FDX_LIMITS.pageSize;
  beforeAll(async () => {
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    await setup({
      fetchJson: async (url: string) =>
        url.endsWith("client.json")
          ? {
              client_id: client,
              client_name: "Iris",
              jwks_uri: `${agent}/agent/jwks.json`,
              redirect_uris: [redirect],
            }
          : { keys: [keys.publicKey] },
    });
    net.app = lab.app;
    net.cookies.set("poppy_visitor", raw);
    visitor = visitorOf({ get: () => ({ value: raw }), set: () => {} })!;
  });
  afterAll(() => {
    (FDX_LIMITS as { pageSize: number }).pageSize = pageSize;
    vi.unstubAllEnvs();
  });

  it("discovers Harborline, turns Use FDX on and signs in sharing one of two accounts", async () => {
    const found = await post(discover, "/api/discover", { url: origin });
    expect(found.status).toBe(200);
    conversation = found.headers.get("X-Poppy-Conversation")!;
    expect((await found.json()).profile.extensions).toHaveProperty(
      "poppylab.dev/fdx",
    );
    // Off by default; on starts a new Session.
    expect(
      (
        await (
          await account(
            new Request(`${agent}/api/account?conversation=${conversation}`),
          )
        ).json()
      ).fdx,
    ).toBe(false);
    const on = await post(act, "/api/account", {
      action: "fdx",
      enabled: true,
    });
    expect(await on.json()).toMatchObject({ fdx: true });

    const signin = await post(act, "/api/account", { action: "signin" });
    expect(signin.status).toBe(200);
    const asked = await withRun(async (run) => run.auth!.scopes.split(" "));
    expect(asked).toEqual(
      expect.arrayContaining([
        "accounts:read",
        "fdx:ACCOUNT_BASIC",
        "fdx:ACCOUNT_DETAILED",
        "fdx:TRANSACTIONS",
        "fdx:STATEMENTS",
        "fdx:CUSTOMER_CONTACT",
      ]),
    );
    expect(asked.some((s) => /:(write|request)$/.test(s))).toBe(false);
    const back = await consent((await signin.json()).url, ["acc_HLB_A100"]);
    expect(back.startsWith(redirect)).toBe(true);
    const done = await callback(new Request(back));
    expect(done.headers.get("Location")).toBe("/playground/sign-in/done");
    await withRun(async (run) => {
      expect(run.fdxConsent).toMatch(/^[A-Za-z0-9_-]/);
      expect(run.scopes).toContain("fdx:TRANSACTIONS");
    });
  });

  it("lists only the shared account, with balances only when asked, and answers 701 for the other", async () => {
    const trace: string[] = [];
    const t = await tools(trace);
    expect(trace).toContain(
      "Extension poppylab.dev/fdx v1 · native FDX-shaped adapter · 7 read tools",
    );
    // The generic adapter got Harborline's own API, listed first; the
    // FDX-shaped description wasn't even read.
    expect(t).toHaveProperty("accounts");
    expect(net.seen).not.toContain(`${origin}/openapi/fdx.json`);
    const plain = (await t.fdx_list_accounts!.execute({})) as {
      accounts: Array<Record<string, unknown>>;
    };
    expect(plain.accounts.map((a) => a.accountId)).toEqual(["acc_HLB_A100"]);
    expect(plain.accounts[0]).not.toHaveProperty("currentBalance");
    const detailed = (await t.fdx_list_accounts!.execute({
      balances: true,
    })) as { accounts: Array<Record<string, unknown>> };
    expect(detailed.accounts[0]).toMatchObject({
      accountId: "acc_HLB_A100",
      currentBalance: expect.any(Number),
      availableBalance: expect.any(Number),
    });
    // Elena's, but not shared: the FDX error reaches the model.
    expect(
      await t.fdx_get_account!.execute({ accountId: "acc_HLB_A200" }),
    ).toMatchObject({ error: "fdx_error", status: 404, code: "701" });
    // Harborline's own API, through the same grant: the same one account.
    const own = (await t.accounts!.execute({})) as {
      accounts: Array<{ id: string }>;
    };
    expect(own.accounts.map((a) => a.id)).toEqual(["acc_HLB_A100"]);
    expect(JSON.stringify(own)).not.toContain("acc_HLB_A200");
  });

  it("pages through transactions, and reads the consent by the id from sign-in", async () => {
    (FDX_LIMITS as { pageSize: number }).pageSize = 2;
    try {
      const trace: string[] = [];
      const t = await tools(trace);
      const read = (await t.fdx_list_transactions!.execute({
        accountId: "acc_HLB_A100",
      })) as {
        transactions: Array<{ transactionId: string }>;
        totalElements: number;
        truncated: boolean;
      };
      const pages = trace.filter((l) =>
        l.startsWith("GET /fdx/v6/accounts/acc_HLB_A100/transactions"),
      );
      expect(pages.length).toBeGreaterThan(1);
      expect(pages[1]).toContain("offset=2");
      expect(read.totalElements).toBeGreaterThan(2);
      expect(read.transactions).toHaveLength(
        Math.min(read.totalElements, 2 * FDX_LIMITS.maxPages),
      );
      expect(new Set(read.transactions.map((x) => x.transactionId)).size).toBe(
        read.transactions.length,
      );
    } finally {
      (FDX_LIMITS as { pageSize: number }).pageSize = pageSize;
    }
    const t = await tools();
    const id = await withRun(async (run) => run.fdxConsent);
    expect(await t.fdx_consent_status!.execute({})).toMatchObject({
      id,
      status: "ACTIVE",
      resources: [
        expect.objectContaining({
          resourceType: "ACCOUNT",
          resourceId: "acc_HLB_A100",
        }),
      ],
    });
  });

  it("answers balances and transactions through FDX in demo mode", async () => {
    const reply = await post(chat, "/api/chat", {
      url: origin,
      message: "my account balances",
      provider: "demo",
    });
    expect(reply.status).toBe(200);
    const body = (await reply.json()) as { text: string; data: string };
    expect(body.text).toContain("FDX-shaped tools");
    expect(body.data).toContain("currentBalance");
    expect(body.data).toContain("acc_HLB_A100");
    expect(body.data).not.toContain("acc_HLB_A200");
    const moves = await post(chat, "/api/chat", {
      url: origin,
      message: "últimos movimientos",
      provider: "demo",
    });
    expect(((await moves.json()) as { data: string }).data).toContain(
      "transactionId",
    );
  });

  it("lists statements, gives the model a statement's size and hash only, and downloads the PDF from the account row", async () => {
    const t = await tools();
    const listed = (await t.fdx_list_statements!.execute({
      accountId: "acc_HLB_A100",
    })) as {
      statements: Array<{ statementId: string; statementDate: string }>;
      totalElements: number;
    };
    // Harborline's closed cycles so far, newest first.
    expect(listed.statements.length).toBeGreaterThan(0);
    expect(listed.totalElements).toBe(listed.statements.length);
    const [newest] = listed.statements;
    expect(newest!.statementId).toMatch(/^stmt_acc_HLB_A100_\d{8}$/);
    const checked = (await t.fdx_get_statement!.execute({
      accountId: "acc_HLB_A100",
      statementId: newest!.statementId,
    })) as Record<string, unknown>;
    expect(checked).toEqual({
      statementId: newest!.statementId,
      accountId: "acc_HLB_A100",
      contentType: "application/pdf",
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(checked)).not.toContain("PDF-");
    // The unshared account: the bank's 701 reaches the model.
    expect(
      await t.fdx_list_statements!.execute({ accountId: "acc_HLB_A200" }),
    ).toMatchObject({ error: "fdx_error", status: 404, code: "701" });

    // The account row: the shared account's statements only.
    const row = await post(act, "/api/account", { action: "fdx_statements" });
    expect(row.status).toBe(200);
    const shown = (await row.json()) as {
      accounts: Array<{ accountId: string; statements: unknown[] }>;
    };
    expect(shown.accounts.map((a) => a.accountId)).toEqual(["acc_HLB_A100"]);
    expect(shown.accounts[0]!.statements).toHaveLength(
      listed.statements.length,
    );

    // The download: one GET of the PDF, the same bytes the tool hashed.
    const from = net.seen.length;
    const download = await post(act, "/api/account", {
      action: "fdx_statement",
      accountId: "acc_HLB_A100",
      statementId: newest!.statementId,
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("content-disposition")).toBe(
      `attachment; filename="statement-acc_HLB_A100-${newest!.statementId}.pdf"`,
    );
    expect(download.headers.get("cache-control")).toBe("no-store");
    const pdf = new Uint8Array(await download.arrayBuffer());
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBe(checked.bytes);
    expect(download.headers.get("x-poppy-statement-sha256")).toBe(
      checked.sha256,
    );
    expect(net.seen.slice(from)).toEqual([
      `${base}/accounts/acc_HLB_A100/statements/${newest!.statementId}`,
    ]);
    // Of the account not shared: not found, in our own words.
    const hidden = await post(act, "/api/account", {
      action: "fdx_statement",
      accountId: "acc_HLB_A200",
      statementId: newest!.statementId.replace("A100", "A200"),
    });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ code: "statement_not_found" });

    // Demo mode: the statements, and where to download them.
    const reply = await post(chat, "/api/chat", {
      url: origin,
      message: "show my statements",
      provider: "demo",
    });
    expect(reply.status).toBe(200);
    const body = (await reply.json()) as { text: string; data: string };
    expect(body.text).toContain("Operating checking");
    expect(body.text).toContain(newest!.statementDate);
    expect(body.text).toContain("Download a statement as a PDF");
    expect(body.data).toContain(newest!.statementId);
    expect(body.data).not.toContain("acc_HLB_A200");
  });

  it("refreshes within narrower scopes, keeping the consent id; balances need ACCOUNT_DETAILED in the token", async () => {
    await withRun(async (run) => {
      const id = run.fdxConsent;
      delete run.fdxConsent;
      run.scopes = run
        .scopes!.split(" ")
        .filter((s) => s !== "fdx:ACCOUNT_DETAILED")
        .join(" ");
      await renewAccount(run);
      expect(run.fdxConsent).toBe(id);
      // Harborline leaves the balances out for this token.
      const listed = (await papRequest(run, `${base}/accounts`, "GET")) as {
        accounts: Array<Record<string, unknown>>;
      };
      expect(listed.accounts[0]).not.toHaveProperty("currentBalance");
    });
    // And Iris doesn't ask for them with it.
    expect(
      await (await tools()).fdx_list_accounts!.execute({ balances: true }),
    ).toMatchObject({ error: "insufficient_scope" });
  });

  it("with Use FDX off, offers no FDX tools and Harborline answers extension_required", async () => {
    const off = await post(act, "/api/account", {
      action: "fdx",
      enabled: false,
    });
    expect(await off.json()).toMatchObject({ fdx: false });
    const t = await tools();
    expect(Object.keys(t).some((n) => n.startsWith("fdx_"))).toBe(false);
    expect(t).toHaveProperty("accounts");
    const error = await withRun((run) =>
      papRequest(run, `${base}/accounts`, "GET", undefined, {
        errorBody: true,
      }).then(
        () => undefined,
        (e: unknown) => e,
      ),
    );
    expect(error).toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({ status: 403, code: "extension_required" });
    expect((error as ProtocolError).body).toBeUndefined();
    await post(act, "/api/account", { action: "fdx", enabled: true });
  });

  it("revokes the consent from the account row: one PUT, the grant ends at Harborline and the run is signed out", async () => {
    const restore = async () =>
      (
        await account(
          new Request(`${agent}/api/account?conversation=${conversation}`),
        )
      ).json();
    const before = await withRun(async (run) => ({
      consent: run.fdxConsent!,
      token: run.token!,
      refresh: run.accountToken!,
      expires: run.tokenExpires!,
      scopes: run.scopes!,
      revoke: run.company!.metadata!.revocation_endpoint!,
    }));
    // The page sees the consent, and its status and accounts.
    expect(await restore()).toMatchObject({
      signedIn: true,
      fdxConsent: before.consent,
    });
    const shown = await post(act, "/api/account", { action: "fdx_consent" });
    expect(shown.status).toBe(200);
    expect((await shown.json()).consent).toMatchObject({
      id: before.consent,
      status: "ACTIVE",
      accounts: ["acc_HLB_A100"],
    });

    const revocation = `${base}/consents/${before.consent}/revocation`;
    const from = net.seen.length;
    const revoked = await post(act, "/api/account", { action: "fdx_revoke" });
    expect(revoked.status).toBe(200);
    const body = await revoked.json();
    expect(body).toMatchObject({
      signedIn: false,
      revoked: "revoked",
      consent: before.consent,
    });
    expect(body.trace).toEqual([
      `PUT /fdx/v6/consents/${before.consent}/revocation · FDX consent revoked · 204`,
    ]);
    // Exactly one request, the PUT; the dead refresh token isn't revoked.
    expect(net.seen.slice(from)).toEqual([revocation]);
    expect(net.seen.slice(from)).not.toContain(before.revoke);

    // Signed out here, as after a sign-out, with Use FDX still on.
    await withRun(async (run) => {
      expect(run.accountToken).toBeUndefined();
      expect(run.token).toBeUndefined();
      expect(run.fdxConsent).toBeUndefined();
      expect(run.resourceTokens).toBeUndefined();
      expect(run.accountUnavailable).toBeUndefined();
      expect(run.fdx).toBe(true);
    });
    expect(await restore()).toMatchObject({ signedIn: false, fdx: true });
    expect((await restore()).fdxConsent).toBeUndefined();
    expect(await (await tools()).fdx_list_accounts!.execute({})).toMatchObject({
      error: "sign_in_required",
    });
    // Nothing left to revoke.
    const again = await post(act, "/api/account", { action: "fdx_revoke" });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: "no_fdx_consent" });

    // At Harborline, the grant's tokens are gone: the old access token is
    // refused, and so is its refresh token.
    await withRun(async (run) => {
      Object.assign(run, {
        token: before.token,
        accountToken: before.refresh,
        tokenExpires: before.expires,
        scopes: before.scopes,
      });
      try {
        const listed = await papRequest(run, `${base}/accounts`, "GET").then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(listed).toMatchObject({ status: 401, code: "invalid_token" });
        delete run.accountUnavailable;
        const renewed = await renewAccount(run).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(renewed).toMatchObject({ status: 400, code: "invalid_grant" });
      } finally {
        delete run.token;
        delete run.accountToken;
        delete run.tokenExpires;
        delete run.scopes;
        delete run.accountUnavailable;
      }
    });

    // Signing in again shares accounts over FDX with a new consent.
    const signin = await post(act, "/api/account", { action: "signin" });
    const back = await consent((await signin.json()).url, ["acc_HLB_A100"]);
    expect((await callback(new Request(back))).headers.get("Location")).toBe(
      "/playground/sign-in/done",
    );
    const fresh = await withRun(async (run) => run.fdxConsent);
    expect(fresh).toMatch(/^[A-Za-z0-9_-]/);
    expect(fresh).not.toBe(before.consent);
  });

  it("after the consent is revoked by another request, calls fail with the runtime's sign-in handling", async () => {
    await withRun(async (run) => {
      await ensureSession(run);
      const url = `${base}/consents/${run.fdxConsent}/revocation`;
      const headers = {
        "Poppy-Session": await signSessionHeader({
          key: run.sessionKey!,
          clientId: clientFor(run),
          audience: origin,
          sessionId: run.sessionId!,
          userId: run.user,
          method: "PUT",
          url,
          accessToken: run.token!,
        }),
        "Poppy-Version": "1.0",
        "Poppy-Extensions": '"operations";v="3", "poppylab.dev/fdx";v="1"',
        Authorization: `DPoP ${run.token}`,
        DPoP: await proof(run.dpop!, url, "PUT", run.token),
        "Content-Type": "application/json",
      };
      expect(
        await protocolRequest(
          url,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({
              reason: "USER_ACTION",
              initiator: "INDIVIDUAL",
            }),
          },
          localOrigins,
          { key: run.dpop!, token: run.token! },
          { acceptEmpty: true },
        ),
      ).toBeNull();
    });
    const t = await tools();
    const error = await t.fdx_list_accounts!.execute({}).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 401, code: "invalid_token" });
    await withRun(async (run) => expect(run.accountUnavailable).toBe(true));
    // The chat says so as for any lost access.
    const reply = await post(chat, "/api/chat", {
      url: origin,
      message: "my recent transactions",
      provider: "demo",
    });
    expect(reply.status).toBe(401);
    expect(await reply.json()).toMatchObject({
      code: "account_unavailable",
      next: "signin",
    });
  });
});

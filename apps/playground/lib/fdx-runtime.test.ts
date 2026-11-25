/**
 * Use FDX (`poppylab.dev/fdx` v1) in the runtime, with a fake transport: the
 * declaration, which API the generic adapter gets, the native tools, and
 * which errors reach the model. `fdx-harborline.test.ts` drives the real
 * Harborline app.
 */
import { it, expect, vi, beforeEach, onTestFinished } from "vitest";
const transport = vi.hoisted(() =>
  vi.fn<(url: string, ...args: unknown[]) => Promise<unknown>>(),
);
const rediscover = vi.hoisted(() => vi.fn());
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: rediscover,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
  }),
}));
import { ProtocolError } from "@poppy-lab/pap-client";
import type { CompanyProfile } from "@poppy-lab/pap-core";
import { connect, papRequest, renewAccount, setFdx, type Run } from "./runtime";

const origin = "https://bank.example";
const fdxEntry = {
  version: "1" as const,
  base_url: `${origin}/fdx/v6`,
  consent_endpoint: `${origin}/fdx/v6/consents`,
};
const fdxScopes = [
  "fdx:ACCOUNT_BASIC",
  "fdx:ACCOUNT_DETAILED",
  "fdx:TRANSACTIONS",
  "fdx:CUSTOMER_CONTACT",
];
/** Harborline's shape: its own API first, then the FDX-shaped one. */
function bank({ fdx = false, signedIn = true, saved = false } = {}): Run {
  const profile: CompanyProfile = {
    version: "1.0",
    identifier: origin,
    issuer: origin,
    signIn: { direct: true, device: false },
    scopes: ["accounts:read", ...fdxScopes],
    scopeDescriptions: {},
    scopeHints: {},
    operations: true,
    // A profile saved before profiles kept extensions has none.
    ...(saved ? {} : { extensions: { "poppylab.dev/fdx": fdxEntry } }),
  };
  return {
    protocol: "1.0",
    url: origin,
    user: "",
    visitor: "visitor-fixture",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    ...(fdx ? { fdx: true } : {}),
    ...(signedIn
      ? {
          token: "access-1",
          tokenType: "Bearer" as const,
          accountToken: "refresh-1",
          scopes: ["accounts:read", ...fdxScopes].join(" "),
          tokenExpires: Date.now() + 3600000,
          fdxConsent: "grant_7Hk2",
        }
      : {}),
    company: {
      requestedUrl: origin,
      discoveryUrl: origin + "/.well-known/poppy.json",
      discoveredAt: new Date().toISOString(),
      trace: [],
      document: {
        protocol_version: "1.0",
        organization: { name: "Bank", domain: "bank.example" },
        apis: [
          {
            type: "openapi",
            url: `${origin}/openapi.json`,
            description: "Own",
          },
          {
            type: "openapi",
            url: `${origin}/openapi/fdx.json`,
            description: "FDX",
          },
        ],
        extensions: {
          operations: [{ version: "3" }],
          "poppylab.dev/fdx": [fdxEntry],
        },
      },
      metadata: {
        issuer: origin,
        token_endpoint: origin + "/oauth/token",
        revocation_endpoint: origin + "/oauth/revoke",
        authorization_endpoint: origin + "/oauth/authorize",
      },
      profile,
    },
  };
}
const ownSpec = {
  servers: [{ url: origin }],
  paths: {
    "/api/account/accounts": {
      get: {
        operationId: "accounts",
        "x-poppy-scopes": ["accounts:read"],
        responses: { "200": {} },
      },
    },
    // Should the Company's own API list an FDX-shaped route: never a tool.
    "/fdx/v6/accounts": {
      get: { operationId: "own_fdx_accounts", responses: { "200": {} } },
    },
  },
};
/** Harborline's: served outside the base URL, its server the origin. */
const fdxSpec = {
  servers: [{ url: origin }],
  paths: {
    "/fdx/v6/accounts": {
      get: { operationId: "listAccounts", responses: { "200": {} } },
    },
    "/fdx/v6/customers/current": {
      get: { operationId: "getCustomer", responses: { "200": {} } },
    },
  },
};
const headersOf = (call: unknown[]) =>
  (call[1] as RequestInit).headers as Record<string, string>;
const serve = (fdxAnswer: () => Promise<unknown> = async () => ({})) =>
  transport.mockImplementation(async (url: string) => {
    if (url === `${origin}/openapi.json`) return ownSpec;
    if (url === `${origin}/openapi/fdx.json`) return fdxSpec;
    if (url.includes("/.well-known/oauth-protected-resource"))
      throw new ProtocolError(404, undefined);
    if (url.startsWith(fdxEntry.base_url)) return fdxAnswer();
    return { ok: true };
  });
beforeEach(() => {
  transport.mockReset();
  rediscover.mockReset();
  serve();
});
const connected = async (run: Run, trace: string[] = []) => {
  rediscover.mockResolvedValue(run.company!);
  return connect(run, trace);
};

it("declares poppylab.dev/fdx v1 next to Operations v3 only with Use FDX on (§3.3, §3.4)", async () => {
  for (const [run, expected] of [
    [bank(), '"operations";v="3"'],
    [bank({ fdx: true }), '"operations";v="3", "poppylab.dev/fdx";v="1"'],
    // A saved profile without extensions: nothing to declare it from.
    [bank({ fdx: true, saved: true }), '"operations";v="3"'],
  ] as const) {
    transport.mockClear();
    await papRequest(run, `${origin}/api/account/accounts`, "GET");
    expect(headersOf(transport.mock.calls.at(-1)!)["Poppy-Extensions"]).toBe(
      expected,
    );
  }
  const trace: string[] = [];
  await connected(bank({ fdx: true }), trace);
  expect(trace[0]).toContain(
    'Poppy-Extensions "operations";v="3", "poppylab.dev/fdx";v="1"',
  );
  expect(trace).toContain(
    "Extension poppylab.dev/fdx v1 · native FDX-shaped adapter · 5 read tools",
  );
});

it("starts a new Session when Use FDX changes, and only then", () => {
  const run = bank();
  run.sessionId = "sid-1";
  expect(setFdx(run, false)).toBe(false);
  expect(run.sessionId).toBe("sid-1");
  expect(setFdx(run, true)).toBe(true);
  expect(run.sessionId).not.toBe("sid-1");
  const on = run.sessionId;
  expect(setFdx(run, false)).toBe(true);
  expect(run.sessionId).not.toBe(on);
  expect(run).not.toHaveProperty("fdx");
});

it("never gives the FDX-shaped description to the generic adapter, wherever it is listed", async () => {
  for (const fdx of [false, true]) {
    const run = bank({ fdx });
    // Listed first: still skipped, and the Company's own API is used.
    run.company!.document.apis!.reverse();
    const trace: string[] = [];
    const tools = await connected(run, trace);
    expect(Object.keys(tools)).toContain("accounts");
    expect(Object.keys(tools)).not.toContain("listAccounts");
    expect(Object.keys(tools)).not.toContain("getCustomer");
    expect(Object.keys(tools)).not.toContain("own_fdx_accounts");
    expect(trace).toContain(
      "Not loading /openapi/fdx.json as API tools · FDX-shaped (poppylab.dev/fdx), native adapter only",
    );
    expect(run.apiBase).toBe(origin);
    // FDX tools only with Use FDX on.
    expect(Object.keys(tools).some((n) => n.startsWith("fdx_"))).toBe(fdx);
  }
  // A description under base_url isn't even read.
  const run = bank();
  run.company!.document.apis = [
    {
      type: "openapi",
      url: `${origin}/fdx/v6/openapi.json`,
      description: "FDX",
    },
    { type: "openapi", url: `${origin}/openapi.json`, description: "Own" },
  ];
  transport.mockClear();
  await connected(run);
  expect(transport.mock.calls.map(([u]) => u)).not.toContain(
    `${origin}/fdx/v6/openapi.json`,
  );
});

it("sends the token and Session header from the FDX tools, and the consent id the bank gave", async () => {
  const run = bank({ fdx: true });
  const tools = await connected(run);
  serve(async () => ({ id: "grant_7Hk2", status: "ACTIVE" }));
  expect(await tools.fdx_consent_status!.execute({})).toMatchObject({
    id: "grant_7Hk2",
    status: "ACTIVE",
  });
  const call = transport.mock.calls.at(-1)!;
  expect(call[0]).toBe(`${origin}/fdx/v6/consents/grant_7Hk2`);
  // No data cluster, but the grant's own token (and the Session header).
  expect(headersOf(call).Authorization).toBe("Bearer access-1");
  expect(headersOf(call)["Poppy-Session"]).toBeTruthy();
  expect(call[4]).toEqual({ errorBody: true });
});

it("leads to sign-in signed out, and asks for a new sign-in without the data clusters, sending nothing", async () => {
  const out = await connected(bank({ fdx: true, signedIn: false }));
  transport.mockClear();
  for (const name of ["fdx_list_accounts", "fdx_consent_status"])
    expect(await out[name]!.execute({})).toMatchObject({
      error:
        name === "fdx_consent_status" ? "consent_unknown" : "sign_in_required",
    });
  const run = bank({ fdx: true });
  run.scopes = "accounts:read fdx:ACCOUNT_BASIC";
  const tools = await connected(run);
  transport.mockClear();
  expect(await tools.fdx_list_accounts!.execute({ balances: true })).toEqual({
    error: "insufficient_scope",
    missing: ["fdx:ACCOUNT_DETAILED"],
    instruction: expect.stringContaining("sign in again with Use FDX on"),
  });
  expect(transport).not.toHaveBeenCalled();
});

it("gives the model an FDX-shaped error body as fdx_error, bounded", async () => {
  const tools = await connected(bank({ fdx: true }));
  serve(async () => {
    throw new ProtocolError(
      404,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { code: "701", message: "Account not found", note: "Fictional." },
    );
  });
  expect(
    await tools.fdx_get_account!.execute({ accountId: "acc_HLB_X" }),
  ).toEqual({
    error: "fdx_error",
    status: 404,
    code: "701",
    message: "Account not found",
  });
});

it.each([
  ["extension_required", new ProtocolError(403, "extension_required")],
  ["insufficient_scope", new ProtocolError(403, "insufficient_scope")],
  ["invalid_session", new ProtocolError(400, "invalid_session")],
  ["a token error", new ProtocolError(401, "invalid_token")],
  ["a bare challenge", new ProtocolError(401, undefined)],
  [
    "a server error with a body",
    new ProtocolError(
      503,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        code: "500",
      },
    ),
  ],
])("keeps the runtime's handling of %s", async (_name, error) => {
  const run = bank({ fdx: true });
  const tools = await connected(run);
  serve(async () => {
    throw error;
  });
  await expect(tools.fdx_list_accounts!.execute({})).rejects.toBe(error);
  if (error.code === "invalid_token") expect(run.accountUnavailable).toBe(true);
});

it("starts one new Session after session_ended from an FDX route (§5.5)", async () => {
  const run = bank({ fdx: true });
  const tools = await connected(run);
  const sid = run.sessionId;
  let first = true;
  serve(async () => {
    if (!first) return { accounts: [] };
    first = false;
    throw new ProtocolError(400, "session_ended");
  });
  expect(await tools.fdx_list_accounts!.execute({})).toEqual({ accounts: [] });
  expect(run.sessionId).not.toBe(sid);
});

it("keeps the consent id the bank returns on refresh (§4.4)", async () => {
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", origin);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const run = bank({ fdx: true });
  transport.mockResolvedValueOnce({
    access_token: "access-2",
    token_type: "Bearer",
    expires_in: 600,
    consent_id: "grant_new",
  });
  await renewAccount(run);
  expect(run.fdxConsent).toBe("grant_new");
  // A refresh without one keeps the grant's.
  transport.mockResolvedValueOnce({
    access_token: "access-3",
    token_type: "Bearer",
  });
  await renewAccount(run);
  expect(run.fdxConsent).toBe("grant_new");
});

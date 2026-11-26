/**
 * Use ESPI (`poppylab.dev/espi` v1) in the runtime, with a fake transport:
 * the declaration, the native tools, the Atom transport, which errors reach
 * the model and the User's revocation. `use-espi-fernwick.test.ts` drives
 * the real Fernwick app.
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
import { ESPI_LIMITS, ProtocolError } from "@poppy-lab/pap-client";
import type { CompanyProfile } from "@poppy-lab/pap-core";
import {
  connect,
  espiAuthorizationTarget,
  ESPI_GUIDANCE,
  papRequest,
  renewAccount,
  revokeEspiAuthorization,
  setExtension,
  type Connection,
} from "./runtime";
import { UserFacingError } from "./user-error";

const origin = "https://energy.example";
const RE = `${origin}/espi/1_1/resource`;
const espiEntry = { version: "1" as const, resource_endpoint: RE };
const SUB = "grant_7Hk2";
/** Fernwick's shape: its own API, and the ESPI-shaped one by extension only. */
function utility({
  espi = false,
  signedIn = true,
  saved = false,
} = {}): Connection {
  const profile: CompanyProfile = {
    version: "1.0",
    identifier: origin,
    issuer: origin,
    signIn: { direct: true, device: false },
    scopes: ["account:read", "espi:usage", "espi:summary", "espi:customer"],
    scopeDescriptions: {},
    scopeHints: {},
    operations: true,
    ...(saved ? {} : { extensions: { "poppylab.dev/espi": espiEntry } }),
  };
  return {
    url: origin,
    user: "",
    visitor: "visitor-fixture",
    ...(espi ? { espi: true } : {}),
    ...(signedIn
      ? {
          token: "access-1",
          tokenType: "Bearer" as const,
          accountToken: "refresh-1",
          scopes: "account:read espi:usage espi:summary",
          tokenExpires: Date.now() + 3600000,
          espiResourceUri: `${RE}/Batch/Subscription/${SUB}`,
          espiAuthorizationUri: `${RE}/Authorization/${SUB}`,
        }
      : {}),
    company: {
      requestedUrl: origin,
      discoveryUrl: origin + "/.well-known/poppy.json",
      discoveredAt: new Date().toISOString(),
      trace: [],
      document: {
        protocol_version: "1.0",
        organization: { name: "Utility", domain: "energy.example" },
        apis: [
          {
            type: "openapi",
            url: `${origin}/openapi.json`,
            description: "Own",
          },
        ],
        extensions: {
          operations: [{ version: "3" }],
          "poppylab.dev/espi": [espiEntry],
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
    "/api/account/bills": {
      get: {
        operationId: "bills",
        "x-poppy-scopes": ["account:read"],
        responses: { "200": {} },
      },
    },
    // Should the Company's own API list an ESPI-shaped route: never a tool.
    "/espi/1_1/resource/ReadingType": {
      get: { operationId: "own_espi_types", responses: { "200": {} } },
    },
  },
};
const atom = (xml: string) => ({
  contentType: "application/atom+xml",
  bytes: new TextEncoder().encode(xml),
});
const authorization = atom(
  `<entry xmlns="http://www.w3.org/2005/Atom" xmlns:espi="http://naesb.org/espi"><id>urn:uuid:a</id><title>Access</title><link rel="self" href="${RE}/Authorization/${SUB}"/><content><espi:Authorization><espi:status>1</espi:status><espi:expires_at>1800000000</espi:expires_at><espi:scope>espi:usage espi:summary</espi:scope></espi:Authorization></content></entry>`,
);
const headersOf = (call: unknown[]) =>
  (call[1] as RequestInit).headers as Record<string, string>;
const serve = (
  espiAnswer: () => Promise<unknown> = async () => authorization,
) =>
  transport.mockImplementation(async (url: string) => {
    if (url === `${origin}/openapi.json`) return ownSpec;
    if (url.includes("/.well-known/oauth-protected-resource"))
      throw new ProtocolError(404, undefined);
    if (url.startsWith(RE)) return espiAnswer();
    return { ok: true };
  });
beforeEach(() => {
  transport.mockReset();
  rediscover.mockReset();
  serve();
});
const connected = async (run: Connection, trace: string[] = []) => {
  rediscover.mockResolvedValue(run.company!);
  return connect(run, trace);
};
const espiCalls = () =>
  transport.mock.calls.filter(([url]) => String(url).startsWith(RE));

it("declares poppylab.dev/espi v1 next to Operations v3 only with Use ESPI on (§3.3, §3.4)", async () => {
  for (const [run, expected] of [
    [utility(), '"operations";v="3"'],
    [utility({ espi: true }), '"operations";v="3", "poppylab.dev/espi";v="1"'],
    // A saved profile without extensions: nothing to declare it from.
    [utility({ espi: true, saved: true }), '"operations";v="3"'],
    // Use FDX at a Company that lists only ESPI declares nothing more.
    [Object.assign(utility(), { fdx: true }), '"operations";v="3"'],
  ] as const) {
    transport.mockClear();
    await papRequest(run, `${origin}/api/account/bills`, "GET");
    expect(headersOf(transport.mock.calls.at(-1)!)["Poppy-Extensions"]).toBe(
      expected,
    );
  }
  const trace: string[] = [];
  await connected(utility({ espi: true }), trace);
  expect(trace[0]).toContain(
    'Poppy-Extensions "operations";v="3", "poppylab.dev/espi";v="1"',
  );
  expect(trace).toContain(
    "Extension poppylab.dev/espi v1 · native ESPI-shaped adapter · 4 read tools",
  );
});

it("starts a new Session when Use ESPI changes, and only then", () => {
  const run = utility();
  run.sessionId = "sid-1";
  expect(setExtension(run, "espi", false)).toBe(false);
  expect(run.sessionId).toBe("sid-1");
  expect(setExtension(run, "espi", true)).toBe(true);
  expect(run.espi).toBe(true);
  expect(run).not.toHaveProperty("fdx");
  expect(run.sessionId).not.toBe("sid-1");
  const on = run.sessionId;
  expect(setExtension(run, "espi", false)).toBe(true);
  expect(run.sessionId).not.toBe(on);
  expect(run).not.toHaveProperty("espi");
});

it("offers the ESPI tools only with Use ESPI on, steered to, and never an ESPI route as a generic tool", async () => {
  for (const espi of [false, true]) {
    const tools = await connected(utility({ espi }));
    expect(Object.keys(tools)).toContain("bills");
    expect(Object.keys(tools)).not.toContain("own_espi_types");
    expect(Object.keys(tools).filter((n) => n.startsWith("espi_"))).toEqual(
      espi
        ? ["espi_meters", "espi_usage", "espi_bills", "espi_authorization"]
        : [],
    );
    const steering = Object.entries(tools)
      .filter(([, tool]) => tool.description.includes(ESPI_GUIDANCE))
      .map(([name]) => name);
    expect(steering).toEqual(espi ? ["espi_meters"] : []);
    expect(
      tools.espi_meters?.description.startsWith(ESPI_GUIDANCE) ?? !espi,
    ).toBe(true);
  }
  expect(ESPI_GUIDANCE).toBe(
    "The User turned on Use ESPI: for electricity usage, costs and bills, use these espi_ tools rather than the Company's own API tools.",
  );
});

it("asks for Atom with the token, the Session header and the extension, at the authorization URI from the token response", async () => {
  const run = utility({ espi: true });
  const tools = await connected(run);
  transport.mockClear();
  expect(await tools.espi_authorization!.execute({})).toMatchObject({
    authorizationId: SUB,
    status: "active",
    scope: "espi:usage espi:summary",
  });
  const [call] = espiCalls();
  expect(espiCalls()).toHaveLength(1);
  expect(call![0]).toBe(`${RE}/Authorization/${SUB}`);
  expect((call![1] as RequestInit).method).toBe("GET");
  expect(headersOf(call!).Accept).toBe("application/atom+xml");
  expect(headersOf(call!).Authorization).toBe("Bearer access-1");
  expect(headersOf(call!)["Poppy-Session"]).toBeTruthy();
  expect(headersOf(call!)["Poppy-Extensions"]).toContain(
    '"poppylab.dev/espi";v="1"',
  );
  expect(call![4]).toEqual({
    errorBody: true,
    binary: { maxBytes: ESPI_LIMITS.feedBytes },
  });
});

it("leads to sign-in signed out, and asks for a new sign-in without the scope or subscription, sending nothing", async () => {
  const out = await connected(utility({ espi: true, signedIn: false }));
  transport.mockClear();
  for (const name of ["espi_meters", "espi_bills", "espi_authorization"])
    expect(
      await out[name]!.execute(
        name === "espi_bills" ? { usagePointId: "UP-E1" } : {},
      ),
    ).toMatchObject({ error: "sign_in_required" });
  const run = utility({ espi: true });
  run.scopes = "account:read espi:summary";
  const tools = await connected(run);
  delete run.espiAuthorizationUri;
  transport.mockClear();
  expect(await tools.espi_meters!.execute({})).toEqual({
    error: "insufficient_scope",
    // Iris answered this itself: nothing was sent to the Company.
    sent: false,
    missing: ["espi:usage"],
    instruction: expect.stringContaining("sign in again with Use ESPI on"),
  });
  expect(await tools.espi_authorization!.execute({})).toMatchObject({
    error: "authorization_unknown",
  });
  delete run.espiResourceUri;
  expect(await tools.espi_meters!.execute({})).toMatchObject({
    error: "subscription_unknown",
  });
  expect(transport).not.toHaveBeenCalled();
});

it("gives the model the utility's bare 404 and its own error body as espi_error", async () => {
  const tools = await connected(utility({ espi: true }));
  serve(async () => {
    throw new ProtocolError(404, undefined);
  });
  expect(await tools.espi_authorization!.execute({})).toEqual({
    error: "espi_error",
    status: 404,
  });
  serve(async () => {
    throw new ProtocolError(
      400,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        error: "invalid_parameter",
        description: "published-min must be an RFC 3339 date-time",
      },
    );
  });
  expect(await tools.espi_authorization!.execute({})).toEqual({
    error: "espi_error",
    status: 400,
    code: "invalid_parameter",
    description: "published-min must be an RFC 3339 date-time",
  });
});

it.each([
  ["extension_required", new ProtocolError(403, "extension_required")],
  ["insufficient_scope", new ProtocolError(403, "insufficient_scope")],
  ["invalid_session", new ProtocolError(400, "invalid_session")],
  ["a token error", new ProtocolError(401, "invalid_token")],
  ["a bare 401", new ProtocolError(401, undefined)],
  ["a rate limit", new ProtocolError(429, undefined)],
  ["a server error", new ProtocolError(503, undefined)],
])("keeps the runtime's handling of %s", async (_name, error) => {
  const run = utility({ espi: true });
  const tools = await connected(run);
  serve(async () => {
    throw error;
  });
  await expect(tools.espi_authorization!.execute({})).rejects.toBe(error);
  if (error.code === "invalid_token") expect(run.accountUnavailable).toBe(true);
});

it("keeps the subscription and authorization URIs the utility returns on refresh (§4.4)", async () => {
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", origin);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const run = utility({ espi: true });
  transport.mockResolvedValueOnce({
    access_token: "access-2",
    token_type: "Bearer",
    resourceURI: `${RE}/Batch/Subscription/grant_new`,
    authorizationURI: "https://elsewhere.example/Authorization/grant_new",
  });
  await renewAccount(run);
  expect(run.espiResourceUri).toBe(`${RE}/Batch/Subscription/grant_new`);
  // One that doesn't fit the entry isn't kept.
  expect(run.espiAuthorizationUri).toBe(`${RE}/Authorization/${SUB}`);
});

it("revokes with one DELETE of the kept authorization URI, as a Poppy request with the extension declared", async () => {
  const run = utility({ espi: true });
  transport.mockResolvedValue(null);
  const trace: string[] = [];
  await revokeEspiAuthorization(run, trace);
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, init, , , options] = transport.mock.calls[0]!;
  expect(url).toBe(`${RE}/Authorization/${SUB}`);
  expect((init as RequestInit).method).toBe("DELETE");
  expect((init as RequestInit).body).toBeUndefined();
  const headers = headersOf(transport.mock.calls[0]!);
  expect(headers["Content-Type"]).toBeUndefined();
  expect(headers.Authorization).toBe("Bearer access-1");
  expect(headers["Poppy-Session"]).toBeTruthy();
  expect(headers["Poppy-Extensions"]).toContain('"poppylab.dev/espi";v="1"');
  expect(options).toEqual({ acceptEmpty: true });
  expect(trace).toEqual([
    `DELETE /espi/1_1/resource/Authorization/${SUB} · ESPI authorization revoked · 204`,
  ]);
  // A failure is traced and thrown.
  transport.mockRejectedValue(new ProtocolError(500, undefined));
  const failed: string[] = [];
  await expect(revokeEspiAuthorization(run, failed)).rejects.toBeInstanceOf(
    ProtocolError,
  );
  expect(failed).toEqual([
    `DELETE /espi/1_1/resource/Authorization/${SUB} · ESPI authorization revocation failed · 500`,
  ]);
});

it("has nothing to revoke with Use ESPI off, signed out, refused, or with an authorization URI that doesn't fit", async () => {
  const runs: Connection[] = [
    utility(),
    utility({ espi: true, signedIn: false }),
    Object.assign(utility({ espi: true }), { accountUnavailable: true }),
    Object.assign(utility({ espi: true }), {
      espiAuthorizationUri: `${RE}/Authorization/${SUB}?x`,
    }),
    Object.assign(utility({ espi: true }), {
      espiAuthorizationUri: `https://elsewhere.example/espi/1_1/resource/Authorization/${SUB}`,
    }),
  ];
  for (const run of runs) {
    expect(espiAuthorizationTarget(run)).toBeUndefined();
    await expect(revokeEspiAuthorization(run, [])).rejects.toBeInstanceOf(
      UserFacingError,
    );
  }
  expect(transport).not.toHaveBeenCalled();
  expect(espiAuthorizationTarget(utility({ espi: true }))).toMatchObject({
    id: SUB,
    url: `${RE}/Authorization/${SUB}`,
  });
});

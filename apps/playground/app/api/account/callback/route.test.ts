import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const s = vi.hoisted(() => ({
  run: {
    protocol: "1.0",
    url: "https://food.papsandbox.com",
    user: "usr_food",
    expires: Date.now() + 60000,
    busy: false,
    history: [{ role: "user", content: "Previous account data" }] as Array<{
      role: "user" | "assistant";
      content: string;
    }>,
    operations: { old: {} } as Record<string, unknown>,
    accountToken: "old-refresh" as string | undefined,
    token: undefined as string | undefined,
    scopes: undefined as string | undefined,
    publicHistory: undefined as
      Array<{ role: "user" | "assistant"; content: string }> | undefined,
    dpop: undefined as object | undefined,
    sessionId: "session_1",
    consentVersion: 0,
    auth: undefined as
      | undefined
      | {
          state: string;
          verifier: string;
          issuer: string;
          scopes: string;
          expires: number;
          dpop?: object;
        },
  },
  request: vi.fn(),
  /** The Company's answer to a request Iris sends as the run. */
  pap: vi.fn(),
  revoke: vi.fn(async () => undefined),
  set: vi.fn(),
  remove: vi.fn(),
  dpop: true,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => ({
      value: name.includes("visitor") ? "v".repeat(43) : "state_test",
    }),
    set: s.set,
    delete: s.remove,
  }),
}));
vi.mock("@/lib/runtime", () => {
  return {
    identity: async () => ({ privateKey: {} }),
    clientFor: () => "https://identity.example/agent/client.json",
    agentFor: () => "https://identity.example",
    localOrigins: [],
    accountConfiguration: () => ({
      issuer: "https://food.papsandbox.com",
      token_endpoint: "https://food.papsandbox.com/oauth/token",
    }),
    usesDpop: () => s.dpop,
    newSession: (run: { sessionId?: string }) => {
      run.sessionId = `new_${Math.random()}`;
    },
    revokeRefreshToken: s.revoke,
    papRequest: s.pap,
  };
});
vi.mock("@poppy-lab/pap-client", async (original) => ({
  ...(await original<typeof import("@poppy-lab/pap-client")>()),
  assertion: async () => "assertion_test",
  proof: async () => "proof_test",
  protocolRequest: s.request,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture"), { code: "ENOENT" });
  }),
}));
vi.mock("@/lib/deployment", () => ({
  serving: () => process.env.NODE_ENV === "development",
  publicMode: () => false,
  isAccountCompany: (origin: string) =>
    ["http://juniper.localhost:4100", "https://food.papsandbox.com"].includes(
      origin,
    ),
  proposalsAllowed: () => true,
  localOrigins: ["http://juniper.localhost:4100"],
}));
import { GET } from "./route";
import { seedRun } from "@/lib/runs";
import { directState } from "@/lib/direct-state";
import { ProtocolError } from "@poppy-lab/pap-client";
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  s.run.busy = false;
  await seedRun("v".repeat(43), "run_fixture_0001", s.run as never);
  s.request.mockReset();
  s.revoke.mockClear();
  s.set.mockReset();
  s.dpop = true;
  Object.assign(s.run, {
    busy: false,
    accountToken: "old-refresh",
    token: undefined,
    scopes: undefined,
    publicHistory: undefined,
    history: [{ role: "user", content: "Previous account data" }],
    operations: { old: {} },
    sessionId: "session_1",
    consentVersion: 0,
    dpop: undefined,
  });
  s.run.auth = {
    state: "state_test",
    verifier: "verifier_test",
    issuer: "https://food.papsandbox.com",
    scopes: "orders:read",
    expires: Date.now() + 60000,
    dpop: { kty: "EC" },
  };
});
const req = (iss = "https://food.papsandbox.com", state = "state_test") =>
  new Request(
    "http://localhost:3000/api/account/callback?" +
      new URLSearchParams({ code: "code_test", state, iss }),
  );
const success = (extra: Record<string, unknown> = {}) => ({
  access_token: "new-access",
  refresh_token: "new-refresh",
  token_type: "DPoP",
  expires_in: 3600,
  ...extra,
});

it("exchanges the code with PKCE, no session_id, and starts a new Session", async () => {
  s.request.mockResolvedValue(success());
  expect((await GET(req())).status).toBe(200);
  const [url, init] = s.request.mock.calls[0]!;
  expect(url).toBe("https://food.papsandbox.com/oauth/token");
  const form = new URLSearchParams(init.body);
  expect(form.get("grant_type")).toBe("authorization_code");
  expect(form.get("code_verifier")).toBe("verifier_test");
  expect(form.get("redirect_uri")).toBe(
    "https://identity.example/api/account/callback",
  );
  expect(form.has("session_id")).toBe(false);
  expect(init.headers.DPoP).toBe("proof_test");
  // §4.7: scope omitted means exactly the requested scopes.
  expect(s.run.scopes).toBe("orders:read");
  expect(s.run.token).toBe("new-access");
  expect(s.run.accountToken).toBe("new-refresh");
  expect(s.run.sessionId).not.toBe("session_1");
  expect(s.run.operations).toEqual({});
  expect(s.run.consentVersion).toBe(1);
  // The replaced refresh token is revoked (best effort), not reused.
  expect(s.revoke).toHaveBeenCalledWith(s.run, "old-refresh");
  expect(s.run.auth).toBeUndefined();
});

it("keeps the FDX-shaped consent id of the grant, and drops an earlier one when there is none (poppylab.dev/fdx v1)", async () => {
  const run = s.run as typeof s.run & { fdxConsent?: string };
  s.request.mockResolvedValue(success({ consent_id: "grant_7Hk2" }));
  expect((await GET(req())).status).toBe(200);
  expect(run.fdxConsent).toBe("grant_7Hk2");
  // A base64url grant ID may start with - or _: kept.
  for (const consent_id of ["-Hk2_a", "_Hk2-a"]) {
    s.run.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
      dpop: { kty: "EC" },
    };
    s.request.mockResolvedValue(success({ consent_id }));
    expect((await GET(req())).status).toBe(200);
    expect(run.fdxConsent).toBe(consent_id);
  }
  // Not one path segment: not kept.
  for (const consent_id of [undefined, "../grant", ".", 7]) {
    run.fdxConsent = "grant_old";
    s.run.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
      dpop: { kty: "EC" },
    };
    s.request.mockResolvedValue(success({ consent_id }));
    expect((await GET(req())).status).toBe(200);
    expect(run.fdxConsent).toBeUndefined();
  }
});

it("keeps the ESPI-shaped subscription and authorization URIs that fit the entry, and drops earlier ones (poppylab.dev/espi v1)", async () => {
  const RE = "https://food.papsandbox.com/espi/1_1/resource";
  const run = s.run as typeof s.run & {
    company?: unknown;
    espiResourceUri?: string;
    espiAuthorizationUri?: string;
  };
  const sign = async (fields: Record<string, unknown>) => {
    s.run.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
      dpop: { kty: "EC" },
    };
    s.request.mockResolvedValue(success(fields));
    expect((await GET(req())).status).toBe(200);
  };
  run.company = {
    profile: {
      extensions: {
        "poppylab.dev/espi": { version: "1", resource_endpoint: RE },
      },
    },
  };
  try {
    await sign({
      resourceURI: `${RE}/Batch/Subscription/grant_7Hk2`,
      authorizationURI: `${RE}/Authorization/grant_7Hk2`,
    });
    expect(run.espiResourceUri).toBe(`${RE}/Batch/Subscription/grant_7Hk2`);
    expect(run.espiAuthorizationUri).toBe(`${RE}/Authorization/grant_7Hk2`);
    // Elsewhere, or not exactly the shape: not kept, and the earlier gone.
    await sign({
      resourceURI:
        "https://evil.example/espi/1_1/resource/Batch/Subscription/g",
      authorizationURI: `${RE}/Authorization/grant_7Hk2/../x`,
    });
    expect(run.espiResourceUri).toBeUndefined();
    expect(run.espiAuthorizationUri).toBeUndefined();
  } finally {
    delete run.company;
  }
});

it("forgets the per-service tokens of the sign-in it replaces (§4.5)", async () => {
  const run = s.run as { resourceTokens?: unknown };
  const cached = {
    "https://food.papsandbox.com/api": {
      value: "old-service-token",
      type: "DPoP",
      expires: Date.now() + 3600000,
    },
  };
  try {
    // A failed exchange keeps the previous access, and so its tokens.
    run.resourceTokens = structuredClone(cached);
    s.request.mockResolvedValueOnce(success({ refresh_token: undefined }));
    expect((await GET(req())).status).toBe(400);
    expect(run.resourceTokens).toEqual(cached);
    // They were issued to the old sign-in's account, scopes and DPoP key.
    s.run.auth = {
      state: "state_test",
      verifier: "verifier_test",
      issuer: "https://food.papsandbox.com",
      scopes: "orders:read",
      expires: Date.now() + 60000,
      dpop: { kty: "EC" },
    };
    s.request.mockResolvedValueOnce(success());
    expect((await GET(req())).status).toBe(200);
    expect(run.resourceTokens).toBeUndefined();
  } finally {
    delete run.resourceTokens;
  }
});

it("uses Bearer tokens when the issuer doesn't bind DPoP", async () => {
  s.dpop = false;
  s.request.mockResolvedValue(success({ token_type: "Bearer" }));
  expect((await GET(req())).status).toBe(200);
  expect(s.request.mock.calls[0]![1].headers).not.toHaveProperty("DPoP");
  expect(s.run.token).toBe("new-access");
});

it.each([
  ["a broader grant", { scope: "orders:read orders:write" }],
  ["a missing refresh token", { refresh_token: undefined }],
  ["an unexpected token type", { token_type: "Bearer" }],
])("rejects %s and keeps the previous access", async (_name, extra) => {
  s.request.mockResolvedValue(success(extra));
  const before = structuredClone({
    token: s.run.token,
    refresh: s.run.accountToken,
    history: s.run.history,
    session: s.run.sessionId,
  });
  expect((await GET(req())).status).toBe(400);
  expect({
    token: s.run.token,
    refresh: s.run.accountToken,
    history: s.run.history,
    session: s.run.sessionId,
  }).toEqual(before);
  expect(s.revoke).not.toHaveBeenCalled();
});

it("preserves the public conversation on first sign-in", async () => {
  s.run.accountToken = undefined;
  const publicTurns = [
    { role: "user" as const, content: "When do you deliver?" },
    { role: "assistant" as const, content: "Tuesday, Thursday and Saturday." },
  ];
  s.run.history = structuredClone(publicTurns);
  s.request.mockResolvedValue(success());
  expect((await GET(req())).status).toBe(200);
  expect(s.run.history).toEqual(publicTurns);
  expect(s.run.publicHistory).toEqual(publicTurns);
  expect(s.revoke).not.toHaveBeenCalled();
});

it("retains only pre-account turns on later consent, never another account's context", async () => {
  s.run.publicHistory = [{ role: "user", content: "When do you deliver?" }];
  s.run.history = [
    ...s.run.publicHistory,
    { role: "assistant", content: "Private order details" },
  ];
  s.request.mockResolvedValue(success());
  expect((await GET(req())).status).toBe(200);
  expect(JSON.stringify(s.run.history)).not.toContain("Private order");
});

describe("the conversation with the Company's agent across a sign-in (§8.2)", () => {
  const endpoint = "https://food.papsandbox.com/poppy/conversations";
  const run = s.run as typeof s.run & { conversation?: unknown };
  // The User is in a Direct Conversation, and the Company had asked again.
  const open = () => ({
    endpoint,
    id: "cnv_1",
    cursor: "evt_9",
    seen: ["evt_9"],
    invitation: { event: "evt_ur", reason: "About order ord_LNB0907" },
    direct: { id: "cnv_d", cursor: "evt_d3", seen: ["evt_d3"] },
  });
  beforeEach(() => {
    s.pap.mockReset();
    run.conversation = open();
    s.request.mockResolvedValue(success());
  });
  afterEach(() => {
    delete run.conversation;
  });

  it("keeps it for the same account: the Company still takes the new sign-in on both threads", async () => {
    const tokens: unknown[] = [];
    s.pap.mockImplementation(async (r: { token?: string }) => {
      tokens.push(r.token);
      return { conversation_id: "cnv_1", events: [] };
    });
    expect((await GET(req())).status).toBe(200);
    expect(run.conversation).toEqual(open());
    // Asked with the new sign-in, as reads that change nothing here.
    expect(tokens).toEqual(["new-access", "new-access"]);
    expect(s.pap.mock.calls.map((call) => call.slice(1))).toEqual([
      [`${endpoint}/cnv_1/events?cursor=evt_9`, "GET"],
      [`${endpoint}/cnv_d/events?cursor=evt_d3`, "GET"],
    ]);
    expect(directState(s.run as never).direct).toBe(true);
  });

  it.each([
    [
      "says it belongs to another account",
      new ProtocolError(404, "conversation_not_found"),
    ],
    ["doesn't answer", new Error("socket hang up")],
  ])(
    "forgets it, and the Direct Conversation with it, when the Company %s",
    async (_name, error) => {
      s.pap.mockRejectedValue(error);
      expect((await GET(req())).status).toBe(200);
      expect(s.run.accountToken).toBe("new-refresh");
      expect(run.conversation).toBeUndefined();
      // What a reloaded page is told: no Direct Conversation, no invitation.
      expect(directState(s.run as never)).toEqual({
        direct: false,
        conversation: false,
        invitation: null,
      });
    },
  );

  it("forgets it when only the User's own thread belongs to another account", async () => {
    s.pap.mockImplementation(async (_run: unknown, url: string) => {
      if (url.includes("/cnv_d/"))
        throw new ProtocolError(404, "conversation_not_found");
      return { conversation_id: "cnv_1", events: [] };
    });
    expect((await GET(req())).status).toBe(200);
    expect(run.conversation).toBeUndefined();
  });

  it("keeps a signed-out conversation on first sign-in without asking: no account has used it (§8.11)", async () => {
    s.run.accountToken = undefined;
    expect((await GET(req())).status).toBe(200);
    expect(run.conversation).toEqual(open());
    expect(s.pap).not.toHaveBeenCalled();
  });

  it("leaves it alone when the sign-in fails", async () => {
    s.request.mockResolvedValue(success({ refresh_token: undefined }));
    expect((await GET(req())).status).toBe(400);
    expect(run.conversation).toEqual(open());
    expect(s.pap).not.toHaveBeenCalled();
  });
});

it("rejects wrong issuer or state without exchanging the code", async () => {
  expect((await GET(req("https://flowers.papsandbox.com"))).status).toBe(400);
  expect((await GET(req(undefined, "other_state"))).status).toBe(400);
  expect(s.request).not.toHaveBeenCalled();
});

it("is single use", async () => {
  s.request.mockResolvedValue(success());
  expect((await GET(req())).status).toBe(200);
  expect((await GET(req())).status).toBe(400);
  expect(s.request).toHaveBeenCalledTimes(1);
});

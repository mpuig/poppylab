import { beforeEach, it, expect, vi } from "vitest";
const s = vi.hoisted(() => ({
  run: {
    protocol: "0.3",
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

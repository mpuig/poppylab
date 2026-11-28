import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  protocolRequest: vi.fn(),
  revokeRefreshToken: vi.fn(async () => undefined),
  papRequest: vi.fn(),
  probeSession: vi.fn(async () => "unknown"),
}));

vi.mock("@poppy-lab/pap-client", async (original) => ({
  ...(await original<typeof import("@poppy-lab/pap-client")>()),
  assertion: async () => "assertion_test",
  proof: async () => "proof_test",
  protocolRequest: state.protocolRequest,
}));

vi.mock("./runtime", async (original) => ({
  ...(await original<typeof import("./runtime")>()),
  identity: async () => ({ privateKey: {} }),
  clientFor: () => "https://identity.example/agent/client.json",
  agentFor: () => "https://identity.example",
  localOrigins: [],
  accountConfiguration: () => ({
    issuer: "https://food.papsandbox.com",
    token_endpoint: "https://food.papsandbox.com/oauth/token",
  }),
  usesDpop: () => false,
  newSession: (connection: { sessionId?: string }) => {
    connection.sessionId = "sid_new";
  },
  revokeRefreshToken: state.revokeRefreshToken,
  papRequest: state.papRequest,
  probeSession: state.probeSession,
}));

import {
  configureBackend,
  createRun,
  memoryBackend,
  releaseRun,
  visitorOf,
  type Backend,
} from "./runs";
import { signInCallback } from "./sign-in-callback";
import type { CookieStore } from "./web";

const COMPANY = "https://food.papsandbox.com";
const VISITOR_COOKIE = "v".repeat(43);

function copyingBackend(): Backend {
  const inner = memoryBackend();
  return {
    async get(visitor, key) {
      const entry = await inner.get(visitor, key);
      return entry ? structuredClone(entry) : undefined;
    },
    put(visitor, key, value, expected, expires) {
      return inner.put(visitor, key, structuredClone(value), expected, expires);
    },
    remove: (visitor, key) => inner.remove(visitor, key),
    async list(visitor, prefix) {
      return (await inner.list(visitor, prefix)).map(([k, v]) => [
        k,
        structuredClone(v),
      ]);
    },
    count: (visitor, key, windowMs) => inner.count(visitor, key, windowMs),
  };
}

function makeCookies(signInState: string): CookieStore {
  return {
    get: (name: string) => ({
      value: name.includes("visitor") ? VISITOR_COOKIE : signInState,
    }),
    set: () => {},
  };
}

function callbackRequest(signInState: string) {
  return new Request(
    "http://localhost:3000/api/account/callback?" +
      new URLSearchParams({
        code: "code_123",
        state: signInState,
        iss: COMPANY,
      }).toString(),
  );
}

describe("signInCallback persistence failure handling", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    state.protocolRequest.mockReset().mockResolvedValue({
      access_token: "new_access",
      refresh_token: "new_refresh",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "orders:read",
    });
    state.revokeRefreshToken.mockReset().mockResolvedValue(undefined);
    state.papRequest.mockReset();
    state.probeSession.mockReset().mockResolvedValue("unknown");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    configureBackend(memoryBackend());
  });

  it("redirects to failed when releaseRun fails with RunNotSaved", async () => {
    const store = copyingBackend();
    configureBackend(store);
    const cookies = makeCookies("state_save_fail");
    const visitor = visitorOf(cookies)!;
    const held = await createRun(visitor, COMPANY);
    const conn = held.run.connections[0]!;
    conn.accountToken = "old_refresh";
    conn.auth = {
      state: "state_save_fail",
      verifier: "verifier_1",
      issuer: COMPANY,
      scopes: "orders:read",
      expires: Date.now() + 60_000,
    };
    await releaseRun(visitor, held);

    // First put is acquireRun's lock write; second put is releaseRun's save.
    const realPut = store.put;
    let puts = 0;
    store.put = async (v, key, value, expected, expires) => {
      puts += 1;
      if (puts === 2) throw new Error("storage unavailable");
      return realPut(v, key, value, expected, expires);
    };

    const response = await signInCallback(
      callbackRequest("state_save_fail"),
      cookies,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/playground/sign-in/failed");
    // The new sign-in wasn't saved, so the still-stored refresh token isn't revoked.
    expect(state.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it("redirects to done and keeps replaced refresh token revocation best-effort when releaseRun succeeds", async () => {
    const store = copyingBackend();
    configureBackend(store);
    const cookies = makeCookies("state_save_ok");
    const visitor = visitorOf(cookies)!;
    const held = await createRun(visitor, COMPANY);
    const conn = held.run.connections[0]!;
    conn.accountToken = "old_refresh";
    conn.auth = {
      state: "state_save_ok",
      verifier: "verifier_1",
      issuer: COMPANY,
      scopes: "orders:read",
      expires: Date.now() + 60_000,
    };
    await releaseRun(visitor, held);

    state.revokeRefreshToken.mockRejectedValueOnce(new Error("network blip"));

    const response = await signInCallback(
      callbackRequest("state_save_ok"),
      cookies,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/playground/sign-in/done");
    expect(state.revokeRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ url: COMPANY, accountToken: "new_refresh" }),
      "old_refresh",
    );
  });

  it("finishes revoking the replaced refresh token before it answers", async () => {
    const store = copyingBackend();
    configureBackend(store);
    const cookies = makeCookies("state_revoke_wait");
    const visitor = visitorOf(cookies)!;
    const held = await createRun(visitor, COMPANY);
    const conn = held.run.connections[0]!;
    conn.accountToken = "old_refresh";
    conn.auth = {
      state: "state_revoke_wait",
      verifier: "verifier_1",
      issuer: COMPANY,
      scopes: "orders:read",
      expires: Date.now() + 60_000,
    };
    await releaseRun(visitor, held);

    // On Workers, work still pending after the response may never run.
    let revoked = false;
    state.revokeRefreshToken.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      revoked = true;
    });

    const response = await signInCallback(
      callbackRequest("state_revoke_wait"),
      cookies,
    );

    expect(response.status).toBe(303);
    expect(revoked).toBe(true);
  });
});

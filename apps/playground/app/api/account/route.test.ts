import type * as OperationStore from "../../../lib/operation-store";
import { beforeEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  run: {
    url: "http://juniper.localhost:4100",
    expires: Date.now() + 60000,
    busy: false,
    accountToken: "secret",
    token: "general-token",
    tokenExpires: Date.now() + 60000,
    scopes: "poppy:read poppy:write",
    accountUnavailable: false,
    operations: {
      op_test: {
        operation_id: "op_test",
        revision: "r1",
        state: "proposed",
        summary: "Move fictional delivery",
        terms: { to: "Saturday" },
        expires_at: new Date(Date.now() + 60000).toISOString(),
        request: {
          url: "http://juniper.localhost:4100/api/account/delivery-change",
          body: { day: "Saturday" },
        },
      } as Record<string, unknown>,
    },
    history: [] as unknown[],
    company: {
      document: {},
      profile: {
        version: "0.3",
        identifier: "http://juniper.localhost:4100",
        issuer: "http://juniper.localhost:4100",
        signIn: { direct: true, device: false },
        scopes: ["poppy:read", "poppy:write"],
        scopeDescriptions: {},
        scopeHints: {
          "poppy:read": { changes: "none", personal_data: true },
          "poppy:write": { changes: "irreversible", personal_data: true },
        },
      },
    } as unknown,
  },
  request: vi.fn(),
  revoke: vi.fn(),
  connect: vi.fn(async (run: Record<string, unknown>): Promise<unknown> =>
    Object.assign(run, {
      company: {
        document: {
          protocol_version: "0.3",
          organization: { name: "Juniper", domain: "juniper.localhost" },
        },
        profile: {
          version: "0.3",
          identifier: "http://juniper.localhost:4100",
          issuer: "http://juniper.localhost:4100",
          signIn: { direct: true, device: false },
          scopes: ["poppy:read", "poppy:write"],
          scopeDescriptions: {},
          scopeHints: {
            "poppy:read": { changes: "none", personal_data: true },
            "poppy:write": { changes: "irreversible", personal_data: true },
          },
        },
      },
    }),
  ),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => ({
      value: name.includes("visitor") ? "v".repeat(43) : "run_fixture_0001",
    }),
    set: vi.fn(),
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

vi.mock("@/lib/runtime", async () => ({
  localOrigins: ["http://juniper.localhost:4100"],
  sendApproval: state.request,
  recordOperation: (
    await vi.importActual<typeof OperationStore>("../../../lib/operation-store")
  ).recordOperation,
  connect: state.connect,
  clientFor: () => "http://localhost:3000/agent/client.json",
  agentFor: () => "http://localhost:3000",
  accountConfiguration: () => ({
    issuer: "http://juniper.localhost:4100",
    authorization_endpoint: "http://juniper.localhost:4100/oauth/authorize",
  }),
  usesDpop: () => true,
  revokeRefreshToken: state.revoke,
  identity: vi.fn(async () => ({ privateKey: {} })),
  clientId: "http://localhost:3000/agent/client.json",
  agentOrigin: "http://localhost:3000",
}));

import { POST, GET } from "./route";
import { seedRun } from "@/lib/runs";
import { ProtocolError } from "@poppy-lab/pap-client";
function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/account", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  Object.assign(state.run, { protocol: "0.3", busy: false });
  await seedRun("v".repeat(43), "run_fixture_0001", state.run as never);
  state.run.operations.op_test = {
    operation_id: "op_test",
    revision: "r1",
    state: "proposed",
    summary: "Move fictional delivery",
    terms: { to: "Saturday" },
    expires_at: new Date(Date.now() + 60000).toISOString(),
    request: {
      url: "http://juniper.localhost:4100/api/account/delivery-change",
      body: { day: "Saturday" },
    },
  };
  state.run.busy = false;
  state.run.url = "http://juniper.localhost:4100";
  state.run.accountToken = "secret";
  state.run.scopes = "poppy:read poppy:write";
  state.run.accountUnavailable = false;
  state.request.mockReset();
  state.revoke.mockReset();
  state.run.token = "general-token";
  state.run.tokenExpires = Date.now() + 60000;
});
describe("Human-controlled account boundary", () => {
  it("keeps the active access if revocation has an uncertain failure", async () => {
    state.revoke.mockRejectedValue(new Error("lost response"));
    expect((await POST(request({ action: "signout" }))).status).toBe(400);
    expect(state.run.accountToken).toBe("secret");
    expect(state.run.token).toBe("general-token");
    expect(state.revoke).toHaveBeenCalledTimes(1);
  });
  it("signs out by revoking the refresh token; the Session continues signed out", async () => {
    state.revoke.mockResolvedValue(undefined);
    expect((await POST(request({ action: "signout" }))).status).toBe(200);
    expect(state.revoke).toHaveBeenCalledWith(state.run, "secret");
    expect(state.run.accountToken).toBeUndefined();
    expect(state.run.token).toBeUndefined();
  });
  it("asks for the Company's read-only scopes by default, with PKCE and a DPoP key", async () => {
    const r = await POST(request({ action: "signin" }));
    expect(r.status).toBe(200);
    const url = new URL((await r.json()).url);
    expect(url.searchParams.get("scope")).toBe("poppy:read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("session_id")).toBe(false);
    expect(state.run).toHaveProperty("auth.dpop");
  });
  it("starts consent with a separate candidate without destroying the current account", async () => {
    const history = state.run.history,
      operations = state.run.operations;
    const r = await POST(request({ action: "signin" }));
    expect(r.status).toBe(200);
    expect(new URL((await r.json()).url).searchParams.get("scope")).toBe(
      "poppy:read",
    );
    expect(state.connect.mock.calls.at(-1)![0]).not.toBe(state.run);
    expect(state.run.accountToken).toBe("secret");
    expect(state.run.history).toBe(history);
    expect(state.run.operations).toBe(operations);
  });
  it("requests write only through the explicit permission choice", async () => {
    const r = await POST(request({ action: "signin", access: "write" }));
    expect(r.status).toBe(200);
    expect(new URL((await r.json()).url).searchParams.get("scope")).toBe(
      "poppy:read poppy:write",
    );
  });
  it("refuses write consent when the Company only advertises read", async () => {
    state.connect.mockImplementationOnce(async (run) =>
      Object.assign(run, {
        company: {
          document: {},
          profile: {
            version: "0.3",
            identifier: "http://juniper.localhost:4100",
            signIn: { direct: true, device: false },
            scopes: ["poppy:read"],
            scopeDescriptions: {},
            scopeHints: {
              "poppy:read": { changes: "none", personal_data: true },
            },
          },
        },
      }),
    );
    expect(
      (await POST(request({ action: "signin", access: "write" }))).status,
    ).toBe(400);
  });
  it("rejects arbitrary scope requests", async () => {
    expect(
      (await POST(request({ action: "signin", access: "admin" }))).status,
    ).toBe(400);
  });
  it("blocks approval under read-only access before any remote request", async () => {
    state.run.scopes = "poppy:read";
    const r = await POST(
      request({ action: "approve", id: "op_test", revision: "r1" }),
    );
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("insufficient_scope");
    expect(state.request).not.toHaveBeenCalled();
  });
  it("explains expiry without submitting the approval", async () => {
    state.run.operations.op_test.expires_at = new Date(
      Date.now() - 1,
    ).toISOString();
    const r = await POST(
      request({ action: "approve", id: "op_test", revision: "r1" }),
    );
    expect(r.status).toBe(410);
    expect((await r.json()).code).toBe("proposal_expired");
    expect(state.request).not.toHaveBeenCalled();
  });
  it("declines locally: nothing is sent and the request is forgotten", async () => {
    const r = await POST(
      request({ action: "decline", id: "op_test", revision: "r1" }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).operation.state).toBe("declined");
    expect(state.run.operations.op_test).not.toHaveProperty("request");
    expect(state.request).not.toHaveBeenCalled();
  });
  it("sends the server-owned request with the approval, ignoring client-supplied terms", async () => {
    let sent: unknown;
    state.request.mockImplementation(async (_run: unknown, op: unknown) => {
      sent = structuredClone(op);
      return { operation_id: "op_test", summary: "Done" };
    });
    const r = await POST(
      request({
        action: "approve",
        id: "op_test",
        revision: "r1",
        terms: { to: "evil" },
        approved_by: "standing",
      }),
    );
    expect(r.status).toBe(200);
    expect(sent).toMatchObject({
      operation_id: "op_test",
      revision: "r1",
      request: {
        url: "http://juniper.localhost:4100/api/account/delivery-change",
        body: { day: "Saturday" },
      },
    });
    const op = (await r.json()).operation;
    expect(op).toMatchObject({
      state: "succeeded",
      result: { summary: "Done" },
    });
    expect(JSON.stringify(op)).not.toContain("secret");
  });
  it("shows new terms for a fresh approval when the Company refuses the approved revision", async () => {
    state.request.mockRejectedValue(
      new ProtocolError(403, "approval_required", undefined, undefined, {
        operation_id: "op_test",
        revision: "r2",
        summary: "Move fictional delivery, now with a fee",
        terms: { to: "Saturday", fee_cents: 100 },
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    const r = await POST(
      request({ action: "approve", id: "op_test", revision: "r1" }),
    );
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.code).toBe("terms_changed");
    expect(body.operation).toMatchObject({ revision: "r2", state: "proposed" });
    expect(state.request).toHaveBeenCalledTimes(1);
    // The old approval can't be reused for the new terms.
    expect(
      (
        await POST(
          request({ action: "approve", id: "op_test", revision: "r1" }),
        )
      ).status,
    ).toBe(400);
  });
  it("refuses a Company that answers an approval with the same revision", async () => {
    state.request.mockRejectedValue(
      new ProtocolError(403, "approval_required", undefined, undefined, {
        ...state.run.operations.op_test,
        request: undefined,
        state: undefined,
      }),
    );
    const r = await POST(
      request({ action: "approve", id: "op_test", revision: "r1" }),
    );
    expect(r.status).not.toBe(200);
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["lost response", new Error("socket hang up")],
    [
      "503 while performing",
      new ProtocolError(503, undefined, Date.now() + 1000),
    ],
  ])(
    "marks the outcome unknown after a %s and retries only the same approval on request",
    async (_name, error) => {
      state.request.mockRejectedValueOnce(error);
      const r = await POST(
        request({ action: "approve", id: "op_test", revision: "r1" }),
      );
      expect([429, 502]).toContain(r.status);
      expect(state.run.operations.op_test.state).toBe("uncertain");
      expect(state.request).toHaveBeenCalledTimes(1);
      // A new approval isn't possible; only "retry" resends the same one.
      expect(
        (
          await POST(
            request({ action: "approve", id: "op_test", revision: "r1" }),
          )
        ).status,
      ).toBe(410);
      state.request.mockResolvedValueOnce({ summary: "Done once" });
      const retried = await POST(
        request({ action: "retry", id: "op_test", revision: "r1" }),
      );
      expect(retried.status).toBe(200);
      expect(state.request).toHaveBeenCalledTimes(2);
      expect(state.request.mock.calls[1]![1]).toMatchObject({ revision: "r1" });
    },
  );
  it("marks unavailable access without retrying or deleting pending review", async () => {
    state.request.mockRejectedValue(new ProtocolError(401, "invalid_token"));
    const r = await POST(
      request({ action: "approve", id: "op_test", revision: "r1" }),
    );
    expect(r.status).toBe(401);
    expect((await r.json()).code).toBe("account_unavailable");
    expect(state.run.accountUnavailable).toBe(true);
    const restored = await (await GET()).json();
    expect(restored.signedIn).toBe(false);
    expect(state.run.operations.op_test.state).toBe("proposed");
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-origin approval", async () => {
    expect(
      (
        await POST(
          request(
            { action: "approve", id: "op_test", revision: "r1" },
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(state.request).not.toHaveBeenCalled();
  });
  it("is disabled in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      (
        await POST(
          request({ action: "approve", id: "op_test", revision: "r1" }),
        )
      ).status,
    ).toBe(403);
  });
  it.each([
    { action: "approve", id: "op_test", revision: "r2" },
    { action: "approve", id: "unknown", revision: "r1" },
    { action: "execute", id: "op_test", revision: "r1" },
    { action: "retry", id: "op_test", revision: "r1" },
  ])(
    "rejects unknown actions, unreviewed terms or retries of unsent approvals: %j",
    async (body) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(state.request).not.toHaveBeenCalled();
    },
  );
});

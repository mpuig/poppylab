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
        version: "1.0",
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
  push: vi.fn(async () => "urn:ietf:params:oauth:request_uri:pushed-1"),
  config: {
    issuer: "http://juniper.localhost:4100",
    authorization_endpoint: "http://juniper.localhost:4100/oauth/authorize",
  } as Record<string, string>,
  connect: vi.fn(async (run: Record<string, unknown>): Promise<unknown> =>
    Object.assign(run, {
      company: {
        document: {
          protocol_version: "1.0",
          organization: { name: "Juniper", domain: "juniper.localhost" },
        },
        profile: {
          version: "1.0",
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
  accountConfiguration: () => state.config,
  usesDpop: () => true,
  revokeRefreshToken: state.revoke,
  pushAuthorizationRequest: state.push,
  identity: vi.fn(async () => ({ privateKey: {} })),
  clientId: "http://localhost:3000/agent/client.json",
  agentOrigin: "http://localhost:3000",
}));

import { POST, GET } from "./route";
import { seedRun } from "@/lib/runs";
import { nextAutoApproval } from "@/lib/auto-approval";
import { ProtocolError } from "@poppy-lab/pap-client";
function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/account", {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      "X-Poppy-Conversation": "run_fixture_0001",
    },
    body: JSON.stringify(body),
  });
}
/**
 * The next approval is sent and then fails with `error`. As sendApproval
 * does before it sends, the approval stays with the operation.
 */
function sendThenFail(error: () => unknown) {
  state.request.mockImplementationOnce(
    async (_run: unknown, op: Record<string, unknown>, approver = "user") => {
      op.approval ??= { approver, approved_at: 1791487260, reference: "a1" };
      throw error();
    },
  );
}
const lost = () => new Error("socket hang up");
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  Object.assign(state.run, { protocol: "1.0", busy: false });
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
  it("signs out of every service: no per-service token is kept (§4.5)", async () => {
    const run = state.run as { resourceTokens?: unknown };
    run.resourceTokens = {
      "http://juniper.localhost:4100/api": {
        value: "service-token",
        type: "DPoP",
        expires: Date.now() + 3600000,
      },
    };
    try {
      state.revoke.mockResolvedValue(undefined);
      expect((await POST(request({ action: "signout" }))).status).toBe(200);
      expect(run.resourceTokens).toBeUndefined();
    } finally {
      delete run.resourceTokens;
    }
  });
  it("asks for the Company's read-only scopes by default, with PKCE and a DPoP key", async () => {
    const r = await POST(request({ action: "signin" }));
    expect(r.status).toBe(200);
    const url = new URL((await r.json()).url);
    expect(url.searchParams.get("scope")).toBe("poppy:read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("session_id")).toBe(false);
    // §4.2: consent is shown even for scopes granted before.
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(state.run).toHaveProperty("auth.dpop");
  });
  it("pushes the request when the Company offers PAR, opening only client_id and request_uri (§4.2)", async () => {
    state.config = {
      ...state.config,
      pushed_authorization_request_endpoint:
        "http://juniper.localhost:4100/oauth/par",
    };
    try {
      const r = await POST(request({ action: "signin" }));
      expect(r.status).toBe(200);
      const url = new URL((await r.json()).url);
      expect([...url.searchParams.keys()].sort()).toEqual([
        "client_id",
        "request_uri",
      ]);
      expect(url.searchParams.get("request_uri")).toBe(
        "urn:ietf:params:oauth:request_uri:pushed-1",
      );
      const [, params, dpop] = state.push.mock.calls.at(-1)! as unknown as [
        unknown,
        Record<string, string>,
        unknown,
      ];
      expect(params).toMatchObject({
        scope: "poppy:read",
        prompt: "consent",
        code_challenge_method: "S256",
      });
      // The code is bound to the sign-in's DPoP key.
      expect(dpop).toBe(
        (state.run as { auth?: { dpop?: unknown } }).auth?.dpop,
      );
    } finally {
      delete state.config.pushed_authorization_request_endpoint;
    }
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
            version: "1.0",
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
  it("records a Company's decline: nothing performed, never sent again (Operations v3 §6)", async () => {
    state.request.mockRejectedValue(
      new ProtocolError(
        403,
        "approval_declined",
        undefined,
        undefined,
        undefined,
        {
          reason: "Only the account holder can do this.",
        },
      ),
    );
    const r = await POST(
      request({ action: "approve", id: "op_test", revision: "r1" }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.code).toBe("approval_declined");
    expect(body.operation).toMatchObject({ state: "refused" });
    expect(body.operation.result.summary).toContain(
      "Only the account holder can do this.",
    );
    // Neither approve nor retry sends it again.
    for (const action of ["approve", "retry"])
      expect(
        (await POST(request({ action, id: "op_test", revision: "r1" }))).status,
      ).not.toBe(200);
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it("leaves the same terms for a new approval when the Company answers an approval with its own revision (Operations v3 §6)", async () => {
    const sent = { approver: "user", approved_at: 1791487260, reference: "a1" };
    state.request.mockImplementationOnce(
      async (_run: unknown, op: Record<string, unknown>) => {
        // As sendApproval does: the approval stays with the operation.
        op.approval = sent;
        throw new ProtocolError(
          403,
          "approval_required",
          undefined,
          undefined,
          {
            ...state.run.operations.op_test,
            approval: undefined,
            request: undefined,
            state: undefined,
          },
        );
      },
    );
    const approve = () =>
      POST(request({ action: "approve", id: "op_test", revision: "r1" }));
    const r = await approve();
    expect(r.status).toBe(409);
    const body = await r.json();
    // Nothing was performed and the outcome is known: the page shows what
    // the server holds, the terms waiting for an approval.
    expect(body.code).toBe("approval_not_accepted");
    expect(body.error).toContain("Nothing was performed");
    expect(body.operation).toMatchObject({ revision: "r1", state: "proposed" });
    expect(state.run.operations.op_test.state).toBe("proposed");
    expect(state.request).toHaveBeenCalledTimes(1);
    // The approval the Company answered that way is never sent again…
    expect(state.run.operations.op_test).not.toHaveProperty("approval");
    expect(
      (await POST(request({ action: "retry", id: "op_test", revision: "r1" })))
        .status,
    ).toBe(400);
    expect(state.request).toHaveBeenCalledTimes(1);
    // …and the User's next tap, a new approval, works.
    state.request.mockResolvedValueOnce({ summary: "Done" });
    const again = await approve();
    expect(again.status).toBe(200);
    expect((await again.json()).operation.state).toBe("succeeded");
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
      sendThenFail(() => error);
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
      expect(state.request.mock.calls[1]![1]).toMatchObject({
        revision: "r1",
        approval: { approver: "user", reference: "a1" },
      });
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
    const restored = await (
      await GET(
        new Request(
          "http://localhost:3000/api/account?conversation=run_fixture_0001",
        ),
      )
    ).json();
    expect(restored.signedIn).toBe(false);
    expect(state.run.operations.op_test.state).toBe("proposed");
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it("tells a reloaded page about an open Direct Conversation (§8.10)", async () => {
    const run = state.run as { conversation?: unknown };
    const restored = async () =>
      (
        await (
          await GET(
            new Request(
              "http://localhost:3000/api/account?conversation=run_fixture_0001",
            ),
          )
        ).json()
      ).directConversation;
    try {
      expect(await restored()).toEqual({
        direct: false,
        conversation: false,
        invitation: null,
      });
      run.conversation = {
        endpoint: "http://juniper.localhost:4100/agent",
        id: "conv_1",
        seen: [],
        invitation: { event: "evt_1", reason: "About your refund" },
      };
      expect(await restored()).toEqual({
        direct: false,
        conversation: true,
        invitation: "About your refund",
      });
      // Accepted: the page must send the next words to the Company.
      run.conversation = {
        endpoint: "http://juniper.localhost:4100/agent",
        id: "conv_1",
        seen: [],
        direct: { id: "dir_1", seen: [] },
      };
      expect(await restored()).toEqual({
        direct: true,
        conversation: true,
        invitation: null,
      });
    } finally {
      delete run.conversation;
    }
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

describe("An operation whose conversation refuses the approval (§8.10, §8.12)", () => {
  const act = (action: string) =>
    POST(request({ action, id: "op_test", revision: "r1" }));
  beforeEach(() => {
    // Proposed in a conversation: the approval goes there in a message.
    state.run.operations.op_test.request = {
      conversation: {
        endpoint: "http://juniper.localhost:4100/agent",
        id: "cnv_direct",
      },
    };
  });

  it.each(["conversation_closed", "conversation_not_found"])(
    "says nothing was performed and that it can't be approved any more after %s",
    async (code) => {
      state.request.mockRejectedValue(
        new ProtocolError(code === "conversation_closed" ? 409 : 404, code),
      );
      const r = await act("approve");
      expect(r.status).toBe(409);
      const body = await r.json();
      expect(body.code).toBe(code);
      expect(body.error).toContain("Nothing was performed");
      // The page shows it as no longer approvable, with the reason.
      expect(body.operation).toMatchObject({
        state: "expired",
        result: { summary: body.error },
      });
      expect(state.run.operations.op_test).not.toHaveProperty("request");
      // Nothing is left to retry or approve, and nothing is sent again.
      expect((await act("retry")).status).toBe(400);
      expect((await act("approve")).status).toBe(410);
      expect(state.request).toHaveBeenCalledTimes(1);
    },
  );

  it("knows a retry the closed conversation refuses was never taken", async () => {
    sendThenFail(lost);
    expect((await act("approve")).status).toBe(502);
    expect(state.run.operations.op_test.state).toBe("uncertain");
    // §8.3: had the Company accepted the message, it would answer it again.
    state.request.mockRejectedValueOnce(
      new ProtocolError(409, "conversation_closed"),
    );
    const r = await act("retry");
    expect(r.status).toBe(409);
    expect((await r.json()).operation).toMatchObject({ state: "expired" });
  });

  it("keeps the outcome unknown when a retry finds the conversation gone", async () => {
    sendThenFail(lost);
    expect((await act("approve")).status).toBe(502);
    state.request.mockRejectedValueOnce(
      new ProtocolError(404, "conversation_not_found"),
    );
    const r = await act("retry");
    expect(r.status).toBe(502);
    expect((await r.json()).code).toBe("outcome_unknown");
    expect(state.run.operations.op_test.state).toBe("uncertain");
  });

  it("leaves it waiting while the User is in a Direct Conversation", async () => {
    state.request.mockRejectedValueOnce(
      new ProtocolError(409, "direct_conversation_open"),
    );
    const r = await act("approve");
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.code).toBe("direct_conversation_open");
    expect(body.error).toContain("Nothing was performed");
    expect(body.error).toContain("Leave the direct conversation");
    expect(body.operation).toMatchObject({ revision: "r1", state: "proposed" });
    // Once the User has left it, the same tap works.
    state.request.mockResolvedValueOnce({ summary: "Refunded." });
    const again = await act("approve");
    expect(again.status).toBe(200);
    expect((await again.json()).operation.state).toBe("succeeded");
  });
});

describe("Agent approvals on a standing instruction (Operations v3 §5)", () => {
  const rule = { maxCents: 2000, currency: "USD" };
  const run = state.run as unknown as {
    operations: Record<string, Record<string, unknown>>;
    agentApprovals?: unknown[];
  };
  const propose = (cents = 1200) => {
    run.operations.op_rule = {
      operation_id: "op_rule",
      revision: "r1",
      state: "proposed",
      summary: "Place the basket order.",
      terms: { total_cents: cents, currency: "USD" },
      expires_at: new Date(Date.now() + 60000).toISOString(),
      request: {
        url: "http://juniper.localhost:4100/api/account/checkout",
        body: {},
      },
    };
  };
  beforeEach(() => {
    delete run.agentApprovals;
    propose();
  });
  const approve = (instruction?: unknown, revision = "r1") =>
    POST(
      request({
        action: "approve",
        id: "op_rule",
        revision,
        ...(instruction ? { instruction } : {}),
      }),
    );

  it("sends an agent approval only when the server's own check covers the exact terms", async () => {
    state.request.mockResolvedValue({ summary: "Ordered." });
    const r = await approve(rule);
    expect(r.status).toBe(200);
    expect(state.request).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation_id: "op_rule" }),
      "agent",
    );
    expect((await r.json()).operation).toMatchObject({
      state: "succeeded",
      approvedBy: {
        approver: "agent",
        rule: expect.stringContaining("$20.00"),
      },
    });
  });

  it("leaves to the User what the rule doesn't cover, and never trusts a malformed rule", async () => {
    for (const instruction of [
      { maxCents: 1000, currency: "USD" },
      { maxCents: 2000, currency: "EUR" },
      { maxCents: -5, currency: "USD" },
      { maxCents: 2000 },
    ]) {
      const r = await approve(instruction);
      expect(r.status).toBe(409);
      expect((await r.json()).code).toBe("not_covered");
    }
    expect(state.request).not.toHaveBeenCalled();
    expect(run.operations.op_rule!.state).toBe("proposed");
  });

  it("holds its own hourly limit, whatever the browser says", async () => {
    run.agentApprovals = Array.from({ length: 5 }, () => ({
      at: Date.now() - 1000,
      cents: 100,
    }));
    const r = await approve(rule);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("last hour");
    expect(state.request).not.toHaveBeenCalled();
  });

  it("counts an approval with an unknown outcome once, at its amount, retried or not", async () => {
    // Each is $20.00 under a $20.00 rule: three fit in the hour's total.
    propose(2000);
    state.request.mockImplementationOnce(
      async (_run: unknown, op: Record<string, unknown>, approver: string) => {
        // As sendApproval does: the approval stays with the operation.
        op.approval = { approver, approved_at: 1791487260, reference: "a1" };
        throw new Error("socket hang up");
      },
    );
    expect((await approve(rule)).status).toBe(502);
    // It may have been performed, so it counts before anyone retries it.
    expect(run.agentApprovals).toMatchObject([{ cents: 2000 }]);
    state.request.mockResolvedValue({ summary: "Ordered." });
    const retried = await POST(
      request({ action: "retry", id: "op_rule", revision: "r1" }),
    );
    expect(retried.status).toBe(200);
    expect((await retried.json()).operation).toMatchObject({
      state: "succeeded",
      approvedBy: { approver: "agent" },
    });
    // The retry is the same approval: not zero cents, and not a second one.
    expect(run.agentApprovals).toMatchObject([{ cents: 2000 }]);
    for (const status of [200, 200, 409]) {
      propose(2000);
      expect((await approve(rule)).status).toBe(status);
    }
    expect(state.request).toHaveBeenCalledTimes(4);
  });

  it("gives the operation back to the User when the Company declines the agent's approval", async () => {
    state.request.mockRejectedValueOnce(
      new ProtocolError(
        403,
        "approval_declined",
        undefined,
        undefined,
        undefined,
        { reason: "Approve money moves yourself." },
      ),
    );
    const r = await approve(rule);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.code).toBe("agent_approval_declined");
    expect(body.operation).toMatchObject({
      state: "proposed",
      agentDeclined: { reason: "Approve money moves yourself." },
    });
    // Never again on the rule for this operation…
    expect((await approve(rule)).status).toBe(409);
    // …but the User can approve it themselves, with a new approval.
    state.request.mockResolvedValueOnce({ summary: "Ordered." });
    const mine = await approve();
    expect(mine.status).toBe(200);
    expect(state.request).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "user",
    );
  });

  it("gives the operation back to the User when the Company answers the agent's approval with its own revision", async () => {
    state.request.mockRejectedValueOnce(
      new ProtocolError(403, "approval_required", undefined, undefined, {
        ...run.operations.op_rule,
        request: undefined,
        state: undefined,
      }),
    );
    const r = await approve(rule);
    expect(r.status).toBe(409);
    expect((await r.json()).operation).toMatchObject({
      state: "proposed",
      agentDeclined: {},
    });
    // Iris doesn't try the rule on it again; the User can still approve.
    expect((await approve(rule)).status).toBe(409);
    expect(state.request).toHaveBeenCalledTimes(1);
    state.request.mockResolvedValueOnce({ summary: "Ordered." });
    expect((await approve()).status).toBe(200);
    expect(state.request).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "user",
    );
  });

  // $13.00 where $12.00 was approved: other terms, still under the rule.
  const newTerms = () =>
    new ProtocolError(403, "approval_required", undefined, undefined, {
      operation_id: "op_rule",
      revision: "r2",
      summary: "Place the basket order.",
      terms: { total_cents: 1300, currency: "USD" },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });

  it("leaves a new revision to the User when the Company answers the agent's approval with one the rule also covers", async () => {
    state.request.mockRejectedValueOnce(newTerms());
    const r = await approve(rule);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.code).toBe("terms_changed");
    expect(body.operation).toMatchObject({ revision: "r2", state: "proposed" });
    // The page's check, as after a reload, doesn't offer the new revision…
    expect(
      nextAutoApproval({
        operations: [body.operation],
        instruction: rule,
        signedIn: true,
        busy: false,
        decided: new Set(),
      }),
    ).toBeNull();
    // …and the server takes no agent approval for it, whatever the page asks.
    const second = await approve(rule, "r2");
    expect(second.status).toBe(409);
    expect((await second.json()).error).toContain("new terms");
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(body.operation).toMatchObject({ agentSuperseded: true });
    expect(body.operation).not.toHaveProperty("agentDeclined");
    // The User can still approve the new revision themselves.
    state.request.mockResolvedValueOnce({ summary: "Ordered." });
    expect((await approve(undefined, "r2")).status).toBe(200);
    expect(state.request).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ revision: "r2" }),
      "user",
    );
  });

  it("leaves it to the User too when the answer is to a retry of the agent's approval", async () => {
    state.request.mockImplementationOnce(
      async (_run: unknown, op: Record<string, unknown>, approver: string) => {
        // As sendApproval does: the approval stays with the operation.
        op.approval = { approver, approved_at: 1791487260, reference: "a1" };
        throw new Error("socket hang up");
      },
    );
    expect((await approve(rule)).status).toBe(502);
    state.request.mockRejectedValueOnce(newTerms());
    const retried = await POST(
      request({ action: "retry", id: "op_rule", revision: "r1" }),
    );
    expect(retried.status).toBe(409);
    expect((await retried.json()).operation).toMatchObject({
      revision: "r2",
      agentSuperseded: true,
    });
    expect((await approve(rule, "r2")).status).toBe(409);
    expect(state.request).toHaveBeenCalledTimes(2);
  });

  it("lets the rule look at a new revision the Company returned for the User's own approval", async () => {
    state.request.mockRejectedValueOnce(newTerms());
    const r = await approve();
    expect(r.status).toBe(409);
    expect((await r.json()).operation).not.toHaveProperty("agentSuperseded");
    state.request.mockResolvedValueOnce({ summary: "Ordered." });
    expect((await approve(rule, "r2")).status).toBe(200);
    expect(state.request).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "agent",
    );
  });

  const retry = (revision = "r1") =>
    POST(request({ action: "retry", id: "op_rule", revision }));
  const approvers = () =>
    state.request.mock.calls.map((call: unknown[]) => call[2]);

  it("never turns a Retry into the User's approval once the Company declined the agent's", async () => {
    // Iris's approval times out: the outcome is unknown.
    sendThenFail(lost);
    expect((await approve(rule)).status).toBe(502);
    expect(run.operations.op_rule!.state).toBe("uncertain");
    // The User clicks Retry, and the Company declines agent approvals here.
    sendThenFail(
      () =>
        new ProtocolError(
          403,
          "approval_declined",
          undefined,
          undefined,
          undefined,
          { reason: "Approve money moves yourself." },
        ),
    );
    const declined = await retry();
    expect(declined.status).toBe(200);
    const body = await declined.json();
    expect(body.code).toBe("agent_approval_declined");
    // A second Retry has no approval to resend, so it sends nothing.
    state.request.mockResolvedValue({ summary: "Paid." });
    expect((await retry()).status).toBe(400);
    expect(approvers()).toEqual(["agent", "agent"]);
    // The outcome is known, and it waits for the User's own Approve.
    expect(body.operation).toMatchObject({
      state: "proposed",
      agentDeclined: { reason: "Approve money moves yourself." },
    });
    expect(body.operation).not.toHaveProperty("approval");
    expect(run.operations.op_rule!.state).toBe("proposed");
    // Only Approve sends an approval in the User's name.
    const mine = await approve();
    expect(mine.status).toBe(200);
    expect((await mine.json()).operation).toMatchObject({
      state: "succeeded",
      approvedBy: { approver: "user" },
    });
    expect(approvers()).toEqual(["agent", "agent", "user"]);
  });

  it("refuses a Retry when no approval is stored, and sends nothing", async () => {
    // As a conversation saved before the fix above can still hold.
    Object.assign(run.operations.op_rule!, {
      state: "uncertain",
      agentDeclined: {},
    });
    state.request.mockResolvedValue({ summary: "Paid." });
    expect((await retry()).status).toBe(400);
    expect(state.request).not.toHaveBeenCalled();
    expect(run.operations.op_rule!.state).toBe("uncertain");
  });

  // Every answer an approval can get, sent first or retried, by the User
  // or by Iris, with the state it leaves. Retry is taken only while the
  // outcome is unknown, and then it resends the approval that was sent.
  const sameTerms = () =>
    new ProtocolError(403, "approval_required", undefined, undefined, {
      ...run.operations.op_rule,
      request: undefined,
      state: undefined,
      approval: undefined,
    });
  const declinedBy = { user: "refused", agent: "proposed" };
  const answers: [
    name: string,
    answer: () => unknown,
    first: string | typeof declinedBy,
    retried: string | typeof declinedBy,
  ][] = [
    [
      "a decline",
      () => new ProtocolError(403, "approval_declined"),
      declinedBy,
      declinedBy,
    ],
    ["the revision it names", sameTerms, "proposed", "proposed"],
    ["new terms", newTerms, "proposed", "proposed"],
    [
      "a closed conversation",
      () => new ProtocolError(409, "conversation_closed"),
      "expired",
      "expired",
    ],
    [
      "a conversation the Company no longer has",
      () => new ProtocolError(404, "conversation_not_found"),
      "expired",
      "uncertain",
    ],
    [
      "a Direct Conversation still open",
      () => new ProtocolError(409, "direct_conversation_open"),
      "proposed",
      "uncertain",
    ],
    [
      "another refusal",
      () => new ProtocolError(409, undefined),
      "proposed",
      "uncertain",
    ],
    [
      "access it no longer accepts",
      () => new ProtocolError(401, "invalid_token"),
      "proposed",
      "uncertain",
    ],
    ["no answer", lost, "uncertain", "uncertain"],
  ];
  describe.each(["user", "agent"] as const)("an approval by the %s", (by) => {
    describe.each(["approve", "retry"] as const)("sent by %s", (action) => {
      it.each(answers)(
        "and answered with %s",
        async (name, answer, ...left) => {
          if (name.includes("onversation"))
            run.operations.op_rule!.request = {
              conversation: {
                endpoint: "http://juniper.localhost:4100/agent",
                id: "cnv_1",
              },
            };
          const first = () => approve(by === "agent" ? rule : undefined);
          if (action === "retry") {
            sendThenFail(lost);
            expect((await first()).status).toBe(502);
          }
          sendThenFail(answer);
          await (action === "retry" ? retry() : first());
          const sends = action === "retry" ? 2 : 1;
          const op = run.operations.op_rule!;
          const expected = left[action === "retry" ? 1 : 0]!;
          expect(op.state).toBe(
            typeof expected === "string" ? expected : expected[by],
          );
          const unknown = op.state === "uncertain";
          // What Retry would resend is the approval that was sent, or nothing.
          if (unknown) expect(op.approval).toMatchObject({ approver: by });
          state.request.mockResolvedValue({ summary: "Paid." });
          expect((await retry(op.revision as string)).status).toBe(
            unknown ? 200 : 400,
          );
          expect(approvers()).toEqual(
            Array(sends + (unknown ? 1 : 0)).fill(by),
          );
          if (unknown)
            expect(state.request.mock.calls[sends]![1]).toMatchObject({
              approval: { approver: by, reference: "a1" },
            });
        },
      );
    });
  });
});

import type * as OperationStore from "../../../lib/operation-store";
import type * as Runtime from "../../../lib/runtime";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
const state = vi.hoisted(() => ({
  /** The network under the real runtime's FDX consent calls. */
  transport: vi.fn<(url: string, ...args: unknown[]) => Promise<unknown>>(
    async () => {
      throw new Error("Unexpected request");
    },
  ),
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
      document: { organization: { name: "Juniper" } },
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

vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: state.transport,
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
  // Use FDX (poppylab.dev/fdx v1): the runtime's own rules.
  fdxEntry: (await vi.importActual<typeof Runtime>("../../../lib/runtime"))
    .fdxEntry,
  setFdx: (await vi.importActual<typeof Runtime>("../../../lib/runtime"))
    .setFdx,
  // The consent calls are the runtime's own, down to the request it sends.
  fdxConsentRecord: (
    await vi.importActual<typeof Runtime>("../../../lib/runtime")
  ).fdxConsentRecord,
  revokeFdxConsent: (
    await vi.importActual<typeof Runtime>("../../../lib/runtime")
  ).revokeFdxConsent,
}));

import { POST, GET } from "./route";
import { seedRun } from "@/lib/runs";
import { nextAutoApproval, usesAllowance } from "@/lib/auto-approval";
import { createIdentity, ProtocolError } from "@poppy-lab/pap-client";
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
  const act = (action: string) =>
    POST(request({ action, id: "op_test", revision: "r1" }));
  it.each([
    // No code at all: not the protocol's, and none of the Company's own.
    [409, undefined],
    [409, "request_id_conflict"],
    [400, "invalid_request"],
    [404, undefined],
    [422, undefined],
    // A 401 that doesn't ask for sign-in.
    [401, "invalid_dpop_proof"],
  ])(
    "says nothing was performed when the Company refuses the approved request with %s %s",
    async (status, code) => {
      sendThenFail(() => new ProtocolError(status, code));
      const r = await act("approve");
      expect(r.status).toBe(409);
      const body = await r.json();
      expect(body.code).toBe("not_performed");
      expect(body.next).toBe("review");
      expect(body.error).toContain("Nothing was performed");
      // The Company's status and code, never its own words.
      expect(body.error).toContain(
        `Juniper refused this request (HTTP ${status}${code ? `, ${code}` : ""})`,
      );
      // The page shows what the server holds: the terms, still waiting.
      expect(body.operation).toMatchObject({
        revision: "r1",
        state: "proposed",
      });
      expect(state.run.operations.op_test.state).toBe("proposed");
      // Nothing is uncertain, so there is nothing to retry…
      expect((await act("retry")).status).toBe(400);
      expect(state.request).toHaveBeenCalledTimes(1);
      // …and the User can approve again: the same approval goes out (§7).
      state.request.mockResolvedValueOnce({ summary: "Done" });
      const again = await act("approve");
      expect(again.status).toBe(200);
      expect((await again.json()).operation.state).toBe("succeeded");
      expect(state.request.mock.calls[1]![1]).toMatchObject({
        approval: { approver: "user", reference: "a1" },
      });
    },
  );
  it.each([
    // As Harborline's: a code of its own, which isn't one of the protocol's.
    [undefined, "insufficient_funds", "insufficient_funds"],
    [undefined, "account_changed", "account_changed"],
    // The protocol's code comes first when the answer has both.
    ["request_id_conflict", "request_id_conflict", "request_id_conflict"],
    ["invalid_dpop_proof", "card_locked", "invalid_dpop_proof"],
  ])(
    "tells the User why the Company refused: its own error code (%s, %s)",
    async (code, companyCode, shown) => {
      sendThenFail(() =>
        Object.assign(new ProtocolError(409, code), { companyCode }),
      );
      const r = await act("approve");
      expect(r.status).toBe(409);
      const body = await r.json();
      expect(body.code).toBe("not_performed");
      expect(body.error).toContain(
        `Juniper refused this request (HTTP 409, ${shown}). Nothing was performed.`,
      );
    },
  );
  it("says nothing was performed when the Company answers an approval with terms it can't use", async () => {
    sendThenFail(
      () =>
        new ProtocolError(403, "approval_required", undefined, undefined, {
          operation_id: "op_test",
          revision: "r2",
          terms: { to: "Saturday" },
          expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
    );
    const r = await act("approve");
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.code).toBe("not_performed");
    expect(body.operation).toMatchObject({ revision: "r1", state: "proposed" });
    expect(state.run.operations.op_test).toMatchObject({
      revision: "r1",
      state: "proposed",
    });
  });
  it.each([
    ["500", () => new ProtocolError(500, undefined)],
    ["429", () => new ProtocolError(429, "rate_limited")],
    ["408", () => new ProtocolError(408, undefined)],
  ])(
    "keeps the outcome unknown after a %s: that isn't a refusal",
    async (_name, error) => {
      sendThenFail(error);
      const r = await act("approve");
      expect(r.status).toBe(502);
      expect((await r.json()).code).toBe("outcome_unknown");
      expect(state.run.operations.op_test.state).toBe("uncertain");
    },
  );
  it("keeps the outcome unknown when the Company refuses a retry", async () => {
    sendThenFail(lost);
    expect((await act("approve")).status).toBe(502);
    // The refusal is of the retry. It doesn't say what became of the
    // approval sent before it, so nothing new may be approved yet (§7).
    sendThenFail(() => new ProtocolError(409, undefined));
    const r = await act("retry");
    expect(r.status).toBe(502);
    expect((await r.json()).code).toBe("outcome_unknown");
    expect(state.run.operations.op_test).toMatchObject({
      state: "uncertain",
      approval: { approver: "user", reference: "a1" },
    });
    expect((await act("approve")).status).toBe(410);
  });
  it.each([
    [new ProtocolError(401, undefined), 401, "account_unavailable"],
    [new ProtocolError(403, "insufficient_scope"), 403, "insufficient_scope"],
  ])(
    "still asks for sign-in or permission when the Company answers the approval with %s",
    async (error, status, code) => {
      sendThenFail(() => error);
      const r = await act("approve");
      expect(r.status).toBe(status);
      expect((await r.json()).code).toBe(code);
      expect(state.run.operations.op_test.state).toBe("proposed");
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

  it.each([
    [410, "cursor_expired"],
    [400, "invalid_cursor"],
  ])(
    "keeps the outcome unknown after %s %s: the Company takes the message before it reads the reply (§8.3)",
    async (status, code) => {
      sendThenFail(() => new ProtocolError(status, code));
      const r = await act("approve");
      expect(r.status).toBe(502);
      expect((await r.json()).code).toBe("outcome_unknown");
      expect(state.run.operations.op_test.state).toBe("uncertain");
      // Only the approval that was sent goes out again.
      state.request.mockResolvedValueOnce({ summary: "Refunded." });
      expect((await act("retry")).status).toBe(200);
      expect(state.request.mock.calls[1]![1]).toMatchObject({
        approval: { approver: "user", reference: "a1" },
      });
    },
  );

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

describe("An operation proposed in the User's Direct Conversation (§8.10)", () => {
  const run = state.run as unknown as {
    operations: Record<string, Record<string, unknown>>;
    history: Array<{ role: string; content: string }>;
    transcript?: Array<{ role: string; content: string }>;
  };
  const act = (revision = "r1", instruction?: unknown) =>
    POST(
      request({
        action: "approve",
        id: "op_test",
        revision,
        ...(instruction ? { instruction } : {}),
      }),
    );
  /** Everything a model turn after this one would be sent. */
  const forModel = () => JSON.stringify(run.history);
  const forPage = () => JSON.stringify(run.transcript ?? []);
  // What only the Company and the User said or agreed in that thread.
  const theirs = ["ord_LNB0907", "37.00", "3700", "holder", "Refund"];
  beforeEach(() => {
    run.history.length = 0;
    delete run.transcript;
    Object.assign(run.operations.op_test!, {
      summary: "Refund all of order ord_LNB0907 (USD 37.00).",
      terms: { order_id: "ord_LNB0907", total_cents: 3700, currency: "USD" },
      request: {
        conversation: {
          endpoint: "http://juniper.localhost:4100/agent",
          id: "cnv_direct",
        },
      },
      // Set when the operation arrived in the User's own thread.
      direct: true,
    });
  });
  const declined = () =>
    new ProtocolError(
      403,
      "approval_declined",
      undefined,
      undefined,
      undefined,
      { reason: "Only the card holder can take a refund of USD 37.00." },
    );

  it("tells the model that one was approved, and keeps the Company's result for the page", async () => {
    state.request.mockResolvedValue({
      summary: "Refunded USD 37.00 for order ord_LNB0907.",
    });
    const r = await act();
    expect(r.status).toBe(200);
    // The card and the transcript show the User what the Company answered.
    expect((await r.json()).operation.result.summary).toContain("ord_LNB0907");
    expect(forPage()).toContain("Refunded USD 37.00 for order ord_LNB0907.");
    for (const word of theirs) expect(forModel()).not.toContain(word);
    expect(run.history).toEqual([
      {
        role: "assistant",
        content:
          "(An operation proposed in the user's direct conversation with Juniper was approved and performed.)",
      },
    ]);
  });

  it("tells the model that the Company declined one, without its reason", async () => {
    state.request.mockRejectedValue(declined());
    const r = await act();
    expect((await r.json()).code).toBe("approval_declined");
    expect(forPage()).toContain("Only the card holder can take a refund");
    for (const word of theirs) expect(forModel()).not.toContain(word);
    expect(run.history).toEqual([
      {
        role: "assistant",
        content:
          "(The Company declined an operation proposed in the user's direct conversation with Juniper. Nothing was performed.)",
      },
    ]);
  });

  it("keeps the reason from the model when the Company declines Iris's approval of one too", async () => {
    state.request.mockRejectedValue(declined());
    const r = await act("r1", { maxCents: 5000, currency: "USD" });
    expect((await r.json()).code).toBe("agent_approval_declined");
    expect(forPage()).toContain("Only the card holder can take a refund");
    for (const word of theirs) expect(forModel()).not.toContain(word);
    expect(run.history).toHaveLength(1);
  });

  it("keeps new terms the Company answers with in that thread, and their result, from the model", async () => {
    state.request.mockRejectedValueOnce(
      new ProtocolError(403, "approval_required", undefined, undefined, {
        operation_id: "op_test",
        revision: "r2",
        summary: "Refund all of order ord_LNB0907 (USD 37.00), less a fee.",
        terms: { order_id: "ord_LNB0907", total_cents: 3500, currency: "USD" },
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    const changed = await (await act()).json();
    expect(changed.code).toBe("terms_changed");
    expect(changed.operation).toMatchObject({ revision: "r2", direct: true });
    state.request.mockResolvedValueOnce({
      summary: "Refunded USD 35.00 for order ord_LNB0907.",
    });
    expect((await act("r2")).status).toBe(200);
    expect(forPage()).toContain("Refunded USD 35.00");
    for (const word of [...theirs, "35.00"])
      expect(forModel()).not.toContain(word);
  });

  it("still tells the model the result of an operation Iris's own conversation proposed", async () => {
    delete run.operations.op_test!.direct;
    state.request.mockResolvedValue({ summary: "Refunded USD 8.00." });
    expect((await act()).status).toBe(200);
    expect(run.history).toEqual([
      {
        role: "assistant",
        content: "Company operation succeeded: Refunded USD 8.00.",
      },
    ]);
    expect(run.transcript).toEqual(run.history);
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

  it("spends none of the hour's allowance on an approval the Company refused", async () => {
    // As Harborline's 409 insufficient_funds, once the balance has dropped.
    sendThenFail(() => new ProtocolError(409, undefined));
    const r = await approve(rule);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.code).toBe("not_performed");
    expect(body.operation).toMatchObject({ state: "proposed" });
    // Neither the server's count nor the page's takes it for performed.
    expect(run.agentApprovals).toEqual([]);
    expect(usesAllowance({ status: r.status, operation: body.operation })).toBe(
      false,
    );
    // It waits for the User, who can approve it themselves.
    state.request.mockResolvedValueOnce({ summary: "Ordered." });
    expect((await approve()).status).toBe(200);
    expect(approvers()).toEqual(["agent", "user"]);
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

describe("Use FDX (poppylab.dev/fdx v1)", () => {
  const entry = {
    version: "1",
    base_url: "http://juniper.localhost:4100/fdx/v6",
    consent_endpoint: "http://juniper.localhost:4100/fdx/v6/consents",
  };
  const bank = (run: Record<string, unknown>) => {
    const company = run.company as { profile: Record<string, unknown> };
    company.profile = {
      ...company.profile,
      scopes: ["poppy:read", "poppy:write", "fdx:ACCOUNT_BASIC"],
      scopeHints: {
        "poppy:read": { changes: "none", personal_data: true },
        "poppy:write": { changes: "irreversible", personal_data: true },
        "fdx:ACCOUNT_BASIC": { changes: "none", personal_data: true },
      },
      extensions: { "poppylab.dev/fdx": entry },
    };
    return run;
  };
  const restored = async () =>
    (
      await GET(
        new Request(
          "http://localhost:3000/api/account?conversation=run_fixture_0001",
        ),
      )
    ).json();
  const run = state.run as typeof state.run & {
    fdx?: boolean;
    fdxConsent?: string;
    sessionId?: string;
  };
  const company = structuredClone(state.run.company);
  const connect = state.connect.getMockImplementation()!;
  beforeEach(() => {
    state.run.company = structuredClone(company);
    delete run.fdx;
    run.sessionId = "sid-before";
  });

  it("is off by default, and a change starts a new Session the page restores (§3.4)", async () => {
    bank(state.run);
    expect((await restored()).fdx).toBe(false);
    const on = await POST(request({ action: "fdx", enabled: true }));
    expect(on.status).toBe(200);
    const body = await on.json();
    expect(body.fdx).toBe(true);
    expect(run.fdx).toBe(true);
    expect(body.sessionId).not.toBe("sid-before");
    expect(run.sessionId).toBe(body.sessionId);
    expect((await restored()).fdx).toBe(true);
    // The same choice again keeps the Session.
    await POST(request({ action: "fdx", enabled: true }));
    expect(run.sessionId).toBe(body.sessionId);
    await POST(request({ action: "fdx", enabled: false }));
    expect(run.fdx).toBeUndefined();
    expect(run.sessionId).not.toBe(body.sessionId);
  });

  it("can't be turned on where the Company lists no valid entry, or a saved profile has none", async () => {
    const r = await POST(request({ action: "fdx", enabled: true }));
    expect(r.status).toBe(400);
    expect(run.fdx).toBeUndefined();
    expect(run.sessionId).toBe("sid-before");
    expect(
      (await POST(request({ action: "fdx", enabled: "yes" }))).status,
    ).toBe(400);
  });

  it("asks for the FDX-shaped data clusters only with Use FDX on", async () => {
    state.connect.mockImplementation(async (r: Record<string, unknown>) =>
      bank(Object.assign(r, { company: structuredClone(company) })),
    );
    try {
      bank(state.run);
      const scope = async () =>
        new URL(
          (await (await POST(request({ action: "signin" }))).json()).url,
        ).searchParams.get("scope");
      expect(await scope()).toBe("poppy:read");
      await POST(request({ action: "fdx", enabled: true }));
      expect(await scope()).toBe("poppy:read fdx:ACCOUNT_BASIC");
    } finally {
      state.connect.mockImplementation(connect);
      delete (state.run as { auth?: unknown }).auth;
    }
  });

  it("forgets the consent id at sign-out", async () => {
    run.fdxConsent = "grant_1";
    state.revoke.mockResolvedValue(undefined);
    expect((await POST(request({ action: "signout" }))).status).toBe(200);
    expect(run.fdxConsent).toBeUndefined();
  });
});

describe("Revoking the FDX consent (poppylab.dev/fdx v1)", () => {
  const entry = {
    version: "1",
    base_url: "http://juniper.localhost:4100/fdx/v6",
    consent_endpoint: "http://juniper.localhost:4100/fdx/v6/consents",
  };
  const revocation =
    "http://juniper.localhost:4100/fdx/v6/consents/grant_1/revocation";
  type FdxRun = typeof state.run & {
    fdx?: boolean;
    fdxConsent?: string;
    visitor?: string;
    dpop?: unknown;
    tokenType?: string;
    sessionId?: string;
    resourceTokens?: unknown;
  };
  const run = state.run as FdxRun;
  const company = structuredClone(state.run.company);
  let dpop: unknown;
  beforeAll(async () => {
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    dpop = (await createIdentity()).privateKey;
  });
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    const bank = structuredClone(company) as { profile: object };
    bank.profile = {
      ...bank.profile,
      extensions: { "poppylab.dev/fdx": entry },
    };
    Object.assign(run, {
      company: bank,
      fdx: true,
      fdxConsent: "grant_1",
      visitor: "visitor-fixture",
      dpop,
      tokenType: "DPoP",
      // Not due for a refresh: the revocation goes with this token.
      tokenExpires: Date.now() + 3600000,
      resourceTokens: {
        "http://juniper.localhost:4100/api": {
          value: "service-token",
          type: "DPoP",
          expires: Date.now() + 3600000,
        },
      },
      history: [{ role: "user", content: "my balances" }],
    });
    state.transport.mockReset();
    state.transport.mockRejectedValue(new Error("Unexpected request"));
  });
  afterEach(() => {
    state.run.company = structuredClone(company);
    for (const key of [
      "fdx",
      "fdxConsent",
      "visitor",
      "dpop",
      "tokenType",
      "sessionId",
      "resourceTokens",
    ] as const)
      delete run[key];
    state.run.history = [];
  });
  const signedOut = () => {
    expect(run.accountToken).toBeUndefined();
    expect(run.token).toBeUndefined();
    expect(run.tokenType).toBeUndefined();
    expect(run.scopes).toBeUndefined();
    expect(run.fdxConsent).toBeUndefined();
    expect(run.resourceTokens).toBeUndefined();
    expect(run.accountUnavailable).toBeUndefined();
    expect(run.history).toEqual([]);
    // The run and its Session go on, signed out (§5.5).
    expect(run.sessionId).toEqual(expect.any(String));
    // The dead refresh token isn't revoked again.
    expect(state.revoke).not.toHaveBeenCalled();
  };
  const kept = () => {
    expect(run.accountToken).toBe("secret");
    expect(run.token).toBe("general-token");
    expect(run.fdxConsent).toBe("grant_1");
    expect(run.resourceTokens).toBeDefined();
  };

  it("is refused, sending nothing, without a consent, with Use FDX off or signed out", async () => {
    const refused = async () => {
      const r = await POST(request({ action: "fdx_revoke" }));
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ code: "no_fdx_consent" });
    };
    delete run.fdxConsent;
    await refused();
    run.fdxConsent = "grant_1";
    delete run.fdx;
    await refused();
    run.fdx = true;
    // A profile with no valid entry: the extension isn't in use.
    state.run.company = structuredClone(company);
    await refused();
    Object.assign(run, { company: structuredClone(company) });
    (run.company as { profile: object }).profile = {
      ...(run.company as { profile: object }).profile,
      extensions: { "poppylab.dev/fdx": entry },
    };
    delete (run as { accountToken?: string }).accountToken;
    await refused();
    run.accountToken = "secret";
    // Access the Company already refused: sign in again, nothing sent.
    run.accountUnavailable = true;
    const lost = await POST(request({ action: "fdx_revoke" }));
    expect(lost.status).toBe(401);
    expect(await lost.json()).toMatchObject({ code: "account_unavailable" });
    run.accountUnavailable = false;
    expect(state.transport).not.toHaveBeenCalled();
    expect(state.revoke).not.toHaveBeenCalled();
    expect(run.fdxConsent).toBe("grant_1");
  });

  it("sends one PUT to the stored consent's revocation, as a Poppy request with the extension declared", async () => {
    state.transport.mockResolvedValue(null);
    // The body's own URL or id are never used.
    const r = await POST(
      request({
        action: "fdx_revoke",
        consentId: "grant_other",
        url: "http://juniper.localhost:4100/elsewhere",
      }),
    );
    expect(r.status).toBe(200);
    expect(state.transport).toHaveBeenCalledTimes(1);
    const [url, init, , dpopOption, options] = state.transport.mock
      .calls[0] as [
      string,
      RequestInit,
      unknown,
      { token?: string },
      { acceptEmpty?: boolean },
    ];
    expect(url).toBe(revocation);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      reason: "USER_ACTION",
      initiator: "INDIVIDUAL",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("DPoP general-token");
    expect(headers.DPoP).toEqual(expect.any(String));
    expect(headers["Poppy-Session"]).toEqual(expect.any(String));
    expect(headers["Poppy-Version"]).toBe("1.0");
    expect(headers["Poppy-Extensions"]).toContain('"poppylab.dev/fdx";v="1"');
    expect(dpopOption.token).toBe("general-token");
    expect(options).toMatchObject({ acceptEmpty: true });
    const body = await r.json();
    expect(body).toMatchObject({
      signedIn: false,
      revoked: "revoked",
      consent: "grant_1",
    });
    expect(body.trace).toContain(
      "PUT /fdx/v6/consents/grant_1/revocation · FDX consent revoked · 204",
    );
    signedOut();
  });

  it("takes a 401 for a consent that has already ended, and signs out the same way", async () => {
    state.transport.mockRejectedValue(new ProtocolError(401, "invalid_token"));
    const r = await POST(request({ action: "fdx_revoke" }));
    const answer = await r.json();
    expect(r.status).toBe(200);
    expect(answer).toMatchObject({
      signedIn: false,
      revoked: "already_ended",
    });
    expect(state.transport).toHaveBeenCalledTimes(1);
    signedOut();
  });

  it("keeps the sign-in and says so when the Company doesn't revoke it", async () => {
    for (const error of [
      new ProtocolError(404, undefined),
      new ProtocolError(403, "extension_required"),
      new ProtocolError(503, undefined),
      new Error("lost response"),
    ]) {
      state.transport.mockReset();
      state.transport.mockRejectedValue(error);
      const r = await POST(request({ action: "fdx_revoke" }));
      expect(r.status).toBe(502);
      const body = await r.json();
      expect(body.code).toBe("fdx_revoke_failed");
      expect(body.error).toMatch(/still signed in/);
      expect(body.trace[0]).toMatch(
        /^PUT \/fdx\/v6\/consents\/grant_1\/revocation · FDX consent revocation failed · /,
      );
      expect(state.transport).toHaveBeenCalledTimes(1);
      kept();
    }
    expect(state.revoke).not.toHaveBeenCalled();
  });

  it("shows the consent's status and accounts from the bank's record, and its id on a reload", async () => {
    state.transport.mockResolvedValue({
      id: "grant_1",
      status: "ACTIVE",
      expirationTime: "2027-01-01T00:00:00Z",
      resources: [
        {
          resourceType: "ACCOUNT",
          resourceId: "acc_1",
          dataClusters: ["ACCOUNT_BASIC"],
        },
      ],
      note: "<script>",
    });
    const r = await POST(request({ action: "fdx_consent" }));
    expect(r.status).toBe(200);
    expect((await r.json()).consent).toEqual({
      id: "grant_1",
      status: "ACTIVE",
      expirationTime: "2027-01-01T00:00:00Z",
      accounts: ["acc_1"],
    });
    expect(state.transport.mock.calls[0]?.[0]).toBe(
      "http://juniper.localhost:4100/fdx/v6/consents/grant_1",
    );
    const restored = await (
      await GET(
        new Request(
          "http://localhost:3000/api/account?conversation=run_fixture_0001",
        ),
      )
    ).json();
    expect(restored.fdxConsent).toBe("grant_1");
    run.accountUnavailable = true;
    const off = await (
      await GET(
        new Request(
          "http://localhost:3000/api/account?conversation=run_fixture_0001",
        ),
      )
    ).json();
    expect(off.fdxConsent).toBeUndefined();
    run.accountUnavailable = false;
  });
});

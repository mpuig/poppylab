import { it, expect, vi, beforeEach } from "vitest";
const transport = vi.hoisted(() =>
  vi
    .fn<(url: string, ...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ state: "succeeded" }),
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
import {
  ProtocolError,
  createIdentity,
  verifyEd25519,
  verifySessionHeader,
  type JWK,
} from "@poppy-lab/pap-client";
import {
  accountConfiguration,
  sendApproval,
  approvalFor,
  identity,
  operatorKey,
  papRequest,
  renewAccount,
  tokenResponse,
  type Operation,
  type Connection,
} from "./runtime";
import { accountRecovery, accountUnavailableNotice } from "./account-recovery";

import { example, headersOf } from "./runtime-fixture";

let dpop: JWK;
beforeEach(async () => {
  transport.mockReset().mockResolvedValue({ ok: true });
  dpop = (await createIdentity()).privateKey;
});
const verify = async (
  run: Connection,
  jwt: string,
  url: string,
  method = "GET",
  accessToken?: string,
) =>
  verifySessionHeader(jwt, {
    audience: run.company!.profile!.identifier,
    method,
    url,
    ...(accessToken ? { accessToken } : {}),
    keysFor: async () => [(await identity()).publicKey],
  });

it("sends a verifiable Session header and the DPoP access token on signed-in requests", async () => {
  const r = example();
  r.dpop = dpop;
  const url = "https://food.papsandbox.com/poppy/orders";
  await papRequest(r, url, "GET");
  const headers = headersOf(transport.mock.calls[0]!);
  expect(headers.Authorization).toBe("DPoP access-1");
  expect(headers.DPoP).toBeTruthy();
  // §3.4: the version, and the extensions the Company lists.
  expect(headers["Poppy-Version"]).toBe("1.0");
  expect(headers["Poppy-Extensions"]).toBe('"operations";v="3"');
  const session = await verify(
    r,
    headers["Poppy-Session"]!,
    url,
    "GET",
    "access-1",
  );
  expect(session).toMatchObject({ userId: r.user, sessionId: r.sessionId });
  // The general jwks key never signs the Session JWT directly.
  expect(
    JSON.parse(
      Buffer.from(
        headers["Poppy-Session"]!.split(".")[0]!,
        "base64url",
      ).toString(),
    ).kid,
  ).not.toBe((await identity()).publicKey.kid);
});

it("sends only the Session header when signed out", async () => {
  const r = example("food", false);
  await papRequest(r, "https://food.papsandbox.com/poppy/products", "GET");
  const headers = headersOf(transport.mock.calls[0]!);
  expect(headers).not.toHaveProperty("Authorization");
  expect(headers).not.toHaveProperty("DPoP");
  expect(headers["Poppy-Version"]).toBe("1.0");
  await verify(
    r,
    headers["Poppy-Session"]!,
    "https://food.papsandbox.com/poppy/products",
  );
});

it("starts one new Session after session_ended and stops if it ends again (§5.5)", async () => {
  const r = example("food", false);
  transport
    .mockRejectedValueOnce(new ProtocolError(400, "session_ended"))
    .mockResolvedValueOnce({ ok: true });
  const before = r.sessionId;
  await papRequest(r, "https://food.papsandbox.com/poppy/products", "GET");
  const second = await verify(
    r,
    headersOf(transport.mock.calls[1]!)["Poppy-Session"]!,
    "https://food.papsandbox.com/poppy/products",
  );
  expect(second.sessionId).toBe(r.sessionId);
  expect(r.sessionId).not.toBe(before);
  transport
    .mockReset()
    .mockRejectedValue(new ProtocolError(400, "session_ended"));
  await expect(
    papRequest(r, "https://food.papsandbox.com/poppy/products", "GET"),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(2);
});

it("doesn't retry invalid_session, and stops on version_unsupported (§3.4, §5.3)", async () => {
  const r = example("food", false);
  transport
    .mockReset()
    .mockRejectedValue(new ProtocolError(400, "invalid_session"));
  await expect(
    papRequest(r, "https://food.papsandbox.com/poppy/products", "GET"),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
  rediscover.mockResolvedValueOnce(r.company!);
  transport
    .mockReset()
    .mockRejectedValue(new ProtocolError(400, "version_unsupported"));
  await expect(
    papRequest(r, "https://food.papsandbox.com/poppy/products", "GET"),
  ).rejects.toThrow("no longer serves a protocol version");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("declares no extensions to a Company that lists none", async () => {
  const r = example("food", false);
  r.company!.profile.operations = false;
  await papRequest(r, "https://food.papsandbox.com/poppy/products", "GET");
  expect(headersOf(transport.mock.calls[0]!)).not.toHaveProperty(
    "Poppy-Extensions",
  );
});

it.each([
  ["server error", new ProtocolError(500, "invalid_session")],
  ["lost response", new Error("socket hang up")],
  ["rejected token", new ProtocolError(401, "invalid_token")],
])("never retries after a %s", async (_name, error) => {
  const r = example();
  r.dpop = dpop;
  transport.mockRejectedValueOnce(error);
  await expect(
    papRequest(
      r,
      "https://food.papsandbox.com/poppy/orders/1/changes",
      "POST",
      {},
    ),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});

it("marks access unavailable after invalid_token without retrying", async () => {
  const r = example();
  r.dpop = dpop;
  transport.mockRejectedValueOnce(new ProtocolError(401, "invalid_token"));
  await expect(
    papRequest(r, "https://food.papsandbox.com/poppy/orders", "GET"),
  ).rejects.toThrow();
  expect(r.accountUnavailable).toBe(true);
});

it("asks for sign-in again when the grant ended and its refresh gets invalid_grant", async () => {
  // A grant that ends with its first access token, as at Harborline without
  // offline_access: past it, the refresh is refused (RFC 6749 §5.2).
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const r = example();
    r.dpop = dpop;
    vi.setSystemTime(r.tokenExpires! + 1);
    transport.mockRejectedValueOnce(new ProtocolError(400, "invalid_grant"));
    const error = await papRequest(
      r,
      "https://food.papsandbox.com/poppy/orders",
      "GET",
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400, code: "invalid_grant" });
    // Only the refresh: nothing goes out with the expired token.
    expect(transport).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(
      (transport.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(r.accountUnavailable).toBe(true);
    expect(accountRecovery(error)).toEqual(accountUnavailableNotice);
    expect(accountUnavailableNotice.next).toBe("signin");
  } finally {
    vi.useRealTimers();
  }
});

it("refreshes within current scopes, keeps the refresh token when none is returned, and needs no Session", async () => {
  const r = example();
  r.dpop = dpop;
  transport.mockResolvedValueOnce({
    access_token: "access-2",
    token_type: "DPoP",
    expires_in: 600,
  });
  await renewAccount(r);
  const body = new URLSearchParams(
    (transport.mock.calls[0]![1] as RequestInit).body as string,
  );
  expect(body.get("grant_type")).toBe("refresh_token");
  expect(body.get("scope")).toBe("orders:read orders:write");
  expect(body.has("session_id")).toBe(false);
  expect(headersOf(transport.mock.calls[0]!)).toHaveProperty("DPoP");
  expect(r.token).toBe("access-2");
  expect(r.accountToken).toBe("refresh-1");
  expect(r.scopes).toBe("orders:read orders:write");
});

it("rejects a refresh that widens scopes or changes the token type, keeping prior authority", async () => {
  for (const reply of [
    {
      access_token: "x",
      token_type: "DPoP",
      scope: "orders:read orders:write admin",
    },
    { access_token: "x", token_type: "Bearer" },
  ]) {
    const r = example();
    r.dpop = dpop;
    const before = structuredClone(r);
    transport.mockResolvedValueOnce(reply);
    await expect(renewAccount(r)).rejects.toThrow();
    expect(r).toEqual(before);
  }
});

it("validates token responses as RFC 6749 describes", () => {
  expect(
    tokenResponse(
      { access_token: "a", token_type: "Bearer", refresh_token: "r" },
      "a b",
      false,
      true,
    ),
  ).toMatchObject({ scope: "a b", tokenType: "Bearer", refreshToken: "r" });
  expect(() =>
    tokenResponse(
      { access_token: "a", token_type: "Bearer" },
      "a",
      false,
      true,
    ),
  ).toThrow();
  expect(
    tokenResponse(
      { access_token: "a", token_type: "DPoP", scope: "a" },
      "a b",
      true,
      false,
    ).scope,
  ).toBe("a");
});

it.each(["food", "flowers", "stays"])(
  "binds %s account endpoints to the discovered origin",
  (host) =>
    expect(accountConfiguration(example(host)).issuer).toBe(
      `https://${host}.papsandbox.com`,
    ),
);
it("does not grant the policy to lookalike domains or different issuers", () => {
  const r = example();
  r.url = "https://food.papsandbox.com.evil.example";
  expect(() => accountConfiguration(r)).toThrow();
  const other = example();
  other.company!.profile!.issuer = "https://flowers.papsandbox.com";
  expect(() => accountConfiguration(other)).toThrow();
});
it("refuses cross-origin account endpoints", () => {
  const r = example();
  r.company!.metadata!.token_endpoint = "https://evil.example/token";
  expect(() => accountConfiguration(r)).toThrow();
});
it("resends the recorded request with an RFC 9651 Poppy-Approval header and the Session header", async () => {
  const r = example();
  r.dpop = dpop;
  transport.mockResolvedValueOnce({ summary: "Done" });
  const op: Operation = {
    operation_id: "op_1",
    revision: "1791-abc",
    summary: "s",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    state: "proposed",
    request: {
      url: "https://food.papsandbox.com/poppy/orders/1/changes",
      body: { slot: "a" },
    },
  };
  await sendApproval(r, op);
  // A retry after an unknown outcome sends the very same approval (§7).
  transport.mockResolvedValueOnce({ summary: "Done" });
  await sendApproval(r, op);
  expect(
    (transport.mock.calls[1]![1] as { headers: Record<string, string> })
      .headers["Poppy-Approval"],
  ).toBe(
    (transport.mock.calls[0]![1] as { headers: Record<string, string> })
      .headers["Poppy-Approval"],
  );
  const [url, init] = transport.mock.calls[0]! as [string, RequestInit];
  expect(url).toBe("https://food.papsandbox.com/poppy/orders/1/changes");
  expect(init.body).toBe(JSON.stringify({ slot: "a" }));
  // A refusal's own body is asked for, so the card can show a number in it.
  expect(transport.mock.calls[0]![4]).toEqual({ errorBody: true });
  const headers = init.headers as Record<string, string>;
  // Operations v3 §6: a user approval, when and how, and our own reference.
  expect(headers["Poppy-Approval"]).toMatch(
    /^operation_id="op_1", revision="1791-abc", approver="user", approved_at=\d+, input_type="tap", reference="apr_[A-Za-z0-9_-]+"$/,
  );
  await verify(r, headers["Poppy-Session"]!, url, "POST", "access-1");
  await expect(
    sendApproval(r, {
      operation_id: "op_1",
      revision: "r",
      summary: "s",
      expires_at: "",
      state: "proposed",
    }),
  ).rejects.toThrow("request");
});

it("derives a stable User ID per visitor and Company, unlinkable across both", async () => {
  const { userFor } = await import("./runtime");
  const a = await userFor("visitor-a", "https://juniper.example");
  expect(a).toMatch(/^usr_[A-Za-z0-9_-]{32}$/);
  expect(await userFor("visitor-a", "https://juniper.example")).toBe(a);
  expect(await userFor("visitor-b", "https://juniper.example")).not.toBe(a);
  expect(await userFor("visitor-a", "https://noodles.example")).not.toBe(a);
  // A demo reset makes the visitor a new person to the same Company.
  const reset = await userFor("visitor-a", "https://juniper.example", "e1");
  expect(reset).not.toBe(a);
  expect(await userFor("visitor-a", "https://juniper.example", "e1")).toBe(
    reset,
  );
  expect(await userFor("visitor-a", "https://juniper.example", "e2")).not.toBe(
    reset,
  );
});

it("presents itself to each Company of a conversation with that Company's own User ID, Session and token", async () => {
  // Two connections of one visitor's conversation.
  const food = example("food");
  const noodles = example("noodles");
  noodles.token = "access-2";
  food.dpop = noodles.dpop = dpop;
  const at = (c: Connection) => `${c.url}/poppy/orders`;
  await papRequest(food, at(food), "GET");
  await papRequest(noodles, at(noodles), "GET");

  expect(food.user).toMatch(/^usr_[A-Za-z0-9_-]{32}$/);
  expect(noodles.user).toMatch(/^usr_[A-Za-z0-9_-]{32}$/);
  expect(noodles.user).not.toBe(food.user);
  expect(noodles.sessionId).not.toBe(food.sessionId);
  expect(noodles.sessionKey).not.toEqual(food.sessionKey);
  // Each request went to its own Company with its own token and nothing
  // of the other's.
  const calls = transport.mock.calls;
  expect(calls.map((call) => call[0])).toEqual([at(food), at(noodles)]);
  const sent = [
    [food, "access-1", noodles],
    [noodles, "access-2", food],
  ] as const;
  for (const [index, [connection, token, other]] of sent.entries()) {
    const headers = headersOf(calls[index]!);
    expect(headers.Authorization).toBe(`DPoP ${token}`);
    const session = await verify(
      connection,
      headers["Poppy-Session"]!,
      at(connection),
      "GET",
      token,
    );
    expect(session).toMatchObject({
      userId: connection.user,
      sessionId: connection.sessionId,
    });
    expect(JSON.stringify(headers)).not.toContain(other.user);
    expect(JSON.stringify(headers)).not.toContain(other.sessionId);
  }
});

it("signs every Session request with the operator key, covering the Session JWT and the token (§5.3)", async () => {
  const r = example();
  r.dpop = dpop;
  const url = "https://food.papsandbox.com/poppy/orders";
  await papRequest(r, url, "GET");
  const h = headersOf(transport.mock.calls[0]!);
  expect(h["Signature-Agent"]).toBe(
    'sig1="http://localhost:3000/.well-known/http-message-signatures-directory"',
  );
  const params = /^sig1=(.*)$/.exec(h["Signature-Input"]!)![1]!;
  expect(params).toMatch(
    /^\("@authority" "@method" "@path" "signature-agent";key="sig1" "poppy-session" "authorization"\);created=\d+;expires=\d+;keyid="[^"]+";alg="ed25519";nonce="[^"]+";tag="web-bot-auth"$/,
  );
  const base = [
    '"@authority": food.papsandbox.com',
    '"@method": GET',
    '"@path": /poppy/orders',
    `"signature-agent";key="sig1": "http://localhost:3000/.well-known/http-message-signatures-directory"`,
    `"poppy-session": ${h["Poppy-Session"]}`,
    `"authorization": ${h.Authorization}`,
    `"@signature-params": ${params}`,
  ].join("\n");
  const sig = /^sig1=:(.*):$/.exec(h.Signature!)![1]!;
  const key = await operatorKey();
  expect(await verifyEd25519(key.publicKey, base, sig)).toBe(true);
  // A separate key: never the jwks_uri key that signs delegations.
  expect(key.keyid).not.toBe((await identity()).publicKey.kid);
});

it("uses a service's own token when its metadata names it, and the default token otherwise (§4.5)", async () => {
  const r = example();
  r.dpop = dpop;
  const endpoint = "https://food.papsandbox.com/poppy/conversations";
  r.conversation = { endpoint, seen: [] };
  transport.mockReset().mockImplementation(async (url: string) => {
    if (
      url ===
      "https://food.papsandbox.com/.well-known/oauth-protected-resource/poppy/conversations"
    )
      return { resource: endpoint, authorization_servers: [r.url] };
    if (url === "https://food.papsandbox.com/oauth/token")
      return {
        access_token: "conversation-token",
        token_type: "DPoP",
        expires_in: 600,
        scope: "orders:read",
      };
    return { ok: true };
  });
  await papRequest(r, `${endpoint}/cnv_1/events`, "GET");
  const tokenCall = transport.mock.calls.find(
    ([u]) => u === "https://food.papsandbox.com/oauth/token",
  )!;
  const form = new URLSearchParams(String((tokenCall[1] as RequestInit).body));
  expect(form.get("grant_type")).toBe("refresh_token");
  expect(form.get("resource")).toBe(endpoint);
  const call = transport.mock.calls.at(-1)!;
  expect(call[0]).toBe(`${endpoint}/cnv_1/events`);
  expect(headersOf(call).Authorization).toBe("DPoP conversation-token");
  // Cached: the next call fetches neither metadata nor a token.
  const before = transport.mock.calls.length;
  await papRequest(r, `${endpoint}/cnv_1/events`, "GET");
  expect(transport.mock.calls.length).toBe(before + 1);

  // Metadata for another resource, or none: the default token.
  for (const meta of [
    async () => ({ resource: "https://elsewhere.example/x" }),
    async () => {
      throw new ProtocolError(404, undefined);
    },
  ]) {
    const d = example();
    d.dpop = dpop;
    d.conversation = { endpoint, seen: [] };
    transport
      .mockReset()
      .mockImplementation(async (url: string) =>
        url.includes("/.well-known/oauth-protected-resource")
          ? meta()
          : { ok: true },
      );
    await papRequest(d, `${endpoint}/cnv_1/events`, "GET");
    expect(headersOf(transport.mock.calls.at(-1)!).Authorization).toBe(
      "DPoP access-1",
    );
  }
});

it("calls a service signed out when the Company won't issue its token (invalid_target)", async () => {
  const r = example();
  r.dpop = dpop;
  const endpoint = "https://food.papsandbox.com/poppy/conversations";
  r.conversation = { endpoint, seen: [] };
  transport.mockReset().mockImplementation(async (url: string) => {
    if (url.includes("/.well-known/oauth-protected-resource"))
      return { resource: endpoint };
    if (url.endsWith("/oauth/token"))
      throw new ProtocolError(400, "invalid_target");
    return { ok: true };
  });
  await papRequest(r, `${endpoint}/cnv_1/events`, "GET");
  expect(headersOf(transport.mock.calls.at(-1)!)).not.toHaveProperty(
    "Authorization",
  );
});

it("after version_unsupported, chooses again and resends once only if the version changed (§3.4)", async () => {
  const r = example("food", false);
  const url = "https://food.papsandbox.com/poppy/products";
  // The Company now prefers 1.1: a new Session and one resend.
  rediscover.mockResolvedValueOnce({
    ...r.company!,
    profile: { ...r.company!.profile, version: "1.1" },
  });
  transport
    .mockReset()
    .mockRejectedValueOnce(new ProtocolError(400, "version_unsupported"))
    .mockResolvedValueOnce({ ok: true });
  const sid = r.sessionId;
  await papRequest(r, url, "GET");
  expect(transport).toHaveBeenCalledTimes(2);
  expect(r.company!.profile.version).toBe("1.1");
  expect(r.sessionId).not.toBe(sid);
  // Still the same version after fetching again: stop.
  rediscover.mockResolvedValueOnce(r.company!);
  transport
    .mockReset()
    .mockRejectedValue(new ProtocolError(400, "version_unsupported"));
  await expect(papRequest(r, url, "GET")).rejects.toThrow(
    "no longer serves a protocol version",
  );
  expect(transport).toHaveBeenCalledTimes(1);
});

it("approves as the agent without input_type, and a different approver is a new approval (Operations v3 §6)", () => {
  const op = {
    operation_id: "op_1",
    revision: "r1",
    state: "proposed",
    expires_at: new Date(Date.now() + 60000).toISOString(),
  } as Parameters<typeof approvalFor>[0];
  const agent = approvalFor(op, "agent");
  expect(agent).toMatchObject({ approver: "agent", operation_id: "op_1" });
  expect(agent).not.toHaveProperty("input_type");
  // A retry sends the very same approval.
  expect(approvalFor(op, "agent")).toEqual(agent);
  const user = approvalFor(op, "user");
  expect(user).toMatchObject({ approver: "user", input_type: "tap" });
  expect(user.reference).not.toBe(agent.reference);
});

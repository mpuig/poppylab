import { it, expect, vi, beforeEach } from "vitest";
const transport = vi.hoisted(() =>
  vi
    .fn<(url: string, ...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ state: "succeeded" }),
);
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
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
  verifySessionHeader,
  type JWK,
} from "@poppy-lab/pap-client";
import {
  accountConfiguration,
  sendApproval,
  identity,
  papRequest,
  renewAccount,
  tokenResponse,
  type Operation,
  type Run,
} from "./runtime";

function example(host = "food", signedIn = true): Run {
  const origin = `https://${host}.papsandbox.com`;
  return {
    protocol: "1.0",
    url: origin,
    user: "",
    visitor: "visitor-fixture",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    ...(signedIn
      ? {
          token: "access-1",
          tokenType: "DPoP" as const,
          accountToken: "refresh-1",
          scopes: "orders:read orders:write",
          tokenExpires: Date.now() + 3600000,
        }
      : {}),
    company: {
      requestedUrl: origin,
      discoveryUrl: origin + "/.well-known/poppy.json",
      discoveredAt: new Date().toISOString(),
      trace: [],
      document: {
        protocol_version: "1.0",
        organization: { name: host, domain: host + ".papsandbox.com" },
        apis: [
          {
            type: "openapi",
            url: origin + "/poppy/openapi.json",
            description: "Test",
          },
        ],
        extensions: { operations: [{ version: "3" }] },
      },
      metadata: {
        issuer: origin,
        token_endpoint: origin + "/oauth/token",
        revocation_endpoint: origin + "/oauth/revoke",
        authorization_endpoint: origin + "/oauth/authorize",
        grant_types_supported: ["authorization_code", "refresh_token"],
        protected_resources: [origin],
        dpop_signing_alg_values_supported: ["ES256"],
      },
      profile: {
        version: "1.0",
        identifier: origin,
        issuer: origin,
        signIn: { direct: true, device: false },
        scopes: ["orders:read", "orders:write"],
        scopeDescriptions: {},
        scopeHints: {},
        operations: true,
      },
    },
  };
}
const headersOf = (call: unknown[]) =>
  (call[1] as RequestInit).headers as Record<string, string>;
let dpop: JWK;
beforeEach(async () => {
  transport.mockReset().mockResolvedValue({ ok: true });
  dpop = (await createIdentity()).privateKey;
});
const verify = async (
  run: Run,
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
  transport
    .mockReset()
    .mockRejectedValue(new ProtocolError(400, "version_unsupported"));
  await expect(
    papRequest(r, "https://food.papsandbox.com/poppy/products", "GET"),
  ).rejects.toThrow("no longer serves PAP 1.0");
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
});

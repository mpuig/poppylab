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
  type Run,
} from "./runtime";

function example(host = "food", signedIn = true): Run {
  const origin = `https://${host}.papsandbox.com`;
  return {
    protocol: "0.3",
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
        protocol_version: "0.3",
        organization: { name: host, domain: host + ".papsandbox.com" },
        apis: [
          {
            type: "openapi",
            url: origin + "/poppy/openapi.json",
            description: "Test",
          },
        ],
        extensions: {
          operations: { version: "1", endpoint: origin + "/poppy/operations" },
        },
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
        version: "0.3",
        identifier: origin,
        issuer: origin,
        signIn: { direct: true, device: false },
        scopes: ["orders:read", "orders:write"],
        scopeDescriptions: {},
        scopeHints: {},
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
  await verify(
    r,
    headers["Poppy-Session"]!,
    "https://food.papsandbox.com/poppy/products",
  );
});

it("starts one new Session after invalid_session and stops if it fails again", async () => {
  const r = example("food", false);
  transport
    .mockRejectedValueOnce(new ProtocolError(400, "invalid_session"))
    .mockResolvedValueOnce({ ok: true });
  await papRequest(r, "https://food.papsandbox.com/poppy/products", "GET");
  const first = await verify(
    r,
    headersOf(transport.mock.calls[0]!)["Poppy-Session"]!,
    "https://food.papsandbox.com/poppy/products",
  ).catch(() => undefined);
  const second = await verify(
    r,
    headersOf(transport.mock.calls[1]!)["Poppy-Session"]!,
    "https://food.papsandbox.com/poppy/products",
  );
  expect(second.sessionId).toBe(r.sessionId);
  if (first) expect(first.sessionId).not.toBe(second.sessionId);
  transport
    .mockReset()
    .mockRejectedValue(new ProtocolError(400, "invalid_session"));
  await expect(
    papRequest(r, "https://food.papsandbox.com/poppy/products", "GET"),
  ).rejects.toThrow();
  // A new Session, then the earlier 0.3 delegation form once; then it stops.
  expect(transport).toHaveBeenCalledTimes(3);
  expect(r.sessionDialect).toBeUndefined();
});

it("falls back to the earlier 0.3 delegation form (pap_dlg) only after a repeated invalid_session, and remembers it", async () => {
  const r = example("food", false);
  transport
    .mockReset()
    .mockRejectedValueOnce(new ProtocolError(400, "invalid_session"))
    .mockRejectedValueOnce(new ProtocolError(400, "invalid_session"))
    .mockResolvedValue({ ok: true });
  await papRequest(r, "https://food.papsandbox.com/poppy/products", "GET");
  const header = (call: number) =>
    JSON.parse(
      Buffer.from(
        headersOf(transport.mock.calls[call]!)["Poppy-Session"]!.split(".")[0]!,
        "base64url",
      ).toString(),
    );
  expect(header(0)).toHaveProperty("poppy_dlg");
  expect(header(2)).toHaveProperty("pap_dlg");
  expect(header(2)).not.toHaveProperty("poppy_dlg");
  expect(r.sessionDialect).toBe("earlier");
  // Verifiable by a Company that accepts either form.
  await verify(
    r,
    headersOf(transport.mock.calls[2]!)["Poppy-Session"]!,
    "https://food.papsandbox.com/poppy/products",
  );
  await papRequest(r, "https://food.papsandbox.com/poppy/products", "GET");
  expect(header(3)).toHaveProperty("pap_dlg");
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
  await sendApproval(r, {
    operation_id: "op_1",
    revision: "1791-abc",
    summary: "s",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    state: "proposed",
    request: {
      url: "https://food.papsandbox.com/poppy/orders/1/changes",
      body: { slot: "a" },
    },
  });
  const [url, init] = transport.mock.calls[0]! as [string, RequestInit];
  expect(url).toBe("https://food.papsandbox.com/poppy/orders/1/changes");
  expect(init.body).toBe(JSON.stringify({ slot: "a" }));
  const headers = init.headers as Record<string, string>;
  expect(headers["Poppy-Approval"]).toBe(
    'operation_id="op_1", revision="1791-abc"',
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

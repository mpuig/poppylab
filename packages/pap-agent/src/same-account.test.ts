import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() =>
  vi.fn<(url: string, ...args: unknown[]) => Promise<unknown>>(),
);
const probe = vi.hoisted(() => vi.fn());

vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
}));
vi.mock("./runtime", () => ({
  localOrigins: [],
  probeSession: probe,
}));

import { example } from "./runtime-fixture";
import { checkTarget, sameBySession } from "./same-account";

const specWithServer = (url: string) => ({
  servers: [{ url }],
  paths: {
    "/status": {
      get: {
        "x-poppy-scopes": [],
        responses: { "200": {} },
      },
    },
  },
});

beforeEach(() => {
  transport.mockReset();
  probe.mockReset();
});

describe("checkTarget", () => {
  const issuer = "https://company.example";
  const specUrl = `${issuer}/docs/openapi.json`;

  it("resolves root-relative and path-relative servers[].url against the spec URL", () => {
    expect(checkTarget(specWithServer("/api/v1"), issuer, [], specUrl)).toBe(
      `${issuer}/api/v1/status`,
    );
    expect(checkTarget(specWithServer("v1"), issuer, [], specUrl)).toBe(
      `${issuer}/docs/v1/status`,
    );
    expect(checkTarget(specWithServer("/"), issuer, [], specUrl)).toBe(
      `${issuer}/status`,
    );
  });

  it("rejects cross-origin, protocol-relative, invalid, or unsafe server URLs", () => {
    for (const url of [
      "https://evil.example/api",
      "//evil.example/api",
      "https://user:pass@company.example/api",
      "/api?foo=bar",
      "/api#frag",
      "http://[invalid",
    ]) {
      expect(checkTarget(specWithServer(url), issuer, [], specUrl)).toBe(
        undefined,
      );
    }
  });
});

describe("sameBySession", () => {
  const makeConnection = (apiUrl: string) => {
    const conn = example("shop", false);
    conn.company!.document.apis = [
      { type: "openapi", url: apiUrl, description: "Shop API" },
    ];
    conn.token = "new-token";
    conn.tokenType = "Bearer";
    conn.scopes = "orders:read";
    return conn;
  };
  const earlier = () => ({
    sessionId: "sid-earlier",
    token: "old-token",
    tokenType: "Bearer" as const,
    tokenExpires: Date.now() + 60_000,
    dpop: undefined,
    scopes: "orders:read",
  });

  it("resolves relative servers[].url against api.url when probing the earlier session", async () => {
    const conn = makeConnection(
      "https://shop.papsandbox.com/docs/openapi.json",
    );
    transport.mockResolvedValueOnce(specWithServer("v1"));
    probe.mockResolvedValue("accepted");

    await expect(sameBySession(conn, earlier(), true)).resolves.toBe("same");
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe.mock.calls[0]?.[1]).toBe(
      "https://shop.papsandbox.com/docs/v1/status",
    );
    expect(probe.mock.calls[1]?.[1]).toBe(
      "https://shop.papsandbox.com/docs/v1/status",
    );
  });

  it("returns unknown without probing when a relative server escapes the issuer origin", async () => {
    const conn = makeConnection(
      "https://shop.papsandbox.com/docs/openapi.json",
    );
    transport.mockResolvedValueOnce(specWithServer("//evil.example/api"));

    await expect(sameBySession(conn, earlier(), true)).resolves.toBe("unknown");
    expect(probe).not.toHaveBeenCalled();
  });
});

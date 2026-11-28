/**
 * What a Company takes from a client metadata document (§4.1): redirect
 * URIs on the client's own HTTPS origin or at a loopback address (RFC 8252
 * §7.3), and a `jwks_uri` on that origin with no credentials in it.
 */
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { setup } from "./test-company.ts";

afterEach(() => vi.useRealTimers());

/** A Company whose client at `id` publishes these redirect URIs. */
async function agent(
  redirects: unknown[],
  {
    id = "https://agent.test/client.json",
    jwks = "https://agent.test/jwks.json",
  } = {},
) {
  const x = await setup({
    fetchJson: async (url) =>
      url === id
        ? { client_id: id, jwks_uri: jwks, redirect_uris: redirects }
        : { keys: [] },
    httpClients: ["http://localhost:3000/agent/client.json"],
  });
  /** What the authorization endpoint answers for that redirect URI. */
  const opens = async (redirect: string) => {
    const r = await x.app.request(
      `/oauth/authorize?${new URLSearchParams({
        client_id: id,
        redirect_uri: redirect,
        response_type: "code",
        scope: "things:read",
        state: "s".repeat(32),
        code_challenge: createHash("sha256")
          .update("v".repeat(64))
          .digest("base64url"),
        code_challenge_method: "S256",
      })}`,
    );
    return r.status === 200
      ? 200
      : ((await r.json()) as { error?: string }).error;
  };
  return { ...x, opens };
}

it("takes redirect URIs on the client's own HTTPS origin and at loopback addresses", async () => {
  const good = [
    "https://agent.test/callback",
    "http://127.0.0.1:8123/callback",
    "http://[::1]:8123/callback",
  ];
  const x = await agent(good);
  for (const redirect of good) expect(await x.opens(redirect)).toBe(200);
});

it("takes a loopback redirect URI on any port, and nothing else that differs (§4.2)", async () => {
  const x = await agent([
    "http://127.0.0.1/callback?app=1",
    "http://[::1]:8123/callback",
    "https://agent.test/callback",
  ]);
  for (const redirect of [
    "http://127.0.0.1/callback?app=1",
    "http://127.0.0.1:51234/callback?app=1",
    "http://[::1]:51234/callback",
    "http://[::1]/callback",
  ])
    expect(await x.opens(redirect), redirect).toBe(200);
  for (const redirect of [
    "http://127.0.0.1:51234/callback",
    "http://127.0.0.1:51234/callback?app=2",
    "http://127.0.0.1:51234/other?app=1",
    "http://127.0.0.1:51234/callback?app=1#here",
    "http://[::1]:51234/callback/",
    "http://[::1]:51234/Callback",
    "http://localhost:51234/callback?app=1",
    "http://127.0.0.2:51234/callback?app=1",
    "https://agent.test:8443/callback",
  ])
    expect(await x.opens(redirect), redirect).toBe("invalid_request");
});

it("drops the redirect URIs §4.1 doesn't allow, and keeps the others", async () => {
  const bad = [
    "http://agent.test/callback",
    "https://evil.test/callback",
    "https://agent.test.evil.test/callback",
    "https://user:pass@agent.test/callback",
    "https://agent.test/callback#here",
    "javascript:alert(1)",
    "data:text/html,hi",
    "not a url",
    "http://localhost:8123/callback",
    "https://127.0.0.1/callback",
  ];
  const x = await agent([...bad, "https://agent.test/callback"]);
  for (const redirect of bad)
    expect(await x.opens(redirect), redirect).toBe("invalid_request");
  expect(await x.opens("https://agent.test/callback")).toBe(200);
});

it("takes an http client's own origin when the deployment allows that client", async () => {
  const x = await agent(
    [
      "http://localhost:3000/api/account/callback",
      "http://localhost:4000/api/account/callback",
    ],
    {
      id: "http://localhost:3000/agent/client.json",
      jwks: "http://localhost:3000/agent/jwks.json",
    },
  );
  expect(await x.opens("http://localhost:3000/api/account/callback")).toBe(200);
  expect(await x.opens("http://localhost:4000/api/account/callback")).toBe(
    "invalid_request",
  );
});

it("refuses a client_id longer than the protocol state keeps", async () => {
  const at = (length: number) =>
    `https://agent.test/${"c".repeat(length - 24)}.json`;
  const fits = await agent(["https://agent.test/callback"], { id: at(200) });
  expect(await fits.opens("https://agent.test/callback")).toBe(200);
  const long = await agent(["https://agent.test/callback"], { id: at(201) });
  expect(await long.opens("https://agent.test/callback")).toBe(
    "invalid_client",
  );
});

it("refuses a client whose jwks_uri isn't a URL or carries credentials", async () => {
  for (const jwks of ["not a url", "https://user:pass@agent.test/jwks.json"]) {
    const x = await agent(["https://agent.test/callback"], { jwks });
    expect(await x.opens("https://agent.test/callback"), jwks).toBe(
      "invalid_client",
    );
  }
});

it("refuses a client_id carrying credentials without fetching it", async () => {
  const fetchJson = vi.fn(async () => ({}));
  const x = await setup({ fetchJson });
  for (const id of [
    "https://user:pass@agent.test/client.json",
    "https://user@agent.test/client.json",
  ]) {
    const r = await x.app.request(
      `/oauth/authorize?${new URLSearchParams({
        client_id: id,
        redirect_uri: "https://agent.test/callback",
        response_type: "code",
        scope: "things:read",
        state: "s".repeat(32),
        code_challenge: createHash("sha256")
          .update("v".repeat(64))
          .digest("base64url"),
        code_challenge_method: "S256",
      })}`,
    );
    expect(r.status, id).toBe(400);
    expect(((await r.json()) as { error?: string }).error, id).toBe(
      "invalid_client",
    );
  }
  expect(fetchJson).not.toHaveBeenCalled();
});

it("coalesces concurrent lookups for the same client_id into one fetch", async () => {
  const id = "https://agent.test/client.json";
  const jwks = "https://agent.test/jwks.json";
  const redirect = "https://agent.test/callback";
  let release!: () => void;
  const hold = new Promise<void>((done) => (release = done));
  const fetched: string[] = [];
  const x = await setup({
    fetchJson: async (url) => {
      fetched.push(url);
      if (url === id) {
        await hold;
        return { client_id: id, jwks_uri: jwks, redirect_uris: [redirect] };
      }
      return { keys: [] };
    },
  });
  const open = () =>
    x.app.request(
      `/oauth/authorize?${new URLSearchParams({
        client_id: id,
        redirect_uri: redirect,
        response_type: "code",
        scope: "things:read",
        state: "s".repeat(32),
        code_challenge: createHash("sha256")
          .update("v".repeat(64))
          .digest("base64url"),
        code_challenge_method: "S256",
      })}`,
    );
  const all = Promise.all([open(), open(), open()]);
  await new Promise((done) => setTimeout(done, 0));
  release();
  const statuses = (await all).map((r) => r.status);
  expect(statuses).toEqual([200, 200, 200]);
  expect(fetched).toEqual([id, jwks]);
});

it("negatively caches failed client lookups for the TTL and retries after expiry", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const id = "https://agent.test/client.json";
  const jwks = "https://agent.test/jwks.json";
  const redirect = "https://agent.test/callback";
  let fail = true;
  const fetched: string[] = [];
  const x = await setup({
    fetchJson: async (url) => {
      fetched.push(url);
      if (fail) throw new Error("HTTP 500");
      return url === id
        ? { client_id: id, jwks_uri: jwks, redirect_uris: [redirect] }
        : { keys: [] };
    },
  });
  const open = async () => {
    const r = await x.app.request(
      `/oauth/authorize?${new URLSearchParams({
        client_id: id,
        redirect_uri: redirect,
        response_type: "code",
        scope: "things:read",
        state: "s".repeat(32),
        code_challenge: createHash("sha256")
          .update("v".repeat(64))
          .digest("base64url"),
        code_challenge_method: "S256",
      })}`,
    );
    return r.status === 200
      ? 200
      : ((await r.json()) as { error?: string }).error;
  };
  const start = Date.now();
  // First failure hits fetchJson once and is cached negatively.
  expect(await open()).toBe("invalid_client");
  expect(fetched).toEqual([id]);
  // Subsequent lookups before TTL expiry short-circuit without calling fetchJson.
  fail = false;
  expect(await open()).toBe("invalid_client");
  vi.setSystemTime(start + 14000);
  expect(await open()).toBe("invalid_client");
  expect(fetched).toEqual([id]);
  // After the 15s negative cache TTL expires, the lookup retries and succeeds.
  vi.setSystemTime(start + 15001);
  expect(await open()).toBe(200);
  expect(fetched).toEqual([id, id, jwks]);
});

it("caps concurrent in-flight lookups for distinct clients", async () => {
  const gates: Array<() => void> = [];
  const fetched: string[] = [];
  const x = await setup({
    fetchJson: async (url) => {
      fetched.push(url);
      if (url.endsWith("/client.json")) {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
        return {
          client_id: url,
          jwks_uri: url.replace("/client.json", "/jwks.json"),
          redirect_uris: [url.replace("/client.json", "/cb")],
        };
      }
      return { keys: [] };
    },
  });
  const open = async (n: number) =>
    (
      await x.app.request(
        `/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: `https://agent-${n}.example/client.json`,
          redirect_uri: `https://agent-${n}.example/cb`,
          scope: "things:read",
          state: "state_value_1234567890",
          code_challenge: "a".repeat(43),
          code_challenge_method: "S256",
        })}`,
      )
    ).status;
  const inflight = Array.from({ length: 20 }, (_, i) => open(i));
  await Promise.resolve();
  expect(gates).toHaveLength(20);
  // 21st distinct client gets a fast 503 without starting a fetch.
  expect(await open(20)).toBe(503);
  expect(fetched).toHaveLength(20);
  for (const release of gates) release();
  expect(await Promise.all(inflight)).toEqual(Array(20).fill(200));
  // Once settled, new clients can be fetched again.
  const after = open(21);
  await Promise.resolve();
  gates[20]!();
  expect(await after).toBe(200);
});

it("serves stale cached metadata for a known client when in-flight lookups are saturated", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const knownId = "https://known.example/client.json";
  const knownJwks = "https://known.example/jwks.json";
  const initialRedirect = "https://known.example/cb";
  const updatedRedirect = "https://known.example/cb2";
  let redirects = [initialRedirect];
  const gates: Array<() => void> = [];
  const fetched: string[] = [];

  const x = await setup({
    fetchJson: async (url) => {
      fetched.push(url);
      if (url === knownId)
        return {
          client_id: knownId,
          jwks_uri: knownJwks,
          redirect_uris: redirects,
        };
      if (url === knownJwks) return { keys: [] };
      if (url.endsWith("/client.json")) {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
        return {
          client_id: url,
          jwks_uri: url.replace("/client.json", "/jwks.json"),
          redirect_uris: [url.replace("/client.json", "/cb")],
        };
      }
      return { keys: [] };
    },
  });

  const open = async (clientId: string, redirectUri: string) =>
    (
      await x.app.request(
        `/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: "things:read",
          state: "state_value_1234567890",
          code_challenge: "a".repeat(43),
          code_challenge_method: "S256",
        })}`,
      )
    ).status;

  // Warm the cache for the known client, then let its TTL expire.
  const start = Date.now();
  expect(await open(knownId, initialRedirect)).toBe(200);
  expect(fetched).toEqual([knownId, knownJwks]);
  vi.setSystemTime(start + 61000);
  redirects = [initialRedirect, updatedRedirect];

  // Saturate all 20 in-flight slots with distinct unknown clients.
  const inflight = Array.from({ length: 20 }, (_, i) =>
    open(
      `https://slow-${i}.example/client.json`,
      `https://slow-${i}.example/cb`,
    ),
  );
  await Promise.resolve();
  expect(gates).toHaveLength(20);

  // Unknown 21st client gets 503, while the known client stays up from stale cache.
  expect(
    await open(
      "https://unknown.example/client.json",
      "https://unknown.example/cb",
    ),
  ).toBe(503);
  expect(await open(knownId, initialRedirect)).toBe(200);
  expect(fetched.filter((u) => u === knownId)).toHaveLength(1);

  for (const release of gates) release();
  expect(await Promise.all(inflight)).toEqual(Array(20).fill(200));

  // Once saturation clears, the stale entry refreshes and picks up the new redirect URI.
  expect(await open(knownId, updatedRedirect)).toBe(200);
  expect(fetched.filter((u) => u === knownId)).toHaveLength(2);
});

it("serves stale cached metadata when refresh fails and refreshes after backoff", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const id = "https://known.example/client.json";
  const jwks = "https://known.example/jwks.json";
  const initialRedirect = "https://known.example/cb";
  const updatedRedirect = "https://known.example/cb2";
  let fail = false;
  let redirects = [initialRedirect];
  const fetched: string[] = [];

  const x = await setup({
    fetchJson: async (url) => {
      fetched.push(url);
      if (fail) throw new Error("HTTP 503");
      return url === id
        ? { client_id: id, jwks_uri: jwks, redirect_uris: redirects }
        : { keys: [] };
    },
  });

  const open = async (redirectUri: string) =>
    (
      await x.app.request(
        `/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: id,
          redirect_uri: redirectUri,
          scope: "things:read",
          state: "state_value_1234567890",
          code_challenge: "a".repeat(43),
          code_challenge_method: "S256",
        })}`,
      )
    ).status;

  const start = Date.now();
  expect(await open(initialRedirect)).toBe(200);
  expect(fetched).toEqual([id, jwks]);

  // Cache expires while the client's metadata endpoint is failing: serve stale.
  vi.setSystemTime(start + 61000);
  fail = true;
  expect(await open(initialRedirect)).toBe(200);
  expect(fetched).toEqual([id, jwks, id]);

  // Within the 15s failure backoff, keep serving stale without hammering fetchJson.
  fail = false;
  redirects = [initialRedirect, updatedRedirect];
  vi.setSystemTime(start + 70000);
  expect(await open(initialRedirect)).toBe(200);
  expect(fetched).toEqual([id, jwks, id]);

  // After the 15s backoff expires, refresh succeeds with the updated metadata.
  vi.setSystemTime(start + 76001);
  expect(await open(updatedRedirect)).toBe(200);
  expect(fetched).toEqual([id, jwks, id, id, jwks]);
});

it("stops serving stale metadata once past the one-hour stale ceiling on fetch failure or backoff", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const id = "https://known.example/client.json";
  const jwks = "https://known.example/jwks.json";
  const redirect = "https://known.example/cb";
  let fail = false;
  const x = await setup({
    fetchJson: async (url) => {
      if (fail) throw new Error("HTTP 503");
      return url === id
        ? { client_id: id, jwks_uri: jwks, redirect_uris: [redirect] }
        : { keys: [] };
    },
  });
  const open = async () => {
    const r = await x.app.request(
      `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: id,
        redirect_uri: redirect,
        scope: "things:read",
        state: "state_value_1234567890",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      })}`,
    );
    return r.status === 200
      ? 200
      : ((await r.json()) as { error?: string }).error;
  };

  // Warm cache: until = start + 60_000; stale ceiling = start + 60_000 + 3_600_000.
  const start = Date.now();
  expect(await open()).toBe(200);

  // Just before the 1-hour stale ceiling: fetch failure still serves stale and starts 15s backoff.
  fail = true;
  vi.setSystemTime(start + 60_000 + 3_600_000 - 1000);
  expect(await open()).toBe(200);

  // Past the 1-hour stale ceiling (even still within the 15s backoff): stale is no longer served.
  vi.setSystemTime(start + 60_000 + 3_600_000);
  expect(await open()).toBe("invalid_client");

  // Past the backoff and past the stale ceiling: a failing refresh still refuses instead of serving stale.
  vi.setSystemTime(start + 60_000 + 3_600_000 + 20_000);
  expect(await open()).toBe("invalid_client");
});

it("stops serving stale metadata once past the one-hour stale ceiling when lookup slots are busy", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const knownId = "https://known.example/client.json";
  const knownJwks = "https://known.example/jwks.json";
  const knownRedirect = "https://known.example/cb";
  const gates: Array<() => void> = [];
  const x = await setup({
    fetchJson: async (url) => {
      if (url === knownId)
        return {
          client_id: knownId,
          jwks_uri: knownJwks,
          redirect_uris: [knownRedirect],
        };
      if (url === knownJwks) return { keys: [] };
      if (url.endsWith("/client.json")) {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
        return {
          client_id: url,
          jwks_uri: url.replace("/client.json", "/jwks.json"),
          redirect_uris: [url.replace("/client.json", "/cb")],
        };
      }
      return { keys: [] };
    },
  });
  const open = async (clientId: string, redirectUri: string) =>
    (
      await x.app.request(
        `/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: "things:read",
          state: "state_value_1234567890",
          code_challenge: "a".repeat(43),
          code_challenge_method: "S256",
        })}`,
      )
    ).status;

  const start = Date.now();
  expect(await open(knownId, knownRedirect)).toBe(200);

  // Saturate all 20 in-flight slots with slow unknown clients.
  const inflight = Array.from({ length: 20 }, (_, i) =>
    open(
      `https://slow-${i}.example/client.json`,
      `https://slow-${i}.example/cb`,
    ),
  );
  await Promise.resolve();
  expect(gates).toHaveLength(20);

  // Just before the 1-hour stale ceiling: stale entry is still served while busy.
  vi.setSystemTime(start + 60_000 + 3_600_000 - 1000);
  expect(await open(knownId, knownRedirect)).toBe(200);

  // Once past the 1-hour stale ceiling: saturated slots return 503 instead of serving stale.
  vi.setSystemTime(start + 60_000 + 3_600_000);
  expect(await open(knownId, knownRedirect)).toBe(503);

  for (const release of gates) release();
  expect(await Promise.all(inflight)).toEqual(Array(20).fill(200));
});

it("never serves stale metadata when a refresh fetches an invalid metadata or JWKS document", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const id = "https://known.example/client.json";
  const jwks = "https://known.example/jwks.json";
  const redirect = "https://known.example/cb";

  const cases: Array<{
    name: string;
    badMetadata?: Record<string, unknown>;
    badJwks?: Record<string, unknown>;
  }> = [
    {
      name: "rejected metadata document",
      badMetadata: {
        client_id: "https://other.example/client.json",
        jwks_uri: jwks,
        redirect_uris: [redirect],
      },
    },
    {
      name: "rejected JWKS with private key",
      badJwks: { keys: [{ kty: "OKP", crv: "Ed25519", x: "pub", d: "priv" }] },
    },
    {
      name: "rejected JWKS with non-array keys",
      badJwks: { keys: "not-an-array" },
    },
  ];

  for (const tc of cases) {
    let invalid = false;
    const x = await setup({
      fetchJson: async (url) => {
        if (url === id) {
          if (invalid && tc.badMetadata) return tc.badMetadata;
          return { client_id: id, jwks_uri: jwks, redirect_uris: [redirect] };
        }
        if (invalid && tc.badJwks) return tc.badJwks;
        return { keys: [] };
      },
    });
    const open = async () => {
      const r = await x.app.request(
        `/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: id,
          redirect_uri: redirect,
          scope: "things:read",
          state: "state_value_1234567890",
          code_challenge: "a".repeat(43),
          code_challenge_method: "S256",
        })}`,
      );
      return r.status === 200
        ? 200
        : ((await r.json()) as { error?: string }).error;
    };

    const start = Date.now();
    expect(await open(), tc.name).toBe(200);

    // Cache expires within the 1-hour stale window, and refresh returns a rejected document.
    vi.setSystemTime(start + 61_000);
    invalid = true;
    expect(await open(), tc.name).toBe("invalid_client");

    // During the 15s backoff, stale metadata is still NOT served.
    vi.setSystemTime(start + 65_000);
    expect(await open(), tc.name).toBe("invalid_client");

    // Once the client fixes the document and backoff expires, lookup recovers.
    invalid = false;
    vi.setSystemTime(start + 77_000);
    expect(await open(), tc.name).toBe(200);
  }
});

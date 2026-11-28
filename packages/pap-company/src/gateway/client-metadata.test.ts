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

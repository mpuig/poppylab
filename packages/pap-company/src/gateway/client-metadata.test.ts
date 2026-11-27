/**
 * What a Company takes from a client metadata document (§4.1): redirect
 * URIs on the client's own HTTPS origin or at a loopback address (RFC 8252
 * §7.3), and a `jwks_uri` on that origin with no credentials in it.
 */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { setup } from "./test-company.ts";

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

it("refuses a client whose jwks_uri isn't a URL or carries credentials", async () => {
  for (const jwks of ["not a url", "https://user:pass@agent.test/jwks.json"]) {
    const x = await agent(["https://agent.test/callback"], { jwks });
    expect(await x.opens("https://agent.test/callback"), jwks).toBe(
      "invalid_client",
    );
  }
});

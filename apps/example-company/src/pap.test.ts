import { expect, it, vi } from "vitest";
import {
  createIdentity,
  createSessionKey,
  newSessionId,
  signSessionHeader,
  assertion,
} from "@poppy-lab/pap-client";
import { juniperApp } from "./test-app.js";

const fetchJson = vi.fn();

const origin = "http://juniper.localhost:4100";
const client = "http://localhost:3000/agent/client.json";

async function setup() {
  const keys = await createIdentity();
  fetchJson.mockImplementation(async (url) =>
    url.endsWith("client.json")
      ? { client_id: client, jwks_uri: "http://localhost:3000/agent/jwks.json" }
      : { keys: [keys.publicKey] },
  );
  const app = juniperApp({ fetchJson });
  const key = await createSessionKey(keys.privateKey, client);
  const header = (
    sid: string,
    user = "usr_a",
    url = "/api/products",
    method = "GET",
  ) =>
    signSessionHeader({
      key,
      clientId: client,
      audience: origin,
      sessionId: sid,
      userId: user,
      method,
      url: origin + url,
    });
  return { app, keys, key, header };
}

it("serves signed-out Sessions from the Session header alone, without any token grant", async () => {
  const { app, header } = await setup();
  try {
    const sid = newSessionId();
    expect((await app.inject({ url: "/api/products" })).json()).toEqual({
      error: "invalid_session",
    });
    const ok = await app.inject({
      url: "/api/products",
      headers: { "poppy-session": await header(sid) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().products.length).toBeGreaterThan(0);
    // Same sid must keep its User ID (§5.3 step 4).
    expect(
      (
        await app.inject({
          url: "/api/products",
          headers: { "poppy-session": await header(sid, "usr_other") },
        })
      ).json(),
    ).toEqual({ error: "invalid_session" });
    // A Session JWT is for one method and URL.
    expect(
      (
        await app.inject({
          url: "/api/delivery",
          headers: { "poppy-session": await header(sid) },
        })
      ).statusCode,
    ).toBe(400);
    // Account APIs challenge with the needed scope and no error code.
    const account = await app.inject({
      url: "/api/account/profile",
      headers: {
        "poppy-session": await header(sid, "usr_a", "/api/account/profile"),
      },
    });
    expect(account.statusCode).toBe(401);
    expect(account.headers["www-authenticate"]).toBe('DPoP scope="poppy:read"');
  } finally {
    await app.close();
  }
});

it("rejects a Session JWT whose ath doesn't match, or that names an unknown access token", async () => {
  const { app, key } = await setup();
  try {
    const jwt = await signSessionHeader({
      key,
      clientId: client,
      audience: origin,
      sessionId: newSessionId(),
      userId: "usr_a",
      method: "GET",
      url: origin + "/api/products",
      accessToken: "not-issued",
    });
    const r = await app.inject({
      url: "/api/products",
      headers: { "poppy-session": jwt, authorization: "DPoP other-token" },
    });
    expect(r.json()).toEqual({ error: "invalid_session" });
    const unknown = await app.inject({
      url: "/api/products",
      headers: { "poppy-session": jwt, authorization: "DPoP not-issued" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual({ error: "invalid_token" });
  } finally {
    await app.close();
  }
});

it("publishes 0.3 OAuth metadata and no longer accepts the JWT-bearer Session grant", async () => {
  const { app, keys } = await setup();
  try {
    const metadata = (
      await app.inject("/.well-known/oauth-authorization-server")
    ).json();
    expect(metadata).toMatchObject({
      issuer: origin,
      protected_resources: [origin],
      grant_types_supported: ["authorization_code", "refresh_token"],
      scopes_supported: ["poppy:read", "poppy:write"],
    });
    expect(metadata).not.toHaveProperty("poppy_domains");
    expect(
      (await app.inject("/.well-known/oauth-protected-resource")).json(),
    ).toEqual({ resource: origin, authorization_servers: [origin] });
    const legacy = await app.inject({
      method: "POST",
      url: "/oauth/token",
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        client_id: client,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          keys.privateKey,
          client,
          client,
          origin,
        ),
        assertion: await assertion(keys.privateKey, client, "usr_a", origin),
      },
    });
    expect(legacy.json()).toEqual({ error: "unsupported_grant_type" });
  } finally {
    await app.close();
  }
});

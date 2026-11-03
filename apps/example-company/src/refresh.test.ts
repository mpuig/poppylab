import { it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  createIdentity,
  createSessionKey,
  newSessionId,
  signSessionHeader,
  assertion,
  proof,
} from "@poppy-lab/pap-client";
import { juniperApp } from "./test-app.js";
const fetchJson = vi.fn();
it("issues scoped account tokens, refreshes with DPoP, rejects escalation, revokes immediately", async () => {
  const origin = "http://juniper.localhost:4100",
    client = "http://localhost:3000/agent/client.json",
    redirect = "http://localhost:3000/api/account/callback";
  const keys = await createIdentity(),
    dpop = await createIdentity();
  fetchJson.mockImplementation(async (url) =>
    url.endsWith("client.json")
      ? { client_id: client, jwks_uri: "http://localhost:3000/agent/jwks.json" }
      : { keys: [keys.publicKey] },
  );
  const app = juniperApp({ fetchJson });
  const token = async (body: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: {
        DPoP: await proof(dpop.privateKey, `${origin}/oauth/token`, "POST"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({
        ...body,
        client_id: client,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          keys.privateKey,
          client,
          client,
          origin,
        ),
      }).toString(),
    });
  try {
    const sessionKey = await createSessionKey(keys.privateKey, client);
    const sid = newSessionId();
    const verifier = "v".repeat(64),
      state = "s".repeat(32);
    const consent = await app.inject(
      `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state, scope: "poppy:read poppy:write", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") })}`,
    );
    const cookie = String(consent.headers["set-cookie"]).split(";")[0]!;
    const approved = await app.inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { cookie, origin },
      payload: { nonce: cookie.split("=")[1], decision: "approve" },
    });
    const code = new URL(String(approved.headers.location)).searchParams.get(
      "code",
    )!;
    const signed = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
    });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().scope).toBe("poppy:read");
    const access = signed.json().access_token,
      refresh_token = signed.json().refresh_token;
    const call = async (
      method: "GET" | "POST",
      url: string,
      payload: Record<string, unknown> = { day: "Saturday" },
    ) =>
      app.inject({
        method,
        url,
        headers: {
          "Poppy-Session": await signSessionHeader({
            key: sessionKey,
            clientId: client,
            audience: origin,
            sessionId: sid,
            userId: "u",
            method,
            url: `${origin}${url}`,
            accessToken: access,
          }),
          Authorization: `DPoP ${access}`,
          DPoP: await proof(dpop.privateKey, `${origin}${url}`, method, access),
        },
        ...(method === "POST" ? { payload } : {}),
      });
    expect((await call("GET", "/api/account/basket")).statusCode).toBe(200);
    expect((await call("POST", "/api/account/checkout")).statusCode).toBe(403);
    for (const url of [
      "/api/account/profile",
      "/api/account/invoices",
      "/api/account/cases",
    ])
      expect((await call("GET", url)).statusCode).toBe(200);
    expect(
      (
        await call("POST", "/api/account/case-proposal", {
          subject: "Caso",
          topic: "delivery",
          message: "Prueba",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("POST", "/api/account/profile-proposal", {
          version: 1,
          name: "Demo",
          email: "demo@example.invalid",
          address: "Fictional street",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("POST", "/api/account/case-resolution", {
          case_id: "unknown",
        })
      ).statusCode,
    ).toBe(403);
    for (const path of ["/site/basket", "/site/delivery"])
      expect(
        (
          await call("POST", path, {
            version: 1,
            items: { oranges: 0, broccoli: 0, apples: 0, coffee: 1 },
            ...(path.endsWith("delivery") ? { day: "Thursday" } : {}),
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await call("POST", "/site/cases", {
          subject: "Caso",
          topic: "delivery",
          message: "Prueba",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call("POST", "/api/account/delivery-items-change")).statusCode,
    ).toBe(403);
    expect(
      (
        await token({
          grant_type: "refresh_token",
          refresh_token,
          scope: "poppy:read poppy:write",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await token({ grant_type: "refresh_token", refresh_token })).statusCode,
    ).toBe(200);
    const revoked = await app.inject({
      method: "POST",
      url: "/oauth/revoke",
      payload: {
        token: refresh_token,
        client_id: client,
        client_assertion: await assertion(
          keys.privateKey,
          client,
          client,
          origin,
        ),
      },
    });
    expect(revoked.statusCode).toBe(200);
    // RFC 7009 §2.1: the refresh token's access tokens end too.
    expect((await call("GET", "/api/account/basket")).statusCode).toBe(401);
    expect((await call("GET", "/api/account/cases")).statusCode).toBe(401);
    expect(
      (await token({ grant_type: "refresh_token", refresh_token })).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});

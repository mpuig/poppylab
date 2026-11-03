import { describe, it, expect } from "vitest";
import { createHash, scryptSync } from "node:crypto";
import {
  assertion,
  createIdentity,
  proof,
  type JWK,
} from "@poppy-lab/pap-client/core";
import { juniperApp, localClient } from "./test-app.js";

const origin = "http://juniper.localhost:4100",
  client = localClient.client_id,
  redirect = localClient.redirect_uris[0]!;
const verifier = "a".repeat(43);

async function setup(passwordHash?: string) {
  const keys = await createIdentity(),
    dpop = await createIdentity();
  const app = juniperApp({
    fetchJson: async (url) =>
      url.endsWith("client.json") ? localClient : { keys: [keys.publicKey] },
    ...(passwordHash ? { passwordHash } : {}),
  });
  const authorize = (
    scope = "poppy:read poppy:write",
    extra: Record<string, string> = {},
  ) =>
    app.inject(
      "/oauth/authorize?" +
        new URLSearchParams({
          client_id: client,
          redirect_uri: redirect,
          response_type: "code",
          code_challenge_method: "S256",
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          scope,
          state: "b".repeat(43),
          ...extra,
        }),
    );
  const consent = async (
    scope: string,
    form: Record<string, string>,
    headers: Record<string, string> = {},
  ) => {
    const page = await authorize(scope);
    const cookie = String(page.headers["set-cookie"]).split(";")[0]!;
    return {
      page,
      response: await app.inject({
        method: "POST",
        url: "/oauth/authorize",
        headers: { origin, cookie, ...headers },
        payload: { nonce: cookie.split("=")[1]!, ...form },
      }),
    };
  };
  const codeOf = (r: { headers: Record<string, string | string[]> }) =>
    new URL(String(r.headers.location)).searchParams.get("code");
  const token = async (
    body: Record<string, string>,
    key: JWK = keys.privateKey,
  ) =>
    app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: {
        DPoP: await proof(dpop.privateKey, `${origin}/oauth/token`, "POST"),
      },
      payload: {
        ...body,
        client_id: client,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(key, client, client, origin),
      },
    });
  const exchange = (code: string, extra: Record<string, string> = {}) =>
    token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      ...extra,
    });
  return { app, authorize, consent, codeOf, token, exchange, keys };
}

describe("Direct Sign-In (0.3 §4.2)", () => {
  it.each([
    "poppy:read",
    "poppy:write",
    "poppy:read poppy:write",
    "poppy:write poppy:read",
  ])("grants only the requested subset: %s", async (scope) => {
    const x = await setup();
    const { page, response } = await x.consent(scope, {
      decision: "approve",
      account: "alex",
      write: "yes",
    });
    if (scope === "poppy:read") {
      expect(page.body).toContain("Read only.");
      expect(page.body).not.toContain('name="write"');
    }
    const granted = (await x.exchange(x.codeOf(response)!)).json();
    expect(
      String(granted.scope ?? scope)
        .split(" ")
        .sort(),
    ).toEqual(scope.split(" ").sort());
    expect(granted).not.toHaveProperty("session_id");
  });
  it("never adds write when only read was requested, even if the form says so", async () => {
    const x = await setup();
    const { response } = await x.consent("poppy:read", {
      decision: "approve",
      write: "yes",
    });
    expect((await x.exchange(x.codeOf(response)!)).json().scope).toBe(
      "poppy:read",
    );
  });
  it("drops write when the user unticks it", async () => {
    const x = await setup();
    const { response } = await x.consent("poppy:read poppy:write", {
      decision: "approve",
    });
    expect((await x.exchange(x.codeOf(response)!)).json().scope).toBe(
      "poppy:read",
    );
  });
  it.each(["", "admin", "poppy:read admin", "poppy:read poppy:read"])(
    "rejects unsupported or ambiguous scopes: %j",
    async (scope) => {
      const x = await setup();
      const r = await x.authorize(scope);
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("invalid_scope");
    },
  );
  it("binds consent to the browser cookie and the Company's Origin", async () => {
    const x = await setup();
    const { response } = await x.consent(
      "poppy:read",
      { decision: "approve" },
      { origin: "https://evil.example" },
    );
    expect(response.statusCode).toBe(400);
    const page = await x.authorize("poppy:read");
    const nonce = String(page.headers["set-cookie"])
      .split(";")[0]!
      .split("=")[1]!;
    const noCookie = await x.app.inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { origin },
      payload: { nonce, decision: "approve" },
    });
    expect(noCookie.statusCode).toBe(400);
  });
  it("issues one-time codes bound to PKCE and the redirect URI", async () => {
    const x = await setup();
    const code = x.codeOf(
      (await x.consent("poppy:read", { decision: "approve" })).response,
    )!;
    expect(
      (await x.exchange(code, { code_verifier: "b".repeat(43) })).json().error,
    ).toBe("invalid_grant");
    const fresh = x.codeOf(
      (await x.consent("poppy:read", { decision: "approve" })).response,
    )!;
    expect(
      (
        await x.exchange(fresh, { redirect_uri: "http://localhost:3000/other" })
      ).json().error,
    ).toBe("invalid_grant");
    const once = x.codeOf(
      (await x.consent("poppy:read", { decision: "approve" })).response,
    )!;
    expect((await x.exchange(once)).statusCode).toBe(200);
    expect((await x.exchange(once)).json().error).toBe("invalid_grant");
  });
  it("declines without issuing a code, even without the password", async () => {
    const salt = "01".repeat(16);
    const x = await setup(
      `${salt}:${scryptSync("secret-pw", salt, 64).toString("hex")}`,
    );
    const { page, response } = await x.consent("poppy:read", {
      decision: "decline",
    });
    expect(page.body).toContain('type="password"');
    const location = new URL(String(response.headers.location));
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.has("code")).toBe(false);
  });
  it("requires the configured demo password without returning it", async () => {
    const salt = "01".repeat(16),
      password = "dedicated-local-test-password";
    const x = await setup(
      `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    );
    const wrong = await x.consent("poppy:read", {
      decision: "approve",
      password: "wrong",
    });
    expect(wrong.page.body).not.toContain(password);
    expect(wrong.response.statusCode).toBe(401);
    const right = await x.consent("poppy:read", {
      decision: "approve",
      password,
    });
    expect(x.codeOf(right.response)).toBeTruthy();
  });
  it("refreshes without widening scopes and revokes immediately (RFC 7009)", async () => {
    const x = await setup();
    const code = x.codeOf(
      (await x.consent("poppy:read", { decision: "approve" })).response,
    )!;
    const issued = (await x.exchange(code)).json();
    expect(
      (
        await x.token({
          grant_type: "refresh_token",
          refresh_token: issued.refresh_token,
          scope: "poppy:read poppy:write",
        })
      ).json().error,
    ).toBe("invalid_scope");
    const renewed = (
      await x.token({
        grant_type: "refresh_token",
        refresh_token: issued.refresh_token,
      })
    ).json();
    expect(renewed).not.toHaveProperty("refresh_token");
    expect(renewed.scope).toBe("poppy:read");
    const other = await createIdentity();
    expect(
      (
        await x.token(
          { grant_type: "refresh_token", refresh_token: issued.refresh_token },
          other.privateKey,
        )
      ).json().error,
    ).toBe("invalid_client");
    await x.app.inject({
      method: "POST",
      url: "/oauth/revoke",
      payload: {
        token: issued.refresh_token,
        client_id: client,
        client_assertion: await assertion(
          x.keys.privateKey,
          client,
          client,
          origin,
        ),
      },
    });
    expect(
      (
        await x.token({
          grant_type: "refresh_token",
          refresh_token: issued.refresh_token,
        })
      ).json().error,
    ).toBe("invalid_grant");
  });
  it("rejects redirect URIs outside the client's metadata", async () => {
    const x = await setup();
    expect(
      (
        await x.authorize("poppy:read", {
          redirect_uri: "https://evil.example/cb",
        })
      ).statusCode,
    ).toBe(400);
  });
});

import { describe, expect, it } from "vitest";
import { SignJWT, decodeProtectedHeader, importJWK, type JWK } from "jose";
import {
  createIdentity,
  createSessionKey,
  newSessionId,
  ReplayCache,
  signSessionHeader,
  tokenHash,
  verifySessionHeader,
} from "./index";

const client = "https://agent.example/agent/client.json";
const audience = "https://auth.company.example";
const url = "https://api.company.example/orders?page=2";

async function setup() {
  const root = await createIdentity();
  const key = await createSessionKey(root.privateKey, client);
  const sign = (extra: Partial<Parameters<typeof signSessionHeader>[0]> = {}) =>
    signSessionHeader({
      key,
      clientId: client,
      audience,
      sessionId: newSessionId(),
      userId: "usr_test",
      method: "GET",
      url,
      ...extra,
    });
  const verify = (
    jwt: string,
    extra: Partial<Parameters<typeof verifySessionHeader>[1]> = {},
  ) =>
    verifySessionHeader(jwt, {
      audience,
      method: "GET",
      url: "https://api.company.example/orders",
      keysFor: async (id) => (id === client ? [root.publicKey as JWK] : []),
      ...extra,
    });
  return { root, key, sign, verify };
}

describe("Poppy-Session header", () => {
  it("round-trips a signed-out Session JWT through its delegation", async () => {
    const { sign, verify, root, key } = await setup();
    const jwt = await sign({ agentId: "agt_travel" });
    const header = decodeProtectedHeader(jwt);
    expect(header).toMatchObject({
      typ: "poppy-session+jwt",
      alg: "ES256",
      kid: key.kid,
    });
    const delegation = decodeProtectedHeader(String(header.poppy_dlg));
    expect(delegation).toMatchObject({
      typ: "poppy-delegation+jwt",
      kid: root.publicKey.kid,
    });
    const claims = JSON.parse(
      Buffer.from(
        String(header.poppy_dlg).split(".")[1]!,
        "base64url",
      ).toString(),
    );
    // A delegation says nothing about the User or Company.
    expect(Object.keys(claims).sort()).toEqual([
      "cnf",
      "exp",
      "iat",
      "iss",
      "jti",
    ]);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(86400);
    expect(claims.cnf.jwk).not.toHaveProperty("d");
    expect(await verify(jwt)).toMatchObject({
      clientId: client,
      userId: "usr_test",
      agentId: "agt_travel",
    });
  });

  it("binds the access token with ath and refuses a mismatch either way", async () => {
    const { sign, verify } = await setup();
    const jwt = await sign({ accessToken: "token-a" });
    expect(await verify(jwt, { accessToken: "token-a" })).toBeTruthy();
    await expect(verify(jwt, { accessToken: "token-b" })).rejects.toThrow(
      "invalid_session",
    );
    await expect(verify(jwt)).rejects.toThrow("invalid_session");
    await expect(
      verify(await sign(), { accessToken: "token-a" }),
    ).rejects.toThrow("invalid_session");
    const claims = JSON.parse(
      Buffer.from(jwt.split(".")[1]!, "base64url").toString(),
    );
    expect(claims.ath).toBe(tokenHash("token-a"));
  });

  it.each([
    ["audience", { audience: "https://other.example" }],
    ["method", { method: "POST" }],
    ["url", { url: "https://api.company.example/other" }],
  ])("rejects a different %s", async (_name, extra) => {
    const { sign, verify } = await setup();
    await expect(verify(await sign(), extra)).rejects.toThrow(
      "invalid_session",
    );
  });

  it("rejects a JWT signed directly with the jwks_uri key", async () => {
    const { root, key, verify } = await setup();
    const jwt = await new SignJWT({
      sid: newSessionId(),
      htm: "GET",
      htu: "https://api.company.example/orders",
    })
      .setProtectedHeader({
        typ: "poppy-session+jwt",
        alg: "ES256",
        kid: root.publicKey.kid!,
        poppy_dlg: key.delegation,
      })
      .setIssuer(client)
      .setAudience(audience)
      .setSubject("usr_test")
      .setIssuedAt()
      .setJti("x".repeat(20))
      .sign(await importJWK(root.privateKey, "ES256"));
    await expect(verify(jwt)).rejects.toThrow("invalid_session");
  });

  it("rejects a delegation from another client or an unknown key", async () => {
    const { sign, verify } = await setup();
    const jwt = await sign();
    await expect(verify(jwt, { keysFor: async () => [] })).rejects.toThrow(
      "invalid_session",
    );
    const other = await createIdentity();
    await expect(
      verify(jwt, { keysFor: async () => [other.publicKey as JWK] }),
    ).rejects.toThrow("invalid_session");
  });

  it("rejects a delegation lasting over 24 hours", async () => {
    const { root, key, verify } = await setup();
    const long = await new SignJWT({
      cnf: {
        jwk:
          decodeProtectedHeader(key.delegation) &&
          JSON.parse(
            Buffer.from(key.delegation.split(".")[1]!, "base64url").toString(),
          ).cnf.jwk,
      },
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "poppy-delegation+jwt",
        kid: root.publicKey.kid!,
      })
      .setIssuer(client)
      .setIssuedAt()
      .setExpirationTime("25h")
      .setJti("y".repeat(20))
      .sign(await importJWK(root.privateKey, "ES256"));
    const jwt = await signSessionHeader({
      key: { ...key, delegation: long },
      clientId: client,
      audience,
      sessionId: newSessionId(),
      userId: "usr_test",
      method: "GET",
      url,
    });
    await expect(verify(jwt)).rejects.toThrow("invalid_session");
  });

  it("refuses to sign after the delegation expired", async () => {
    const { key } = await setup();
    await expect(
      signSessionHeader({
        key: { ...key, expires: Date.now() - 1 },
        clientId: client,
        audience,
        sessionId: newSessionId(),
        userId: "u",
        method: "GET",
        url,
      }),
    ).rejects.toThrow("expired");
  });

  it("rejects typ confusion with a DPoP proof or delegation", async () => {
    const { key, verify } = await setup();
    await expect(verify(key.delegation)).rejects.toThrow("invalid_session");
  });

  it("can reject a replayed jti", async () => {
    const { sign, verify } = await setup();
    const replay = new ReplayCache();
    const jwt = await sign();
    await verify(jwt, { replay });
    await expect(verify(jwt, { replay })).rejects.toThrow();
  });

  it("uses a new delegated key per call so Users can't be matched by key", async () => {
    const { root } = await setup();
    const a = await createSessionKey(root.privateKey, client);
    const b = await createSessionKey(root.privateKey, client);
    expect(a.kid).not.toBe(b.kid);
  });
});

describe("earlier 0.3 delegation form", () => {
  it("signs and verifies pap_dlg with pap-delegation+jwt, and rejects mixed forms", async () => {
    const { root, verify } = await setup();
    const earlier = await createSessionKey(
      root.privateKey,
      client,
      3600,
      "earlier",
    );
    const jwt = await signSessionHeader({
      key: earlier,
      clientId: client,
      audience,
      sessionId: newSessionId(),
      userId: "usr_test",
      method: "GET",
      url,
    });
    const header = decodeProtectedHeader(jwt);
    expect(header).toHaveProperty("pap_dlg");
    expect(header).not.toHaveProperty("poppy_dlg");
    expect(decodeProtectedHeader(String(header.pap_dlg)).typ).toBe(
      "pap-delegation+jwt",
    );
    expect((await verify(jwt)).userId).toBe("usr_test");
    // A current delegation under the earlier field name is refused.
    const current = await createSessionKey(root.privateKey, client);
    const mixed = await signSessionHeader({
      key: { ...current, dialect: "earlier" },
      clientId: client,
      audience,
      sessionId: newSessionId(),
      userId: "usr_test",
      method: "GET",
      url,
    });
    await expect(verify(mixed)).rejects.toThrow("invalid_session");
  });
});

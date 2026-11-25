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

describe("delegation algorithms (§5.2)", () => {
  it("refuses the earlier pap_dlg form", async () => {
    const { root, verify } = await setup();
    const key = await createSessionKey(root.privateKey, client);
    const jwt = await signSessionHeader({
      key,
      clientId: client,
      audience,
      sessionId: newSessionId(),
      userId: "usr_test",
      method: "GET",
      url,
    });
    const [h, p, sig] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    header.pap_dlg = header.poppy_dlg;
    delete header.poppy_dlg;
    const renamed = [
      Buffer.from(JSON.stringify(header)).toString("base64url"),
      p,
      sig,
    ].join(".");
    await expect(verify(renamed)).rejects.toThrow("invalid_session");
  });
  it("accepts PS384 delegations from an RSA key of 2048 to 4096 bits", async () => {
    const { generateKeyPair, exportJWK, calculateJwkThumbprint } =
      await import("jose");
    const { generateKeyPairSync } = await import("node:crypto");
    const rsa = async (modulusLength: number) => {
      // jose refuses to generate short keys; node:crypto makes the bad one.
      const pair =
        modulusLength >= 2048
          ? await generateKeyPair("PS384", { modulusLength, extractable: true })
          : generateKeyPairSync("rsa", { modulusLength });
      const publicKey = await exportJWK(pair.publicKey);
      const kid = await calculateJwkThumbprint(publicKey);
      return {
        publicKey: { ...publicKey, kid },
        privateKey: { ...(await exportJWK(pair.privateKey)), kid },
      };
    };
    for (const [bits, ok] of [
      [3072, true],
      [1024, false],
    ] as const) {
      const root = await rsa(bits);
      const sign = async () =>
        signSessionHeader({
          key: await createSessionKey(root.privateKey, client),
          clientId: client,
          audience,
          sessionId: newSessionId(),
          userId: "usr_rsa",
          method: "GET",
          url,
        });
      if (!ok) {
        await expect(sign()).rejects.toThrow("Unsupported root key");
        continue;
      }
      const jwt = await sign();
      const delegation = decodeProtectedHeader(
        String(decodeProtectedHeader(jwt).poppy_dlg),
      );
      expect(delegation.alg).toBe("PS384");
      const verified = await verifySessionHeader(jwt, {
        audience,
        method: "GET",
        url,
        keysFor: async () => [root.publicKey],
      });
      expect(verified.userId).toBe("usr_rsa");
    }
  });
});

import { randomBytes, createHash } from "node:crypto";
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  SignJWT,
  jwtVerify,
  decodeProtectedHeader,
  calculateJwkThumbprint,
  type JWK,
} from "jose";

export const randomId = () => randomBytes(24).toString("base64url");
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

export async function createIdentity() {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const publicKey = await exportJWK(pair.publicKey);
  const privateKey = await exportJWK(pair.privateKey);
  const kid = await calculateJwkThumbprint(publicKey);
  return {
    publicKey: { ...publicKey, kid, alg: "ES256", use: "sig" },
    privateKey: { ...privateKey, kid, alg: "ES256" },
  };
}

export async function assertion(
  key: JWK,
  issuer: string,
  subject: string,
  audience: string,
) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", ...(key.kid ? { kid: key.kid } : {}) })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomId())
    .sign(await importJWK(key, "ES256"));
}

export async function proof(
  key: JWK,
  url: string,
  method: string,
  token?: string,
  nonce?: string,
) {
  const publicKey = { ...key };
  delete publicKey.d;
  const target = new URL(url);
  target.search = "";
  target.hash = "";
  return new SignJWT({
    ...(nonce ? { nonce } : {}),
    htm: method,
    htu: target.toString(),
    ...(token ? { ath: tokenHash(token) } : {}),
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicKey })
    .setIssuedAt()
    .setJti(randomId())
    .sign(await importJWK(key, "ES256"));
}

export class ReplayCache {
  constructor(private entries = new Map<string, number>()) {}
  snapshot() {
    return [...this.entries] as Array<[string, number]>;
  }
  accept(id: string, until: number) {
    const now = Date.now() / 1000;
    for (const [key, expiry] of this.entries)
      if (expiry < now) this.entries.delete(key);
    if (this.entries.has(id) || this.entries.size >= 10000)
      throw new Error("Replay or capacity limit");
    this.entries.set(id, until);
  }
}

export async function verifyAssertion(
  jwt: string,
  jwk: JWK,
  issuer: string,
  subject: string | undefined,
  audience: string,
  replay: ReplayCache,
) {
  const { payload } = await jwtVerify(jwt, await importJWK(jwk, "ES256"), {
    algorithms: ["ES256"],
    issuer,
    audience,
    maxTokenAge: "65s",
    clockTolerance: 5,
  });
  if (
    payload.aud !== audience ||
    (subject !== undefined && payload.sub !== subject) ||
    !payload.sub ||
    !payload.jti ||
    !payload.exp ||
    !payload.iat ||
    payload.exp - payload.iat > 300
  )
    throw new Error("Invalid assertion");
  replay.accept(`${issuer}:${payload.jti}`, payload.exp);
  return payload;
}

export async function verifyProof(
  jwt: string,
  url: string,
  method: string,
  replay: ReplayCache,
  token?: string,
  binding?: string,
  validateNonce?: (nonce: unknown, binding: string) => void,
) {
  const header = decodeProtectedHeader(jwt);
  if (
    header.typ !== "dpop+jwt" ||
    header.alg !== "ES256" ||
    !header.jwk ||
    "d" in header.jwk
  )
    throw new Error("Invalid proof");
  const { payload } = await jwtVerify(
    jwt,
    await importJWK(header.jwk, "ES256"),
    { algorithms: ["ES256"], maxTokenAge: "65s", clockTolerance: 5 },
  );
  const target = new URL(url);
  target.search = "";
  target.hash = "";
  const thumbprint = await calculateJwkThumbprint(header.jwk);
  if (
    payload.htm !== method ||
    payload.htu !== target.toString() ||
    !payload.jti ||
    (token && payload.ath !== tokenHash(token)) ||
    (binding && binding !== thumbprint)
  )
    throw new Error("Invalid proof binding");
  validateNonce?.(payload.nonce, thumbprint);
  replay.accept(
    `proof:${thumbprint}:${payload.jti}`,
    Math.floor(Date.now() / 1000) + 70,
  );
  return thumbprint;
}

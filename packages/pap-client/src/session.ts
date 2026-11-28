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
  const alg = signingAlgorithm(key);
  if (!alg) throw new Error("Unsupported signing key");
  // §4.1: exp at most 5 minutes after iat; one minute here.
  return new SignJWT({})
    .setProtectedHeader({ alg, ...(key.kid ? { kid: key.kid } : {}) })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomId())
    .sign(await importJWK(key, alg));
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

/** A saved entry: its id's hash, when it ends, and its owner's hash. */
export type ReplayEntry = [string, number, string?];
const digest = (value: string, length: number) =>
  createHash("sha256").update(value).digest("base64url").slice(0, length);

/**
 * The `jti`s taken, each until its JWT ends, so a copy is refused. Each entry
 * counts against its owner, the client that signed it, which may hold at
 * most its `share` of the cache: one client can't fill it, and a client
 * within its share is never refused. When many clients fill it together,
 * the entry nearest its end makes room, and only that copy could then come
 * back. Rejecting a reused `jti` is optional (RFC 7523 §3, RFC 9449 §11.1),
 * and refusing everyone would let one sender stop every client. Ids and
 * owners are kept as hashes, so a long `client_id` costs no more room.
 */
export class ReplayCache {
  private entries = new Map<string, { until: number; owner: string }>();
  private owners = new Map<string, number>();
  private total: number;
  private share: (owner: string) => number;
  constructor(
    saved: Iterable<ReplayEntry> = [],
    limits: { total?: number; share?: (owner: string) => number } = {},
  ) {
    this.total = limits.total ?? 10000;
    this.share = limits.share ?? (() => 0.2);
    // An entry saved before owners were kept has its raw id and no owner.
    for (const [id, until, owner] of saved)
      if (owner === undefined) this.add(digest(id, 22), until, digest("", 16));
      else this.add(id, until, owner);
  }
  snapshot(): ReplayEntry[] {
    return [...this.entries].map(([id, e]) => [id, e.until, e.owner]);
  }
  /** This cache, with every entry counted against `owner`. */
  for(owner: string) {
    return {
      accept: (id: string, until: number) => this.accept(id, until, owner),
    };
  }
  accept(id: string, until: number, owner = "") {
    const now = Date.now() / 1000;
    const key = digest(id, 22),
      mine = digest(owner, 16);
    let first: string | undefined;
    for (const [k, e] of this.entries)
      if (e.until < now) this.remove(k);
      else if (!first || e.until < this.entries.get(first)!.until) first = k;
    if (this.entries.has(key)) throw new Error("Replayed JWT");
    if (
      (this.owners.get(mine) ?? 0) >= Math.ceil(this.total * this.share(owner))
    )
      throw new Error("Replay cache share full");
    if (this.entries.size >= this.total && first) this.remove(first);
    this.add(key, until, mine);
  }
  private add(key: string, until: number, owner: string) {
    this.entries.set(key, { until, owner });
    this.owners.set(owner, (this.owners.get(owner) ?? 0) + 1);
  }
  private remove(key: string) {
    const owner = this.entries.get(key)!.owner;
    this.entries.delete(key);
    const left = this.owners.get(owner)! - 1;
    if (left) this.owners.set(owner, left);
    else this.owners.delete(owner);
  }
}

/**
 * §4.1 and §5.2: Companies accept `ES256` and `PS384` (RSA keys of 2048 to
 * 4096 bits), so a Personal Agent can have its keys sign blindly. The key's
 * type chooses the algorithm; nothing in the JWT can choose another.
 */
export function signingAlgorithm(jwk: JWK) {
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  if (jwk.kty === "RSA" && typeof jwk.n === "string") {
    const bits = Buffer.from(jwk.n, "base64url").length * 8;
    if (bits >= 2048 && bits <= 4096) return "PS384";
  }
  return undefined;
}

const CLOCK_TOLERANCE_SECONDS = 5;
const REPLAY_MARGIN_SECONDS = 5;
const PROOF_MAX_AGE_SECONDS = 65;

export async function verifyAssertion(
  jwt: string,
  jwk: JWK,
  issuer: string,
  subject: string | undefined,
  audience: string,
  replay: ReplayCache,
) {
  const alg = signingAlgorithm(jwk);
  if (!alg || (jwk.alg && jwk.alg !== alg))
    throw new Error("Invalid assertion");
  // §4.1: at most 5 minutes from iat to exp; the lifetime decides, so an
  // assertion within it is never refused for its age.
  const { payload } = await jwtVerify(jwt, await importJWK(jwk, alg), {
    algorithms: [alg],
    issuer,
    audience,
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  });
  if (
    payload.aud !== audience ||
    (subject !== undefined && payload.sub !== subject) ||
    !payload.sub ||
    !payload.jti ||
    !payload.exp ||
    !payload.iat ||
    payload.exp - payload.iat > 300 ||
    payload.iat > Date.now() / 1000 + CLOCK_TOLERANCE_SECONDS
  )
    throw new Error("Invalid assertion");
  replay.accept(
    `${issuer}:${payload.jti}`,
    payload.exp + CLOCK_TOLERANCE_SECONDS + REPLAY_MARGIN_SECONDS,
    issuer,
  );
  return payload;
}

export async function verifyProof(
  jwt: string,
  url: string,
  method: string,
  replay: Pick<ReplayCache, "accept">,
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
    {
      algorithms: ["ES256"],
      maxTokenAge: `${PROOF_MAX_AGE_SECONDS}s`,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    },
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
  const now = Math.floor(Date.now() / 1000);
  const iat = typeof payload.iat === "number" ? payload.iat : now;
  replay.accept(
    `proof:${thumbprint}:${payload.jti}`,
    Math.max(now, iat) +
      PROOF_MAX_AGE_SECONDS +
      CLOCK_TOLERANCE_SECONDS +
      REPLAY_MARGIN_SECONDS,
  );
  return thumbprint;
}

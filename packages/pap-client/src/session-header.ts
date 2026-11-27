/**
 * PAP 1.0 §5.2–5.3: the `Poppy-Session` header. A key from the Personal
 * Agent's jwks_uri signs only short-lived delegations (ES256 or PS384); each
 * delegated key signs Session JWTs (ES256) for exactly one User ID.
 */
import {
  SignJWT,
  calculateJwkThumbprint,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
} from "jose";
import {
  randomId,
  signingAlgorithm,
  tokenHash,
  type ReplayCache,
} from "./session.ts";

export const SESSION_TYP = "poppy-session+jwt";
export const DELEGATION_TYP = "poppy-delegation+jwt";
const MAX_DELEGATION_SECONDS = 24 * 3600;
/** The `sid` this client chooses: random, never reused (§5.2). */
const OWN_SID = /^[A-Za-z0-9_-]{16,128}$/;
/** What a Company accepts: the characters of Conversation IDs (§8.2). */
const SID = /^[A-Za-z0-9_-]{1,256}$/;

/** A delegated key pair plus the delegation vouching for its public key. */
export type SessionKey = {
  privateKey: JWK;
  kid: string;
  delegation: string;
  expires: number;
};

/** Random Session ID, never reused (§5.2). */
export const newSessionId = () => randomId();

/**
 * Creates a fresh delegated key and its delegation, signed by a jwks_uri key.
 * The delegation names no User, Company or issuer (§5.2).
 */
export async function createSessionKey(
  rootKey: JWK,
  clientId: string,
  lifetimeSeconds = 6 * 3600,
): Promise<SessionKey> {
  if (!rootKey.kid) throw new Error("Root key needs a kid");
  const alg = signingAlgorithm(rootKey);
  if (!alg) throw new Error("Unsupported root key");
  const lifetime = Math.min(
    Math.max(Math.floor(lifetimeSeconds), 60),
    MAX_DELEGATION_SECONDS,
  );
  const pair = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  const privateKey = await exportJWK(pair.privateKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  // Rounded times make delegations harder to correlate (guides).
  const iat = Math.floor(Date.now() / 1000 / 60) * 60;
  const delegation = await new SignJWT({
    cnf: {
      jwk: {
        kty: publicJwk.kty,
        crv: publicJwk.crv,
        x: publicJwk.x,
        y: publicJwk.y,
      },
    },
  })
    .setProtectedHeader({ alg, typ: DELEGATION_TYP, kid: rootKey.kid })
    .setIssuer(clientId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + lifetime)
    .setJti(randomId())
    .sign(await importJWK(rootKey, alg));
  return {
    privateKey,
    kid,
    delegation,
    expires: (iat + lifetime) * 1000,
  };
}

/** True when the key can still sign a JWT that remains valid for `marginMs`. */
export const sessionKeyUsable = (
  key: SessionKey | undefined,
  marginMs = 300000,
) => !!key && key.expires - marginMs > Date.now();

const target = (url: string) => {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
};

/** Signs a Session JWT for one request (§5.2). */
export async function signSessionHeader(input: {
  key: SessionKey;
  clientId: string;
  audience: string;
  sessionId: string;
  userId: string;
  agentId?: string;
  method: string;
  url: string;
  accessToken?: string;
}) {
  if (input.key.expires <= Date.now())
    throw new Error("Session key delegation expired");
  if (!OWN_SID.test(input.sessionId)) throw new Error("Invalid Session ID");
  return new SignJWT({
    sid: input.sessionId,
    ...(input.agentId ? { agent_id: input.agentId } : {}),
    htm: input.method.toUpperCase(),
    htu: target(input.url),
    ...(input.accessToken ? { ath: tokenHash(input.accessToken) } : {}),
  })
    .setProtectedHeader({
      typ: SESSION_TYP,
      alg: "ES256",
      kid: input.key.kid,
      poppy_dlg: input.key.delegation,
    })
    .setIssuer(input.clientId)
    .setAudience(input.audience)
    .setSubject(input.userId)
    .setIssuedAt()
    .setJti(randomId())
    .sign(await importJWK(input.key.privateKey, "ES256"));
}

export type VerifiedSession = {
  clientId: string;
  sessionId: string;
  userId: string;
  agentId?: string;
};

/**
 * Company-side checks of §5.2 "Delegated keys" and §5.3. `keysFor` must fetch
 * the client metadata at `iss` without redirects and return its jwks_uri keys.
 */
export async function verifySessionHeader(
  jwt: string,
  options: {
    audience: string;
    method: string;
    url: string;
    accessToken?: string;
    keysFor: (clientId: string) => Promise<JWK[]>;
    replay?: ReplayCache;
    windowSeconds?: number;
  },
): Promise<VerifiedSession> {
  if (!jwt || jwt.length > 8192) throw new Error("invalid_session");
  const header = decodeProtectedHeader(jwt);
  if (
    header.typ !== SESSION_TYP ||
    header.alg !== "ES256" ||
    typeof header.kid !== "string" ||
    "jwk" in header
  )
    throw new Error("invalid_session");
  if (typeof header.poppy_dlg !== "string") throw new Error("invalid_session");
  const delegationJwt = header.poppy_dlg;
  // Read iss before verification only to locate keys; nothing is trusted yet.
  const unverified = JSON.parse(
    Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { iss?: unknown };
  if (typeof unverified.iss !== "string") throw new Error("invalid_session");
  const clientId = unverified.iss;

  // 1–2. Delegation signed (ES256 or PS384) by a jwks_uri key named by its kid.
  const delegationHeader = decodeProtectedHeader(delegationJwt);
  if (
    delegationHeader.typ !== DELEGATION_TYP ||
    typeof delegationHeader.kid !== "string"
  )
    throw new Error("invalid_session");
  const root = (await options.keysFor(clientId)).find(
    (key) => key.kid === delegationHeader.kid && !("d" in key),
  );
  const alg = root && signingAlgorithm(root);
  if (!root || !alg || delegationHeader.alg !== alg)
    throw new Error("invalid_session");
  const { payload: delegation } = await jwtVerify(
    delegationJwt,
    await importJWK(root, alg),
    {
      algorithms: [alg],
      typ: DELEGATION_TYP,
      issuer: clientId,
      clockTolerance: 5,
    },
  ).catch(() => {
    throw new Error("invalid_session");
  });
  const cnf = (delegation.cnf as { jwk?: JWK } | undefined)?.jwk;
  if (
    typeof delegation.iat !== "number" ||
    typeof delegation.exp !== "number" ||
    delegation.exp - delegation.iat > MAX_DELEGATION_SECONDS ||
    !delegation.jti ||
    !cnf ||
    cnf.kty !== "EC" ||
    cnf.crv !== "P-256" ||
    "d" in cnf
  )
    throw new Error("invalid_session");

  // 3. Session JWT signed by the delegated key; kid is its thumbprint.
  if ((await calculateJwkThumbprint(cnf)) !== header.kid)
    throw new Error("invalid_session");
  const key = await importJWK(cnf, "ES256");
  const { payload } = await jwtVerify(jwt, key, {
    algorithms: ["ES256"],
    typ: SESSION_TYP,
    issuer: clientId,
    maxTokenAge: `${options.windowSeconds ?? 60}s`,
    clockTolerance: 5,
  }).catch(() => {
    throw new Error("invalid_session");
  });
  // 4. Not signed after the delegation expired.
  if (typeof payload.iat !== "number" || payload.iat > delegation.exp)
    throw new Error("invalid_session");
  if (
    payload.aud !== options.audience ||
    payload.htm !== options.method.toUpperCase() ||
    payload.htu !== target(options.url) ||
    typeof payload.sid !== "string" ||
    !SID.test(payload.sid) ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.sub.length > 256 ||
    typeof payload.jti !== "string" ||
    (payload.agent_id !== undefined &&
      (typeof payload.agent_id !== "string" ||
        payload.agent_id.length > 256)) ||
    (options.accessToken
      ? payload.ath !== tokenHash(options.accessToken)
      : payload.ath !== undefined)
  )
    throw new Error("invalid_session");
  options.replay?.accept(
    `session:${clientId}:${payload.jti}`,
    payload.iat + (options.windowSeconds ?? 60) + 10,
    clientId,
  );
  return {
    clientId,
    sessionId: payload.sid,
    userId: payload.sub,
    ...(typeof payload.agent_id === "string"
      ? { agentId: payload.agent_id }
      : {}),
  };
}

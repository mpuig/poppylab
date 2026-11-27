/**
 * Passkeys (WebAuthn): creating an account with one, signing in with
 * one, and adding one to an account. Each ceremony is two requests: the
 * options, with a challenge kept here for five minutes and taken once,
 * then the authenticator's answer, verified against it by
 * `@simplewebauthn/server`.
 *
 * The relying party is the deployment's host (`poppylab.dev`). Every
 * passkey is discoverable, so signing in needs no username: the answer
 * names the account (its user handle is the account's ID). User
 * verification is required (a face, a fingerprint, the device's PIN);
 * attestation isn't asked for, so nothing about the device is learned.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createHash, randomBytes } from "node:crypto";
import { agentName } from "./agent";
import {
  accountBackend,
  createAccount,
  isOpaqueId,
  loadAccount,
  MAX_PASSKEYS,
  opaqueId,
  takeOnce,
  updateAccount,
  type AgentAccount,
  type Passkey,
} from "./account-store";
import { endSessionsOf } from "./api-sessions";
import { publicMode } from "./deployment";

/** Who the passkeys are for: this deployment's host and origin. */
export type RelyingParty = { id: string; origin: string };
/**
 * In public mode the deployment's configured origin, whatever the
 * request says; elsewhere the request's own (`http://localhost:3991`).
 */
export function relyingParty(requestOrigin: string): RelyingParty {
  const origin = publicMode()
    ? new URL(process.env.AGENT_PUBLIC_ORIGIN!).origin
    : new URL(requestOrigin).origin;
  return { id: new URL(origin).hostname, origin };
}

/** A ceremony waits at most this long for the authenticator. */
const CEREMONY_MS = 5 * 60000;
type Ceremony = {
  kind: "create" | "sign-in" | "add";
  challenge: string;
  rp: string;
  expires: number;
  used?: true;
  /** For `create`: the new account's ID and label; for `add`: the account. */
  account?: string;
  label?: string;
};
const ceremonyBucket = (id: string) => `ceremony:${id}`;
async function begin(ceremony: Omit<Ceremony, "expires">) {
  const id = opaqueId();
  if (
    !(await accountBackend().put(
      ceremonyBucket(id),
      "ceremony",
      { ...ceremony, expires: Date.now() + CEREMONY_MS },
      null,
    ))
  )
    throw new Error("Ceremony conflict");
  return id;
}
/** The ceremony, once: a second answer to the same challenge finds nothing. */
async function take(id: unknown, kind: Ceremony["kind"], rp: RelyingParty) {
  if (!isOpaqueId(id)) return undefined;
  const ceremony = await takeOnce<Ceremony>(ceremonyBucket(id), "ceremony");
  return ceremony?.kind === kind && ceremony.rp === rp.id
    ? ceremony
    : undefined;
}

export type CeremonyOptions<T> = { ceremony: string; options: T };
export type Refusal = { status: number; code: string; error: string };
const refusal = (status: number, code: string, error: string): Refusal => ({
  status,
  code,
  error,
});
const NOT_VERIFIED = refusal(
  400,
  "passkey_not_verified",
  "The passkey couldn't be verified. Nothing changed; try again.",
);
const EXPIRED = refusal(
  400,
  "ceremony_expired",
  "That took too long or was already used. Try again.",
);

const challenge = () => randomBytes(32).toString("base64url");
const label = (value: unknown) =>
  typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/g, " ").slice(0, 60)
    : undefined;
/** A device's own words for itself, short and plain. */
export const deviceLabel = (value: unknown, fallback = "A device") =>
  label(value)?.replace(/[^\p{L}\p{N} .,()'’-]/gu, "") || fallback;

/** ES256 and RS256: what platform authenticators and password managers use. */
const ALGORITHMS = [-7, -257];
const OPTIONS = {
  attestationType: "none" as const,
  authenticatorSelection: {
    residentKey: "required" as const,
    userVerification: "required" as const,
  },
  supportedAlgorithmIDs: ALGORITHMS,
  timeout: CEREMONY_MS,
};

const userOptions = (id: string, name: string) => ({
  userID: new Uint8Array(Buffer.from(id, "base64url")),
  userName: name,
  userDisplayName: name,
});
const accountName = (account: { label?: string }) =>
  account.label ?? `${agentName()} account`;

/** Options for a new account's first passkey. */
export async function createOptions(
  rp: RelyingParty,
  input: { label?: unknown },
): Promise<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>> {
  const account = opaqueId();
  const chosen = label(input.label);
  const options = await generateRegistrationOptions({
    rpName: rp.id,
    rpID: rp.id,
    ...userOptions(
      account,
      accountName({ ...(chosen ? { label: chosen } : {}) }),
    ),
    challenge: challenge(),
    ...OPTIONS,
  });
  const ceremony = await begin({
    kind: "create",
    challenge: options.challenge,
    rp: rp.id,
    account,
    ...(chosen ? { label: chosen } : {}),
  });
  return { ceremony, options };
}

/** Options for one more passkey on an account the request is signed in to. */
export async function addOptions(
  rp: RelyingParty,
  account: AgentAccount,
): Promise<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON> | Refusal> {
  if (account.passkeys.length >= MAX_PASSKEYS)
    return refusal(
      409,
      "too_many_passkeys",
      `An account keeps at most ${MAX_PASSKEYS} passkeys. Remove one to add another.`,
    );
  const options = await generateRegistrationOptions({
    rpName: rp.id,
    rpID: rp.id,
    ...userOptions(account.id, accountName(account)),
    challenge: challenge(),
    // The authenticator says so when it holds one of these already.
    excludeCredentials: account.passkeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports as AuthenticatorTransport[],
    })),
    ...OPTIONS,
  });
  const ceremony = await begin({
    kind: "add",
    challenge: options.challenge,
    rp: rp.id,
    account: account.id,
  });
  return { ceremony, options };
}

/** Verifies a new passkey's answer to a ceremony of `kind`. */
async function registered(
  rp: RelyingParty,
  ceremony: Ceremony,
  credential: unknown,
  device: string,
): Promise<Passkey | Refusal> {
  try {
    const verified = await verifyRegistrationResponse({
      response: credential as RegistrationResponseJSON,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!verified.verified || !verified.registrationInfo) return NOT_VERIFIED;
    const info = verified.registrationInfo;
    return {
      id: opaqueId(),
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      counter: info.credential.counter,
      transports: [
        ...((credential as RegistrationResponseJSON).response?.transports ??
          []),
      ]
        .filter((t) => typeof t === "string")
        .slice(0, 8),
      backedUp: info.credentialBackedUp,
      name: device,
      created: Date.now(),
    };
  } catch {
    return NOT_VERIFIED;
  }
}

/** A new account, with the passkey that answered the ceremony. */
export async function createWithPasskey(
  rp: RelyingParty,
  input: { ceremony: unknown; credential: unknown; device: string },
): Promise<{ account: AgentAccount; passkey: Passkey } | Refusal> {
  const ceremony = await take(input.ceremony, "create", rp);
  if (!ceremony?.account) return EXPIRED;
  const passkey = await registered(
    rp,
    ceremony,
    input.credential,
    input.device,
  );
  if ("status" in passkey) return passkey;
  const account = await createAccount({
    id: ceremony.account,
    ...(ceremony.label ? { label: ceremony.label } : {}),
    // Its conversations' key, as a visitor's is the hash of its cookie.
    user: createHash("sha256").update(randomBytes(32)).digest("base64url"),
    passkey,
  });
  return { account, passkey };
}

/** One more passkey on the account the ceremony was started for. */
export async function addPasskey(
  rp: RelyingParty,
  account: AgentAccount,
  input: { ceremony: unknown; credential: unknown; device: string },
): Promise<{ account: AgentAccount; passkey: Passkey } | Refusal> {
  const ceremony = await take(input.ceremony, "add", rp);
  if (!ceremony || ceremony.account !== account.id) return EXPIRED;
  const passkey = await registered(
    rp,
    ceremony,
    input.credential,
    input.device,
  );
  if ("status" in passkey) return passkey;
  const next = await updateAccount<Refusal>(account.id, (current) => {
    if (current.passkeys.some((p) => p.credentialId === passkey.credentialId))
      return {
        refused: refusal(
          409,
          "passkey_exists",
          "This passkey is on the account already.",
        ),
      };
    if (current.passkeys.length >= MAX_PASSKEYS)
      return {
        refused: refusal(
          409,
          "too_many_passkeys",
          `An account keeps at most ${MAX_PASSKEYS} passkeys. Remove one to add another.`,
        ),
      };
    return { ...current, passkeys: [...current.passkeys, passkey] };
  });
  if (!next) return EXPIRED;
  if ("refused" in next) return next.refused;
  return { account: next, passkey };
}

/**
 * Removes a passkey, and ends every session it started (`ended`, by
 * ID); the account keeps at least one.
 */
export async function removePasskey(
  account: string,
  passkey: string,
): Promise<{ account: AgentAccount; ended: string[] } | Refusal> {
  const next = await updateAccount<Refusal>(account, (current) => {
    if (!current.passkeys.some((p) => p.id === passkey))
      return {
        refused: refusal(
          404,
          "passkey_not_found",
          "There is no such passkey on this account.",
        ),
      };
    if (current.passkeys.length <= 1)
      return {
        refused: refusal(
          409,
          "last_passkey",
          "An account keeps at least one passkey. Add another before you remove this one.",
        ),
      };
    return {
      ...current,
      passkeys: current.passkeys.filter((p) => p.id !== passkey),
    };
  });
  if (!next)
    return refusal(404, "account_not_found", "There is no such account.");
  if ("refused" in next) return next.refused;
  return { account: next, ended: await endSessionsOf(account, passkey) };
}

/** Options for signing in: no username, any of the site's passkeys. */
export async function signInOptions(
  rp: RelyingParty,
): Promise<CeremonyOptions<PublicKeyCredentialRequestOptionsJSON>> {
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    challenge: challenge(),
    userVerification: "required",
    timeout: CEREMONY_MS,
  });
  const ceremony = await begin({
    kind: "sign-in",
    challenge: options.challenge,
    rp: rp.id,
  });
  return { ceremony, options };
}

/** The account named by a sign-in's answer, before it is verified. */
export function claimedAccount(credential: unknown) {
  const handle = (credential as AuthenticationResponseJSON | undefined)
    ?.response?.userHandle;
  return typeof handle === "string" && isOpaqueId(handle) ? handle : undefined;
}

/**
 * The account a sign-in's answer proves, and the passkey it used, with
 * the passkey's counter and last use written back.
 */
export async function verifySignIn(
  rp: RelyingParty,
  input: { ceremony: unknown; credential: unknown },
): Promise<{ account: AgentAccount; passkey: Passkey } | Refusal> {
  const ceremony = await take(input.ceremony, "sign-in", rp);
  if (!ceremony) return EXPIRED;
  const response = input.credential as AuthenticationResponseJSON;
  const id = claimedAccount(response);
  const found = id ? await loadAccount(id) : undefined;
  const passkey = found?.account.passkeys.find(
    (p) => typeof response?.id === "string" && p.credentialId === response.id,
  );
  if (!found || !passkey)
    return refusal(
      401,
      "passkey_unknown",
      "This passkey isn't one of an account here. It may have been removed, or the account deleted.",
    );
  let newCounter: number;
  try {
    const verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransport[],
      },
    });
    if (!verified.verified) return NOT_VERIFIED;
    newCounter = verified.authenticationInfo.newCounter;
  } catch {
    return NOT_VERIFIED;
  }
  // Removed on another device in the meantime: it signs in no one.
  const next = await updateAccount<true>(found.account.id, (current) =>
    current.passkeys.some((p) => p.id === passkey.id)
      ? {
          ...current,
          passkeys: current.passkeys.map((p) =>
            p.id === passkey.id
              ? { ...p, counter: newCounter, lastUsed: Date.now() }
              : p,
          ),
        }
      : { refused: true },
  );
  if (!next || "refused" in next) return NOT_VERIFIED;
  return { account: next, passkey };
}

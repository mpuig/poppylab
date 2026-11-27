/**
 * Where agent accounts are kept: an account, its passkeys, the API
 * session of each device signed in to it, the ceremonies under way and
 * the one-time link codes. It is the same storage interface as
 * conversations (`Backend` in `runs.ts`), in buckets of its own:
 *
 * - `account:<id>`: `account` (the account and its passkeys, written
 *   with a compare-and-set, so "at least one passkey" holds under two
 *   requests at once) and `session:<id>` for each signed-in device;
 * - `ceremony:<id>`: one WebAuthn challenge, taken once;
 * - `link-code:<hash>`: one link code, redeemed once.
 *
 * A channel names the store with `configureAccountStorage`; the
 * playground's is a Durable Object per bucket that outlives the visitor's
 * (`apps/playground/lib/visitor-storage.ts`). Without one, accounts are
 * kept where conversations are.
 */
import { randomBytes } from "node:crypto";
import { storage, type Backend } from "./runs";

const global = globalThis as typeof globalThis & {
  poppyAccountStorage?: () => Backend;
  poppyAccountBackend?: Backend;
};
/** Where accounts are kept, opened on the first request that needs them. */
export function configureAccountStorage(open: () => Backend) {
  global.poppyAccountStorage = open;
  delete global.poppyAccountBackend;
}
export function accountBackend(): Backend {
  if (!global.poppyAccountStorage) return storage();
  return (global.poppyAccountBackend ??= global.poppyAccountStorage());
}

/** An opaque random ID: 16 bytes, base64url. */
export const opaqueId = () => randomBytes(16).toString("base64url");
export const isOpaqueId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{22}$/.test(id);

/**
 * One passkey of an account: a WebAuthn credential. Only its public key
 * is kept; the private key never leaves the person's device or password
 * manager.
 */
export type Passkey = {
  /** Ours, to name it in the API. */
  id: string;
  /** The credential's ID, base64url, as the authenticator gives it. */
  credentialId: string;
  /** The COSE public key, base64url. */
  publicKey: string;
  /** The authenticator's signature counter; 0 for synced passkeys. */
  counter: number;
  transports: string[];
  /** Synced to the person's other devices (a password manager's). */
  backedUp: boolean;
  /** Where it was added, in the device's own words ("Chrome on macOS"). */
  name: string;
  created: number;
  lastUsed?: number;
};

/**
 * An agent account: an opaque ID, its passkeys and a label the person
 * chooses, and nothing else about them. Its conversations are kept under
 * `user`, an agent user like a visitor's, on every device signed in to it.
 */
export type AgentAccount = {
  id: string;
  label?: string;
  created: number;
  /** The agent user its conversations are kept under. */
  user: string;
  passkeys: Passkey[];
  /** The channels' users linked to it by a one-time code. */
  channels: Array<{ channel: string; user: string; linked: number }>;
};

/** An account keeps at most this many passkeys. */
export const MAX_PASSKEYS = 10;

const ACCOUNT = "account";
const bucket = (id: string) => `account:${id}`;

export async function loadAccount(id: string) {
  if (!isOpaqueId(id)) return undefined;
  const entry = await accountBackend().get(bucket(id), ACCOUNT);
  return entry
    ? { account: entry.value as AgentAccount, version: entry.version }
    : undefined;
}

/** A new account with its first passkey. */
export async function createAccount(input: {
  id: string;
  label?: string;
  user: string;
  passkey: Passkey;
}): Promise<AgentAccount> {
  const account: AgentAccount = {
    id: input.id,
    ...(input.label ? { label: input.label } : {}),
    created: Date.now(),
    user: input.user,
    passkeys: [input.passkey],
    channels: [],
  };
  if (!(await accountBackend().put(bucket(account.id), ACCOUNT, account, null)))
    throw new Error("Account conflict");
  return account;
}

/**
 * Changes an account with a compare-and-set, tried again if another
 * request wrote it in between. `change` answers the new account, or a
 * refusal it returns as it is.
 */
export async function updateAccount<R>(
  id: string,
  change: (account: AgentAccount) => AgentAccount | { refused: R },
): Promise<AgentAccount | { refused: R } | undefined> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await loadAccount(id);
    if (!current) return undefined;
    const next = change(structuredClone(current.account));
    if ("refused" in next) return next;
    if (await accountBackend().put(bucket(id), ACCOUNT, next, current.version))
      return next;
  }
  throw new Error("Account conflict");
}

// ---- API sessions ----------------------------------------------------------

/**
 * Not built yet: the push item fills it. A device that wants notices
 * registers its push token on its own session, so it goes when the
 * session does. Planned as `PUT /api/v1/account/sessions/{id}/push`.
 */
export type PushDevice = {
  platform: "apns";
  /** The device token, as APNs gives it. */
  token: string;
  environment: "sandbox" | "production";
  /** The app's bundle ID, the APNs topic. */
  topic: string;
  registered: number;
};

/**
 * One device signed in to an account. A browser holds a cookie; a client
 * app holds a short-lived access token and a refresh token that changes
 * each time it is used. Only their SHA-256 hashes are kept.
 */
export type ApiSession = {
  id: string;
  account: string;
  /** The account's agent user, so a request needs one read. */
  user: string;
  kind: "browser" | "app";
  device: { label: string };
  created: number;
  lastUsed: number;
  /** It ends then unless it is used (a refresh, for an app). */
  expires: number;
  /** It ends then whatever happens. */
  until: number;
  /** The passkey it was started with. */
  passkey: string;
  /**
   * When the person last proved they were there with a passkey (user
   * verification): a later step-up for an approval can ask for a recent one.
   */
  verified: number;
  /** A browser's cookie. */
  cookie?: { hash: string };
  /** An app's tokens. */
  access?: { hash: string; expires: number };
  refresh?: {
    hash: string;
    /** The refresh tokens it replaced: one shown again ends the session. */
    used: string[];
  };
  /** See `PushDevice`. */
  push?: PushDevice;
};

const SESSION = "session:";

export async function loadSession(account: string, id: string) {
  if (!isOpaqueId(account) || !isOpaqueId(id)) return undefined;
  const entry = await accountBackend().get(bucket(account), SESSION + id);
  return entry
    ? { session: entry.value as ApiSession, version: entry.version }
    : undefined;
}
export async function putSession(session: ApiSession, expected: number | null) {
  return accountBackend().put(
    bucket(session.account),
    SESSION + session.id,
    session,
    expected,
  );
}
export async function removeSession(account: string, id: string) {
  await accountBackend().remove(bucket(account), SESSION + id);
}
/** The account's sessions that haven't ended; ended ones are dropped. */
export async function listSessions(account: string) {
  const now = Date.now();
  const live: ApiSession[] = [];
  for (const [key, entry] of await accountBackend().list(
    bucket(account),
    SESSION,
  )) {
    const session = entry.value as ApiSession;
    if (session.expires <= now || session.until <= now)
      await accountBackend().remove(bucket(account), key);
    else live.push(session);
  }
  return live.sort((a, b) => b.lastUsed - a.lastUsed);
}

// ---- One-time records ------------------------------------------------------

/**
 * Takes a record that may be used once: the first request to take it
 * gets it, any other gets nothing, and so does one after `expires`. The
 * mark is a compare-and-set; the record goes afterwards.
 */
export async function takeOnce<T extends { expires: number; used?: true }>(
  bucketName: string,
  key: string,
): Promise<T | undefined> {
  const b = accountBackend();
  const entry = await b.get(bucketName, key);
  const record = entry?.value as T | undefined;
  if (!entry || !record || record.used) return undefined;
  const won = await b.put(
    bucketName,
    key,
    { ...record, used: true },
    entry.version,
  );
  await b.remove(bucketName, key).catch(() => {});
  if (!won || record.expires <= Date.now()) return undefined;
  return record;
}

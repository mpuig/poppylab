/**
 * A session for each device signed in to an agent account. A browser
 * holds it in a cookie; a client app (the iPhone app) holds an access
 * token for about 15 minutes and a refresh token that is replaced each
 * time it is used. A refresh token shown a second time means it was
 * copied: the whole session ends, on that device and wherever the copy
 * is.
 *
 * A token is `<kind>.<account>.<session>.<secret>`: the IDs find the
 * session with one read and the secret proves it. Only SHA-256 hashes
 * are kept, compared in constant time. Tokens travel in headers, cookies
 * and bodies, never in an address, and are never logged.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  isOpaqueId,
  listSessions,
  loadSession,
  opaqueId,
  putSession,
  removeSession,
  type AgentAccount,
  type ApiSession,
  type Passkey,
} from "./account-store";

const minute = 60000,
  day = 86400000;
/** An app's access token lives this long. */
export const ACCESS_MS = 15 * minute;
/** A session that isn't used for this long ends. */
export const IDLE_MS = 30 * day;
/** And every session ends after this long, used or not. */
export const SESSION_MS = 365 * day;
/** A browser's cookie lasts as long as its session may stay idle. */
export const BROWSER_MS = IDLE_MS;
/** A session's last use is written at most this often. */
const TOUCH_MS = 5 * minute;
/** The replaced refresh tokens a session remembers, to tell a reuse. */
const REMEMBERED = 16;

type Kind = "at" | "rt" | "bs";
const PREFIX: Record<Kind, string> = {
  at: "poppy_at",
  rt: "poppy_rt",
  bs: "poppy_bs",
};
const hash = (token: string) =>
  createHash("sha256").update(token).digest("base64url");
/** Two hashes, compared in constant time. */
export function sameHash(a: string, b: string) {
  const x = Buffer.from(a, "base64url"),
    y = Buffer.from(b, "base64url");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
const mint = (kind: Kind, session: { account: string; id: string }) =>
  `${PREFIX[kind]}.${session.account}.${session.id}.${randomBytes(32).toString("base64url")}`;
/** The account and session a token names, before it is checked. */
function parse(kind: Kind, token: unknown) {
  if (typeof token !== "string" || token.length > 200) return undefined;
  const [prefix, account, session, secret] = token.split(".");
  if (
    prefix !== PREFIX[kind] ||
    !isOpaqueId(account) ||
    !isOpaqueId(session) ||
    !secret ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret)
  )
    return undefined;
  return { account, session };
}

/** What an app is given when it signs in or refreshes. */
export type SessionTokens = {
  session: string;
  accessToken: string;
  /** Milliseconds since 1970. */
  accessTokenExpiresAt: number;
  refreshToken: string;
  /** The refresh token must be used before then. */
  refreshTokenExpiresAt: number;
};

/** A new session for a device, after a passkey proved the person. */
export async function startSession(
  account: AgentAccount,
  input: { kind: "browser" | "app"; device: string; passkey: Passkey },
): Promise<
  { session: ApiSession } & (
    { kind: "browser"; cookie: string } | { kind: "app"; tokens: SessionTokens }
  )
> {
  const now = Date.now();
  const base: ApiSession = {
    id: opaqueId(),
    account: account.id,
    user: account.user,
    kind: input.kind,
    device: { label: input.device },
    created: now,
    lastUsed: now,
    expires: now + IDLE_MS,
    until: now + SESSION_MS,
    passkey: input.passkey.id,
    verified: now,
  };
  if (input.kind === "browser") {
    const cookie = mint("bs", base);
    const session = {
      ...base,
      expires: now + BROWSER_MS,
      cookie: { hash: hash(cookie) },
    };
    if (!(await putSession(session, null))) throw new Error("Session conflict");
    return { session, kind: "browser", cookie };
  }
  const access = mint("at", base),
    refresh = mint("rt", base);
  const session: ApiSession = {
    ...base,
    access: { hash: hash(access), expires: now + ACCESS_MS },
    refresh: { hash: hash(refresh), used: [] },
  };
  if (!(await putSession(session, null))) throw new Error("Session conflict");
  return { session, kind: "app", tokens: tokensOf(session, access, refresh) };
}
const tokensOf = (
  session: ApiSession,
  accessToken: string,
  refreshToken: string,
): SessionTokens => ({
  session: session.id,
  accessToken,
  accessTokenExpiresAt: session.access!.expires,
  refreshToken,
  refreshTokenExpiresAt: Math.min(session.expires, session.until),
});

const live = (session: ApiSession, now = Date.now()) =>
  session.expires > now && session.until > now;

/**
 * Writes the session's last use, at most every few minutes. Its end
 * stays: a browser's cookie has a fixed life, and an app's session is
 * kept going by its refreshes.
 */
async function touch(session: ApiSession, version: number) {
  const now = Date.now();
  if (now - session.lastUsed < TOUCH_MS) return;
  await putSession({ ...session, lastUsed: now }, version).catch(() => false);
}

/** The session a browser's cookie holds, if it is still one. */
export async function sessionOfCookie(cookie: unknown) {
  const named = parse("bs", cookie);
  if (!named) return undefined;
  const found = await loadSession(named.account, named.session);
  const session = found?.session;
  if (
    !session ||
    session.kind !== "browser" ||
    !session.cookie ||
    !live(session) ||
    !sameHash(hash(cookie as string), session.cookie.hash)
  )
    return undefined;
  await touch(session, found.version);
  return session;
}

/** The session an app's access token belongs to, while the token lasts. */
export async function sessionOfAccessToken(token: unknown) {
  const named = parse("at", token);
  if (!named) return undefined;
  const found = await loadSession(named.account, named.session);
  const session = found?.session;
  if (
    !session ||
    session.kind !== "app" ||
    !session.access ||
    !live(session) ||
    session.access.expires <= Date.now() ||
    !sameHash(hash(token as string), session.access.hash)
  )
    return undefined;
  await touch(session, found.version);
  return session;
}

/** The account a refresh token names, for its budget, before it is checked. */
export const refreshAccount = (token: unknown) => parse("rt", token)?.account;

/**
 * New tokens for an app, in exchange for its refresh token, which stops
 * working. One that was replaced already ends the whole session.
 */
export async function refreshSession(
  token: unknown,
): Promise<
  | { ok: true; tokens: SessionTokens; session: ApiSession }
  | { ok: false; code: "invalid_token" | "session_revoked" }
> {
  const named = parse("rt", token);
  if (!named) return { ok: false, code: "invalid_token" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await loadSession(named.account, named.session);
    if (!found?.session.refresh || found.session.kind !== "app")
      return { ok: false, code: "invalid_token" };
    const session = found.session;
    const refreshing = session.refresh!;
    const presented = hash(token as string);
    if (refreshing.used.some((used) => sameHash(presented, used))) {
      // Copied: whoever holds the newer token isn't to be trusted either.
      await removeSession(session.account, session.id);
      return { ok: false, code: "session_revoked" };
    }
    if (!live(session) || !sameHash(presented, refreshing.hash))
      return { ok: false, code: "invalid_token" };
    const now = Date.now();
    const access = mint("at", session),
      refresh = mint("rt", session);
    const next: ApiSession = {
      ...session,
      lastUsed: now,
      expires: now + IDLE_MS,
      access: { hash: hash(access), expires: now + ACCESS_MS },
      refresh: {
        hash: hash(refresh),
        used: [refreshing.hash, ...refreshing.used].slice(0, REMEMBERED),
      },
    };
    // Two refreshes at once: one wins, and the other finds its token used.
    if (await putSession(next, found.version))
      return {
        ok: true,
        tokens: tokensOf(next, access, refresh),
        session: next,
      };
  }
  return { ok: false, code: "invalid_token" };
}

/** What the account's owner sees of a session: no hash, no token. */
export type SessionView = {
  id: string;
  kind: "browser" | "app";
  device: string;
  created: number;
  lastUsed: number;
  expires: number;
  /** The session this request is made with. */
  current: boolean;
};
export const viewOf = (session: ApiSession, current?: string): SessionView => ({
  id: session.id,
  kind: session.kind,
  device: session.device.label,
  created: session.created,
  lastUsed: session.lastUsed,
  expires: Math.min(session.expires, session.until),
  current: session.id === current,
});

export async function sessionsOf(account: string, current?: string) {
  return (await listSessions(account)).map((s) => viewOf(s, current));
}

/** Ends one session; true when there was one. */
export async function revokeSession(account: string, id: string) {
  if (!isOpaqueId(id)) return false;
  const found = await loadSession(account, id);
  if (!found) return false;
  await removeSession(account, id);
  return true;
}

/** Ends every session of the account, this one too. */
export async function revokeAll(account: string) {
  const sessions = await listSessions(account);
  for (const session of sessions) await removeSession(account, session.id);
  return sessions.length;
}

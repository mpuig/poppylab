/**
 * The cookie that binds a sign-in to the browser that started it. Each
 * sign-in gets a cookie of its own, named after its OAuth `state`, set
 * when the sign-in starts and sent only to the callback. The callback
 * completes a sign-in only for a browser that holds the cookie of that
 * very `state`, so only the visitor's own browser, in which they pressed
 * Sign in, can finish it; for an app's sign-in, the browser the app opened
 * its link in (`sign-in-links.ts`).
 *
 * One cookie for each sign-in, not one for the browser: a conversation
 * can have a sign-in under way at two of its Companies, and the second
 * must not undo the first.
 */
import { createHash } from "node:crypto";
import { accountBackend, takeOnce } from "./account-store";
import { secureCookies } from "./runs";

/** A `state` as Iris makes them, and so the only kind a cookie is read for. */
const STATE = /^[A-Za-z0-9_-]{1,64}$/;

/** The name of the cookie for the sign-in with this `state`, if it is one. */
export const signInCookie = (state: string) =>
  STATE.test(state) ? `pap_oauth_${state}` : undefined;

/** A sign-in waits at most this long for its callback, in seconds. */
const LIFETIME = 300;

/** How the cookie is set: for the callback only, and for as long as it waits. */
export const signInCookieOptions = (maxAge = LIFETIME) => ({
  httpOnly: true,
  secure: secureCookies(),
  sameSite: "lax" as const,
  path: "/api/account/callback",
  maxAge,
});

/** Where an app's sign-in ends, done or not: the address the app detects. */
export const APP_SIGN_IN_END = "/playground/sign-in/app";

/**
 * An app's sign-in (`sign-in-links.ts`) is bound to the app's browser by
 * the same cookie, but it is the account's, which that browser has no
 * cookie for. So the agent notes whose it is under the `state`'s hash
 * when the sign-in starts, and the callback takes the note once.
 */
type AppSignIn = { user: string; expires: number; used?: true };
const stateBucket = (state: string) =>
  `sign-in-state:${createHash("sha256").update(state).digest("base64url")}`;

export async function rememberAppSignIn(state: string, user: string) {
  const expires = Date.now() + LIFETIME * 1000;
  await accountBackend().put(
    stateBucket(state),
    "state",
    { user, expires } satisfies AppSignIn,
    null,
    expires,
  );
}
/** The agent user of the app's sign-in with this `state`, if it is one. */
export async function appSignIn(state: string) {
  return (await takeOnce<AppSignIn>(stateBucket(state), "state"))?.user;
}

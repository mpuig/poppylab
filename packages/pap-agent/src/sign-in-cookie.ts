/**
 * The cookie that binds a sign-in to the browser that started it. Each
 * sign-in gets a cookie of its own, named after its OAuth `state`, set
 * when the sign-in starts and sent only to the callback. The callback
 * completes a sign-in only for a browser that holds the cookie of that
 * very `state`, so only the visitor's own browser, in which they pressed
 * Sign in, can finish it.
 *
 * One cookie for each sign-in, not one for the browser: a conversation
 * can have a sign-in under way at two of its Companies, and the second
 * must not undo the first.
 */
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

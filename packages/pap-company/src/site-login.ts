/**
 * The login form of a Company's own website. The page puts one random token
 * in a cookie and in a hidden field of the form, and a login is accepted
 * when the two arrive equal within the token's five minutes. Nothing is kept
 * on the server: a Durable Object is dropped from memory after seconds
 * without a request, and a browser moves to the agent user's copy of the
 * Company once it approved a consent (`gateway/tenancy.ts`), and a form
 * opened before either must still work. Another site can't read or set the
 * cookie, so it can't post a form that matches it; each website also checks
 * `Origin`.
 */
import { randomId } from "@poppy-lab/pap-client/core";

/** How long an opened login form can be posted. */
export const LOGIN_FORM_MS = 5 * 60000;

/** A token for one opening of the login form: when it ends, then 24 random bytes. */
export const loginFormToken = (now = Date.now()) =>
  `${now + LOGIN_FORM_MS}.${randomId()}`;

/** Whether a posted form carries its browser's own token, not yet ended. */
export function loginFormValid(
  cookie: string,
  field: unknown,
  now = Date.now(),
) {
  const [, until, random] = /^(\d{13})\.([\w-]{32})$/.exec(cookie) ?? [];
  return (
    !!random &&
    field === cookie &&
    Number(until) > now &&
    // Never longer than a form lasts, whatever the browser sent.
    Number(until) <= now + LOGIN_FORM_MS
  );
}

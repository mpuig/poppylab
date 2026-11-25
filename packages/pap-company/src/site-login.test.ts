/**
 * The website login form's token: the cookie and the form's field must
 * arrive equal, within five minutes of the form opening.
 */
import { expect, it } from "vitest";
import { LOGIN_FORM_MS, loginFormToken, loginFormValid } from "./site-login.ts";

it("accepts a login form's own token for five minutes, and nothing else", () => {
  const opened = Date.parse("2026-11-25T12:00:00Z");
  const token = loginFormToken(opened);
  expect(loginFormValid(token, token, opened)).toBe(true);
  expect(loginFormValid(token, token, opened + LOGIN_FORM_MS - 1)).toBe(true);
  expect(loginFormValid(token, token, opened + LOGIN_FORM_MS)).toBe(false);
  // A form without the browser's cookie, or with another form's token.
  expect(loginFormValid("", token, opened)).toBe(false);
  expect(loginFormValid(token, undefined, opened)).toBe(false);
  expect(loginFormValid(token, loginFormToken(opened), opened)).toBe(false);
  expect(loginFormValid("", "", opened)).toBe(false);
  // A browser can't give itself a token that lasts longer.
  const long = `${opened + 2 * LOGIN_FORM_MS}.${token.split(".")[1]}`;
  expect(loginFormValid(long, long, opened)).toBe(false);
  expect(loginFormValid("soon.abc", "soon.abc", opened)).toBe(false);
});

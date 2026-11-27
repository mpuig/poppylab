/**
 * The page's side of the agent account: the calls to `/api/v1` it makes
 * with its cookie, the passkey ceremonies in the browser
 * (`@simplewebauthn/browser`), and the words for what went wrong. The
 * server keeps the account; the browser holds only its session cookie,
 * which scripts can't read.
 */
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

export type PasskeyView = {
  id: string;
  name: string;
  created: number;
  lastUsed?: number;
  synced: boolean;
};
export type AccountView = {
  id: string;
  label?: string;
  created: number;
  passkeys: PasskeyView[];
  channels: Array<{ channel: string; linked: number }>;
  session: string;
  unclaimed?: number;
};
export type SessionView = {
  id: string;
  kind: "browser" | "app";
  device: string;
  created: number;
  lastUsed: number;
  expires: number;
  current: boolean;
};

/** A refusal, in the server's words when it gave some. */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function call<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
  };
  if (!response.ok)
    throw new AccountError(
      data.error ?? "That didn’t go through. Try again in a moment.",
      data.code,
    );
  return data as T;
}

/** The account this browser is signed in to, or none. */
export async function readAccount(): Promise<AccountView | null> {
  try {
    return await call<AccountView>("GET", "/account");
  } catch (error) {
    if (error instanceof AccountError && error.code === "not_signed_in")
      return null;
    throw error;
  }
}
export const readSessions = () =>
  call<{ sessions: SessionView[] }>("GET", "/account/sessions").then(
    (r) => r.sessions,
  );

/**
 * How this device names itself to the account: a browser and a system,
 * as the user agent says, and nothing finer.
 */
export function deviceName(userAgent: string) {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "A browser";
  const system = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /CrOS/.test(userAgent)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(userAgent)
            ? "macOS"
            : /Windows/.test(userAgent)
              ? "Windows"
              : /Linux/.test(userAgent)
                ? "Linux"
                : "";
  return system ? `${browser} on ${system}` : browser;
}
const device = () => deviceName(navigator.userAgent);

export const passkeysWork = () => browserSupportsWebAuthn();

/**
 * What the browser said when a ceremony didn't finish: the person closed
 * the prompt, or the passkey is on this device already.
 */
export function ceremonyFailure(error: unknown, doing: string) {
  if (error instanceof AccountError) return error.message;
  const name = (error as { name?: string } | null)?.name;
  if (name === "InvalidStateError")
    return "This device already has a passkey for this account.";
  if (name === "NotAllowedError" || name === "AbortError")
    return `${doing} didn’t finish, so nothing changed. Try again when you’re ready.`;
  return `${doing} didn’t work in this browser. Nothing changed.`;
}

type Ceremony<T> = { ceremony: string; options: T };

export async function createAccount(label: string) {
  const started = await call<
    Ceremony<Parameters<typeof startRegistration>[0]["optionsJSON"]>
  >("POST", "/accounts/options", label.trim() ? { label } : {});
  const credential = await startRegistration({ optionsJSON: started.options });
  return (
    await call<{ account: AccountView }>("POST", "/accounts", {
      ceremony: started.ceremony,
      credential,
      device: device(),
    })
  ).account;
}

export async function signIn() {
  const started = await call<
    Ceremony<Parameters<typeof startAuthentication>[0]["optionsJSON"]>
  >("POST", "/sessions/options", {});
  const credential = await startAuthentication({
    optionsJSON: started.options,
  });
  return (
    await call<{ account: AccountView }>("POST", "/sessions", {
      ceremony: started.ceremony,
      credential,
      device: device(),
    })
  ).account;
}

export async function addPasskey() {
  const started = await call<
    Ceremony<Parameters<typeof startRegistration>[0]["optionsJSON"]>
  >("POST", "/account/passkeys/options", {});
  const credential = await startRegistration({ optionsJSON: started.options });
  return (
    await call<{ account: AccountView }>("POST", "/account/passkeys", {
      ceremony: started.ceremony,
      credential,
      device: device(),
    })
  ).account;
}

export const removePasskey = (id: string) =>
  call<AccountView>("DELETE", `/account/passkeys/${encodeURIComponent(id)}`);
export const signOut = () => call("POST", "/account/sign-out", {});
export const revokeSession = (id: string) =>
  call("DELETE", `/account/sessions/${encodeURIComponent(id)}`);
export const revokeAll = () => call("DELETE", "/account/sessions");
export const bringConversations = () =>
  call<{ moved: number; skipped: number; account: AccountView }>(
    "POST",
    "/account/claim",
    {},
  );

/** What bringing conversations did, in a sentence. */
export function broughtSentence(moved: number, skipped: number) {
  const count = (n: number) =>
    n === 1 ? "1 conversation" : `${n} conversations`;
  const done =
    moved === 0
      ? "There was nothing to bring."
      : `${count(moved)} moved into your account. ${moved === 1 ? "It opens" : "They open"} on every device you sign in on.`;
  return skipped
    ? `${done} ${count(skipped)} ${skipped === 1 ? "was" : "were"} busy and stayed in this browser; try again in a moment.`
    : done;
}

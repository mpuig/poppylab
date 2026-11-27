/**
 * A Company's sign-in for a client app (§4.2). The Company sends the
 * browser back to the callback, which completes a sign-in only for the
 * browser that holds its cookie (`sign-in-cookie.ts`), and an app's API
 * session has no browser. So the app is given a link to a page of the
 * agent's own, which it opens in a browser of its own
 * (`ASWebAuthenticationSession` on iOS). Opening it pushes the request,
 * binds the sign-in to that browser with the same cookie as the page's,
 * and sends it on to the Company's authorization endpoint. The callback
 * then completes it in that browser for the account that asked, and
 * leaves for a fixed address of ours that the app watches for
 * (`APP_SIGN_IN_END`).
 *
 * The link carries a ticket: 32 random bytes, kept only as a hash, taken
 * once, for three minutes, and only for the account, the device's
 * session, the conversation, the Company and the access it was asked
 * for. The app opens it at once on the device that asked, so the sign-in
 * never crosses to another device; what is left is a link someone
 * forwards, which RFC 10027 §6.1 limits with the short life and single
 * use, the budgets, and the Company's own consent page, which names the
 * agent and is shown every time (`prompt=consent`).
 */
import { createHash, randomBytes } from "node:crypto";
import { overAccountBudget } from "./account-limits";
import { accountBackend, loadSession, takeOnce } from "./account-store";
import { startSignIn, type Result } from "./api";
import { sessionOfAccessToken } from "./api-sessions";
import { connectionNamed, originOf } from "./connections";
import { isAccountCompany, publicMode } from "./deployment";
import { readConversation } from "./runs";
import { APP_SIGN_IN_END, rememberAppSignIn } from "./sign-in-cookie";
import {
  browserAccount,
  clientAddress,
  cookieSignIns,
  type Caller,
  type CookieStore,
} from "./web";

/**
 * In public mode the deployment's configured origin, whatever the request
 * says; elsewhere the request's own.
 */
const publicOrigin = (fallback: string) =>
  publicMode()
    ? new URL(process.env.AGENT_PUBLIC_ORIGIN!).origin
    : new URL(fallback).origin;

/** A link works this long after it is asked for. */
export const SIGN_IN_LINK_MS = 3 * 60000;

type Ticket = {
  account: string;
  session: string;
  user: string;
  conversation: string;
  /** The Company's origin. */
  company: string;
  access: "read" | "write";
  expires: number;
  used?: true;
};
const ticketBucket = (ticket: string) =>
  `sign-in-ticket:${createHash("sha256").update(ticket).digest("base64url")}`;
const isTicket = (ticket: unknown): ticket is string =>
  typeof ticket === "string" && /^[A-Za-z0-9_-]{43}$/.test(ticket);

/** What an app is answered: the link to open and the address to watch for. */
export type SignInLink = {
  url: string;
  /** Milliseconds since 1970: open the link before then. */
  expiresAt: number;
  /** Where the browser ends, with `?result=done` or `?result=failed`. */
  endUrl: string;
};

const refused = (status: number, code: string, error: string) => ({
  ok: false as const,
  status,
  code,
  error,
});

/**
 * `POST /api/v1/conversations/{id}/sign-ins` over an API session: a link
 * that starts the sign-in at one of the conversation's Companies when the
 * app opens it, checked now as the sign-in itself will be checked then.
 */
export async function createSignInLink(
  caller: Caller,
  id: string,
  input: { company?: string; access: "read" | "write" },
): Promise<Result<SignInLink>> {
  const account = caller.account;
  const user = caller.user();
  if (!account || !user)
    return refused(401, "not_signed_in", "Sign in with your passkey first.");
  const over = await overAccountBudget("signInLink", {
    ip: caller.ip,
    account: account.id,
  });
  if (over)
    return refused(
      429,
      "rate_limited",
      "Too many attempts. Wait a minute and try again.",
    );
  const run = await readConversation(user, id);
  if (!run)
    return refused(
      404,
      "conversation_not_found",
      "There is no such conversation for this user. Start a new one.",
    );
  if (run.archived)
    return refused(
      410,
      "conversation_ended",
      "This conversation has ended and is read-only, so nothing was sent to any company. Start a new conversation to go on.",
    );
  const connection = connectionNamed(run, input.company || undefined);
  if ("code" in connection)
    return refused(400, connection.code, connection.error);
  const company = originOf(connection);
  if (!isAccountCompany(company))
    return refused(
      400,
      "sign_in_unavailable",
      "Connect to a supported account Company first.",
    );
  const ticket = randomBytes(32).toString("base64url");
  const expires = Date.now() + SIGN_IN_LINK_MS;
  const record: Ticket = {
    account: account.id,
    session: account.session,
    user,
    conversation: id,
    company,
    access: input.access,
    expires,
  };
  if (
    !(await accountBackend().put(
      ticketBucket(ticket),
      "ticket",
      record,
      null,
      expires,
    ))
  )
    throw new Error("Sign-in link conflict");
  const origin = publicOrigin(caller.origin);
  return {
    ok: true,
    value: {
      url: `${origin}/api/v1/sign-ins/${ticket}`,
      expiresAt: expires,
      endUrl: `${origin}${APP_SIGN_IN_END}`,
    },
  };
}

/** A redirect that leaves nothing of this address in the next one's headers. */
const go = (location: string) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
const failed = () => go(`${APP_SIGN_IN_END}?result=failed`);

/**
 * `GET /api/v1/sign-ins/{ticket}`, opened in the app's browser: takes the
 * ticket, starts the sign-in there as the page would (PAR when the Company
 * offers it), binds it to this browser with its cookie, and goes on to the
 * Company. A ticket that is unknown, used, expired, of a session that has
 * ended, or opened in a browser signed in to another account goes to the
 * failed end instead, spent all the same.
 */
export async function openSignInLink(
  request: Request,
  cookies: CookieStore,
  ticket: string,
): Promise<Response> {
  const ip = clientAddress(request);
  if (await overAccountBudget("signInLink", { ip })) return failed();
  const record = isTicket(ticket)
    ? await takeOnce<Ticket>(ticketBucket(ticket), "ticket")
    : undefined;
  if (!record) return failed();
  const session = (await loadSession(record.account, record.session))?.session;
  if (!session || session.expires <= Date.now() || session.until <= Date.now())
    return failed();
  // A browser that says whose it is must be the same account's: by a
  // bearer token the app added to the request, or by the playground's
  // account cookie.
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const token = /^Bearer ([A-Za-z0-9._-]{1,200})$/.exec(authorization)?.[1];
    const by = token ? await sessionOfAccessToken(token) : undefined;
    if (by?.account !== record.account) return failed();
  }
  const signedIn = await browserAccount(cookies);
  if (signedIn && signedIn.account !== record.account) return failed();
  const browser = cookieSignIns(cookies);
  let bound: string | undefined;
  const caller: Caller = {
    user: (() => record.user) as Caller["user"],
    // The account's own: its device asked for this ticket with its token.
    authentic: true,
    origin: publicOrigin(request.url),
    localDev: false,
    ip,
    signIns: {
      ...browser,
      bind: (state) => {
        browser.bind(state);
        bound = state;
      },
    },
    account: { id: record.account, session: record.session, via: "bearer" },
  };
  const started = await startSignIn(caller, record.conversation, {
    company: record.company,
    access: record.access,
  });
  if (!started.ok || !bound) return failed();
  // The callback finds the sign-in under the account's agent user, which
  // this browser has no cookie for.
  await rememberAppSignIn(bound, record.user);
  return go(started.value.url);
}

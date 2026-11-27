/**
 * The agent account over HTTP, under `/api/v1` (`api-http.ts` routes to
 * these): creating an account with a passkey, signing in with one, the
 * account's passkeys and devices, bringing a browser's conversations into
 * it, and link codes for channels.
 *
 * Two kinds of client, told apart by the request itself:
 *
 * - **The playground's page** sends its `Origin`, which must be ours. A
 *   sign-in sets a cookie and answers no token.
 * - **A client app** (the iPhone app) sends no `Origin`. A sign-in
 *   answers an access token and a refresh token, and every later request
 *   carries `Authorization: Bearer <access token>`.
 *
 * A request from another origin is refused before anything is read.
 */
import {
  addOptions,
  addPasskey,
  claimedAccount,
  createOptions,
  createWithPasskey,
  deviceLabel,
  relyingParty,
  removePasskey,
  signInOptions,
  verifySignIn,
  type Refusal,
} from "./passkeys";
import { overAccountBudget, type AccountBudget } from "./account-limits";
import { loadAccount, type AgentAccount, type Passkey } from "./account-store";
import {
  refreshAccount,
  refreshSession,
  revokeAll,
  revokeSession,
  sessionsOf,
  startSession,
} from "./api-sessions";
import { createLinkCode, isChannelName, redeemLinkCode } from "./link-codes";
import { listConversations, moveConversations, visitorOf } from "./runs";
import { UserFacingError } from "./user-error";
import {
  accountCookie,
  accountCookieOptions,
  readJson,
  type Caller,
  type CookieStore,
} from "./web";

const headers = { "Cache-Control": "no-store" };
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
export const refuse = (status: number, code: string, error: string) =>
  answer({ code, error }, status);
const refused = (r: Refusal) => refuse(r.status, r.code, r.error);
const fromReply = (reply: { status: number; body: unknown }) =>
  Response.json(reply.body, { status: reply.status, headers });

/** A passkey as its owner sees it: never its key. */
export type PasskeyView = {
  id: string;
  name: string;
  created: number;
  lastUsed?: number;
  /** Kept in a password manager that syncs it to the person's other devices. */
  synced: boolean;
};
/** The account as its owner sees it. */
export type AccountView = {
  id: string;
  label?: string;
  created: number;
  passkeys: PasskeyView[];
  channels: Array<{ channel: string; linked: number }>;
  /** The session this request is made with. */
  session: string;
  /**
   * A browser only: how many of its own conversations, from before it
   * signed in, it could bring into the account.
   */
  unclaimed?: number;
};
const passkeyView = (p: Passkey): PasskeyView => ({
  id: p.id,
  name: p.name,
  created: p.created,
  ...(p.lastUsed ? { lastUsed: p.lastUsed } : {}),
  synced: p.backedUp,
});
async function view(
  account: AgentAccount,
  session: string,
  cookies?: CookieStore,
): Promise<AccountView> {
  const visitor = cookies ? visitorOf(cookies) : undefined;
  return {
    id: account.id,
    ...(account.label ? { label: account.label } : {}),
    created: account.created,
    passkeys: account.passkeys.map(passkeyView),
    channels: account.channels.map(({ channel, linked }) => ({
      channel,
      linked,
    })),
    session,
    ...(cookies
      ? {
          unclaimed: visitor ? (await listConversations(visitor)).length : 0,
        }
      : {}),
  };
}

/** A JSON object body, or why it isn't one. */
async function body(request: Request): Promise<Record<string, unknown>> {
  let read: unknown;
  try {
    read = await readJson(request, 16000);
  } catch (failure) {
    throw failure instanceof UserFacingError
      ? failure
      : new UserFacingError("Send a JSON object.");
  }
  if (!read || typeof read !== "object" || Array.isArray(read))
    throw new UserFacingError("Send a JSON object.");
  return read as Record<string, unknown>;
}

/** The page's own request, or an app's: anything else was refused before. */
const fromPage = (request: Request) => request.headers.has("origin");
const ipOf = (request: Request) => request.headers.get("cf-connecting-ip");

/** A sign-in whose passkey was removed while it was under way. */
const PASSKEY_GONE = () =>
  refuse(
    400,
    "passkey_not_verified",
    "This passkey was removed from the account. Sign in with another one.",
  );

/** Starts the device's session and answers it the way its client keeps it. */
async function signedIn(
  request: Request,
  cookies: CookieStore,
  account: AgentAccount,
  passkey: Passkey,
  device: string,
  status: number,
) {
  if (fromPage(request)) {
    const started = await startSession(account, {
      kind: "browser",
      device,
      passkey,
    });
    if (!started) return PASSKEY_GONE();
    if (started.kind !== "browser") throw new Error("Unreachable");
    cookies.set(accountCookie(), started.cookie, accountCookieOptions());
    return answer(
      { account: await view(account, started.session.id, cookies) },
      status,
    );
  }
  const started = await startSession(account, { kind: "app", device, passkey });
  if (!started) return PASSKEY_GONE();
  if (started.kind !== "app") throw new Error("Unreachable");
  return answer(
    {
      account: await view(account, started.session.id),
      tokens: started.tokens,
    },
    status,
  );
}

const budget = async (
  kind: AccountBudget,
  request: Request,
  account?: string,
) => {
  const over = await overAccountBudget(kind, {
    ip: ipOf(request),
    ...(account ? { account } : {}),
  });
  return over ? fromReply(over) : undefined;
};

/** The operations anyone may call: they create an account or sign in. */
export const OPEN_OPERATIONS = [
  "accountOptions",
  "createAccount",
  "signInOptions",
  "signIn",
  "refreshSession",
] as const;
export type OpenOperation = (typeof OPEN_OPERATIONS)[number];

/** An operation that creates an account, signs in or refreshes. */
export async function openOperation(
  operation: OpenOperation,
  request: Request,
  cookies: CookieStore,
  origin: string,
): Promise<Response> {
  const rp = relyingParty(origin);
  switch (operation) {
    case "accountOptions": {
      const over = await budget("create", request);
      if (over) return over;
      const input = await body(request);
      return answer(await createOptions(rp, { label: input.label }));
    }
    case "createAccount": {
      const over = await budget("create", request);
      if (over) return over;
      const input = await body(request);
      const device = deviceLabel(input.device);
      const created = await createWithPasskey(rp, {
        ceremony: input.ceremony,
        credential: input.credential,
        device,
      });
      if ("status" in created) return refused(created);
      return signedIn(
        request,
        cookies,
        created.account,
        created.passkey,
        device,
        201,
      );
    }
    case "signInOptions": {
      const over = await budget("signIn", request);
      if (over) return over;
      return answer(await signInOptions(rp));
    }
    case "signIn": {
      const input = await body(request);
      const over = await budget(
        "signIn",
        request,
        claimedAccount(input.credential),
      );
      if (over) return over;
      const proved = await verifySignIn(rp, {
        ceremony: input.ceremony,
        credential: input.credential,
      });
      if ("status" in proved) return refused(proved);
      return signedIn(
        request,
        cookies,
        proved.account,
        proved.passkey,
        deviceLabel(input.device),
        201,
      );
    }
    case "refreshSession": {
      const input = await body(request);
      const over = await budget(
        "refresh",
        request,
        refreshAccount(input.refreshToken),
      );
      if (over) return over;
      const refreshed = await refreshSession(input.refreshToken);
      if (!refreshed.ok)
        return refreshed.code === "session_revoked"
          ? refuse(
              401,
              "session_revoked",
              "This refresh token was used before, so the session was ended on every device that had it. Sign in again with your passkey.",
            )
          : refuse(
              401,
              "invalid_token",
              "This refresh token isn't valid any more. Sign in again with your passkey.",
            );
      return answer(refreshed.tokens);
    }
  }
}

/** The operations of a signed-in account. */
export const ACCOUNT_OPERATIONS = [
  "getAccount",
  "passkeyOptions",
  "addPasskey",
  "removePasskey",
  "listSessions",
  "revokeSession",
  "revokeAllSessions",
  "signOut",
  "claimConversations",
  "createLinkCode",
] as const;
export type AccountOperation = (typeof ACCOUNT_OPERATIONS)[number];

export const NOT_SIGNED_IN = () =>
  refuse(401, "not_signed_in", "Sign in to your account with a passkey first.");

/** An operation of the account `caller` is signed in to. */
export async function accountOperation(
  operation: AccountOperation,
  request: Request,
  caller: Caller,
  cookies: CookieStore,
  names: Record<string, string>,
): Promise<Response> {
  const signed = caller.account;
  const found = signed ? await loadAccount(signed.id) : undefined;
  if (!signed || !found) return NOT_SIGNED_IN();
  const { account } = found;
  const browser = signed.via === "cookie";
  const shown = (next: AgentAccount) =>
    view(next, signed.session, browser ? cookies : undefined);
  if (operation !== "getAccount" && operation !== "listSessions") {
    const over = await budget("manage", request, account.id);
    if (over) return over;
  }
  switch (operation) {
    case "getAccount":
      return answer(await shown(account));
    case "passkeyOptions": {
      const options = await addOptions(relyingParty(caller.origin), account);
      return "status" in options ? refused(options) : answer(options);
    }
    case "addPasskey": {
      const input = await body(request);
      const added = await addPasskey(relyingParty(caller.origin), account, {
        ceremony: input.ceremony,
        credential: input.credential,
        device: deviceLabel(input.device),
      });
      if ("status" in added) return refused(added);
      return answer(
        {
          passkey: passkeyView(added.passkey),
          account: await shown(added.account),
        },
        201,
      );
    }
    case "removePasskey": {
      const removed = await removePasskey(account.id, names.passkey ?? "");
      if ("status" in removed) return refused(removed);
      // This browser signed in with it: it is signed out with the rest.
      if (browser && removed.ended.includes(signed.session))
        cookies.set(accountCookie(), "", accountCookieOptions(0));
      return answer(await shown(removed.account));
    }
    case "listSessions":
      return answer({ sessions: await sessionsOf(account.id, signed.session) });
    case "revokeSession": {
      const id = names.session ?? "";
      if (!(await revokeSession(account.id, id)))
        return refuse(
          404,
          "session_not_found",
          "There is no such device signed in to this account.",
        );
      if (id === signed.session && browser)
        cookies.set(accountCookie(), "", accountCookieOptions(0));
      return answer({ revoked: 1 });
    }
    case "revokeAllSessions": {
      const revoked = await revokeAll(account.id);
      if (browser) cookies.set(accountCookie(), "", accountCookieOptions(0));
      return answer({ revoked });
    }
    case "signOut": {
      await revokeSession(account.id, signed.session);
      if (browser) cookies.set(accountCookie(), "", accountCookieOptions(0));
      return answer({ revoked: 1 });
    }
    case "claimConversations": {
      // The visitor is the browser's own; an app has none to bring.
      const visitor = browser ? visitorOf(cookies) : undefined;
      if (!browser)
        return refuse(
          400,
          "browser_only",
          "Only a browser has conversations of its own to bring into the account.",
        );
      const moved = visitor
        ? await moveConversations(visitor, account.user)
        : { moved: 0, skipped: 0 };
      return answer({ ...moved, account: await shown(account) });
    }
    case "createLinkCode":
      return answer(await createLinkCode(account), 201);
  }
}

// ---- Channels --------------------------------------------------------------

/**
 * A channel that redeems link codes over HTTP: it runs outside this
 * process (a messaging bot's own server) and proves itself on each
 * request in its own way, a shared secret in a header, say. None is
 * configured by default, so the route refuses every request until a
 * deployment names one; a channel in this process calls `redeemLinkCode`.
 */
export type LinkingChannel = {
  name: string;
  authenticate(request: Request): boolean | Promise<boolean>;
};
const global = globalThis as typeof globalThis & {
  papLinkingChannels?: Map<string, LinkingChannel>;
};
export function configureLinkingChannel(channel: LinkingChannel) {
  (global.papLinkingChannels ??= new Map()).set(channel.name, channel);
}
/** TEST ONLY: forgets every channel. */
export function forgetLinkingChannels() {
  global.papLinkingChannels?.clear();
}

/** `POST /api/v1/link-codes/redeem`, from a channel. */
export async function redeemOverHttp(request: Request): Promise<Response> {
  const input = await body(request);
  const name = input.channel;
  const channel = isChannelName(name)
    ? global.papLinkingChannels?.get(name)
    : undefined;
  if (!channel || !(await channel.authenticate(request)))
    return refuse(
      401,
      "channel_unauthenticated",
      "Only a channel this deployment knows can redeem a link code.",
    );
  const user = typeof input.user === "string" ? input.user : "";
  const over = await budget("redeem", request, `${channel.name}\n${user}`);
  if (over) return over;
  const redeemed = await redeemLinkCode({
    channel: channel.name,
    user,
    code: typeof input.code === "string" ? input.code : "",
  });
  if (!redeemed.ok)
    return refuse(
      400,
      redeemed.code,
      "That code isn't valid. Codes work once, for five minutes; ask for a new one in your account.",
    );
  return answer({ account: redeemed.account.id, linked: true });
}

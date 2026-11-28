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
  accountOperations,
  type InvalidRequest,
} from "./api-contract/index.ts";
import {
  addOptions,
  addPasskey,
  claimedAccount,
  createOptions,
  createWithPasskey,
  deviceLabel,
  relyingParty,
  removePasskey,
  SIGN_IN_REFUSED,
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
import { readPublicInput } from "./public-input";
import { listConversations, moveConversations, visitorOf } from "./runs";
import {
  accountCookie,
  accountCookieOptions,
  clientAddress,
  type Caller,
  type CookieStore,
  type Reply,
} from "./web";

const headers = { "Cache-Control": "no-store" };
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
export const refuse = (status: number, code: string, error: string) =>
  answer({ code, error }, status);
const refused = (r: Refusal) => refuse(r.status, r.code, r.error);
const invalid = (failure: InvalidRequest) =>
  refuse(failure.status, failure.code, failure.error);
const fromReply = (reply: Reply) =>
  Response.json(reply.body, {
    status: reply.status,
    headers: { ...headers, ...reply.headers },
  });

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

/** The page's own request, or an app's: anything else was refused before. */
const fromPage = (request: Request) => request.headers.has("origin");

/** A sign-in whose passkey was removed while it was under way. */
const PASSKEY_GONE = () => refused(SIGN_IN_REFUSED);

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

/**
 * 429 when the request is over its budget. `account` is the account it
 * names; `claimed` when nothing has proved it yet (a passkey's user
 * handle, a refresh token's prefix), so it is counted with the source
 * and no one can spend another person's budget by naming their account.
 */
const budget = async (
  kind: AccountBudget,
  request: Request,
  account?: string,
  claimed = false,
) => {
  const over = await overAccountBudget(kind, {
    ip: clientAddress(request),
    ...(account ? { account, claimed } : {}),
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
      const contract = accountOperations.accountOptions;
      const parsed = await readPublicInput(
        request,
        16000,
        contract.body,
        contract.messages,
      );
      if (!parsed.ok) return invalid(parsed.error);
      return answer(await createOptions(rp, parsed.value));
    }
    case "createAccount": {
      const over = await budget("createAnswer", request);
      if (over) return over;
      const contract = accountOperations.createAccount;
      const parsed = await readPublicInput(
        request,
        16000,
        contract.body,
        contract.messages,
      );
      if (!parsed.ok) return invalid(parsed.error);
      const device = deviceLabel(parsed.value.device);
      const created = await createWithPasskey(rp, {
        ceremony: parsed.value.ceremony,
        credential: parsed.value.credential,
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
      const contract = accountOperations.signInOptions;
      const parsed = await readPublicInput(request, 16000, contract.body);
      if (!parsed.ok) return invalid(parsed.error);
      return answer(await signInOptions(rp));
    }
    case "signIn": {
      const contract = accountOperations.signIn;
      const parsed = await readPublicInput(
        request,
        16000,
        contract.body,
        contract.messages,
      );
      if (!parsed.ok) {
        const over = await budget("signIn", request);
        return over ?? invalid(parsed.error);
      }
      const over = await budget(
        "signIn",
        request,
        claimedAccount(parsed.value.credential),
        true,
      );
      if (over) return over;
      const proved = await verifySignIn(rp, {
        ceremony: parsed.value.ceremony,
        credential: parsed.value.credential,
      });
      if ("status" in proved) return refused(proved);
      return signedIn(
        request,
        cookies,
        proved.account,
        proved.passkey,
        deviceLabel(parsed.value.device),
        201,
      );
    }
    case "refreshSession": {
      const contract = accountOperations.refreshSession;
      const parsed = await readPublicInput(
        request,
        16000,
        contract.body,
        contract.messages,
      );
      if (!parsed.ok) {
        const over = await budget("refresh", request);
        return over ?? invalid(parsed.error);
      }
      const over = await budget(
        "refresh",
        request,
        refreshAccount(parsed.value.refreshToken),
        true,
      );
      if (over) return over;
      const refreshed = await refreshSession(parsed.value.refreshToken);
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
      const contract = accountOperations.passkeyOptions;
      const parsed = await readPublicInput(request, 16000, contract.body);
      if (!parsed.ok) return invalid(parsed.error);
      const options = await addOptions(relyingParty(caller.origin), account);
      return "status" in options ? refused(options) : answer(options);
    }
    case "addPasskey": {
      const contract = accountOperations.addPasskey;
      const parsed = await readPublicInput(
        request,
        16000,
        contract.body,
        contract.messages,
      );
      if (!parsed.ok) return invalid(parsed.error);
      const added = await addPasskey(relyingParty(caller.origin), account, {
        ceremony: parsed.value.ceremony,
        credential: parsed.value.credential,
        device: deviceLabel(parsed.value.device),
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
      const contract = accountOperations.signOut;
      const parsed = await readPublicInput(request, 16000, contract.body);
      if (!parsed.ok) return invalid(parsed.error);
      await revokeSession(account.id, signed.session);
      if (browser) cookies.set(accountCookie(), "", accountCookieOptions(0));
      return answer({ revoked: 1 });
    }
    case "claimConversations": {
      const contract = accountOperations.claimConversations;
      const parsed = await readPublicInput(request, 16000, contract.body);
      if (!parsed.ok) return invalid(parsed.error);
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
    case "createLinkCode": {
      const contract = accountOperations.createLinkCode;
      const parsed = await readPublicInput(request, 16000, contract.body);
      if (!parsed.ok) return invalid(parsed.error);
      return answer(await createLinkCode(account), 201);
    }
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
  const contract = accountOperations.redeemLinkCode;
  const parsed = await readPublicInput(
    request,
    16000,
    contract.body,
    contract.messages,
  );
  if (!parsed.ok) return invalid(parsed.error);
  const channel = isChannelName(parsed.value.channel)
    ? global.papLinkingChannels?.get(parsed.value.channel)
    : undefined;
  if (!channel || !(await channel.authenticate(request)))
    return refuse(
      401,
      "channel_unauthenticated",
      "Only a channel this deployment knows can redeem a link code.",
    );
  const over = await budget(
    "redeem",
    request,
    `${channel.name}\n${parsed.value.user}`,
  );
  if (over) return over;
  const redeemed = await redeemLinkCode({
    channel: channel.name,
    user: parsed.value.user,
    code: parsed.value.code,
  });
  if (!redeemed.ok)
    return refuse(
      400,
      redeemed.code,
      "That code isn't valid. Codes work once, for five minutes; ask for a new one in your account.",
    );
  return answer({ account: redeemed.account.id, linked: true });
}

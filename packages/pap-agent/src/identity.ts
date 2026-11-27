/**
 * Who the agent works for, as a channel tells it. Every conversation is
 * kept under an agent user (`Caller.user`); a channel says which one a
 * request is for.
 *
 * - The playground's page: the visitor, by its cookie (`browserCaller`),
 *   or the agent account the browser is signed in to.
 * - A client app (the iPhone app): the agent account its device signed
 *   in to with a passkey, by the API session's bearer token
 *   (`apiSessionCaller`).
 * - A channel with users of its own (a messaging bot, a harness): its
 *   user's ID, mapped to an agent user the first time it is seen
 *   (`channelCaller`, `channelUser`), and to an account's once the person
 *   redeems a link code there (`link-codes.ts`).
 *
 * An agent account (`account-store.ts`) is an opaque ID, its passkeys
 * and an optional label: no email, no password, nothing else about the
 * person. Its conversations follow it to every device signed in to it.
 */
import type { ApiSession } from "./account-store";
import { channelUser } from "./runs";
import type { Caller } from "./web";

export { browserCaller } from "./web";
export { channelUser };
export type {
  AgentAccount,
  ApiSession,
  Passkey,
  PushDevice,
} from "./account-store";
export { createLinkCode, redeemLinkCode } from "./link-codes";
export { configureAccountStorage } from "./account-store";
export { configureLinkingChannel } from "./agent-account-http";

/**
 * A request from a channel that knows its own user: `user` is the agent
 * user (`channelUser`). The channel vouches for the request (`authentic`)
 * because it authenticated its user itself. A channel binds a sign-in to
 * the user who started it in its own way (`signIns`).
 */
export function channelCaller(input: {
  user: string;
  origin: string;
  signIns: Caller["signIns"];
  ip?: string | null;
}): Caller {
  return {
    user: (() => input.user) as Caller["user"],
    authentic: true,
    origin: input.origin,
    localDev: false,
    ip: input.ip ?? null,
    signIns: input.signIns,
  };
}

/**
 * A request with an API session's access token: the account's own,
 * from whichever device. The token proves it, so it is `authentic`
 * without an Origin. A Company's sign-in comes back to a browser, which
 * an app's session has no cookie in, so none is bound here: the API gives
 * the app a link that binds it in the browser the app opens
 * (`sign-in-links.ts`).
 */
export function apiSessionCaller(
  request: Request,
  session: ApiSession,
): Caller {
  return {
    user: (() => session.user) as Caller["user"],
    authentic: true,
    origin: new URL(request.url).origin,
    localDev: false,
    ip: request.headers.get("cf-connecting-ip"),
    signIns: {
      bind: () => {},
      holds: () => false,
      release: () => {},
    },
    account: { id: session.account, session: session.id, via: "bearer" },
  };
}

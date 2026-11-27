/**
 * Who the agent works for, as a channel tells it. Every conversation is
 * kept under an agent user (`Caller.user`); a channel says which one a
 * request is for.
 *
 * - The playground's page: the visitor, by its cookie (`browserCaller`).
 * - A channel with users of its own (a messaging bot, a harness): its
 *   user's ID, mapped to an agent user the first time it is seen
 *   (`channelCaller`, `channelUser`).
 *
 * What comes next has its place here and is not built yet: an agent
 * account a person signs in to with a passkey, which a visitor and any
 * channel's users can be linked to, and an API session for each device
 * of a client app, which a request presents instead of a cookie. They are
 * described below so the API's shape leaves room for them.
 */
import { channelUser } from "./runs";
import type { Caller } from "./web";

export { browserCaller } from "./web";
export { channelUser };

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
 * Not built yet. An agent account: the person behind any number of
 * visitors and channel users, who signs in with a passkey. Each passkey is
 * a WebAuthn credential; the account keeps only its public key.
 */
export type AgentAccount = {
  id: string;
  passkeys: Array<{ credentialId: string; publicKey: string; added: number }>;
  /** The agent users linked to it: a visitor, a channel's user. */
  linked: Array<{ via: "visitor" | "channel"; user: string }>;
};

/**
 * Not built yet. A session of one device of a client app (the mobile
 * app), started with the account's passkey and presented as a bearer
 * token on `/api/v1`. It can be listed and ended one device at a time.
 */
export type ApiSession = {
  id: string;
  account: string;
  device: { name: string; added: number };
  expires: number;
};

/**
 * Linking a channel to an agent account by a one-time code. A person
 * signed in to their account asks for a code and types it into the
 * channel (a messaging app, say); the channel redeems it once, and from
 * then on its user is the account's: `channelUser` answers the account's
 * agent user, so the channel sees the account's conversations.
 *
 * A code is eight characters from an alphabet without look-alikes, lasts
 * five minutes and is kept only as a hash. Redeeming is counted per
 * channel user and per source (`account-limits.ts`), so guessing one in
 * its five minutes doesn't pay.
 */
import { createHash, randomInt } from "node:crypto";
import {
  accountBackend,
  loadAccount,
  takeOnce,
  updateAccount,
  type AgentAccount,
} from "./account-store";
import { linkChannelUser } from "./runs";

/** Crockford's base32: no I, L, O or U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 8;
export const LINK_CODE_MS = 5 * 60000;

type LinkCode = { account: string; expires: number; used?: true };
/** As the person may type it: any case, with spaces or a dash. */
const normal = (code: string) =>
  code
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
const bucketOf = (code: string) =>
  `link-code:${createHash("sha256").update(normal(code)).digest("base64url")}`;

/** A new code for the account, and when it stops working. */
export async function createLinkCode(account: AgentAccount) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = Array.from(
      { length: LENGTH },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join("");
    const expires = Date.now() + LINK_CODE_MS;
    if (
      await accountBackend().put(
        bucketOf(code),
        "code",
        { account: account.id, expires } satisfies LinkCode,
        null,
        expires,
      )
    )
      return {
        code: `${code.slice(0, 4)}-${code.slice(4)}`,
        expiresAt: expires,
      };
  }
  throw new Error("Link code conflict");
}

export const isChannelName = (name: unknown): name is string =>
  typeof name === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(name);

/**
 * Redeems a code for a channel's user, once: the user is linked to the
 * code's account. Answers the account, or why not.
 */
export async function redeemLinkCode(input: {
  channel: string;
  /** The channel's own ID for its user (a chat's ID). */
  user: string;
  code: string;
}): Promise<
  | { ok: true; account: AgentAccount; user: string }
  | { ok: false; code: "link_code_invalid" }
> {
  const typed = normal(input.code);
  if (
    !isChannelName(input.channel) ||
    !input.user ||
    input.user.length > 256 ||
    typed.length !== LENGTH ||
    [...typed].some((c) => !ALPHABET.includes(c))
  )
    return { ok: false, code: "link_code_invalid" };
  const record = await takeOnce<LinkCode>(bucketOf(typed), "code");
  const found = record ? await loadAccount(record.account) : undefined;
  if (!found) return { ok: false, code: "link_code_invalid" };
  const { account } = found;
  await linkChannelUser(input.channel, input.user, account.user, account.id);
  const userKey = createHash("sha256").update(input.user).digest("base64url");
  const next = await updateAccount<never>(account.id, (current) => ({
    ...current,
    channels: [
      ...current.channels.filter(
        (c) => !(c.channel === input.channel && c.user === userKey),
      ),
      { channel: input.channel, user: userKey, linked: Date.now() },
    ].slice(-20),
  }));
  return {
    ok: true,
    account: next && !("refused" in next) ? next : account,
    user: account.user,
  };
}

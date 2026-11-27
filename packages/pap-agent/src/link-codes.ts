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
import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  accountBackend,
  loadAccount,
  takeOnce,
  updateAccount,
  type AgentAccount,
} from "./account-store";
import { storage } from "./runs";

// ---- Channel users ---------------------------------------------------------
/**
 * The agent user a channel's own user is (a Telegram chat, a device), made
 * the first time the channel names them: a random key, kept under
 * `user:<SHA-256 of their ID>` in the channel's own bucket. The link is a
 * record of its own so that it can be pointed at another agent user, when
 * a person links the channel to their account. It is kept with the
 * accounts (`accountBackend`), so a link lasts as long as its account.
 */
const channelKey = (channel: string, id: string) => ({
  bucket: `channel:${channel}`,
  key: `user:${createHash("sha256").update(id).digest("base64url")}`,
});
/**
 * The channel user's record, moved first from where conversations are
 * kept, where it was stored before, when it is still only there.
 */
async function channelRecord(bucket: string, key: string) {
  const found = await accountBackend().get(bucket, key);
  if (found || accountBackend() === storage()) return found;
  const before = await storage().get(bucket, key);
  if (!before) return undefined;
  if (await accountBackend().put(bucket, key, before.value, null)) {
    await storage().remove(bucket, key);
  }
  return accountBackend().get(bucket, key);
}
export async function channelUser(channel: string, id: string) {
  const b = accountBackend();
  const { bucket, key } = channelKey(channel, id);
  for (let attempt = 0; attempt < 3; attempt++) {
    const linked = (await channelRecord(bucket, key))?.value as
      { user?: string } | undefined;
    if (typeof linked?.user === "string") return linked.user;
    const user = createHash("sha256")
      .update(randomBytes(32))
      .digest("base64url");
    if (await b.put(bucket, key, { user, linked: Date.now() }, null))
      return user;
  }
  throw new Error("Channel user conflict");
}

/**
 * Points a channel's user at another agent user: an account's, once the
 * person redeemed a link code there. From then on the channel's requests
 * are the account's; what it said before stays under the agent user it
 * had.
 */
export async function linkChannelUser(
  channel: string,
  id: string,
  user: string,
  account: string,
) {
  const b = accountBackend();
  const { bucket, key } = channelKey(channel, id);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await channelRecord(bucket, key);
    if (
      await b.put(
        bucket,
        key,
        { user, account, linked: Date.now() },
        current?.version ?? null,
      )
    )
      return;
  }
  throw new Error("Channel user conflict");
}

// ---- Link codes ------------------------------------------------------------

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

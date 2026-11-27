/**
 * Budgets for the account's ceremonies: creating an account, signing in
 * with a passkey, adding one, refreshing an app's tokens, redeeming a
 * link code and an app's links to a Company's sign-in; and for opening a
 * conversation's event stream. Unlike the chat's (`limits.ts`), they
 * hold on every deployment: each is a guess at a secret or a write to
 * the store, and none needs many tries.
 *
 * Each is counted per source address and, once the request names one,
 * per account, with a global ceiling. An account named before anything
 * proved it (a sign-in's user handle, a refresh token's prefix) is
 * counted together with the source, so someone who knows an account's ID
 * can spend only their own tries at it, not its owner's. An address is
 * hashed before it is a key. An IPv6 address counts by its /64
 * (`addressKey`), as in `limits.ts` and at the Companies.
 */
import { createHash } from "node:crypto";
import { addressKey } from "@poppy-lab/pap-client";
import { storage, type Limit } from "./runs";
import { json, type Reply } from "./web";

const minute = 60000,
  hour = 3600000;
const l = (name: string, limit: number, windowMs: number): Limit => ({
  name,
  limit,
  windowMs,
});
const budgets = {
  /**
   * Options for a new account. With no attestation a script can answer
   * them as well as a phone, so few: each answer needs options of its
   * own, which are taken once.
   */
  create: {
    source: [l("acct-create:h", 5, hour)],
    account: [],
    global: [l("acct-create:g", 60, hour)],
  },
  /** The answer to a new account's options, tried once each. */
  createAnswer: {
    source: [l("acct-answer:m", 10, minute)],
    account: [],
    global: [l("acct-answer:g", 600, minute)],
  },
  /** Options and verification of a sign-in. */
  signIn: {
    source: [l("acct-signin:m", 20, minute), l("acct-signin:h", 200, hour)],
    account: [l("acct-signin:a", 20, minute)],
    global: [l("acct-signin:g", 1200, minute)],
  },
  /** Adding or removing a passkey, a link code, bringing conversations. */
  manage: {
    source: [l("acct-manage:m", 30, minute)],
    account: [l("acct-manage:a", 30, minute)],
    global: [l("acct-manage:g", 1200, minute)],
  },
  refresh: {
    source: [l("acct-refresh:m", 30, minute)],
    account: [l("acct-refresh:a", 30, minute)],
    global: [l("acct-refresh:g", 1200, minute)],
  },
  redeem: {
    source: [l("acct-redeem:m", 10, minute)],
    account: [l("acct-redeem:a", 10, minute)],
    global: [l("acct-redeem:g", 600, minute)],
  },
  /** An app's sign-in link to a Company: asked for, and opened. */
  signInLink: {
    source: [l("acct-link:m", 20, minute)],
    account: [l("acct-link:a", 20, minute)],
    global: [l("acct-link:g", 1200, minute)],
  },
  /** Opening a conversation's event stream, which then reads it for minutes. */
  events: {
    source: [l("events:m", 30, minute)],
    account: [l("events:a", 30, minute)],
    global: [l("events:g", 2400, minute)],
  },
} satisfies Record<
  string,
  { source: Limit[]; account: Limit[]; global: Limit[] }
>;
export type AccountBudget = keyof typeof budgets;

const hashed = (text: string) =>
  createHash("sha256").update(text).digest("base64url");

/** The first of `limits` this request goes over in `bucket`, if any. */
async function over(bucket: string, limits: Limit[]) {
  for (const limit of limits)
    if (
      (await storage().count(bucket, limit.name, limit.windowMs)) > limit.limit
    )
      return limit;
  return undefined;
}

/**
 * 429 when this request is over its budget, otherwise undefined.
 * `account` is the account it names, when it names one; for a link code,
 * the channel's user. The source is counted first, so tries a source was
 * refused don't spend the global ceiling everyone shares.
 */
export async function overAccountBudget(
  kind: AccountBudget,
  who: { ip: string | null; account?: string; claimed?: boolean },
): Promise<Reply | undefined> {
  const b = budgets[kind];
  const refused =
    (who.ip
      ? await over(`ip:${hashed(addressKey(who.ip))}`, b.source)
      : undefined) ??
    (who.account && b.account.length
      ? await over(
          `acct-budget:${hashed(
            who.claimed
              ? `${who.ip ? addressKey(who.ip) : ""}\n${who.account}`
              : who.account,
          )}`,
          b.account,
        )
      : undefined) ??
    (await over("global", b.global));
  if (!refused) return undefined;
  const hourly = refused.windowMs >= hour;
  return json(
    {
      code: "rate_limited",
      error: hourly
        ? "Too many attempts. Wait an hour and try again."
        : "Too many attempts. Wait a minute and try again.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(refused.windowMs / 1000)),
        "Cache-Control": "no-store",
      },
    },
  );
}

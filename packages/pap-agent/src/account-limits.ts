/**
 * Budgets for the account's ceremonies: creating an account, signing in
 * with a passkey, adding one, refreshing an app's tokens, redeeming a
 * link code and an app's links to a Company's sign-in; and for opening a
 * conversation's event stream. Unlike the chat's (`limits.ts`), they
 * hold on every deployment: each is a guess at a secret or a write to
 * the store, and none needs many tries.
 *
 * Each is counted per source address and, once the request names one,
 * per account, with a global ceiling. An address is hashed before it is
 * a key. An IPv6 address counts by its /64 (`addressKey`), as in
 * `limits.ts` and at the Companies.
 */
import { createHash } from "node:crypto";
import { addressKey } from "@poppy-lab/pap-client";
import { allow, type Limit } from "./runs";
import { json, type Reply } from "./web";

const minute = 60000,
  hour = 3600000;
const l = (name: string, limit: number, windowMs: number): Limit => ({
  name,
  limit,
  windowMs,
});
const budgets = {
  /** Options and verification of a new account. */
  create: {
    source: [l("acct-create:m", 10, minute), l("acct-create:h", 40, hour)],
    account: [],
    global: [l("acct-create:g", 600, minute)],
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

/**
 * 429 when this request is over its budget, otherwise undefined.
 * `account` is the account it names, when it names one; for a link code,
 * the channel's user.
 */
export async function overAccountBudget(
  kind: AccountBudget,
  who: { ip: string | null; account?: string },
): Promise<Reply | undefined> {
  const b = budgets[kind];
  const ok =
    (await allow("global", { visitor: b.global })) &&
    (!who.ip ||
      (await allow(`ip:${hashed(addressKey(who.ip))}`, {
        visitor: b.source,
      }))) &&
    (!who.account ||
      !b.account.length ||
      (await allow(`acct-budget:${hashed(who.account)}`, {
        visitor: b.account,
      })));
  if (ok) return undefined;
  return json(
    {
      code: "rate_limited",
      error: "Too many attempts. Wait a minute and try again.",
    },
    {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    },
  );
}

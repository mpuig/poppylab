/**
 * A channel's link to an account lasts as long as the account, not as
 * long as the conversations kept where visitors' are; and on Node the
 * accounts, their sessions and the links outlive a restart.
 */
import { beforeEach, expect, it } from "vitest";
import {
  configureAccountStorage,
  loadAccount,
  loadSession,
} from "./account-store";
import { startSession } from "./api-sessions";
import { channelUser, createLinkCode, redeemLinkCode } from "./link-codes";
import {
  configureBackend,
  memoryBackend,
  restoredRows,
  snapshotRows,
} from "./runs";
import { createOptions, createWithPasskey, relyingParty } from "./passkeys";
import { softwareAuthenticator } from "./webauthn-fixture";

const origin = "http://localhost:3991";
let visitors: ReturnType<typeof memoryBackend>,
  accounts: ReturnType<typeof memoryBackend>;
beforeEach(() => {
  visitors = memoryBackend();
  accounts = memoryBackend();
  configureBackend(visitors);
  configureAccountStorage(() => accounts);
});

async function newAccount() {
  const rp = relyingParty(origin);
  const { ceremony, options } = await createOptions(rp, {});
  const created = await createWithPasskey(rp, {
    ceremony,
    credential: await softwareAuthenticator(origin).create(options),
    device: "iPhone",
  });
  if ("status" in created) throw new Error(created.error);
  return created.account;
}

it("keeps a channel's link where the account is, so it outlives the visitors' store", async () => {
  const account = await newAccount();
  const { code } = await createLinkCode(account);
  expect(
    await redeemLinkCode({ channel: "telegram", user: "chat-1", code }),
  ).toMatchObject({ ok: true });
  // The visitors' objects go after eight idle days; the account stays.
  visitors.data.clear();
  expect(await channelUser("telegram", "chat-1")).toBe(account.user);
  expect((await loadAccount(account.id))!.account.channels).toHaveLength(1);
});

it("moves a link kept where the visitors' are into the account store", async () => {
  const account = await newAccount();
  const { code } = await createLinkCode(account);
  await redeemLinkCode({ channel: "telegram", user: "chat-1", code });
  // As links were stored before: in the visitors' store.
  for (const [bucket, entries] of accounts.data)
    if (bucket.startsWith("channel:")) {
      visitors.data.set(bucket, new Map(entries));
      accounts.data.delete(bucket);
    }
  expect(await channelUser("telegram", "chat-1")).toBe(account.user);
  visitors.data.clear();
  expect(await channelUser("telegram", "chat-1")).toBe(account.user);
});

it("keeps accounts, their sessions and the channels' links across a Node restart, not ceremonies or codes", async () => {
  const account = await newAccount();
  const { session } = (await startSession(account, {
    kind: "app",
    device: "iPhone",
    passkey: account.passkeys[0]!,
  }))!;
  const { code } = await createLinkCode(account);
  await redeemLinkCode({ channel: "telegram", user: "chat-1", code });
  await createLinkCode(account);
  await createOptions(relyingParty(origin), {});
  const restarted = memoryBackend();
  for (const [bucket, key, value] of restoredRows(
    snapshotRows(accounts.data),
  )) {
    if (!restarted.data.has(bucket)) restarted.data.set(bucket, new Map());
    restarted.data.get(bucket)!.set(key, { value, version: 1 });
  }
  configureAccountStorage(() => restarted);
  expect((await loadAccount(account.id))?.account.id).toBe(account.id);
  expect(await loadSession(account.id, session.id)).toBeDefined();
  expect(await channelUser("telegram", "chat-1")).toBe(account.user);
  expect(
    [...restarted.data.keys()].filter(
      (b) => b.startsWith("ceremony:") || b.startsWith("link-code:"),
    ),
  ).toEqual([]);
});

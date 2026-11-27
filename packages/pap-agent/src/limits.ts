import { createHash } from "node:crypto";
import { addressKey } from "@poppy-lab/pap-client";
import { allow, endedConversation, type Limit } from "./runs";
import { publicMode } from "./deployment";
import { json } from "./web";

const minute = 60000,
  day = 86400000;
const l = (name: string, limit: number, windowMs: number): Limit => ({
  name,
  limit,
  windowMs,
});
/**
 * Public-mode budgets. Model calls use the visitor's own key, so these
 * protect the Companies and this deployment's compute, not model spend.
 * The visitor cookie is the client's to rotate, so per-visitor budgets only
 * bound honest users; the per-IP (Cloudflare's `cf-connecting-ip`) and
 * global budgets are the ones that hold against abuse. An IPv6 address
 * counts by its /64 (`addressKey`), as at the Companies, since one
 * subscriber usually holds the whole of it.
 */
const budgets = {
  chat: {
    visitor: [l("chat:m", 8, minute), l("chat:d", 150, day)],
    ip: [l("chat:ip", 20, minute)],
    global: [l("chat:g", 600, minute)],
  },
  account: {
    visitor: [l("account:m", 20, minute)],
    ip: [l("account:ip", 40, minute)],
    global: [l("account:g", 1200, minute)],
  },
  discover: {
    visitor: [l("discover:m", 20, minute)],
    ip: [l("discover:ip", 40, minute)],
    global: [l("discover:g", 1200, minute)],
  },
};

/** 429 when over budget (public mode only), otherwise undefined. */
export async function overBudget(
  /** The client's address (`Caller.ip`), when the channel knows it. */
  ip: string | null,
  visitor: string,
  kind: keyof typeof budgets,
) {
  if (!publicMode()) return undefined;
  const b = budgets[kind];
  const ok =
    (await allow(visitor, { visitor: b.visitor, global: b.global })) &&
    (!ip ||
      (await allow(
        `ip:${createHash("sha256").update(addressKey(ip)).digest("base64url")}`,
        { visitor: b.ip },
      )));
  if (ok) return undefined;
  return json(
    { error: "Too many requests. Wait a minute and try again." },
    {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    },
  );
}

/**
 * 410 when the request names a conversation of this visitor that has ended
 * and is kept read-only, otherwise undefined. The tab that named it still
 * shows it, with a message box: an answer from a new conversation would
 * land under the old messages, signed out. Nothing is sent or started, and
 * the header lets the page tell this from any other refusal and show the
 * conversation read-only, as History does.
 */
export async function conversationEnded(
  visitor: string,
  id: string | undefined,
) {
  const ended = await endedConversation(visitor, id);
  if (!ended || !id) return undefined;
  return json(
    {
      code: "conversation_ended",
      error:
        "This conversation has ended and is read-only, so nothing was sent to any company. Start a new conversation to go on.",
      keptUntil: ended.keptUntil,
    },
    {
      status: 410,
      headers: {
        "X-Poppy-Conversation-Ended": id,
        "Cache-Control": "no-store",
      },
    },
  );
}

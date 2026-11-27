/**
 * What happens in a conversation after a turn has answered: a sign-in
 * finished in the Company's tab, a proposal expired or came back with new
 * terms, a Company wrote in a Direct Conversation, the conversation ended.
 * They are read from the stored conversation, which every channel and
 * every request writes to, so a channel learns of what another one did
 * (the sign-in callback, the page in another tab) without a message bus:
 * `conversationEvents` reads it again every few seconds and says what
 * changed (`eventsBetween`).
 */
import {
  getConversation,
  type AgentMessage,
  type CompanyRef,
  type ConversationState,
  type Proposal,
} from "./api";
import { accountBackend, opaqueId } from "./account-store";
import type { Backend } from "./runs";
import type { Caller } from "./web";

export type AgentEvent =
  /** The conversation as it is when the stream opens: the base for what follows. */
  | { type: "state"; state: ConversationState }
  /** Something new was said, by the User, the agent or a Company. */
  | { type: "message"; message: AgentMessage }
  /** What the conversation showed was taken back: show `state` in its place. */
  | { type: "messages.replaced"; state: ConversationState }
  | { type: "signin.completed"; company: CompanyRef }
  /**
   * A sign-in under way ended without signing in: declined or failed at
   * the Company, or not finished within five minutes. Nothing changed.
   */
  | { type: "signin.failed"; company: CompanyRef }
  /** The Company no longer takes the sign-in: the User signs in again. */
  | { type: "access.lost"; company: CompanyRef }
  | { type: "signout"; company: CompanyRef }
  | { type: "proposal.created"; proposal: Proposal }
  /** Its terms ran out before it was approved: nothing was done. */
  | { type: "proposal.expired"; proposal: Proposal }
  /** The Company answered the approval with other terms, which wait now. */
  | { type: "proposal.replaced"; proposal: Proposal }
  /** It ended otherwise: performed, declined, refused or uncertain. */
  | { type: "proposal.updated"; proposal: Proposal }
  | { type: "company.added"; company: CompanyRef }
  | { type: "company.removed"; company: CompanyRef }
  | { type: "conversation.ended"; keptUntil?: number }
  /**
   * The stream's own sign-in ended, and the stream with it: with
   * `invalid_token` its access token ran out or was replaced (refresh and
   * open it again), with `session_revoked` the device was signed out.
   */
  | { type: "session.ended"; code: SessionEnded };
export type SessionEnded = "invalid_token" | "session_revoked";
export type AgentEventType = AgentEvent["type"];

const ref = ({ origin, name }: CompanyRef): CompanyRef => ({ origin, name });
const key = (p: Proposal) => `${p.company.origin} ${p.id}`;
const expired = (p: Proposal, now: number) =>
  p.state === "expired" ||
  (p.state === "proposed" && Date.parse(p.expiresAt) <= now);
const same = (a: AgentMessage, b: AgentMessage) =>
  a.from === b.from && a.text === b.text;

/**
 * What changed between two readings of a conversation, in the order a
 * channel should show it: `before` read at `since`, `after` at `now`. A
 * Company holds terms until their time and nothing is written when that
 * passes, so a proposal has run out when its time came between the two.
 */
export function eventsBetween(
  before: ConversationState,
  after: ConversationState,
  { since = Date.now(), now = since }: { since?: number; now?: number } = {},
): AgentEvent[] {
  const events: AgentEvent[] = [];
  const was = new Map(before.companies.map((c) => [c.origin, c]));
  const is = new Map(after.companies.map((c) => [c.origin, c]));
  for (const c of after.companies)
    if (!was.has(c.origin))
      events.push({ type: "company.added", company: ref(c) });
  for (const c of before.companies)
    if (!is.has(c.origin))
      events.push({ type: "company.removed", company: ref(c) });
  for (const c of after.companies) {
    const prior = was.get(c.origin);
    if (!prior) continue;
    if (
      c.signedIn &&
      (!prior.signedIn || c.consentVersion > prior.consentVersion)
    )
      events.push({ type: "signin.completed", company: ref(c) });
    else if (c.accessLost && !prior.accessLost)
      events.push({ type: "access.lost", company: ref(c) });
    else if (!c.signedIn && prior.signedIn && !c.accessLost)
      events.push({ type: "signout", company: ref(c) });
    else if (prior.signingIn && !c.signingIn)
      events.push({ type: "signin.failed", company: ref(c) });
  }
  // Messages: what follows what was there before. When the start no longer
  // matches, the conversation took back what it showed.
  const kept = before.messages.length;
  const continues =
    after.messages.length >= kept &&
    before.messages.every((m, i) => same(m, after.messages[i]!));
  if (!continues) events.push({ type: "messages.replaced", state: after });
  else
    for (const message of after.messages.slice(kept))
      events.push({ type: "message", message });
  const prior = new Map(before.proposals.map((p) => [key(p), p]));
  for (const p of after.proposals) {
    const old = prior.get(key(p));
    if (!old) {
      events.push({ type: "proposal.created", proposal: p });
      continue;
    }
    if (expired(p, now) && !expired(old, since))
      events.push({ type: "proposal.expired", proposal: p });
    else if (
      p.revision !== old.revision ||
      (p.state === "superseded" && old.state !== "superseded")
    )
      events.push({ type: "proposal.replaced", proposal: p });
    else if (p.state !== old.state && !expired(p, now))
      events.push({ type: "proposal.updated", proposal: p });
  }
  if (before.active && !after.active)
    events.push({
      type: "conversation.ended",
      ...(after.keptUntil ? { keptUntil: after.keptUntil } : {}),
    });
  return events;
}

/** A stream's sign-in is checked again after this many readings. */
const CHECK_EVERY = 5;

/**
 * The conversation's events, read every `every` milliseconds, from the
 * state it is in when called: first `state`, then what changes. Stops when
 * `signal` aborts, when the conversation ends, or after `lasting`
 * milliseconds; a channel opens it again from a new `state`. `signedIn`
 * says why the request's sign-in no longer holds, if it doesn't: it is
 * asked every few readings, and the stream ends with `session.ended`.
 */
export async function* conversationEvents(
  caller: Caller,
  id: string,
  options: {
    signal?: AbortSignal;
    every?: number;
    lasting?: number;
    /** After each reading, changed or not: a stream's keep-alive. */
    onRead?: () => void;
    signedIn?: () => Promise<SessionEnded | undefined>;
  } = {},
): AsyncGenerator<AgentEvent> {
  const every = options.every ?? 2000;
  const until = Date.now() + (options.lasting ?? STREAM_MS);
  const first = await getConversation(caller, id);
  if (!first.ok) return;
  let last = first.value;
  let checked = Date.now();
  let readings = 0;
  yield { type: "state", state: last };
  while (!options.signal?.aborted && Date.now() < until && last.active) {
    // One listener a reading, gone when the reading comes: a stream of
    // five minutes would otherwise leave 150 on the request's signal.
    await new Promise<void>((resolve) => {
      const stop = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", stop);
        resolve();
      }, every);
      options.signal?.addEventListener("abort", stop, { once: true });
    });
    if (options.signal?.aborted) return;
    if (options.signedIn && ++readings % CHECK_EVERY === 0) {
      const ended = await options.signedIn();
      if (ended) {
        yield { type: "session.ended", code: ended };
        return;
      }
    }
    const next = await getConversation(caller, id);
    if (!next.ok) return;
    options.onRead?.();
    const now = Date.now();
    for (const event of eventsBetween(last, next.value, {
      since: checked,
      now,
    }))
      yield event;
    last = next.value;
    checked = now;
  }
}

// ---- Open streams ----------------------------------------------------------

/** A stream lasts at most this long; a client opens it again. */
export const STREAM_MS = 5 * 60000;
/** An account has at most this many streams open, on all its devices. */
export const MAX_STREAMS = 10;
/** A browser not signed in to an account has at most this many streams open. */
export const MAX_VISITOR_STREAMS = 4;
type Open = { id: string; until: number };
export type StreamTarget = { bucket: string; backend: Backend; limit: number };

/**
 * Holds one open-stream slot, or answers undefined when `limit` streams are
 * open already. Passing an account ID holds one of that account's
 * `MAX_STREAMS` slots in `accountBackend()`; passing `{ bucket, backend,
 * limit }` holds a slot in another bucket (such as an anonymous visitor's).
 * The list is one record, changed with a compare-and-set, so two tabs or
 * devices opening at once can't both take the last place. A stream that
 * never said it closed (its isolate went) frees its place when its time is
 * up.
 */
export async function holdStream(target: string | StreamTarget) {
  const { bucket, backend, limit } =
    typeof target === "string"
      ? {
          bucket: `account:${target}`,
          backend: accountBackend(),
          limit: MAX_STREAMS,
        }
      : target;
  const key = "streams";
  const change = async (edit: (open: Open[]) => Open[] | undefined) => {
    for (let attempt = 0; attempt < limit + 5; attempt++) {
      const entry = await backend.get(bucket, key);
      const now = Date.now();
      const open = ((entry?.value as Open[] | undefined) ?? []).filter(
        (s) => s.until > now,
      );
      const next = edit(open);
      if (!next) return false;
      if (
        await backend.put(
          bucket,
          key,
          next,
          entry?.version ?? null,
          Math.max(now, ...next.map((s) => s.until)),
        )
      )
        return true;
    }
    return false;
  };
  const id = opaqueId();
  const held = await change((open) =>
    open.length < limit
      ? [...open, { id, until: Date.now() + STREAM_MS + 60000 }]
      : undefined,
  );
  if (!held) return undefined;
  return {
    release: () =>
      change((open) => open.filter((s) => s.id !== id)).catch(() => false),
  };
}

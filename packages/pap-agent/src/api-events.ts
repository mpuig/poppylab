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
import type { Caller } from "./web";

export type AgentEvent =
  /** The conversation as it is when the stream opens: the base for what follows. */
  | { type: "state"; state: ConversationState }
  /** Something new was said, by the User, the agent or a Company. */
  | { type: "message"; message: AgentMessage }
  /** What the conversation showed was taken back: show `state` in its place. */
  | { type: "messages.replaced"; state: ConversationState }
  | { type: "signin.completed"; company: CompanyRef }
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
  | { type: "conversation.ended"; keptUntil?: number };
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

/**
 * The conversation's events, read every `every` milliseconds, from the
 * state it is in when called: first `state`, then what changes. Stops when
 * `signal` aborts, when the conversation ends, or after `lasting`
 * milliseconds; a channel opens it again from a new `state`.
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
  } = {},
): AsyncGenerator<AgentEvent> {
  const every = options.every ?? 2000;
  const until = Date.now() + (options.lasting ?? 300000);
  const first = await getConversation(caller, id);
  if (!first.ok) return;
  let last = first.value;
  let checked = Date.now();
  yield { type: "state", state: last };
  while (!options.signal?.aborted && Date.now() < until && last.active) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, every);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (options.signal?.aborted) return;
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

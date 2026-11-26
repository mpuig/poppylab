/**
 * §8.10 Direct Conversations, as the server tells the page. Every
 * `/api/chat` answer carries it and `/api/account` returns it for a reload,
 * so the page never guesses whether the User's next words are for the
 * Company or for Iris.
 */
import type { Run } from "./runtime";

/**
 * §8.10: whether the User is in a Direct Conversation, or invited to one,
 * and whether there is a conversation with the Company's agent to start
 * one from (`conversation`). A Direct Conversation names a parent, so the
 * page offers "Talk to … yourself" only with one Iris holds and can use:
 * not after a sign-out or a sign-in as another account, where Iris forgot
 * it, and not while the Company no longer takes the sign-in, when every
 * request in it would be refused until the User signs in again.
 */
export function directState(
  run: Pick<Run, "conversation" | "accountToken" | "accountUnavailable">,
) {
  const c = run.conversation;
  return {
    direct: !!(c?.direct && !c.direct.closed),
    conversation: !!c?.id && !(run.accountToken && run.accountUnavailable),
    invitation: c?.invitation?.reason ?? (c?.invitation ? "" : null),
  };
}

/**
 * What the page keeps of `directState`. Nothing to read (a new connection,
 * an ended conversation) means no Direct Conversation and no invitation.
 */
export function directView(data?: unknown) {
  const state = (data ?? {}) as Record<string, unknown>;
  return {
    direct: !!state.direct,
    invitation: typeof state.invitation === "string" ? state.invitation : null,
    canTalkDirectly: !!state.conversation,
  };
}

/**
 * §8.10 Direct Conversations, as the server tells the page. Every
 * `/api/chat` answer carries it and `/api/account` returns it for a reload,
 * so the page never guesses whether the User's next words are for the
 * Company or for Iris.
 */
import type { Run } from "./runtime";

/** §8.10: whether the User is in a Direct Conversation, or invited to one. */
export function directState(run: Pick<Run, "conversation">) {
  const c = run.conversation;
  return {
    direct: !!(c?.direct && !c.direct.closed),
    conversation: !!c?.id,
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

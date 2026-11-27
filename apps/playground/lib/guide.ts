import {
  needsYou,
  type ReviewOperation,
} from "@poppy-lab/pap-agent/operation-presentation";

/**
 * The four moves of a first run, and where the visitor is among them. The
 * playground shows this above the chat so nobody has to guess what comes
 * next: connect, sign in, ask for a change, approve it.
 */
export const guideSteps = [
  "Pick a company",
  "Sign in",
  "Ask for a change",
  "Approve it",
] as const;

export type GuideState = {
  connected: boolean;
  signedIn: boolean;
  /** The grant lets Iris propose changes, not only read. */
  canWrite: boolean;
  /** Proposals waiting for the visitor, and all proposals so far. */
  waiting: number;
  proposals: number;
  completed: number;
  /**
   * Why the waiting proposal that changed last waits again: an approval of
   * it was sent and the Company refused it, or answered with these new
   * terms, or its outcome is `unknown` and the same approval is to be sent
   * again. The first two stay when that proposal's terms ran out since and
   * none waits.
   */
  again?: "refused" | "new_terms" | "unknown" | undefined;
  /**
   * How the proposal that changed last ended, when none waits and that one
   * was not performed.
   */
  ended?: "declined" | "expired" | "refused" | "superseded" | undefined;
};
/**
 * A proposal as the page holds it: what its card shows, why its terms wait
 * again after an approval, and when it last changed (see `Operation` in
 * `runtime.ts`).
 */
export type GuideOperation = ReviewOperation & {
  changed?: number;
};

/**
 * The proposal something happened to last. The list keeps the order the
 * proposals first came in, so the time each one changed decides, and terms
 * nobody approved in time changed when they ran out. Proposals without a
 * time fall back to the list's order.
 */
function newest(operations: GuideOperation[], now: number) {
  const when = (op: GuideOperation) => {
    const expiry = Date.parse(op.expires_at) || 0;
    return op.state === "proposed" && !(expiry > now)
      ? Math.max(expiry, op.changed ?? 0)
      : (op.changed ?? 0);
  };
  return operations.reduce<GuideOperation | undefined>(
    (latest, op) => (latest && when(latest) > when(op) ? latest : op),
    undefined,
  );
}

/** The proposals' part of the guide's state, from the page's operations. */
export function guideProposals(
  operations: GuideOperation[],
  now = Date.now(),
): Pick<GuideState, "waiting" | "proposals" | "completed" | "again" | "ended"> {
  const waiting = operations.filter((op) => needsYou(op, now));
  const waits = newest(waiting, now);
  const last = newest(operations, now);
  // Terms nobody approved in time ended too, whatever the server last saw.
  const ended = last?.state === "proposed" ? "expired" : last?.state;
  return {
    waiting: waiting.length,
    proposals: operations.length,
    // "succeeded" is the state the page labels Completed.
    completed: operations.filter((op) => op.state === "succeeded").length,
    again:
      waits?.state === "uncertain"
        ? "unknown"
        : // Of the proposal that waits, or of the one whose terms ran out.
          (waits ?? (ended === "expired" ? last : undefined))?.notPerformed,
    ended:
      !waiting.length &&
      (ended === "declined" ||
        ended === "expired" ||
        ended === "refused" ||
        ended === "superseded")
        ? ended
        : undefined,
  };
}
/**
 * When the next waiting proposal runs out, if one has a clock. Nothing tells
 * the page that a proposal expired: it has to look again at that moment.
 */
export function nextExpiry(operations: GuideOperation[], now = Date.now()) {
  const times = operations
    .filter((op) => op.state === "proposed")
    .map((op) => Date.parse(op.expires_at))
    .filter((time) => time > now);
  return times.length ? Math.min(...times) : undefined;
}
export type GuideContext = {
  /** The Company's display name, once connected. */
  company?: string;
  /** Its test customers, when it is one of the lab's Companies. */
  people?: string;
  /** A change to ask for there. */
  ask?: string;
  /** No model: the demo's keyword rules answer. */
  demo: boolean;
  /** Those rules can propose that change at this Company. */
  demoCanChange: boolean;
  /** The Company offers sign-in to agents. */
  signInOffered: boolean;
};

/**
 * The step the visitor is on, 0 to 3, or 4 once a change went through and
 * no other proposal waits for them. The markers follow the proposal
 * something happened to last, as the sentence does: "Approve it" is not
 * ticked beside a sentence about a proposal that ended with nothing
 * performed, whatever went through before it.
 */
export function guideStep(state: GuideState) {
  if (!state.connected) return 0;
  if (!state.signedIn) return 1;
  if (!state.proposals) return 2;
  if (state.waiting || state.ended || !state.completed) return 3;
  return 4;
}

/** One sentence on what to do now. */
export function guideHint(state: GuideState, context: GuideContext) {
  const company = context.company ?? "the company";
  switch (guideStep(state)) {
    case 0:
      return "Pick one of the fictional companies, or enter any company’s address.";
    case 1:
      return context.signInOffered
        ? `Sign in to ${company}${context.people ? ` as ${context.people}, its test customers` : ""}. You do it on the company’s own page; Iris never sees a password.`
        : `${company} doesn’t offer sign-in to agents, so Iris can only ask its public questions.`;
    case 2:
      if (!state.canWrite)
        return "Iris can read your account. To let it propose changes, press “Request change permission”.";
      if (context.demo && !context.demoCanChange)
        return `Demo mode only reads at ${company}. To ask for a change${context.ask ? ` like “${context.ask}”` : ""}, add your own model in Model settings.`;
      return context.ask
        ? `Ask for a change. Try: “${context.ask}”`
        : "Ask Iris for a change to your account.";
    default:
      // A proposal that waits comes first, even after a change went through.
      if (state.waiting) return waitingHint(state, company);
      // Then the proposal that changed last: one that ended with nothing
      // performed is the news, even after an earlier change went through.
      if (state.ended) return endedHint(state, company);
      if (state.completed)
        return `Done: ${company} performed the change once. Its website shows the same data.`;
      return endedHint(state, company);
  }
}

/** A proposal waits: for the first time, or again after an approval. */
function waitingHint(state: GuideState, company: string) {
  switch (state.again) {
    case "refused":
      return `${company} refused the approval and performed nothing; the proposal says why. Approve it again once that is sorted out, or ask for the change again.`;
    case "new_terms":
      return `${company} answered the approval with new terms and performed nothing. Check the new terms, then approve them yourself or decline.`;
    case "unknown":
      // Operations §7: the same approval again, and no new proposal until
      // it is known whether the first one was performed.
      return `The approval was sent, but ${company} hasn’t said whether the change was made, so it may or may not have been. Retry the same approval: ${company} performs it at most once. Don’t ask for the change again until the outcome is known.`;
    default:
      return `${company} is holding the change. Check the exact terms, then approve it yourself.`;
  }
}

/** Nothing waits and nothing was performed: how the last proposal ended. */
function endedHint(state: GuideState, company: string) {
  switch (state.ended) {
    case "declined":
      return `You declined the last proposal, so Iris sent no approval to ${company} and nothing was done. Ask for the change again if you still want it.`;
    case "expired":
      // An approval sent before the terms ran out is part of what happened.
      return state.again === "refused"
        ? `The last proposal was approved, but ${company} refused the approval and performed nothing. Its terms then expired. Ask for the change again to get fresh terms.`
        : state.again === "new_terms"
          ? `${company} answered the approval with new terms and performed nothing, and the new terms expired before they were approved. Ask for the change again to get fresh terms.`
          : "The last proposal expired before it was approved, so nothing was performed. Ask for the change again to get fresh terms.";
    case "refused":
      return `${company} declined the approval and performed nothing; the proposal shows its reason, if it gave one. You can ask for a different change.`;
    case "superseded":
      return `${company} offered new terms instead of performing the last proposal. Ask for the change again to see the terms it offers now.`;
    default:
      return "The last proposal didn’t go through. Ask for the change again.";
  }
}

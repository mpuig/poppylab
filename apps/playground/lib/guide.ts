import { needsYou, type ReviewOperation } from "./operation-presentation";

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
   * Why the newest waiting proposal waits again: an approval of it was
   * sent and the Company refused it, or answered with these new terms.
   */
  again?: "refused" | "new_terms" | undefined;
  /** How the newest proposal ended, when none waits. */
  ended?: "declined" | "expired" | "refused" | "superseded" | undefined;
};
/**
 * A proposal as the page holds it: what its card shows, and why its terms
 * wait again after an approval (see `Operation` in `runtime.ts`).
 */
export type GuideOperation = ReviewOperation & {
  notPerformed?: "refused" | "new_terms";
};

/** The proposals' part of the guide's state, from the page's operations. */
export function guideProposals(
  operations: GuideOperation[],
  now = Date.now(),
): Pick<GuideState, "waiting" | "proposals" | "completed" | "again" | "ended"> {
  const waiting = operations.filter((op) => needsYou(op, now));
  const last = operations.at(-1);
  // Terms nobody approved in time ended too, whatever the server last saw.
  const ended = last?.state === "proposed" ? "expired" : last?.state;
  return {
    waiting: waiting.length,
    proposals: operations.length,
    // "succeeded" is the state the page labels Completed.
    completed: operations.filter((op) => op.state === "succeeded").length,
    again: waiting.at(-1)?.notPerformed,
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
 * no other proposal waits for them.
 */
export function guideStep(state: GuideState) {
  if (!state.connected) return 0;
  if (!state.signedIn) return 1;
  if (!state.proposals) return 2;
  if (state.waiting || !state.completed) return 3;
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
    default:
      return `${company} is holding the change. Check the exact terms, then approve it yourself.`;
  }
}

/** Nothing waits and nothing was performed: how the last proposal ended. */
function endedHint(state: GuideState, company: string) {
  switch (state.ended) {
    case "declined":
      return `You declined the last proposal, so nothing was sent to ${company}. Ask for the change again if you still want it.`;
    case "expired":
      return "The last proposal expired before it was approved, so nothing was performed. Ask for the change again to get fresh terms.";
    case "refused":
      return `${company} declined the approval and performed nothing; the proposal shows its reason, if it gave one. You can ask for a different change.`;
    case "superseded":
      return `${company} offered new terms instead of performing the last proposal. Ask for the change again to see the terms it offers now.`;
    default:
      return "The last proposal didn’t go through. Ask for the change again.";
  }
}

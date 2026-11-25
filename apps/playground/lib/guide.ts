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
};
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

/** The step the visitor is on, 0 to 3, or 4 once a change went through. */
export function guideStep(state: GuideState) {
  if (!state.connected) return 0;
  if (!state.signedIn) return 1;
  if (!state.proposals) return 2;
  if (!state.completed) return 3;
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
    case 3:
      return state.waiting
        ? `${company} is holding the change. Check the exact terms, then approve it yourself.`
        : "The last proposal didn’t go through. Ask for the change again.";
    default:
      return `Done: ${company} performed the change once. Its website shows the same data.`;
  }
}

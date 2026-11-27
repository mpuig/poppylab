/**
 * What waits for the User, across their conversations: proposals to
 * approve or decline, sign-ins under way or lost, and the questions the
 * agent asked that only the next message answers. A client lists these
 * as an inbox (`GET /api/v1/pending`), and the playground's page lists the
 * same for the conversation it shows from its own state.
 *
 * Each item says what it is in the agent's own words, made by fixed rules
 * from what the agent holds: never a Company's summary, never a token,
 * code or OAuth `state`. Plain data and no I/O, safe for a page to load;
 * a stored run is read in `pending-runs.ts`.
 */
import { firstChange, proposalNoun, questionCents } from "./approval-question";
import {
  money,
  needsYou,
  type ReviewOperation,
} from "./operation-presentation";

/** A Company as an item names it: by origin, with its name. */
export type CompanyRef = { origin: string; name: string };

/** One thing that waits for the User. */
export type PendingItem = {
  /** The conversation it is in. */
  conversation: string;
  /**
   * `proposal`: a Company holds a change for the User's approval.
   * `signin`: a sign-in to finish, or to do again. `question`: the agent
   * asked, and the next message answers.
   */
  kind: "proposal" | "signin" | "question";
  /** The Company it is at, when it is at one. */
  company?: CompanyRef;
  /** What it is, in the agent's words: "Approve or decline the $88.00 change". */
  text: string;
  /** ISO 8601: when it stops waiting on its own, if it does. */
  expiresAt?: string;
  /** For a proposal: its ID and the revision to approve. */
  proposal?: { id: string; revision: string };
};

/** The agent's question, as a page reads it from its buttons or a run holds it. */
export type OpenAsk =
  | { signin: { company: string; access: "read" | "write" } }
  | { resume: string; until?: number }
  | { invitation: string }
  | { signout: string[] }
  | { which: true }
  | { removing: string[] };

/** What one Company of a conversation holds that can wait for the User. */
export type PendingCompany = {
  company: CompanyRef;
  operations: readonly ReviewOperation[];
  /** A sign-in under way there, until this time (ms). */
  signingIn?: number | true;
  /** The Company no longer takes the sign-in: sign in again. */
  accessLost?: boolean;
};

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * "the $88.00 change", "the transfer", "the change of plan from Time of
 * use to Flat rate": one proposal, its Company aside.
 */
function proposalWords(op: ReviewOperation) {
  const amount = questionCents(op);
  const currency = op.terms?.currency;
  const noun = proposalNoun(op);
  const priced =
    amount !== undefined &&
    typeof currency === "string" &&
    /^[A-Z]{3}$/.test(currency);
  if (priced) return `the ${money(amount, currency)} ${noun}`;
  const what = noun === "change" ? firstChange(op) : undefined;
  return what ? `the change of ${what}` : `the ${noun}`;
}

/** What a waiting proposal asks of the User. */
export function proposalText(op: ReviewOperation) {
  return op.state === "uncertain"
    ? `Check ${proposalWords(op)} you approved: its outcome is unknown`
    : `Approve or decline ${proposalWords(op)}`;
}

/**
 * Everything that waits in one conversation: its proposals in the order
 * they came, then sign-ins, then the open question. An ask about a sign-in
 * already under way at that Company is listed once, as the sign-in.
 */
export function pendingItems(
  conversation: string,
  companies: readonly PendingCompany[],
  ask: OpenAsk | undefined,
  now = Date.now(),
): PendingItem[] {
  const items: PendingItem[] = [];
  for (const { company, operations } of companies)
    for (const op of operations)
      if (needsYou(op, now))
        items.push({
          conversation,
          kind: "proposal",
          company,
          text: proposalText(op),
          // An approval with an unknown outcome waits until it is known.
          ...(op.state === "proposed" ? { expiresAt: op.expires_at } : {}),
          proposal: { id: op.operation_id, revision: op.revision },
        });
  const signing = new Set<string>();
  for (const { company, signingIn, accessLost } of companies) {
    if (signingIn && (signingIn === true || signingIn > now)) {
      signing.add(company.origin);
      items.push({
        conversation,
        kind: "signin",
        company,
        text: "Finish signing in on the company’s own page",
        ...(signingIn !== true ? { expiresAt: iso(signingIn) } : {}),
      });
    } else if (accessLost)
      items.push({
        conversation,
        kind: "signin",
        company,
        text: "Sign in again: the company no longer takes your sign-in",
      });
  }
  const at = (origin: string) =>
    companies.find((c) => c.company.origin === origin)?.company;
  if (ask && "signin" in ask && !signing.has(ask.signin.company)) {
    const company = at(ask.signin.company);
    if (company)
      items.push({
        conversation,
        kind: "signin",
        company,
        text:
          ask.signin.access === "write"
            ? "Give change permission, if you want the change"
            : "Sign in, read only, to go on",
      });
  }
  if (ask && "resume" in ask && (ask.until === undefined || ask.until > now)) {
    const company = at(ask.resume);
    if (company)
      items.push({
        conversation,
        kind: "question",
        company,
        text: "Say whether to go on with your request",
        ...(ask.until !== undefined ? { expiresAt: iso(ask.until) } : {}),
      });
  }
  if (ask && "invitation" in ask) {
    const company = at(ask.invitation);
    if (company)
      items.push({
        conversation,
        kind: "question",
        company,
        text: "Answer the invitation to talk with it directly",
      });
  }
  if (ask && "signout" in ask) {
    const named = ask.signout.flatMap((origin) => at(origin) ?? []);
    items.push({
      conversation,
      kind: "question",
      ...(named.length === 1 ? { company: named[0]! } : {}),
      text: "Say whether to sign out",
    });
  }
  if (ask && "removing" in ask) {
    const named = ask.removing.flatMap((origin) => at(origin) ?? []);
    items.push({
      conversation,
      kind: "question",
      ...(named.length === 1 ? { company: named[0]! } : {}),
      text: "Say whether to remove it from the conversation",
    });
  }
  if (ask && "which" in ask)
    items.push({
      conversation,
      kind: "question",
      text: "Say which company your request is for",
    });
  return items;
}

/**
 * The agent's channel-neutral API: conversations, messages in and out,
 * proposals and their decisions, sign-in, and the events that come later.
 * A channel (the playground's /api/v1, later an MCP server, a messaging
 * bot or a mobile app) calls these with a `Caller`, which says who the
 * user is, and gets typed results back. The playground's page keeps its
 * own wire contract (`chat`, `account`); these speak in plainer terms over
 * the same turns, so both see the same conversations.
 *
 * `openapi.ts` describes these as HTTP (`api-http.ts`).
 */
import { accountAction, accountReading } from "./account";
import type { ModelChoiceInput } from "./api-contract/index.ts";
import type { TurnStream } from "./answer-stream";
import { chatTurn } from "./chat";
import type { Answer, Choice } from "./company-commands";
import type { AgentStep } from "./agent-steps";
import { connectCompany } from "./connecting";
import { originOf, type CompanyRef } from "./connections";
import type { ConnectionView, FormerView } from "./conversation-view";
import { localOrigins, serving } from "./deployment";
import { overBudget } from "./limits";
import { spokenProposal } from "./approval-question";
import { hideLinkSecrets } from "./link-display";
import { spokenText } from "./spoken";
import { languageOf, type Language } from "./language";
import { notSaved } from "./run-size";
import type { PendingItem } from "./pending";
import { pendingFor } from "./pending-runs";
import {
  createRun,
  readConversation as storedConversation,
  releaseRun,
} from "./runs";
import type { Operation, Run } from "./runtime";
import type { Caller, Reply } from "./web";
import { PapDiscoveryError } from "@poppy-lab/pap-core";

export type { Answer, Choice, CompanyRef, PendingItem };

/** What went wrong, in words a channel can show the User as they are. */
export type ApiError = { status: number; code?: string; error: string };
export type Result<T> = { ok: true; value: T } | ({ ok: false } & ApiError);

/** One of the conversation's Companies, and where the User stands there. */
export type CompanyState = CompanyRef & {
  url: string;
  signedIn: boolean;
  /** The permissions granted there, as the Company names them. */
  scopes?: string;
  /** A sign-in is under way there: started, and not back within five minutes. */
  signingIn: boolean;
  /** Goes up with each completed sign-in there. */
  consentVersion: number;
  /** The Company no longer takes the sign-in: sign in again. */
  accessLost: boolean;
  /** §8.10: the User is talking with the Company directly, or is asked to. */
  direct: { open: boolean; invitation: string | null };
};

/**
 * A proposal a Company holds for the User's approval (Operations v3), with
 * its exact terms. Nothing is performed until the User approves it.
 */
export type Proposal = {
  id: string;
  company: CompanyRef;
  revision: string;
  /** The Company's own words: show them as the Company's, never as the agent's. */
  summary?: string;
  terms: Record<string, unknown>;
  state: Operation["state"];
  expiresAt: string;
  /** How it ended, in the Company's words or the agent's. */
  result?: string;
  /**
   * What it is, said aloud in the agent's words, from its terms: the
   * Company, what it wants and how much. Never the Company's summary.
   */
  spoken: string;
};

/** Something said in the conversation. */
export type AgentMessage = {
  /**
   * In a turn's answer streamed with `Accept: text/event-stream`, on each
   * of the agent's messages: the ID its `message.delta` events named.
   */
  id?: string;
  /**
   * `user`: the User's words (or the label of the choice they pressed).
   * `agent`: the agent's answer; with `company`, to a turn with that
   * Company, and without, in its own voice about the conversation.
   * `company`: a Company's own content (its agent's reply, a note), shown
   * as the Company's words.
   */
  from: "user" | "agent" | "company";
  text: string;
  /**
   * The agent's words in a form to read aloud: one or two short
   * sentences, with no markdown or identifier and amounts as they are
   * said. Made by fixed rules from the same words or facts, never by a
   * model. Only on the agent's messages: a Company's are its own.
   */
  spoken?: string;
  /** The Company it came from or the turn was with. */
  company?: CompanyRef;
  /** A turn with several Companies: each, in the order the task used them. */
  using?: CompanyRef[];
  /** For a Company's content: who there wrote it. */
  author?: string;
  /** Said in a Direct Conversation (§8.10), between the User and the Company. */
  direct?: boolean;
  /**
   * Quick replies: send one's `answer` to `answerChoice`, never its label
   * as words. The User can also answer in words, with `sendMessage`. A
   * `signin` answer is the client's to carry out: open `startSignIn` for
   * that Company and access.
   */
  choices?: Choice[];
  /** The addresses in the text, with any token or signature in them hidden. */
  links?: string[];
  /** What the agent did for this answer. */
  steps?: AgentStep[];
  /** The Companies' exact answers behind the text, as JSON. */
  data?: string;
  /**
   * The proposals that arrived with this message, at the revision they
   * came with: a client that shows a proposal as a card shows it after
   * this message, and leaves it there once it is decided. Find each in
   * `ConversationState.proposals` by its Company and ID.
   */
  proposals?: ProposalRef[];
};

/** One proposal at one Company, at the exact revision a question named. */
export type ProposalRef = {
  company: string;
  proposal: string;
  revision: string;
};

/** A conversation as a channel shows it. */
export type ConversationState = {
  id: string;
  /** Running; otherwise ended and read-only until `keptUntil`. */
  active: boolean;
  keptUntil?: number;
  companies: CompanyState[];
  /** Companies removed from it, whose words it still shows. */
  removed: CompanyRef[];
  messages: AgentMessage[];
  /** Every Company's proposals, waiting or ended. */
  proposals: Proposal[];
};

/** What a message or an answer did. */
export type TurnResult = {
  conversation: string;
  /** What this turn added, the User's line first. */
  messages: AgentMessage[];
  /**
   * The conversation took back what it showed before this turn (a
   * Company stopped taking the sign-in, or a Company was removed): show
   * `state.messages` in place of what is on screen.
   */
  replaced: boolean;
  state: ConversationState;
};

/**
 * The model a turn is asked of; demo mode when none is given. `free` is
 * the deployment's own small model (`free-model.ts`), which takes no key
 * but a Turnstile token for each turn; without a good one, or past its
 * limits, the turn runs in demo mode and says why.
 */
export type ModelChoice = ModelChoiceInput;

// ---- Mapping ---------------------------------------------------------------

type PageEntry = {
  role: "user" | "assistant" | "company";
  content: string;
  from?: CompanyRef;
  using?: CompanyRef[];
  author?: string;
  direct?: true;
  choices?: Choice[];
  steps?: AgentStep[];
  data?: string;
  spoken?: string;
  proposals?: ProposalRef[];
};
const LINK = /https?:\/\/[^\s<>"')\]]+/gi;
/** A kept entry of the page's, as a message any channel can show. */
export function messageOf(
  entry: PageEntry,
  language: Language = "en",
): AgentMessage {
  const links = [...entry.content.matchAll(LINK)].map((m) =>
    hideLinkSecrets(m[0]),
  );
  return {
    from:
      entry.role === "assistant"
        ? "agent"
        : entry.role === "company"
          ? "company"
          : "user",
    text: entry.content,
    // The agent's own words only: a Company's are never rewritten.
    ...(entry.role === "assistant"
      ? { spoken: entry.spoken ?? spokenText(entry.content, language) }
      : {}),
    ...(entry.from ? { company: entry.from } : {}),
    ...(entry.using?.length ? { using: entry.using } : {}),
    ...(entry.author ? { author: entry.author } : {}),
    ...(entry.direct ? { direct: true } : {}),
    ...(entry.choices?.length ? { choices: entry.choices } : {}),
    ...(links.length ? { links } : {}),
    ...(entry.steps?.length ? { steps: entry.steps } : {}),
    ...(entry.data ? { data: entry.data } : {}),
    ...(entry.proposals?.length
      ? {
          proposals: entry.proposals.map(({ company, proposal, revision }) => ({
            company,
            proposal,
            revision,
          })),
        }
      : {}),
  };
}
const proposalOf = (
  company: CompanyRef,
  op: Operation,
  language: Language = "en",
): Proposal => ({
  id: op.operation_id,
  company,
  revision: op.revision,
  ...(op.summary ? { summary: op.summary } : {}),
  terms: op.terms ?? {},
  state: op.state,
  expiresAt: op.expires_at,
  ...(op.result?.summary ? { result: op.result.summary } : {}),
  spoken: spokenProposal(op, company.name, language),
});
/**
 * A sign-in waiting for its callback there, and only that. The page's
 * `authPending` also counts a turn under way, which isn't a sign-in.
 */
const waitingSignIn = (run: Run, origin: string) => {
  const auth = run.connections.find((c) => originOf(c) === origin)?.auth;
  return !!auth && auth.expires > Date.now();
};
const companyOf = (c: ConnectionView, run?: Run): CompanyState => ({
  origin: c.origin,
  name: c.name,
  url: c.url ?? "",
  signedIn: c.signedIn,
  ...(c.scopes ? { scopes: c.scopes } : {}),
  signingIn: run ? waitingSignIn(run, c.origin) : c.authPending,
  consentVersion: c.consentVersion,
  accessLost: !!c.recovery,
  direct: {
    open: !!c.directConversation?.direct,
    invitation: c.directConversation?.invitation ?? null,
  },
});
type View = {
  missing: boolean;
  readOnly: boolean;
  keptUntil?: number;
  connections: ConnectionView[];
  former: FormerView[];
  history: PageEntry[];
};
/** The reload's answer (`readAccount`) as a channel shows it. */
export function stateOf(id: string, view: View, run?: Run): ConversationState {
  const language = languageOf(run);
  return {
    id,
    active: !view.readOnly,
    ...(view.keptUntil ? { keptUntil: view.keptUntil } : {}),
    companies: view.connections.map((c) => companyOf(c, run)),
    removed: view.former.map(({ origin, name }) => ({ origin, name })),
    messages: view.history.map((entry) => messageOf(entry, language)),
    proposals: [
      ...view.connections.flatMap((c) =>
        c.operations.map((op) =>
          proposalOf({ origin: c.origin, name: c.name }, op, language),
        ),
      ),
      ...view.former.flatMap((f) =>
        f.operations.map((op) =>
          proposalOf({ origin: f.origin, name: f.name }, op, language),
        ),
      ),
    ],
  };
}

const failure = (reply: Reply): { ok: false } & ApiError => {
  const body = (reply.body ?? {}) as { code?: unknown; error?: unknown };
  return {
    ok: false,
    status: reply.status,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
    error:
      typeof body.error === "string"
        ? body.error
        : "The request failed. Try again in a moment.",
  };
};
const refused = (
  status: number,
  code: string,
  error: string,
): { ok: false } & ApiError => ({ ok: false, status, code, error });
const NOT_FOUND = refused(
  404,
  "conversation_not_found",
  "There is no such conversation for this user. Start a new one.",
);

// ---- Conversations ---------------------------------------------------------

/** The conversation as it is now. */
export async function getConversation(
  caller: Caller,
  id: string,
): Promise<Result<ConversationState>> {
  const { reply, run } = await accountReading(id, caller);
  if (reply.status !== 200) return failure(reply);
  const view = reply.body as View;
  if (view.missing) return NOT_FOUND;
  return { ok: true, value: stateOf(id, view, run) };
}

/**
 * A new conversation, with no Company or with the one at `company`, which
 * is discovered and connected signed out, as the page's first card does.
 */
export async function startConversation(
  caller: Caller,
  input: { company?: string } = {},
): Promise<Result<ConversationState>> {
  if (!serving())
    return refused(
      403,
      "disabled",
      "The agent is disabled on this deployment.",
    );
  if (!caller.authentic)
    return refused(403, "forbidden", "Same-origin requests required.");
  if (
    input.company !== undefined &&
    (typeof input.company !== "string" ||
      !input.company.trim() ||
      input.company.length > 2048)
  )
    return refused(400, "invalid_request", "Enter a valid Company URL.");
  const user = caller.user(true);
  const limited = await overBudget(caller.ip, user, "discover");
  if (limited) return failure(limited);
  const held = await createRun(user);
  if (input.company !== undefined) {
    let added: Awaited<ReturnType<typeof connectCompany>>;
    try {
      added = await connectCompany(held.run, input.company, localOrigins);
    } catch (error) {
      await releaseRun(user, held).catch(() => {});
      return refused(
        422,
        "discovery_failed",
        error instanceof PapDiscoveryError
          ? error.message
          : "Discovery failed safely.",
      );
    }
    if ("code" in added) {
      await releaseRun(user, held).catch(() => {});
      return refused(409, added.code, added.error);
    }
  }
  try {
    await releaseRun(user, held);
  } catch (error) {
    const { status, code, error: words } = notSaved(error);
    return refused(status, code, words);
  }
  return getConversation(caller, held.id);
}

/** Whether `id` names a conversation of this user that is still running. */
async function running(
  caller: Caller,
  id: string,
): Promise<({ ok: false } & ApiError) | undefined> {
  const user = caller.user();
  const run = user ? await storedConversation(user, id) : undefined;
  if (!run) return NOT_FOUND;
  return undefined;
}

/** A turn of the chat, in the plainer terms: what it added, and the state. */
async function turn(
  caller: Caller,
  id: string,
  body: Record<string, unknown>,
  options: TurnOptions = {},
): Promise<Result<TurnResult>> {
  const gone = await running(caller, id);
  if (gone) return gone;
  const done = await chatTurn(
    {
      read: async () => ({ ...body, companies: true }),
      conversation: id,
      stream: options.stream,
    },
    caller,
  );
  if (done.status !== 200) return failure(done);
  const state = await getConversation(caller, done.conversation ?? id);
  if (!state.ok) return state;
  const doneBody = done.body && typeof done.body === "object" ? done.body : {};
  const replaced = "history" in doneBody;
  const language = done.language ?? "en";
  const messages =
    done.entries !== undefined
      ? done.entries.map((entry) => messageOf(entry, language))
      : state.value.messages;
  return {
    ok: true,
    value: {
      conversation: state.value.id,
      messages,
      replaced,
      state: state.value,
    },
  };
}
const model = (choice: ModelChoice | undefined) => ({
  provider: choice?.provider ?? "demo",
  ...(choice?.apiKey !== undefined ? { apiKey: choice.apiKey } : {}),
  ...(choice?.model !== undefined ? { model: choice.model } : {}),
  ...(choice?.turnstile !== undefined ? { turnstile: choice.turnstile } : {}),
});

/**
 * How a channel takes a turn's answer besides its result: `stream` is
 * given the model's answer as it is written (`answer-stream.ts`).
 */
export type TurnOptions = { stream?: TurnStream | undefined };

/**
 * The User's message. `company` is the Company the User chose for it, by
 * origin; without it the agent works out which, or asks.
 */
export async function sendMessage(
  caller: Caller,
  id: string,
  input: { text: string; company?: string; model?: ModelChoice },
  options: TurnOptions = {},
): Promise<Result<TurnResult>> {
  if (typeof input.text !== "string")
    return refused(400, "invalid_request", "Send the message as text.");
  return turn(
    caller,
    id,
    {
      message: input.text,
      ...(input.company !== undefined ? { company: input.company } : {}),
      ...model(input.model),
    },
    options,
  );
}

/** The answer a choice carries, in place of a message: never its label. */
export async function answerChoice(
  caller: Caller,
  id: string,
  input: { answer: Answer; model?: ModelChoice },
  options: TurnOptions = {},
): Promise<Result<TurnResult>> {
  return turn(
    caller,
    id,
    { answer: input.answer, ...model(input.model) },
    options,
  );
}

/**
 * Everything that waits for the user in their running conversations: a
 * proposal to approve or decline, a sign-in to finish or do again, a
 * question the agent asked. For a client's inbox; each item names its
 * conversation, to open it there.
 */
export async function listPending(
  caller: Caller,
): Promise<Result<{ items: PendingItem[] }>> {
  if (!serving())
    return refused(
      403,
      "disabled",
      "The agent is disabled on this deployment.",
    );
  const user = caller.user();
  return { ok: true, value: { items: user ? await pendingFor(user) : [] } };
}

// ---- Proposals and sign-in -------------------------------------------------

async function act(
  caller: Caller,
  id: string,
  body: Record<string, unknown>,
): Promise<Result<Record<string, unknown>>> {
  const gone = await running(caller, id);
  if (gone) return gone;
  const done = await accountAction(
    { read: async () => body, conversation: id, shown: null },
    caller,
  );
  if (done.status !== 200) return failure(done);
  return { ok: true, value: done.body as Record<string, unknown> };
}

/**
 * The User's decision on a proposal, found by its Company and its ID. An
 * approval covers exactly `revision`; the Company performs it at most
 * once. A decline stays here: nothing is sent to the Company.
 */
export async function decideProposal(
  caller: Caller,
  id: string,
  input: {
    proposal: string;
    company: string;
    revision: string;
    decision: "approve" | "decline";
  },
): Promise<Result<{ proposal: Proposal; state: ConversationState }>> {
  if (input.decision !== "approve" && input.decision !== "decline")
    return refused(400, "invalid_request", "Decide approve or decline.");
  const done = await act(caller, id, {
    action: input.decision,
    company: input.company,
    id: input.proposal,
    revision: input.revision,
  });
  if (!done.ok) return done;
  const state = await getConversation(caller, id);
  if (!state.ok) return state;
  const op = done.value.operation as Operation;
  const company = state.value.companies.find((c) =>
    state.value.proposals.some(
      (p) => p.id === op.operation_id && p.company.origin === c.origin,
    ),
  ) ?? { origin: input.company, name: input.company };
  return {
    ok: true,
    value: {
      proposal: proposalOf({ origin: company.origin, name: company.name }, op),
      state: state.value,
    },
  };
}

/**
 * Starts a sign-in at one of the conversation's Companies (§4.2): the
 * User opens `url`, the Company's own consent page, and the agent never
 * sees a password. `signin.completed` follows on the events once it
 * comes back. `write` asks for change permission too.
 */
export async function startSignIn(
  caller: Caller,
  id: string,
  input: { company: string; access?: "read" | "write" },
): Promise<Result<{ url: string }>> {
  const done = await act(caller, id, {
    action: "signin",
    company: input.company,
    access: input.access ?? "read",
  });
  if (!done.ok) return done;
  return { ok: true, value: { url: String(done.value.url) } };
}

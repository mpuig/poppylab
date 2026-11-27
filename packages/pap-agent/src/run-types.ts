import type { SessionKey } from "@poppy-lab/pap-client";
import type { DiscoveredCompany, TasksResponse } from "@poppy-lab/pap-core";
import type { JWK } from "jose";
import type { Asking } from "./chat-answers";
import type { Removing } from "./company-commands";
import type { ConversationState } from "./conversations";
import type { KeptLine } from "./inspector-log";
import type { Language } from "./language";
import type { OfferedTool } from "./routing";
import type { TranscriptEntry } from "./transcript";

/**
 * An Operations v3 operation (§3) plus this playground's local state. The
 * Company keeps no state for us: `state` records only what Poppy observed,
 * and `request` is the exact request to resend with the User's approval.
 */
export type Operation = {
  operation_id: string;
  revision: string;
  /** Optional in Operations v3; `terms` are always there. */
  summary?: string;
  terms?: Record<string, unknown>;
  expires_at: string;
  /**
   * `declined`: by the User, locally. `refused`: the Company declined it.
   * `superseded`: the Company answered its approval with another operation.
   */
  state:
    | "proposed"
    | "succeeded"
    | "declined"
    | "refused"
    | "expired"
    | "superseded"
    | "uncertain";
  result?: { summary: string } | null;
  /**
   * An approval was sent, nothing was performed, and terms wait for the
   * User: the Company `refused` the request, or answered it with these
   * `new_terms`. Gone once the operation changes or another approval is sent.
   */
  notPerformed?: "refused" | "new_terms";
  /**
   * When this last changed here, in milliseconds: its terms came, the User
   * declined it, or an approval of it was sent. The operations keep the
   * order they first came in, so the guide reads the newest from this.
   */
  changed?: number;
  /**
   * The approval as first sent (Operations v3 §6), reused for a retry: who
   * approved (the User, or Iris on the User's standing instruction), when,
   * and the ledger reference shown to the Company.
   */
  approval?: {
    approver?: "user" | "agent";
    approved_at: number;
    reference: string;
    /** How the User answered, when it wasn't a tap: `typed`, in words. */
    input_type?: "typed";
  };
  /** Who approved a performed operation, and the rule it was approved under. */
  approvedBy?: {
    approver: "user" | "agent";
    rule?: string;
    reference?: string;
  };
  /**
   * The Company declined an agent approval (§6): the User decides now, with
   * a new approval of their own. Iris never resends the declined one.
   */
  agentDeclined?: { reason?: string };
  /**
   * The Company answered an agent approval with a new revision (§5). Iris
   * doesn't approve the new terms on the same instruction: the User decides.
   */
  agentSuperseded?: true;
  /**
   * Why the User's standing instruction left these terms to them, as the
   * Inspector's line said it (`notAppliedLine`). Kept so the line is
   * written once for each reason, whatever the page asks after a reload.
   */
  notApplied?: string;
  /**
   * Proposed in the User's Direct Conversation (§8.10), which the model
   * doesn't read. Kept once that thread is over, so the model is never told
   * how the operation ended in the Company's words.
   */
  direct?: true;
  /** An API request to resend, or the conversation the operation is in (§8). */
  request?:
    | { url: string; body: unknown; conversation?: undefined }
    | { conversation: { endpoint: string; id: string }; url?: undefined };
};
/**
 * What Iris holds for one Company over PAP 1.0: the Session, the sign-in and
 * everything read or proposed there. `sessionId` is the client-chosen `sid`;
 * `user` the User ID for the Company's identifier. The access/refresh tokens
 * are plain OAuth and independent of the Session. Every function that talks
 * to a Company takes its connection, so a token only ever goes to the
 * Company it was issued by.
 */
export type Connection = {
  /** The Company's address, as it was connected. Its origin names it. */
  url: string;
  /**
   * The conversation's visitor and demo epoch, copied here so that the User
   * ID for this Company can be worked out from the connection alone
   * (`userFor`).
   */
  visitor?: string;
  epoch?: string;
  user: string;
  sessionId?: string;
  /** Delegated key for this User ID only (§5.2). */
  sessionKey?: SessionKey;
  /** Approvals Iris sent on the User's standing instruction, for its limits. */
  agentApprovals?: Array<{ at: number; cents: number }>;
  /** §9: the tasks response for the current Session only. */
  tasks?: { sid: string; value: TasksResponse };
  /**
   * The tools its last turn loaded, by name and description, for working
   * out which Company the next turn is for (`routing.ts`).
   */
  offered?: OfferedTool[];
  /** §9.3: tasks reported in this Session, so each is reported once. */
  reported?: { sid: string; tasks: string[] };
  /** §4.5: each service's own resource, from its metadata (absent = default token). */
  services?: Record<string, { resource?: string; until: number }>;
  /** §4.5: tokens for services with their own resource, or that refuse one. */
  resourceTokens?: Record<
    string,
    | { value: string; type: "DPoP" | "Bearer"; expires: number }
    | { unavailable: true; until: number }
  >;
  /** The OpenAPI server base, the service its tools call. */
  apiBase?: string;
  /** DPoP key for access tokens, when the issuer binds them. */
  dpop?: JWK;
  token?: string;
  tokenType?: "DPoP" | "Bearer";
  tokenExpires?: number;
  accountToken?: string;
  consentVersion?: number;
  accountUnavailable?: boolean;
  scopes?: string;
  /**
   * Use FDX: the User chose to declare `poppylab.dev/fdx` v1 and use its
   * FDX-shaped tools at this Company (off when absent). Fixed for a Session
   * (§3.4): changing it starts a new one.
   */
  fdx?: boolean;
  /** `poppylab.dev/fdx` v1: the consent id from the last token response. */
  fdxConsent?: string;
  /**
   * Use ESPI: the same choice for `poppylab.dev/espi` v1 and its
   * ESPI-shaped tools, at a Company that lists it.
   */
  espi?: boolean;
  /**
   * `poppylab.dev/espi` v1: the subscription (`resourceURI`) and its
   * authorization (`authorizationURI`) from the last token response, each
   * checked against the entry (`espiUri`).
   */
  espiResourceUri?: string;
  espiAuthorizationUri?: string;
  company?: DiscoveredCompany;
  auth?:
    | {
        state: string;
        verifier: string;
        expires: number;
        issuer: string;
        scopes: string;
        dpop?: JWK;
      }
    | undefined;
  operations?: Record<string, Operation>;
  /**
   * For each of its proposals that could hold another Company's account
   * data, by operation ID: the origins of the Companies whose accounts
   * could be in it (`operation-store.ts`). A reset of one of those
   * accounts takes the proposal back (`transcript.ts`). Kept beside the
   * proposals and not in them: the page is sent each proposal whole, and
   * is never told whose accounts are in anything.
   */
  operationAccounts?: Record<string, string[]>;
  /** The conversation with the Company's own agent (§8), if any. */
  conversation?: ConversationState;
  /**
   * The model's turns from before any access to this Company's account:
   * safe to go back to when a sign-in may be for another account.
   */
  publicHistory?: Turn[];
  /**
   * The User's request a turn stopped for want of a sign-in here, or of
   * the change permission (`access`), kept so that once it completes the
   * agent can ask whether to go on with it (`chat-answers.ts`). One at a
   * time: a newer turn here replaces it, and an answer, a sign-out or the
   * conversation's end takes it away. `at` is when it was asked.
   */
  resume?: { asked: string; access: "read" | "write"; at: number };
};
/**
 * One turn of the model's context. `company` is the origin of the Company
 * the turn was with, so a sign-in or sign-out there takes back its turns
 * and no other Company's. `accounts` lists the Companies whose accounts
 * could be in the turn (`connections.ts`): a sign-in or sign-out at any
 * of them takes it back too. The model is sent the role and the words only.
 */
export type Turn = {
  role: "user" | "assistant";
  content: string;
  company?: string;
  accounts?: string[];
};
/**
 * A Company the conversation was connected to and no longer is. Its name
 * stays for what the page still shows from it, and so does an approval
 * that was sent there and whose outcome isn't known, without the request:
 * with no Session or sign-in left it can't be sent again from here.
 */
export type FormerConnection = {
  url: string;
  name: string;
  operations?: Record<string, Operation>;
};
/**
 * One conversation of a visitor with Iris: its lifetime and its words, and
 * a connection for each Company it works with. The words are the
 * conversation's and are kept in the order they were said; what belongs to
 * a Company (its Session, sign-in and proposals) is in that Company's
 * connection and nowhere else.
 */
export type Run = {
  /** Runs of an earlier protocol version are discarded, not migrated. */
  protocol?: "1.0";
  /** SHA-256 of the visitor cookie: the owner of this run. */
  visitor?: string;
  /** While `busy`, the lock lapses after this time (a crashed request). */
  busyUntil?: number;
  expires: number;
  /** The conversation's turns with Iris, whichever Company they went to. */
  calls: number;
  busy: boolean;
  /** One per Company, in the order they were connected. */
  connections: Connection[];
  /** The Companies that were removed from the conversation. */
  former?: FormerConnection[];
  history: Turn[];
  /**
   * What the page shows: `history` is cut to the model's last ten turns,
   * this keeps the conversation, with the Company content and each
   * answer's label, steps and data that the model is never sent. It resets
   * wherever `history` does. Each entry says which Company it came from.
   */
  transcript?: TranscriptEntry[];
  /**
   * The Inspector's "Session & API calls" lines, kept as the page lists
   * them, each with the Company it was written for.
   */
  log?: KeptLine[];
  /**
   * A request Iris couldn't tell the Company of, kept while it asks the
   * User which one: their next message can say it (`routing.ts`).
   */
  waiting?: string;
  /**
   * A removal Iris asked the User to confirm, kept while it asks: their
   * next message, or a button, says yes or no (`company-commands.ts`).
   */
  removing?: Removing;
  /**
   * The agent's own question that waits for the User's answer: approve a
   * proposal, sign in, go on with a request, and the like
   * (`chat-answers.ts`). Only the next message can answer it, by a button
   * or in the User's own words; any other message drops it.
   */
  asking?: Asking;
  /**
   * The language the agent's own lines are in: the one the User writes
   * in, read from their typed messages alone (`language.ts`). English
   * until they write in another.
   */
  language?: Language;
  /** When the conversation started, and its first request, for the list. */
  created?: number;
  title?: string;
  /** The visitor's demo epoch when it started (see `userFor`). */
  epoch?: string;
  /**
   * An ended conversation: readable until `keepUntil`, with every token,
   * key and Session removed. It can't be continued.
   */
  archived?: boolean;
  keepUntil?: number;
};

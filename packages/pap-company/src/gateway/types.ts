/**
 * Shared types and constants of the Company gateway. The modules under this
 * directory each own one section of the protocol and share a `Ctx`
 * (`context.ts`); `createCompany` (`../gateway.ts`) composes them.
 */
import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import type { Approval } from "@poppy-lab/pap-client/core";
import type { Action, OperationRecord, Outcome } from "../approvals.ts";

export type Session = {
  client: string;
  user: string;
  agent?: string;
  expires: number;
  account?: string;
  grant?: string;
  scopes?: string;
  /** The request declares Operations version 3 in `Poppy-Extensions`. */
  operations?: boolean;
};
export type Grant = {
  account: string;
  /** The (client, user) tenant that first used it; nobody else can. */
  holder?: string;
  /** The browser that approved its consent (hash of `pap_browser`). */
  browser?: string;
  id: string;
  client: string;
  scopes: string;
  expires: number;
  /** §4.4: the DPoP key the refresh token was issued with (thumbprint). */
  dpop?: string;
};
export type Token = {
  client: string;
  binding: string;
  expires: number;
  accountId: string;
  scopes: string;
  grant: string;
};
export type GatewayState = {
  sessions: Record<string, Session>;
  tokens: Record<string, Token>;
  grants: Record<string, Grant>;
  replays: Array<[string, number]>;
  tenants: Record<string, Tenant>;
  /** Pending consent pages by nonce, and one-time codes by hash. */
  consents?: Record<string, Consent>;
  codes?: Record<string, Code>;
  /** RFC 9126 pushed authorization requests by `request_uri` hash. */
  pushed?: Record<string, Pushed>;
  /** Browser → the agent user's tenant it approved consent for. */
  links?: Record<string, { tenant: string; used: number }>;
  /** Before tenancy: shared operation records (moved to `shared`). */
  operations?: Record<string, OperationRecord>;
  /** Before tenancy: the single business copy (moved to `shared`). */
  business?: Record<string, unknown>;
};
export type Consent = {
  client: string;
  redirect: string;
  state: string;
  scopes: string;
  challenge: string;
  expires: number;
  /** RFC 9449 §10: the code is bound to this DPoP key (from PAR). */
  dpop?: string;
};
/** An authorization request pushed by an authenticated client (RFC 9126). */
export type Pushed = {
  client: string;
  params: Record<string, string>;
  expires: number;
  dpop?: string;
};
export type Code = {
  client: string;
  redirect: string;
  challenge: string;
  scopes: string;
  account: string;
  expires: number;
  browser?: string;
  dpop?: string;
};
export type Tenant = {
  business: Record<string, unknown>;
  operations: Record<string, OperationRecord>;
  used: number;
  /** Conversations (§8) by ID, and accepted request IDs by owner hash. */
  conversations?: Record<string, Conversation>;
  requests?: Record<string, RequestRecord>;
  /** §9.3 reports from this tenant's agents, newest last (bounded). */
  feedback?: FeedbackReport[];
};
export type FeedbackReport = {
  task: string;
  description: string;
  client: string;
  user: string;
  at: string;
  /** What the Company answered: 202, or 200 with an alternative. */
  answer: "accepted" | "alternative";
};
/** §9.2: another way to do a task (at least one of the two fields). */
export type Alternative = {
  instructions?: string;
  references?: Array<Record<string, string>>;
};

// ---- Conversations (§8) ----------------------------------------------------
export type ConversationMessage = {
  id: string;
  role: "user" | "company";
  author: { type: string; id?: string; name?: string };
  /** §8.4 hints: the request a Company message took into account, and the
   * last cursor the Personal Agent had read. */
  as_of_request?: string;
  as_of_cursor?: string;
  text?: string;
  data?: Record<string, unknown>;
  context?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};
export type ConversationEvent = {
  id: string;
  type:
    | "message"
    | "state"
    | "authorization"
    | "user_requested"
    | "direct_opened"
    | "direct_closed";
  created_at: string;
  message?: ConversationMessage;
  /** `user_requested` (§8.10): why the Company asks for the User. */
  reason?: string;
  /** `direct_opened`, `direct_closed` (§8.10): the Direct Conversation. */
  conversation_id?: string;
  /** §8.7: a state event carries all three. */
  handoff?: "none" | "pending";
  responder?: "agent";
  closed?: boolean;
  error?: string;
  scope?: string;
};
export type Conversation = {
  id: string;
  /** Part of every event ID, so a cursor names its conversation. */
  tag: string;
  /** Owner (§8.2): client and User ID, and the account once it uses one. */
  client: string;
  user: string;
  account?: string;
  /** §8.7 state (never `working`: replies are computed on acceptance). */
  handoff: "none" | "pending";
  closed: boolean;
  /** Last event number; events before the first kept one were dropped. */
  seq: number;
  events: ConversationEvent[];
  context: Record<string, unknown>;
  /** The Company Agent's own notes, such as a pending proposal. */
  memory: Record<string, unknown>;
  /** User messages accepted. */
  messages: number;
  updated: number;
  /** §8.10: a Direct Conversation's parent, and the event it accepted. */
  parent?: string;
  requested?: string;
  /** A parent's open Direct Conversation. */
  direct?: string;
  /** A parent's accepted `user_requested` events → Direct Conversation. */
  accepted?: Record<string, string>;
};
/** §8.3: an accepted request, so a retry gets the original response. */
export type RequestRecord = {
  conversation: string;
  /** Path without the query, and a hash of the canonical body. */
  path: string;
  digest: string;
  status: 201 | 202;
};
/** One accepted User-side message, for the Company Agent. */
export type ConversationTurn = {
  conversation: string;
  message: {
    /** An unrecognized `author.type` counts as `agent` (§8.4). */
    author: "agent" | "human";
    text?: string;
    data?: Record<string, unknown>;
  };
  /** Merged `context` of the conversation so far. */
  context: Record<string, unknown>;
  /**
   * §8.10: set in a Direct Conversation, where the User speaks for
   * themselves (`author` `human`). `requested` when it accepted the
   * Company's `user_requested` event; `parent` is the parent's memory,
   * read-only, since the Company keeps the earlier history.
   */
  direct?: { requested: boolean; parent: Readonly<Record<string, unknown>> };
  /** The Direct Conversation was opened without a message: speak first. */
  opening?: boolean;
  /** Signed in: the token's account and scopes (none when signed out). */
  account?: string;
  scopes: string[];
  /** Notes kept for this conversation; the Company Agent may change them. */
  memory: Record<string, unknown>;
  /** `extensions.operations.approval`, only when the request declares v3. */
  approval?: Approval;
  /** Whether operations may be sent (the request declares Operations v3). */
  operations: boolean;
  /** Operations v2 for an action of this conversation (needs `account`). */
  propose: (action: Action) => Outcome;
};
export type CompanyReply = {
  text?: string;
  data?: Record<string, unknown>;
  /** An operation from `propose`, sent in `extensions.operations`. */
  operation?: Record<string, unknown>;
};
export type TurnResult = {
  replies?: CompanyReply[];
  /** Sign-in or more scopes are needed: the scopes, space-separated (§8.11). */
  authorization?: string;
  /**
   * §8.10: ask to talk with the User, with a short reason. Adds a
   * `user_requested` event; ignored in a Direct Conversation.
   */
  requestUser?: string;
};
/** A deterministic Company Agent: structured data in, structured data out. */
export type ConversationHandler = (turn: ConversationTurn) => TurnResult;
/** What a request changed, for stores that persist tenants separately. */
export type Changes = { tenants: string[]; removed: string[] };
export const emptyState = (): GatewayState => ({
  sessions: {},
  tokens: {},
  grants: {},
  replays: [],
  tenants: {},
});
/** Single-writer persistence of the whole state. */
export interface Store {
  value: GatewayState;
  save(changes: Changes): void | Promise<void>;
}
/** HTTPS JSON fetch without redirects and with size and time bounds. */
export type FetchJson = (url: string) => Promise<unknown>;

export type Gate = (c: Context, action: Action) => Response;
/** The account's own grants, for a Company website's "connected agents". */
export type GrantAccess = {
  list: (account: string) => Array<{
    id: string;
    client: string;
    scopes: string;
    expires_at: string;
  }>;
  revoke: (account: string, id: string) => boolean;
};
/** Optional RFC 9449 §8 server nonces; `check` throws `NonceChallenge`. */
export class NonceChallenge extends Error {
  constructor(public nonce: string) {
    super("use_dpop_nonce");
  }
}
/** Structural check: a challenge may come from another copy of this module. */
export const isChallenge = (e: unknown): e is NonceChallenge =>
  e instanceof Error &&
  e.message === "use_dpop_nonce" &&
  typeof (e as { nonce?: unknown }).nonce === "string";
export type DpopNonces = {
  check: (scope: "token" | "api", nonce: unknown, binding: string) => void;
};
export type CompanyDefinition = {
  name: string;
  /** Default scopes for account reads and changes (legacy two-scope Companies). */
  readScope: string;
  writeScope: string;
  /** Every OAuth scope this Company accepts. Defaults to readScope/writeScope. */
  scopes?: string[];
  /** Route-specific account scopes. Every returned scope is required. */
  requiredScopes?: (input: { path: string; method: string }) => string[];
  /**
   * Chooses which requested scopes the consent form granted. The default keeps
   * every requested scope except writeScope unless the form posts write=yes.
   */
  selectScopes?: (input: {
    requested: string[];
    body: Record<string, string>;
  }) => string[];
  consent: (input: {
    nonce: string;
    passwordRequired: boolean;
    scopes: string;
    /** The agent's `client_name`: self-asserted, so show it with `clientHost`. */
    client: string;
    /** Host of the verified `client_id`. */
    clientHost: string;
  }) => string;
  persona: (id: unknown) => { id: string } | undefined;
  defaultAccount: string;
  /** `poppy.json` for this origin (the gateway adds nothing to it). */
  /** `poppy.json` for this origin; `domain` is its host, with a non-443 port (§3.1). */
  discovery: (origin: string, domain: string) => Record<string, unknown>;
  /** §9.1: tasks not offered through the protocol, for `tasks.endpoint`. */
  excludedTasks?: (origin: string) => Array<Record<string, unknown>>;
  /**
   * §9.3: an alternative for a reported task, matched by the Company's own
   * code. Reports are data: never pass them to a model as instructions.
   */
  feedback?: (
    report: { task: string; description: string },
    origin: string,
  ) => Alternative | undefined;
  landing?: (origin: string) => string;
  /** Further server-rendered pages of the Company website, by path. */
  pages?: Record<string, (origin: string) => string>;
  /** Headers for the landing and pages (for example a CSP allowing fonts). */
  pageHeaders?: Record<string, string>;
  /** Web-font origins the consent page's CSP allows (style and font). */
  fontSources?: { style: string; font: string };
  paths: Record<string, unknown>;
  /**
   * The Company Agent (§8), when the Company offers conversations at
   * `/poppy/conversations`. `handoff` is the reply when the User asks for a
   * person (§8.9): this lab has nobody to join, so it says how to call.
   */
  agent?: {
    name: string;
    handoff: { text: string; data: Record<string, unknown> };
    /**
     * §8.10: whether the handler answers turns in Direct Conversations
     * (`turn.direct`). Without it, the gateway answers the User there with
     * `handoff`, since nobody else can.
     */
    direct?: boolean;
  };
  /** Called once per tenant with that tenant's own state. */
  mount: (
    app: Hono,
    ctx: {
      sessionFor: (c: Context) => Session;
      state: Record<string, unknown>;
      gate: Gate;
      grants: GrantAccess;
      origin: string;
      /** This tenant's Operations v3 records, read-only (for a website). */
      operations: () => Readonly<Record<string, OperationRecord>>;
      /** Registers this tenant's Company Agent (with `agent` set). */
      converse: (handler: ConversationHandler) => void;
      /** This tenant's §9.3 reports, newest last, read-only (for a website). */
      feedback: () => readonly FeedbackReport[];
    },
  ) => void;
};
export type Deployment = {
  origin: string;
  store: Store;
  fetchJson: FetchJson;
  /** Plain-HTTP Personal Agents accepted in development, by exact client_id. */
  httpClients?: string[];
  /** Salted scrypt hash of a shared demo password for consent (optional). */
  passwordHash?: string;
  dpopNonces?: DpopNonces;
  /** `"visitor"`: separate business data per agent user. Default `"shared"`. */
  isolation?: "shared" | "visitor";
  /** Visitor tenants kept at most (least recently used go first). */
  maxTenants?: number;
  /** A visitor tenant idle this long starts again from the seed data. */
  tenantIdleMs?: number;
};
export const SHARED_TENANT = "shared";
/** A Map view over a persisted plain object. */
export class ObjectMap<V> {
  constructor(private o: Record<string, V>) {}
  get size() {
    return Object.keys(this.o).length;
  }
  get(k: string) {
    return Object.hasOwn(this.o, k) ? this.o[k] : undefined;
  }
  set(k: string, v: V) {
    this.o[k] = v;
    return this;
  }
  delete(k: string) {
    return delete this.o[k];
  }
  *[Symbol.iterator](): IterableIterator<[string, V]> {
    yield* Object.entries(this.o);
  }
  values(): V[] {
    return Object.values(this.o);
  }
}

export const SESSION_MS = 3600000,
  TOKEN_MS = 3600000,
  GRANT_MS = 7 * 86400000;
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

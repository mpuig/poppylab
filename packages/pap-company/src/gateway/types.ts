/**
 * Shared types and constants of the Company gateway. The modules under this
 * directory each own one section of the protocol and share a `Ctx`
 * (`context.ts`); `createCompany` (`../gateway.ts`) composes them.
 */
import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import type { Approval } from "@poppy-lab/pap-client/core";
import type {
  Action,
  OperationRecord,
  Outcome,
  Refusal,
} from "../approvals.ts";
import type { ActivityEntry, ActivityItem } from "./activity.ts";

/** A Session as the gateway keeps it between requests (§5.3). */
export type SessionRecord = {
  client: string;
  user: string;
  agent?: string;
  expires: number;
  account?: string;
};
/**
 * The Session as one request sees it: its record, token and declarations.
 * The gateway always sets `extensions` and `operations` (`RequestSession`);
 * they are optional so a Company's own code can build a Session.
 */
export type Session = SessionRecord & {
  /** The request's token: its grant (by key) and the token's own scopes. */
  grant?: string;
  scopes?: string;
  /**
   * §3.4: what this request declares in `Poppy-Extensions`, extension name
   * → version. Empty without the header or when it fails to parse.
   */
  extensions?: Record<string, string>;
  /** Derived from `extensions`: the request declares Operations version 3. */
  operations?: boolean;
};
/** A Session from `sessionFor`, as the Session middleware set it. */
export type RequestSession = Session & {
  extensions: Record<string, string>;
  operations: boolean;
};
export type Grant = {
  account: string;
  /** The (client, user) tenant that first used it; nobody else can. */
  holder?: string;
  /** The browser that approved its consent (hash of `pap_browser`). */
  browser?: string;
  id: string;
  client: string;
  /**
   * The agent's `client_name` when the grant was issued, as the consent
   * page showed it: self-asserted, so show it with the host of `client`.
   * Grants from before this field lack it.
   */
  name?: string;
  scopes: string;
  expires: number;
  /** §4.4: the DPoP key the refresh token was issued with (thumbprint). */
  dpop?: string;
  /**
   * What the consent granted beyond scopes (`selectResources`), such as the
   * accounts the User chose. A grant approved before this field existed, or
   * at a Company without `selectResources`, has none: each route decides
   * what that means.
   */
  resources?: string[];
  /** When the consent was approved; grants from before this field lack it. */
  created?: number;
};
/** A grant as a Company's routes see it (`grantFor`, `tokenFields`): a copy. */
export type GrantView = {
  id: string;
  /** What the grant covers; the request's token may carry fewer. */
  scopes: string[];
  resources?: string[];
  /** When the consent was approved (absent on older grants). */
  created_at?: string;
  expires_at: string;
};
/** The view of a grant that Company code may see. */
export const viewOf = (g: Grant): GrantView => ({
  id: g.id,
  scopes: g.scopes.split(" ").filter(Boolean),
  ...(g.resources ? { resources: [...g.resources] } : {}),
  ...(g.created ? { created_at: new Date(g.created).toISOString() } : {}),
  expires_at: new Date(g.expires).toISOString(),
});
/** One version of an extension (§3.3). */
export type ExtensionVersion = { name: string; version: string };
/** Whether a request's declarations (§3.4) include that version. */
export const declares = (
  extensions: Record<string, string>,
  { name, version }: ExtensionVersion,
) => Object.hasOwn(extensions, name) && extensions[name] === version;
export type Token = {
  client: string;
  binding: string;
  expires: number;
  accountId: string;
  scopes: string;
  grant: string;
};
export type GatewayState = {
  sessions: Record<string, SessionRecord>;
  tokens: Record<string, Token>;
  grants: Record<string, Grant>;
  replays: Array<[string, number]>;
  tenants: Record<string, Tenant>;
  /** Pending consent pages by nonce, and one-time codes by hash. */
  consents?: Record<string, Consent>;
  codes?: Record<string, Code>;
  /** RFC 9126 pushed authorization requests by `request_uri` hash. */
  pushed?: Record<string, Pushed>;
  /** Device Sign-In requests (RFC 8628) by `device_code` hash. */
  devices?: Record<string, DeviceRequest>;
  /** Browser → the agent user's tenant it approved consent for. */
  links?: Record<string, { tenant: string; used: number }>;
  /**
   * Browser join (§6): the key its codes and join cookies are made with,
   * the codes that were authorized or submitted, by hash, and the joined
   * browsers by the hash of their Session's cookie.
   */
  joinKey?: string;
  joins?: Record<string, JoinCode>;
  browsers?: Record<string, JoinedBrowser>;
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
  /**
   * Device Sign-In (§4.3): the request this page answers, by `device_code`
   * hash. Its answer goes to that request, not to a redirect, so
   * `redirect`, `state` and `challenge` are empty.
   */
  device?: string;
};
/**
 * A Device Sign-In request (§4.3, RFC 8628), from the device authorization
 * endpoint until its tokens are issued or it ends.
 */
export type DeviceRequest = {
  client: string;
  /** The agent's `client_name` when the code was entered, for its pages. */
  name?: string;
  /** The scopes requested, in the Company's order. */
  scopes: string;
  /** The `user_code` as entered, without the dash: eight letters. */
  userCode: string;
  expires: number;
  /** Seconds a poll waits; each `slow_down` adds 5 (RFC 8628 §3.5). */
  interval: number;
  /** When the last poll came. */
  polled?: number;
  /** The DPoP key its tokens are bound to: the request's, or the first poll's. */
  dpop?: string;
  /** The consent page open for it: the newest one a browser opened. */
  consent?: string;
  /** The consent page's answer. */
  approved?: {
    account: string;
    scopes: string;
    browser?: string;
    resources?: string[];
  };
  declined?: boolean;
};
/** An authorization request pushed by an authenticated client (RFC 9126). */
export type Pushed = {
  client: string;
  params: Record<string, string>;
  /** Until when it can be opened; once used, its consent page decides. */
  expires: number;
  dpop?: string;
  /** Set on first use: the nonce of the one consent page it made. */
  consent?: string;
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
  /** What `selectResources` chose at consent, for the grant. */
  resources?: string[];
};
/**
 * A browser-session code (§6), kept from its authorization, or from a form
 * that submitted it first, until it expires.
 */
export type JoinCode = {
  expires: number;
  /**
   * Authorized: by which Personal Agent, for which agent user (the tenant
   * key) and which Session (its key in `sessions`).
   */
  client?: string;
  holder?: string;
  session?: string;
  /**
   * Authorized with an access token: its account, its scopes and its grant
   * (by key), which the joined browser is then signed in with.
   */
  account?: string;
  scopes?: string;
  grant?: string;
  /** A form submitted it: a code is used by its first submission. */
  used?: boolean;
};
/** A browser joined to a Session (§6), until `expires` or the Session ends. */
export type JoinedBrowser = {
  client: string;
  holder: string;
  session: string;
  expires: number;
  /** Signed in (§6): as `JoinCode`. It lasts while the grant does. */
  account?: string;
  scopes?: string;
  grant?: string;
};
/**
 * What a Company's website is told of the browser join a request belongs
 * to (§6). `account` is there while the join is signed in: the website then
 * serves that account, whatever login cookie the browser sends, shows only
 * what `scopes` and `resources` cover, as its API would for the token, and
 * offers no change. Without `account` the browser is a Session's and
 * signed out. The gateway refuses every change from a joined browser.
 */
export type BrowserJoin = {
  account?: string;
  /** The access token's scopes; none when signed out. */
  scopes: string[];
  /** The grant's resources (`selectResources`), when it has them. */
  resources?: string[];
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
  /**
   * What the gate finished, newest last (bounded), for the website: it
   * outlasts `operations`, which forget an operation with its revision.
   * A tenant stored before this has none, and gets what its `operations`
   * still remember when it is next used.
   */
  activity?: ActivityEntry[];
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
/**
 * §9.4: a skill the Company publishes for Personal Agents, as one
 * `SKILL.md` in the Agent Skills format. It says how to do a task the
 * Company supports with its own interfaces: the prerequisites, the order of
 * calls and the common outcomes. It grants nothing and approves nothing.
 */
export type SkillDefinition = {
  /**
   * The skill's identifier and the folder of its URL: at most 64 lowercase
   * letters, digits and single hyphens, as the format requires.
   */
  name: string;
  /** What the skill does and when to use it: one line, at most 1,024 characters. */
  description: string;
  /** The Markdown after the frontmatter, which the gateway writes. */
  body: string;
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
  /**
   * The keys of `context`, oldest first. An object can't say that: it lists
   * keys like "2027" first, whenever they were set. Conversations stored
   * before this have none.
   */
  contextOrder?: string[];
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
  /**
   * The grant's resources (`selectResources`), such as the accounts the
   * User chose at consent. Absent signed out and for a grant without them.
   */
  resources?: string[];
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
/**
 * What a request changed, for stores that persist tenants separately. A key
 * in `removed` may hold a new tenant again by the time it is saved.
 */
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
/**
 * Puts on record, for the website, an approved request the Company answers
 * with a refusal of its own before the gate. It records nothing unless the
 * request's `Poppy-Approval` names a waiting revision of that action.
 */
export type Refused = (c: Context, refusal: Refusal) => void;
/**
 * The account's own grants, for a Company website's "connected agents".
 * With `isolation: "visitor"` they are the ones the tenant's agent user
 * holds and, until an agent first uses it, the one the browser of the
 * request approved: call it while answering that browser's request.
 */
export type GrantAccess = {
  list: (account: string) => Array<{
    id: string;
    /** The agent's address (its `client_id`). */
    client: string;
    /** What the agent calls itself; absent on a grant from before it was kept. */
    name?: string;
    /** Host of the verified `client`, as the consent page showed it. */
    host: string;
    scopes: string;
    resources?: string[];
    expires_at: string;
    /** `expires_at` as "Dec 2, 22:07 UTC", the same for every viewer. */
    expires: string;
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
  /**
   * §4.3: offer Device Sign-In. Default `true`. RFC 10027 §6.2.1.5 advises
   * against the device grant for high-value accounts, and the guides say a
   * Company such as a bank may offer only Direct Sign-In: `false` leaves it
   * out of the metadata and refuses the grant.
   */
  deviceSignIn?: boolean;
  /** Default scopes for account reads and changes (legacy two-scope Companies). */
  readScope: string;
  writeScope: string;
  /** Every OAuth scope this Company accepts. Defaults to readScope/writeScope. */
  scopes?: string[];
  /**
   * Path prefixes of the account routes (§7): each needs the Session header,
   * an access token (401 with a scope challenge without one), the scopes of
   * `requiredScopes`, and on POST Operations v3, with replay of performed
   * operations. Default `["/api/account"]`. Prefixes are matched as given,
   * so `/api/account` also covers `/api/accounts`. Paths under `/oauth/`,
   * `/.well-known/` and `/poppy/` can't be account routes.
   */
  accountPrefixes?: string[];
  /**
   * Route-specific account scopes. Every returned scope is required. An
   * empty list means the route needs an access token but no particular
   * scope, and checks the rest itself (for example through `grantFor`).
   */
  requiredScopes?: (input: { path: string; method: string }) => string[];
  /**
   * §3.3: the extension a route is handled only with, at the version this
   * Company lists in `poppy.json`. A request that doesn't declare that
   * version gets `extension_required` before its token is looked at. Asked
   * for every request with the Session header (`/api/*`, the account
   * prefixes, conversations, feedback, the browser authorization). Leave out routes a request can use the extension at without
   * declaring it (§3.3). Operations v3 on account POSTs is built in.
   */
  requiredExtension?: (input: {
    path: string;
    method: string;
  }) => ExtensionVersion | undefined;
  /**
   * Chooses which requested scopes the consent form granted. The default keeps
   * every requested scope except writeScope unless the form posts write=yes.
   */
  selectScopes?: (input: {
    requested: string[];
    body: Record<string, string>;
  }) => string[];
  /**
   * What else an approved consent grants, such as the accounts the User
   * chose for `persona`, from the consent form; `scopes` are the scopes the
   * approval grants (`selectScopes`). The grant keeps it through refresh,
   * for `grantFor`. Without the hook, or with `undefined`, the grant has no
   * resources. The form comes from the browser: return only what `persona`
   * owns. `{ refuse }` turns the approval down with that message for the
   * User (400 `invalid_request` with `error_description`); the consent page
   * stays pending, so nothing is issued and the agent learns nothing.
   */
  selectResources?: (input: {
    persona: string;
    body: Record<string, string>;
    scopes: string[];
  }) => string[] | undefined | { refuse: string };
  /**
   * Further fields of a token response, from the grant it serves, at the
   * code exchange and at every refresh. RFC 6749 §5.1 lets a server add
   * parameters, and clients ignore those they don't know. Names of the
   * standard fields (`access_token`, `token_type`, `expires_in`, `scope`,
   * `refresh_token`) and of errors are never replaced. `origin` is the
   * deployment's, for fields that are absolute URLs.
   */
  tokenFields?: (grant: GrantView, origin: string) => Record<string, string>;
  /**
   * How long a grant lasts, in milliseconds from the code exchange, given
   * the scopes its consent granted. Without the hook every grant lasts
   * `GRANT_MS` (7 days). The end is stored with the grant: a refresh after
   * it gets `invalid_grant` (RFC 6749 §5.2), and no access token outlives
   * it, so a refresh before it gets a token that ends with the grant. Sign-in
   * still returns a refresh token (§4.4). For example, `TOKEN_MS` without
   * `offline_access` ends the grant with its first access token, and
   * `GRANT_MS` with it keeps it refreshable. A value that isn't a positive
   * number fails the code exchange with `invalid_grant`.
   */
  grantLifetime?: (scopes: string[]) => number;
  consent: (input: {
    nonce: string;
    passwordRequired: boolean;
    scopes: string;
    /** The agent's `client_name`: self-asserted, so show it with `clientHost`. */
    client: string;
    /** Host of the verified `client_id`. */
    clientHost: string;
    /**
     * The account this browser last allowed this client to reach, while the
     * client holds that permission: the one to choose when the page opens.
     * Absent when there is none, and where browsers aren't told apart
     * (without `isolation: "visitor"`).
     */
    account?: string;
  }) => string;
  /**
   * The page for a browser that answers a consent page after its five
   * minutes (`answered`), or loads one again that ran out or was answered
   * (`reopened`): it says the page ran out, what that changed, and to
   * start the sign-in again from the agent. It gets nothing else, so it can
   * name no agent and hold no code, token or `request_uri`. Without it the
   * browser gets what every other caller gets, the protocol's error as
   * JSON.
   */
  consentExpired?: (how: "answered" | "reopened") => string;
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
  /**
   * §9.4: the skills this Company publishes. The gateway serves each as
   * `/poppy/skills/{name}/SKILL.md` and lists them in the tasks response's
   * `skill_index`, with the digest of the bytes it serves. The same for
   * every Session, like the rest of the tasks response.
   */
  skills?: SkillDefinition[];
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
      sessionFor: (c: Context) => RequestSession;
      /**
       * A website keeps its logins under `webSessions`, by the hash of each
       * login's cookie: with `isolation: "visitor"` the gateway moves them
       * with a browser that starts to see an agent user's copy.
       */
      state: Record<string, unknown>;
      gate: Gate;
      refused: Refused;
      grants: GrantAccess;
      /**
       * The grant behind this request's access token, or `undefined` when
       * signed out or outside the Session routes. Only this tenant's
       * requests see one, and only the token's own client, User and account.
       */
      grantFor: (c: Context) => GrantView | undefined;
      origin: string;
      /** This tenant's Operations v3 records, read-only. */
      operations: () => Readonly<Record<string, OperationRecord>>;
      /**
       * What an account's agents asked for, for a website: the proposals
       * that wait, then the requests that were applied or not, newest
       * first, kept after the operation itself is forgotten.
       */
      activity: (account: string) => ActivityItem[];
      /** Registers this tenant's Company Agent (with `agent` set). */
      converse: (handler: ConversationHandler) => void;
      /** This tenant's §9.3 reports, newest last, read-only (for a website). */
      feedback: () => readonly FeedbackReport[];
      /**
       * §6: the browser join a website request belongs to, or `undefined`
       * for any other browser. Ask it before the website's own login.
       */
      browser: (c: Context) => BrowserJoin | undefined;
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
/** §6: where a Company on this gateway has its browser-session endpoint. */
export const BROWSER_SESSION_PATH = "/poppy/browser-session";
/**
 * §4.7: the protocol's own scope, which signs a joined browser in (§6).
 * Every Company on this gateway lists it. A consent grants it only on its
 * own line (`allow_browser`), and a website shows a browser joined with it
 * what the token's other scopes cover and takes no change from it.
 */
export const BROWSER_SIGN_IN = "poppy:browser-sign-in";
/** RFC 8628: the grant type of Device Sign-In (§3.2, §4.3). */
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

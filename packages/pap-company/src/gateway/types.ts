/**
 * Shared types and constants of the Company gateway. The modules under this
 * directory each own one section of the protocol and share a `Ctx`
 * (`context.ts`); `createCompany` (`../gateway.ts`) composes them.
 */
import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import type { Action, OperationRecord } from "../approvals.ts";

export type Session = {
  client: string;
  user: string;
  agent?: string;
  expires: number;
  account?: string;
  grant?: string;
  scopes?: string;
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
};
export type Token = {
  client: string;
  binding: string;
  expires: number;
  operations: boolean;
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
};
export type Code = {
  client: string;
  redirect: string;
  challenge: string;
  scopes: string;
  account: string;
  expires: number;
  browser?: string;
};
export type Tenant = {
  business: Record<string, unknown>;
  operations: Record<string, OperationRecord>;
  used: number;
};
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
  readScope: string;
  writeScope: string;
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
  discovery: (origin: string, domain: string) => Record<string, unknown>;
  excludedTasks?: (origin: string) => Record<string, unknown>;
  landing?: (origin: string) => string;
  /** Further server-rendered pages of the Company website, by path. */
  pages?: Record<string, (origin: string) => string>;
  /** Headers for the landing and pages (for example a CSP allowing fonts). */
  pageHeaders?: Record<string, string>;
  /** Web-font origins the consent page's CSP allows (style and font). */
  fontSources?: { style: string; font: string };
  paths: Record<string, unknown>;
  /** Called once per tenant with that tenant's own state. */
  mount: (
    app: Hono,
    ctx: {
      sessionFor: (c: Context) => Session;
      state: Record<string, unknown>;
      gate: Gate;
      grants: GrantAccess;
      origin: string;
      /** This tenant's Operations v2 records, read-only (for a website). */
      operations: () => Readonly<Record<string, OperationRecord>>;
    },
  ) => void;
};
export type Deployment = {
  origin: string;
  domain: string;
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

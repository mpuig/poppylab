/**
 * What every gateway module shares: the definition and deployment, the
 * persisted state, the replay cache, the requests to save for, cookie
 * helpers, the client-metadata cache, DPoP proof helpers, and the
 * per-request maps that carry the Session and tenant from middleware to
 * handlers.
 */
import type { Context } from "hono";
import {
  decodeProtectedHeader,
  ReplayCache,
  verifyProof,
  type JWK,
} from "@poppy-lab/pap-client/core";
import { calculateJwkThumbprint } from "jose";
import {
  BROWSER_SIGN_IN,
  hash,
  isChallenge,
  SHARED_TENANT,
  type CompanyDefinition,
  type Deployment,
  type GatewayState,
  type RequestSession,
} from "./types.ts";

export type ClientInfo = {
  keys: JWK[];
  redirects: string[];
  name: string;
  until: number;
};

/**
 * The key a client assertion is verified with: the one its `kid` names.
 * Neither §4.1 nor RFC 7523 requires a `kid`, so an assertion without one
 * gets the client's key when it publishes exactly one, and never the first
 * of several.
 */
export function assertionKey(info: ClientInfo, assertion: string) {
  const { kid } = decodeProtectedHeader(assertion);
  // Without a `kid` nothing is looked up: a published key that has none
  // itself would match, and be the first of several.
  if (kid === undefined)
    return info.keys.length === 1 ? info.keys[0] : undefined;
  return info.keys.find((k) => k.kid === kid);
}

export function createContext(def: CompanyDefinition, deploy: Deployment) {
  const { origin, store } = deploy;
  const state: GatewayState = store.value;
  state.tenants ??= {};
  if (state.business || state.operations) {
    state.tenants[SHARED_TENANT] ??= {
      business: state.business ?? {},
      operations: state.operations ?? {},
      used: 0,
    };
    delete state.business;
    delete state.operations;
  }
  const isolated = deploy.isolation === "visitor";
  const scopes = [...new Set(def.scopes ?? [def.readScope, def.writeScope])];
  if (
    !scopes.length ||
    !scopes.includes(def.readScope) ||
    !scopes.includes(def.writeScope)
  )
    throw new Error("Company scopes must include readScope and writeScope");
  // A token with it would sign a joined browser in (§6), which the browser
  // join here doesn't do: see `browser-session.ts` before offering it.
  if (scopes.includes(BROWSER_SIGN_IN))
    throw new Error(`Company scopes can't include ${BROWSER_SIGN_IN} yet`);
  // §7: account routes, never the sign-in, discovery or Poppy routes.
  const accountPrefixes = [...(def.accountPrefixes ?? ["/api/account"])];
  const reserved = ["/oauth/", "/.well-known/", "/poppy/"];
  if (
    !accountPrefixes.length ||
    accountPrefixes.some(
      (prefix) =>
        !prefix.startsWith("/") ||
        reserved.some((r) => r.startsWith(prefix) || prefix.startsWith(r)),
    )
  )
    throw new Error(
      "Company accountPrefixes must be paths outside /oauth, /.well-known and /poppy",
    );
  const replay = new ReplayCache(new Map(state.replays));
  const secure = origin.startsWith("https:"),
    cookiePrefix = secure ? "__Host-" : "";
  const flags = { failed: false };
  /**
   * The requests that may have changed state; each saves when it ends. Per
   * request, not one flag for all: requests overlap while one awaits, and
   * one would drop another's save or save for it.
   */
  const dirty = new WeakSet<Request>();
  const markDirty = (request: Request) => {
    dirty.add(request);
  };

  /** Hash of this browser's `pap_browser` cookie (never stored raw). */
  const browserOf = (c: Context) => {
    const raw = (c.req.header("cookie") ?? "")
      .split(/;\s*/)
      .find((v) => v.startsWith(`${cookiePrefix}pap_browser=`))
      ?.split("=")[1];
    return raw && /^[A-Za-z0-9_-]{20,64}$/.test(raw) ? hash(raw) : undefined;
  };
  const browserCookie = (raw: string) =>
    `${cookiePrefix}pap_browser=${raw}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}; Max-Age=${7 * 86400}`;
  const link = (request: Request, browser: string, tenant: string) => {
    const links = (state.links ??= {});
    if (links[browser]?.tenant !== tenant) markDirty(request);
    links[browser] = { tenant, used: Date.now() };
    const keys = Object.keys(links);
    if (keys.length > 2000)
      for (const k of keys
        .sort((a, b) => links[a]!.used - links[b]!.used)
        .slice(0, keys.length - 2000))
        delete links[k];
  };
  const holderOf = (client: string, user: string) => hash(`${client}\n${user}`);

  /**
   * No client may hold more than a fifth of a shared cap, so one agent can't
   * exhaust Sessions, tokens, grants or consents for everyone else.
   */
  const SHARE = 0.2;
  const overShare = (
    records: Iterable<{ client: string }>,
    client: string,
    cap: number,
  ) => {
    let total = 0,
      mine = 0;
    for (const r of records) {
      total++;
      if (r.client === client) mine++;
    }
    return total >= cap || mine >= Math.ceil(cap * SHARE);
  };

  // ---- Client metadata (CIMD) --------------------------------------------
  const clients = new Map<string, ClientInfo>();
  /**
   * Fetches client metadata at `client_id`, without redirects (§4.1, §5.3).
   * Extensions aren't read from it: requests declare them (§3.4).
   */
  async function client(id: string): Promise<ClientInfo> {
    const cached = clients.get(id);
    if (cached && cached.until > Date.now()) return cached;
    let url: URL;
    try {
      url = new URL(id);
    } catch {
      throw new Error("invalid_client");
    }
    if (url.protocol !== "https:" && !(deploy.httpClients ?? []).includes(id))
      throw new Error("invalid_client");
    const metadata = (await deploy.fetchJson(id)) as {
      client_id?: unknown;
      client_name?: unknown;
      jwks_uri?: unknown;
      redirect_uris?: unknown;
    };
    if (
      metadata?.client_id !== id ||
      typeof metadata.jwks_uri !== "string" ||
      new URL(metadata.jwks_uri).origin !== url.origin ||
      !Array.isArray(metadata.redirect_uris)
    )
      throw new Error("invalid_client");
    const jwks = (await deploy.fetchJson(metadata.jwks_uri)) as {
      keys?: JWK[];
    };
    if (!Array.isArray(jwks?.keys) || jwks.keys.some((k) => "d" in k))
      throw new Error("invalid_client");
    const info: ClientInfo = {
      keys: jwks.keys.slice(0, 8),
      redirects: metadata.redirect_uris
        .filter((r): r is string => typeof r === "string")
        .slice(0, 8),
      name:
        typeof metadata.client_name === "string"
          ? metadata.client_name.slice(0, 80)
          : url.host,
      until: Date.now() + 60000,
    };
    // Least recently inserted goes first (Map order); never the whole cache.
    if (clients.size >= 200) clients.delete(clients.keys().next().value!);
    clients.set(id, info);
    return info;
  }

  // ---- DPoP --------------------------------------------------------------
  const proofOf = async (...args: Parameters<typeof verifyProof>) => {
    try {
      return await verifyProof(...args);
    } catch (e) {
      if (isChallenge(e)) throw e;
      throw new Error("invalid_dpop_proof", { cause: e });
    }
  };
  const nonceFor = (scope: "token" | "api") =>
    deploy.dpopNonces
      ? (nonce: unknown, binding: string) =>
          deploy.dpopNonces!.check(scope, nonce, binding)
      : undefined;
  /**
   * At the token and revocation endpoints a nonce challenge comes before the
   * client assertion or grant is consumed, so the agent can retry the same
   * request (RFC 9449 §8). Without a proof there is nothing to challenge: a
   * pushed request and a revocation go on without one, and the token
   * endpoint refuses it when it verifies the proof.
   */
  const challengeBeforeConsuming = async (c: Context) => {
    const header = c.req.header("dpop");
    if (!deploy.dpopNonces || !header) return;
    const jwk = (decodeProtectedHeader(header) as { jwk?: JWK }).jwk;
    const payload = JSON.parse(
      Buffer.from(header.split(".")[1] ?? "", "base64url").toString() || "{}",
    ) as { nonce?: unknown };
    if (jwk)
      deploy.dpopNonces.check(
        "token",
        payload.nonce,
        await calculateJwkThumbprint(jwk),
      );
  };

  // ---- Per-request carriers ----------------------------------------------
  const sessions = new WeakMap<object, RequestSession>();
  const sessionFor = (c: Context) => {
    const s = sessions.get(c.req.raw);
    if (!s) throw new Error("Session context missing");
    return s;
  };

  return {
    def,
    deploy,
    origin,
    store,
    state,
    isolated,
    replay,
    both: scopes,
    accountPrefixes,
    secure,
    cookiePrefix,
    flags,
    dirty,
    markDirty,
    browserOf,
    browserCookie,
    link,
    holderOf,
    overShare,
    client,
    proofOf,
    nonceFor,
    challengeBeforeConsuming,
    sessions,
    sessionFor,
    /** Request → its Session's key in `state.sessions` (Session middleware). */
    sessionKeys: new WeakMap<Request, string>(),
    /** Request → tenant key chosen by the Session or website middleware. */
    tenantKeys: new WeakMap<Request, string>(),
    /** Request → tenant it entered, for the store's per-tenant persistence. */
    tenantsTouched: new WeakMap<Request, string>(),
    /** Tenants evicted since the last save. */
    removed: [] as string[],
  };
}
export type Ctx = ReturnType<typeof createContext>;

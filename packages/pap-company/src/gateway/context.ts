/**
 * What every gateway module shares: the definition and deployment, the
 * persisted state, the replay cache, the requests to save for, cookie
 * helpers, the client-metadata cache, DPoP proof helpers, and the
 * per-request maps that carry the Session and tenant from middleware to
 * handlers.
 */
import type { Context } from "hono";
import {
  addressKey,
  decodeProtectedHeader,
  onWorkers,
  ReplayCache,
  verifyProof,
  type JWK,
} from "@poppy-lab/pap-client/core";
import { calculateJwkThumbprint } from "jose";
import {
  BROWSER_SIGN_IN,
  hash,
  isChallenge,
  MCP_PATH,
  SHARED_TENANT,
  type CompanyDefinition,
  type Deployment,
  type GatewayState,
  type RequestSession,
} from "./types.ts";

/** The longest `client_id` taken, in characters. */
export const MAX_CLIENT_ID = 200;

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

/**
 * Failed attempts, such as wrong passwords or codes, counted per source and
 * for everyone. A source is blocked after `mine` in `mineMs`, and everyone
 * after `all` in a minute: a backstop high enough that one source can't
 * reach it alone. Kept in memory: a restart forgets them, which costs a
 * guesser more than it gains.
 */
export function attemptLimit(mine: number, mineMs: number, all: number) {
  const sources = new Map<string, { count: number; start: number }>();
  let everyone = { count: 0, start: Date.now() };
  return {
    blocked(source: string) {
      const now = Date.now();
      if (now - everyone.start > 60000) everyone = { count: 0, start: now };
      const own = sources.get(source);
      if (own && now - own.start > mineMs) sources.delete(source);
      return everyone.count >= all || (sources.get(source)?.count ?? 0) >= mine;
    },
    count(source: string) {
      everyone.count++;
      const own = sources.get(source);
      if (own) own.count++;
      else {
        // Least recently inserted goes first (Map order).
        if (sources.size >= 1000) sources.delete(sources.keys().next().value!);
        sources.set(source, { count: 1, start: Date.now() });
      }
    },
  };
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
  // The Company's own scopes, then the protocol's: every Company here can
  // have a browser joined signed in, read only (§6, `browser-session.ts`).
  const scopes = [
    ...new Set([
      ...(def.scopes ?? [def.readScope, def.writeScope]),
      BROWSER_SIGN_IN,
    ]),
  ];
  if (
    !scopes.length ||
    !scopes.includes(def.readScope) ||
    !scopes.includes(def.writeScope)
  )
    throw new Error("Company scopes must include readScope and writeScope");
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
  // Section 7: the MCP server, when `poppy.json` lists it at MCP_PATH.
  const listed = def.discovery(origin, new URL(origin).host).apis;
  const mcp = Array.isArray(listed)
    ? listed.some(
        (api: { type?: unknown; url?: unknown } | null) =>
          api?.type === "mcp" && api.url === `${origin}${MCP_PATH}`,
      )
      ? `${origin}${MCP_PATH}`
      : undefined
    : undefined;
  /**
   * No client may hold more than a fifth of a shared cap, so one agent can't
   * exhaust Sessions, tokens, grants, consents or the replay cache for
   * everyone else; a client the deployment trusts may hold its own share.
   */
  const shares = deploy.clientShares ?? {};
  for (const share of Object.values(shares))
    if (!(share > 0 && share <= 1))
      throw new Error("clientShares must be more than 0 and at most 1");
  const shareOf = (client: string) =>
    Object.hasOwn(shares, client) ? shares[client]! : 0.2;
  const replay = new ReplayCache(state.replays, { share: shareOf });
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
   * Where a request comes from, for attempt limits: the visitor's address
   * (`addressKey`), which Cloudflare sets in front of a Worker and any
   * client can send to Node, else this browser's cookie.
   */
  const sourceOf = (c: Context) => {
    const address = onWorkers() ? c.req.header("cf-connecting-ip") : undefined;
    return address !== undefined ? addressKey(address) : browserOf(c);
  };

  /** Whether a client may add no more records under this cap (`shareOf`). */
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
    return total >= cap || mine >= Math.ceil(cap * shareOf(client));
  };

  // ---- Client metadata (CIMD) --------------------------------------------
  const clients = new Map<string, ClientInfo>();
  const inflight = new Map<string, Promise<ClientInfo>>();
  const failed = new Map<string, number>();
  const FAILED_TTL_MS = 15000;
  /** A URL from client metadata, unless it doesn't parse or has credentials. */
  const urlOf = (value: string) => {
    try {
      const url = new URL(value);
      return url.username || url.password ? undefined : url;
    } catch {
      return undefined;
    }
  };
  /**
   * §4.1: a redirect URI is on the client's own origin, which is HTTPS but
   * for a development client the deployment allows (`httpClients`), or a
   * loopback redirect URI (RFC 8252 §7.3). No fragment (RFC 6749 §3.1.2).
   */
  const redirectAllowed = (value: string, client: URL) => {
    const url = urlOf(value);
    return (
      !!url &&
      !value.includes("#") &&
      (url.origin === client.origin ||
        (url.protocol === "http:" &&
          (url.hostname === "127.0.0.1" || url.hostname === "[::1]")))
    );
  };
  /**
   * Fetches client metadata at `client_id`, without redirects (§4.1, §5.3).
   * Extensions aren't read from it: requests declare them (§3.4).
   */
  async function client(id: string): Promise<ClientInfo> {
    const cached = clients.get(id);
    if (cached && cached.until > Date.now()) return cached;
    // Every Session, token, grant and sign-in keeps it, so its length is
    // bounded for the protocol state to fit its rows (`split-store.ts`).
    if (id.length > MAX_CLIENT_ID) throw new Error("invalid_client");
    const url = urlOf(id);
    if (
      !url ||
      (url.protocol !== "https:" && !(deploy.httpClients ?? []).includes(id))
    )
      throw new Error("invalid_client");
    const retryAt = failed.get(id);
    if (retryAt !== undefined) {
      if (retryAt > Date.now()) throw new Error("invalid_client");
      failed.delete(id);
    }
    const pending = inflight.get(id);
    if (pending) return pending;
    const load = async (): Promise<ClientInfo> => {
      try {
        const metadata = (await deploy.fetchJson(id)) as {
          client_id?: unknown;
          client_name?: unknown;
          jwks_uri?: unknown;
          redirect_uris?: unknown;
        };
        if (
          metadata?.client_id !== id ||
          typeof metadata.jwks_uri !== "string" ||
          urlOf(metadata.jwks_uri)?.origin !== url.origin ||
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
          // An entry §4.1 doesn't allow is dropped, not the client: a sign-in
          // to it fails, and signed-out Sessions, which need only the keys, go on.
          redirects: metadata.redirect_uris
            .filter(
              (r): r is string =>
                typeof r === "string" && redirectAllowed(r, url),
            )
            .slice(0, 8),
          name:
            typeof metadata.client_name === "string"
              ? metadata.client_name.slice(0, 80)
              : url.host,
          until: Date.now() + 60000,
        };
        // Least recently inserted goes first (Map order); never the whole cache.
        clients.delete(id);
        if (clients.size >= 200) clients.delete(clients.keys().next().value!);
        clients.set(id, info);
        return info;
      } catch (e) {
        failed.delete(id);
        if (failed.size >= 200) failed.delete(failed.keys().next().value!);
        failed.set(id, Date.now() + FAILED_TTL_MS);
        throw e;
      }
    };
    const lookup = load().finally(() => {
      inflight.delete(id);
    });
    inflight.set(id, lookup);
    return lookup;
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
    let nonce: unknown, binding: string | undefined;
    try {
      const jwk = (decodeProtectedHeader(header) as { jwk?: JWK }).jwk;
      nonce = (
        JSON.parse(
          Buffer.from(header.split(".")[1] ?? "", "base64url").toString() ||
            "{}",
        ) as { nonce?: unknown } | null
      )?.nonce;
      if (jwk) binding = await calculateJwkThumbprint(jwk);
    } catch {
      // Not a proof: the endpoint's own check refuses it, as
      // invalid_dpop_proof, not as the client.
      return;
    }
    if (binding) deploy.dpopNonces.check("token", nonce, binding);
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
    /** The MCP server's URL, the `resource` of its tokens, when listed. */
    mcp,
    secure,
    cookiePrefix,
    flags,
    dirty,
    markDirty,
    browserOf,
    browserCookie,
    link,
    holderOf,
    sourceOf,
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

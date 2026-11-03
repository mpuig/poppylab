/**
 * What every gateway module shares: the definition and deployment, the
 * persisted state, the replay cache, the dirty flag, cookie helpers, the
 * client-metadata cache, DPoP proof helpers, and the per-request maps that
 * carry the Session and tenant from middleware to handlers.
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
  hash,
  isChallenge,
  SHARED_TENANT,
  type CompanyDefinition,
  type Deployment,
  type GatewayState,
  type Session,
} from "./types.ts";

export type ClientInfo = {
  keys: JWK[];
  operations: boolean;
  redirects: string[];
  name: string;
  until: number;
};

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
  const replay = new ReplayCache(new Map(state.replays));
  const secure = origin.startsWith("https:"),
    cookiePrefix = secure ? "__Host-" : "";
  const flags = { dirty: false, failed: false };
  const markDirty = () => {
    flags.dirty = true;
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
  const link = (browser: string, tenant: string) => {
    const links = (state.links ??= {});
    if (links[browser]?.tenant !== tenant) markDirty();
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
  /** Fetches client metadata at `client_id`, without redirects (§4.1, §5.3). */
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
      extensions?: { operations?: { version?: unknown } };
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
      operations: metadata.extensions?.operations?.version === "2",
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
   * request (RFC 9449 §8).
   */
  const challengeBeforeConsuming = async (c: Context) => {
    if (!deploy.dpopNonces) return;
    const header = c.req.header("dpop") ?? "";
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
  const sessions = new WeakMap<object, Session>();
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
    both: [def.readScope, def.writeScope],
    secure,
    cookiePrefix,
    flags,
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
    /** Request → tenant key chosen by the Session or website middleware. */
    tenantKeys: new WeakMap<Request, string>(),
    /** Request → tenant it entered, for the store's per-tenant persistence. */
    tenantsTouched: new WeakMap<Request, string>(),
    /** Tenants evicted since the last save. */
    removed: [] as string[],
  };
}
export type Ctx = ReturnType<typeof createContext>;

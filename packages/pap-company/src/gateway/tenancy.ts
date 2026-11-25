/**
 * Tenancy: one mounted copy of the Company's business routes per tenant
 * (the shared copy, or one per agent user with `isolation: "visitor"`), the
 * Operations v3 gate, grant access for the Company website and for a
 * request's own grant, and the final dispatch that routes website browsers
 * to their copy.
 */
import { Hono, type Context } from "hono";
import { randomId } from "@poppy-lab/pap-client/core";
import { approvals } from "../approvals.ts";
import { activityOf, agentActivity, keepActivity } from "./activity.ts";
import type { Ctx } from "./context.ts";
import {
  hash,
  SHARED_TENANT,
  type ConversationHandler,
  type Gate,
  type GrantAccess,
  type GrantView,
  type Tenant,
  viewOf,
} from "./types.ts";

export function createTenancy(ctx: Ctx) {
  const { def, deploy, origin, state, isolated } = ctx;
  const maxTenants = deploy.maxTenants ?? 500,
    idleMs = deploy.tenantIdleMs ?? 86400000;
  const gate: Gate = (c, action) => {
    const s = ctx.sessionFor(c);
    const outcome = enter(c.req.raw).engine.gate(
      {
        client: s.client,
        user: s.user,
        account: s.account ?? def.defaultAccount,
      },
      c.req.header("poppy-approval"),
      action,
    );
    return c.json(outcome.body, outcome.status);
  };
  // Grants visible to a tenant's website: all in shared mode, else its own.
  const grantsOf = (tenant: string): GrantAccess => ({
    list: (account) =>
      Object.values(state.grants)
        .filter(
          (g) =>
            g.account === account &&
            g.expires > Date.now() &&
            (!isolated || g.holder === tenant),
        )
        .map((g) => ({
          id: g.id,
          client: g.client,
          scopes: g.scopes,
          ...(g.resources ? { resources: [...g.resources] } : {}),
          expires_at: new Date(g.expires).toISOString(),
        })),
    revoke(account, id) {
      const found = Object.entries(state.grants).find(
        ([, g]) =>
          g.account === account &&
          g.id === id &&
          (!isolated || g.holder === tenant),
      );
      if (!found) return false;
      delete state.grants[found[0]];
      for (const [k, t] of Object.entries(state.tokens))
        if (t.grant === found[0]) delete state.tokens[k];
      return true;
    },
  });
  /**
   * The grant behind a request's access token, for the tenant `key`. The
   * Session middleware already refused a token of another client, holder,
   * or an expired one; this checks again, so a view is never another
   * tenant's, client's, User's or account's, whatever request a Company's
   * code passes in.
   */
  const grantFor =
    (key: string) =>
    (c: Context): GrantView | undefined => {
      const s = ctx.sessions.get(c.req.raw);
      if (!s?.grant || (ctx.tenantKeys.get(c.req.raw) ?? SHARED_TENANT) !== key)
        return undefined;
      const g = state.grants[s.grant];
      if (
        !g ||
        g.expires < Date.now() ||
        g.client !== s.client ||
        g.account !== s.account ||
        g.holder !== ctx.holderOf(s.client, s.user)
      )
        return undefined;
      return viewOf(g);
    };
  type Entry = {
    app: Hono;
    engine: ReturnType<typeof approvals>;
    tenant: Tenant;
    converse?: ConversationHandler;
  };
  const apps = new Map<string, Entry>();
  /** The request's tenant (created or renewed), recorded for persistence. */
  function enter(request: Request) {
    const key = ctx.tenantKeys.get(request) ?? SHARED_TENANT;
    ctx.tenantsTouched.set(request, key);
    return tenantApp(key, request);
  }
  function tenantApp(key: string, request: Request) {
    const now = Date.now();
    let tenant = state.tenants[key];
    if (
      tenant &&
      isolated &&
      key !== SHARED_TENANT &&
      now - tenant.used > idleMs
    ) {
      delete state.tenants[key];
      apps.delete(key);
      ctx.removed.push(key);
      tenant = undefined;
    }
    if (!tenant) {
      const keys = Object.keys(state.tenants);
      if (keys.length >= maxTenants) {
        // Evict the least recently used visitors (idle ones first).
        const order = keys
          .filter((k) => k !== SHARED_TENANT)
          .sort((a, b) => state.tenants[a]!.used - state.tenants[b]!.used);
        for (const k of order.slice(0, keys.length - maxTenants + 1)) {
          delete state.tenants[k];
          apps.delete(k);
          ctx.removed.push(k);
        }
      }
      tenant = state.tenants[key] = { business: {}, operations: {}, used: now };
      ctx.markDirty(request);
    }
    // Persist the idle clock hourly, not on every read.
    if (now - tenant.used > 3600000) ctx.markDirty(request);
    tenant.used = now;
    tenant.operations ??= {};
    const kept = (tenant.activity ??= activityOf(tenant.operations));
    let entry = apps.get(key);
    if (!entry) {
      const sub = new Hono();
      const created: Entry = {
        app: sub,
        engine: approvals(tenant.operations, {
          finished: (entry) => keepActivity(kept, entry),
        }),
        tenant,
      };
      entry = created;
      apps.set(key, created);
      def.mount(sub, {
        sessionFor: ctx.sessionFor,
        state: tenant.business,
        gate,
        grants: grantsOf(key),
        grantFor: grantFor(key),
        origin,
        operations: () => tenant.operations,
        activity: (account) => agentActivity(account, tenant.operations, kept),
        converse: (handler) => {
          created.converse = handler;
        },
        feedback: () => tenant.feedback ?? [],
      });
    }
    return entry;
  }
  // The Company website: each browser gets its own copy, or the agent
  // user's copy once that browser approved the agent's consent.
  const website = (path: string) =>
    path === "/account" || path.startsWith("/site/");
  /**
   * A browser that approved an agent's consent sees the agent user's copy
   * from then on, and nothing leads back to its own. Its website logins
   * (`webSessions` in a Company's state, see `mount`) move with it, so
   * connecting an agent doesn't log the customer out of the website, and
   * its own copy is dropped.
   */
  function follow(request: Request, own: string, to: Tenant) {
    const from = state.tenants[own];
    if (!from || from === to) return;
    const logins = from.business.webSessions;
    if (logins && typeof logins === "object")
      Object.assign((to.business.webSessions ??= {}) as object, logins);
    delete state.tenants[own];
    apps.delete(own);
    ctx.removed.push(own);
    ctx.markDirty(request);
  }
  function mountDispatch(app: Hono) {
    app.all("*", async (c) => {
      const path = new URL(c.req.url).pathname;
      let cookie: string | undefined, own: string | undefined;
      if (isolated && website(path)) {
        let browser = ctx.browserOf(c);
        if (!browser) {
          const raw = randomId();
          cookie = ctx.browserCookie(raw);
          browser = hash(raw);
        }
        const linked = state.links?.[browser];
        if (linked) linked.used = Date.now();
        own = `browser:${browser}`;
        ctx.tenantKeys.set(c.req.raw, linked?.tenant ?? own);
      }
      const entry = enter(c.req.raw);
      if (own) follow(c.req.raw, own, entry.tenant);
      const response = await entry.app.fetch(c.req.raw);
      if (!cookie) return response;
      const copy = new Response(response.body, response);
      copy.headers.append("Set-Cookie", cookie);
      return copy;
    });
  }
  /** The grant behind a request's token, in the request's own tenant. */
  const grantOf = (c: Context) =>
    grantFor(ctx.tenantKeys.get(c.req.raw) ?? SHARED_TENANT)(c);
  return { enter, gate, grantOf, mountDispatch };
}
export type Tenancy = ReturnType<typeof createTenancy>;

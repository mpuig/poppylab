/**
 * Tenancy: one mounted copy of the Company's business routes per tenant
 * (the shared copy, or one per agent user with `isolation: "visitor"`), the
 * Operations v2 gate, grant access for the Company website, and the final
 * dispatch that routes website browsers to their copy.
 */
import { Hono } from "hono";
import { randomId } from "@poppy-lab/pap-client/core";
import { approvals } from "../approvals.ts";
import type { Ctx } from "./context.ts";
import {
  hash,
  SHARED_TENANT,
  type ConversationHandler,
  type Gate,
  type GrantAccess,
  type Tenant,
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
    return tenantApp(key);
  }
  function tenantApp(key: string) {
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
      ctx.markDirty();
    }
    // Persist the idle clock hourly, not on every read.
    if (now - tenant.used > 3600000) ctx.markDirty();
    tenant.used = now;
    tenant.operations ??= {};
    let entry = apps.get(key);
    if (!entry) {
      const sub = new Hono();
      const created: Entry = {
        app: sub,
        engine: approvals(tenant.operations),
        tenant,
      };
      entry = created;
      apps.set(key, created);
      def.mount(sub, {
        sessionFor: ctx.sessionFor,
        state: tenant.business,
        gate,
        grants: grantsOf(key),
        origin,
        operations: () => tenant.operations,
        converse: (handler) => {
          created.converse = handler;
        },
      });
    }
    return entry;
  }
  // The Company website: each browser gets its own copy, or the agent
  // user's copy once that browser approved the agent's consent.
  const website = (path: string) =>
    path === "/account" || path.startsWith("/site/");
  function mountDispatch(app: Hono) {
    app.all("*", async (c) => {
      const path = new URL(c.req.url).pathname;
      let cookie: string | undefined;
      if (isolated && website(path)) {
        let browser = ctx.browserOf(c);
        if (!browser) {
          const raw = randomId();
          cookie = ctx.browserCookie(raw);
          browser = hash(raw);
        }
        const linked = state.links?.[browser];
        if (linked) linked.used = Date.now();
        ctx.tenantKeys.set(c.req.raw, linked?.tenant ?? `browser:${browser}`);
      }
      const response = await enter(c.req.raw).app.fetch(c.req.raw);
      if (!cookie) return response;
      const copy = new Response(response.body, response);
      copy.headers.append("Set-Cookie", cookie);
      return copy;
    });
  }
  return { enter, gate, mountDispatch };
}
export type Tenancy = ReturnType<typeof createTenancy>;

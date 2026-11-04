/**
 * The Session header and access tokens at the APIs (§5.3, §7): verifies
 * `Poppy-Session`, binds one account per Session, enforces scopes and
 * Operations v2 on account routes, and replays performed operations (§7).
 */
import type { Hono } from "hono";
import { tokenHash, verifySessionHeader } from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import { isChallenge, SESSION_MS, type Token } from "./types.ts";
import type { Tenancy } from "./tenancy.ts";

/** Session destinations (§5.2): the APIs and the conversation routes (§8.2). */
const guarded = (path: string) =>
  path.startsWith("/api/") ||
  path === "/poppy/conversations" ||
  path.startsWith("/poppy/conversations/");

export function mountSessions(app: Hono, ctx: Ctx, tenancy: Tenancy) {
  const { def, origin, state, replay, isolated } = ctx;
  app.use("*", async (c, next) => {
    if (!guarded(new URL(c.req.url).pathname)) return next();
    const authorization = c.req.header("authorization") ?? "";
    const token = authorization.startsWith("DPoP ")
      ? authorization.slice(5)
      : undefined;
    if (authorization && !token)
      return c.json({ error: "invalid_token" }, 401, {
        "WWW-Authenticate": 'DPoP error="invalid_token"',
      });
    const url = `${origin}${new URL(c.req.url).pathname}${new URL(c.req.url).search}`;
    let verified;
    try {
      verified = await verifySessionHeader(
        c.req.header("poppy-session") ?? "",
        {
          audience: origin,
          method: c.req.method,
          url,
          ...(token ? { accessToken: token } : {}),
          keysFor: async (id) => (await ctx.client(id)).keys,
        },
      );
    } catch {
      return c.json({ error: "invalid_session" }, 400);
    }
    const now = Date.now();
    const sid = `${verified.clientId} ${verified.sessionId}`;
    let session = state.sessions[sid];
    if (
      session &&
      (session.expires < now ||
        session.user !== verified.userId ||
        (session.agent ?? null) !== (verified.agentId ?? null))
    )
      return c.json({ error: "invalid_session" }, 400);
    let record: Token | undefined;
    if (token) {
      record = state.tokens[tokenHash(token)];
      const grant = record && state.grants[record.grant];
      if (
        !record ||
        record.expires < now ||
        record.client !== verified.clientId ||
        !grant ||
        grant.expires < now
      )
        return c.json({ error: "invalid_token" }, 401, {
          "WWW-Authenticate": 'DPoP error="invalid_token"',
        });
      try {
        await ctx.proofOf(
          c.req.header("dpop") ?? "",
          url,
          c.req.method,
          replay,
          token,
          record.binding,
          ctx.nonceFor("api"),
        );
      } catch (e) {
        if (isChallenge(e))
          return c.json({ error: "use_dpop_nonce" }, 401, {
            "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
            "DPoP-Nonce": e.nonce,
          });
        return c.json({ error: "invalid_dpop_proof" }, 401, {
          "WWW-Authenticate": 'DPoP error="invalid_dpop_proof"',
        });
      }
      // One account per Session (§5.4).
      if (session?.account && session.account !== record.accountId)
        return c.json({ error: "invalid_session" }, 400);
      // A grant serves only the agent user that first used it.
      const holder = ctx.holderOf(verified.clientId, verified.userId);
      if (grant.holder && grant.holder !== holder)
        return c.json({ error: "invalid_token" }, 401, {
          "WWW-Authenticate": 'DPoP error="invalid_token"',
        });
      if (grant.holder !== holder) ctx.markDirty();
      grant.holder = holder;
      // The browser that approved this consent now sees this user's copy.
      if (isolated && grant.browser) ctx.link(grant.browser, holder);
    }
    if (!session) {
      for (const [k, v] of Object.entries(state.sessions))
        if (v.expires < now - 86400000) delete state.sessions[k];
      if (ctx.overShare(Object.values(state.sessions), verified.clientId, 2000))
        return c.body(null, 429);
      session = state.sessions[sid] = {
        client: verified.clientId,
        user: verified.userId,
        ...(verified.agentId ? { agent: verified.agentId } : {}),
        expires: now + SESSION_MS,
      };
    }
    if (record) session.account ??= record.accountId;
    if (isolated)
      ctx.tenantKeys.set(
        c.req.raw,
        ctx.holderOf(verified.clientId, verified.userId),
      );
    ctx.sessions.set(c.req.raw, {
      ...session,
      operations: (await ctx.client(verified.clientId)).operations,
      ...(record
        ? {
            account: record.accountId,
            grant: record.grant,
            scopes: record.scopes,
          }
        : {}),
    });
    if (new URL(c.req.url).pathname.startsWith("/api/account")) {
      const needed = c.req.method === "POST" ? def.writeScope : def.readScope;
      if (!record)
        return c.body(null, 401, {
          "WWW-Authenticate": `DPoP scope="${needed}"`,
        });
      if (!record.scopes.split(" ").includes(needed))
        return c.json({ error: "insufficient_scope" }, 403, {
          "WWW-Authenticate": `DPoP error="insufficient_scope", scope="${needed}"`,
        });
      // Operations v2 §2: never return operations to an agent without v2.
      if (c.req.method === "POST" && !record.operations)
        return c.json(
          { error: "extension_required", extension: "operations" },
          403,
          {
            "WWW-Authenticate":
              'DPoP error="extension_required", extension="operations"',
          },
        );
      // §7: a retry of a performed operation gets its first response.
      if (c.req.method === "POST") {
        const s = ctx.sessions.get(c.req.raw)!;
        const first = tenancy.enter(c.req.raw).engine.replay(
          {
            client: s.client,
            user: s.user,
            account: s.account ?? def.defaultAccount,
          },
          c.req.header("poppy-approval"),
        );
        if (first) return c.json(first, 200);
      }
    }
    await next();
  });
}

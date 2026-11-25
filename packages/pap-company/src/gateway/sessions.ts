/**
 * The Session header and access tokens at the APIs and conversations (§3.4,
 * §5.3, §7): checks `Poppy-Version`, reads `Poppy-Extensions`, verifies
 * `Poppy-Session`, finds the Session by client, `sid` and User ID, refuses
 * routes that need an undeclared extension (§3.3), keeps one account per
 * Session, enforces scopes and Operations v3 on account routes, and replays
 * performed operations (Operations §7).
 */
import type { Hono } from "hono";
import {
  parseExtensionsHeader,
  tokenHash,
  verifySessionHeader,
} from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import {
  declares,
  hash,
  isChallenge,
  SESSION_MS,
  type ExtensionVersion,
  type Token,
} from "./types.ts";
import type { Tenancy } from "./tenancy.ts";

/** Operations v3 (Operations §2), which account POSTs always need. */
const OPERATIONS: ExtensionVersion = { name: "operations", version: "3" };

/** Session destinations (§5.2): the APIs and the conversation routes (§8.2). */
const guarded = (path: string) =>
  path.startsWith("/api/") ||
  path === "/poppy/conversations" ||
  path === "/poppy/feedback" ||
  path.startsWith("/poppy/conversations/");

export function mountSessions(app: Hono, ctx: Ctx, tenancy: Tenancy) {
  const { def, origin, state, replay, isolated } = ctx;
  app.use("*", async (c, next) => {
    if (!guarded(new URL(c.req.url).pathname)) return next();
    // Without a Session header, nothing else can be checked (§5.3).
    if (!c.req.header("poppy-session"))
      return c.json({ error: "invalid_session" }, 400);
    // §3.4: this Company serves 1.0; any 1.x Personal Agent is compatible.
    if (!/^1\.\d{1,3}$/.test(c.req.header("poppy-version") ?? ""))
      return c.json({ error: "version_unsupported" }, 400);
    const declared = parseExtensionsHeader(c.req.header("poppy-extensions"));
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
    // §5.3: a Session is named by client_id, sid and User ID; another User
    // ID with a known sid is another Session.
    const sid = hash(
      `${verified.clientId}\n${verified.sessionId}\n${verified.userId}`,
    );
    let session = state.sessions[sid];
    // §5.5: an ended Session gets session_ended; the agent starts a new one.
    if (session && session.expires < now)
      return c.json({ error: "session_ended" }, 400);
    // Its Agent ID is fixed when it starts (guides: Sessions).
    if (session && (session.agent ?? null) !== (verified.agentId ?? null))
      return c.json({ error: "invalid_session" }, 400);
    // §3.3: a route the Company handles only with an extension refuses a
    // request that doesn't declare it, in a JSON body, not as a token error
    // (§7). It comes after the version and the Session, which say what the
    // declarations mean and whose they are, and before the access token:
    // only a new Session that declares it can fix this (§3.4), so refreshing,
    // a nonce retry or a sign-in in front of it would be wasted, and a
    // refused request touches no grant or Session. Operations v3 on account
    // POSTs keeps its own check below, after the scopes, as before.
    const path = new URL(c.req.url).pathname;
    const extension = def.requiredExtension?.({ path, method: c.req.method });
    if (extension && !declares(declared, extension))
      return c.json(
        { error: "extension_required", extension: extension.name },
        403,
      );
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
      // One account per Session: a second one ends it (§5.4).
      if (session?.account && session.account !== record.accountId)
        return c.json({ error: "session_ended" }, 400);
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
    // An idle timeout: each request keeps the Session going (§5.5).
    session.expires = now + SESSION_MS;
    if (record) session.account ??= record.accountId;
    if (isolated)
      ctx.tenantKeys.set(
        c.req.raw,
        ctx.holderOf(verified.clientId, verified.userId),
      );
    const operations = declares(declared, OPERATIONS);
    ctx.sessions.set(c.req.raw, {
      ...session,
      // As this request declares them: §3.4 asks the agent, not the
      // Company, to keep them the same throughout a Session.
      extensions: declared,
      // Operations v3 §2: used only when this request declares version 3.
      operations,
      ...(record
        ? {
            account: record.accountId,
            grant: record.grant,
            scopes: record.scopes,
          }
        : {}),
    });
    if (path.startsWith("/api/account")) {
      const needed = def.requiredScopes?.({ path, method: c.req.method }) ?? [
        c.req.method === "POST" ? def.writeScope : def.readScope,
      ];
      const scope = needed.join(" ");
      if (!needed.length)
        return c.json({ error: "invalid_scope_configuration" }, 500);
      if (!record)
        return c.body(null, 401, {
          "WWW-Authenticate": `DPoP scope="${scope}"`,
        });
      const granted = record.scopes.split(" ");
      if (needed.some((required) => !granted.includes(required)))
        return c.json({ error: "insufficient_scope" }, 403, {
          "WWW-Authenticate": `DPoP error="insufficient_scope", scope="${scope}"`,
        });
      // Operations v3 §2: never return operations to a request that doesn't
      // declare version 3. A JSON body, not a token error (§3.3).
      if (c.req.method === "POST" && !operations)
        return c.json(
          { error: "extension_required", extension: OPERATIONS.name },
          403,
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

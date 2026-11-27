/**
 * The Session header and access tokens at the APIs and conversations (§3.4,
 * §5.3, §7): checks `Poppy-Version`, reads `Poppy-Extensions`, verifies
 * `Poppy-Session`, finds the Session by client, `sid` and User ID, refuses
 * routes that need an undeclared extension (§3.3), keeps one account per
 * Session, enforces scopes and Operations v3 on account routes (the
 * Company's `accountPrefixes`), and replays performed operations
 * (Operations §7). The MCP server (`mcp.ts`) verifies its requests and
 * checks each tool's route with the same two functions.
 */
import type { Context, Hono } from "hono";
import {
  parseExtensionsHeader,
  tokenHash,
  verifySessionHeader,
} from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import {
  BROWSER_SESSION_PATH,
  declares,
  hash,
  isChallenge,
  SESSION_MS,
  type CompanyDefinition,
  type ExtensionVersion,
  type Token,
} from "./types.ts";
import type { Tenancy } from "./tenancy.ts";

/** Operations v3 (Operations §2), which account POSTs always need. */
export const OPERATIONS: ExtensionVersion = {
  name: "operations",
  version: "3",
};

/**
 * Session destinations (§5.2): the APIs, the account routes (§7), the
 * conversation routes (§8.2), feedback and the browser authorization (§6).
 * Every request to one needs a verified Session header, and none reads a
 * cookie. The MCP server checks its own (`mcp.ts`).
 */
export const sessionDestination = (ctx: Ctx, path: string) =>
  path.startsWith("/api/") ||
  ctx.accountPrefixes.some((prefix) => path.startsWith(prefix)) ||
  path === "/poppy/conversations" ||
  path === "/poppy/feedback" ||
  path === `${BROWSER_SESSION_PATH}/authorize` ||
  path.startsWith("/poppy/conversations/");

/** Where a request is verified: the service its token must be for. */
export type Service = {
  /** The token's `resource` (§4.5); none for the default token. */
  resource?: string;
  /** RFC 9728 §5.1: named in every challenge, as an MCP server does (§7). */
  metadata?: string;
  /**
   * Also takes Bearer tokens issued for it (§4.5), as the MCP server does:
   * each only with a Session header whose `ath` covers it (§5.2).
   */
  bearer?: boolean;
};

/**
 * A token challenge for each scheme `service` accepts (§7), each with its
 * metadata when it names one.
 */
export const challengeFor = (
  service: { metadata?: string | undefined; bearer?: boolean | undefined },
  params?: string,
) =>
  (service.bearer ? ["DPoP", "Bearer"] : ["DPoP"])
    .map((scheme) =>
      [
        scheme,
        [params, service.metadata && `resource_metadata="${service.metadata}"`]
          .filter(Boolean)
          .join(", "),
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(", ");

/**
 * Why an account route turns a request down before its handler (§7,
 * Operations §2), or the first response of an operation it performed
 * (Operations §7). Each interface says it in its own way.
 */
export type RouteAnswer =
  | { kind: "sign_in"; scopes: string[] }
  | { kind: "insufficient_scope"; scopes: string[] }
  | { kind: "extension_required"; extension: string }
  | { kind: "replay"; body: unknown };

/** The scopes an account route needs, or `undefined` for another route. */
export const routeScopes = (
  def: CompanyDefinition,
  path: string,
  method: string,
) =>
  (def.accountPrefixes ?? ["/api/account"]).some((prefix) =>
    path.startsWith(prefix),
  )
    ? (def.requiredScopes?.({ path, method }) ?? [
        method === "POST" ? def.writeScope : def.readScope,
      ])
    : undefined;

export function mountSessions(app: Hono, ctx: Ctx, tenancy: Tenancy) {
  const { def, origin, state, replay, isolated } = ctx;
  /**
   * Verifies a request's Session header and token for `service`, and keeps
   * the Session for its handlers (`sessionFor`, `tenantKeys`). Returns the
   * refusal, or nothing when the request may go on.
   */
  async function verify(
    c: Context,
    service: Service = {},
  ): Promise<Response | undefined> {
    // Without a Session header, nothing else can be checked (§5.3).
    if (!c.req.header("poppy-session"))
      return c.json({ error: "invalid_session" }, 400);
    // §3.4: this Company serves 1.0; any 1.x Personal Agent is compatible.
    if (!/^1\.\d{1,3}$/.test(c.req.header("poppy-version") ?? ""))
      return c.json({ error: "version_unsupported" }, 400);
    const declared = parseExtensionsHeader(c.req.header("poppy-extensions"));
    const authorization = c.req.header("authorization") ?? "";
    const [, scheme, token] = /^(DPoP|Bearer) (\S+)$/.exec(authorization) ?? [];
    const invalidToken = (metadata = service.metadata) =>
      c.json({ error: "invalid_token" }, 401, {
        "WWW-Authenticate": challengeFor(
          { ...service, metadata },
          'error="invalid_token"',
        ),
      });
    if (authorization && !token) return invalidToken();
    // A Bearer token is bound only by the Session header's `ath`, which the
    // verification below checks, as it does for a DPoP token (§5.3).
    const bearer = scheme === "Bearer";
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
          // The Session JWT stands in for a Bearer token's DPoP proof.
          ...(bearer ? { replay } : {}),
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
        grant.expires < now ||
        // Each token in its own scheme (RFC 9449 §7.1, RFC 6750 §2.1).
        bearer !== !record.binding
      )
        return invalidToken();
      // §4.5: a token for one service works only there, and the default
      // token works everywhere else. The challenge names this service's
      // metadata, so an agent with stale metadata learns where it is.
      if (
        record.resource !== service.resource ||
        (!record.binding && !service.bearer)
      )
        return invalidToken(
          service.metadata ?? `${origin}/.well-known/oauth-protected-resource`,
        );
      // Errors of the DPoP proof name DPoP only: a Bearer token has none.
      const dpop = { metadata: service.metadata };
      if (record.binding)
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
              "WWW-Authenticate": challengeFor(dpop, 'error="use_dpop_nonce"'),
              "DPoP-Nonce": e.nonce,
            });
          return c.json({ error: "invalid_dpop_proof" }, 401, {
            "WWW-Authenticate": challengeFor(
              dpop,
              'error="invalid_dpop_proof"',
            ),
          });
        }
      // One account per Session: a second one ends it (§5.4).
      if (session?.account && session.account !== record.accountId)
        return c.json({ error: "session_ended" }, 400);
      // A grant serves only the agent user that first used it.
      const holder = ctx.holderOf(verified.clientId, verified.userId);
      if (grant.holder && grant.holder !== holder) return invalidToken();
      if (grant.holder !== holder) ctx.markDirty(c.req.raw);
      grant.holder = holder;
      // The browser that approved this consent now sees this user's copy.
      if (isolated && grant.browser) ctx.link(c.req.raw, grant.browser, holder);
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
    ctx.sessionKeys.set(c.req.raw, sid);
    ctx.sessions.set(c.req.raw, {
      ...session,
      // As this request declares them: §3.4 asks the agent, not the
      // Company, to keep them the same throughout a Session.
      extensions: declared,
      // Operations v3 §2: used only when this request declares version 3.
      operations: declares(declared, OPERATIONS),
      ...(record
        ? {
            account: record.accountId,
            grant: record.grant,
            scopes: record.scopes,
          }
        : {}),
    });
    return undefined;
  }
  /**
   * An account route's checks (§7) for a verified request: the scopes, a
   * token challenge without a token, Operations v3 on POST, and the first
   * response of a performed operation. Nothing for any other route.
   */
  function route(
    request: Request,
    path: string,
    method: string,
    approval: string | undefined,
  ): RouteAnswer | undefined {
    const needed = routeScopes(def, path, method);
    if (!needed) return undefined;
    const s = ctx.sessions.get(request)!;
    // An empty list: a token of any scope, and the route checks the rest.
    if (s.scopes === undefined) return { kind: "sign_in", scopes: needed };
    const granted = s.scopes.split(" ");
    if (needed.some((required) => !granted.includes(required)))
      return { kind: "insufficient_scope", scopes: needed };
    // Operations v3 §2: never return operations to a request that doesn't
    // declare version 3. Only POSTs propose operations; other methods are
    // the route's own business.
    if (method !== "POST") return undefined;
    if (!s.operations)
      return { kind: "extension_required", extension: OPERATIONS.name };
    // §7: a retry of a performed operation gets its first response.
    const first = tenancy.enter(request).engine.replay(
      {
        client: s.client,
        user: s.user,
        account: s.account ?? def.defaultAccount,
      },
      approval,
    );
    return first ? { kind: "replay", body: first } : undefined;
  }
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (!sessionDestination(ctx, path)) return next();
    const refused = await verify(c);
    if (refused) return refused;
    const answer = route(
      c.req.raw,
      path,
      c.req.method,
      c.req.header("poppy-approval"),
    );
    if (answer?.kind === "sign_in")
      return c.body(null, 401, {
        "WWW-Authenticate": answer.scopes.length
          ? `DPoP scope="${answer.scopes.join(" ")}"`
          : "DPoP",
      });
    if (answer?.kind === "insufficient_scope")
      return c.json({ error: "insufficient_scope" }, 403, {
        "WWW-Authenticate": `DPoP error="insufficient_scope", scope="${answer.scopes.join(" ")}"`,
      });
    // A JSON body, not a token error (§3.3).
    if (answer?.kind === "extension_required")
      return c.json(
        { error: "extension_required", extension: answer.extension },
        403,
      );
    if (answer?.kind === "replay") return c.json(answer.body, 200);
    await next();
  });
  return { verify, route };
}
export type Sessions = ReturnType<typeof mountSessions>;

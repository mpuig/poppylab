/**
 * A PAP 0.3 Company gateway on Hono and Web APIs, so the same code runs in
 * Node and in Cloudflare Workers (`nodejs_compat`). It provides discovery
 * metadata (RFC 8414/9728), Direct Sign-In (PKCE S256, private_key_jwt),
 * DPoP-bound access tokens, refresh and revocation (RFC 7009), verification
 * of the delegated `Poppy-Session` header, one account per Session, and the
 * Operations v2 extension. Each Company supplies its scopes, consent page,
 * test customers, OpenAPI contract and business routes.
 *
 * State is single-writer: one in-memory object persisted by a `Store` when
 * a request may have changed it (a file vault in Node, a Durable Object in
 * Cloudflare).
 *
 * Tenancy: with `isolation: "visitor"` each agent user (client_id + user id
 * from the signed Session header) gets its own copy of the business data,
 * seeded fresh and evicted when idle, so public visitors never share the
 * fictional customers. `"shared"` (default) keeps one copy, which a local
 * Company website can show next to the agent.
 *
 * The sections live under `gateway/`: `context` (shared state and helpers),
 * `persistence`, `discovery`, `signin`, `tokens`, `sessions` and `tenancy`.
 * Middleware order matters: body limit and persistence first, the Session
 * middleware before the business dispatch.
 */
import { Hono } from "hono";
import { createContext } from "./gateway/context.ts";
import { mountPersistence } from "./gateway/persistence.ts";
import { mountDiscovery } from "./gateway/discovery.ts";
import { mountSignIn } from "./gateway/signin.ts";
import { mountTokens } from "./gateway/tokens.ts";
import { mountSessions } from "./gateway/sessions.ts";
import { createTenancy } from "./gateway/tenancy.ts";
import type { CompanyDefinition, Deployment } from "./gateway/types.ts";

export * from "./gateway/types.ts";

export function createCompany(def: CompanyDefinition, deploy: Deployment) {
  const ctx = createContext(def, deploy);
  const app = new Hono();
  mountPersistence(app, ctx);
  mountDiscovery(app, ctx);
  const { codes } = mountSignIn(app, ctx);
  mountTokens(app, ctx, codes);
  const tenancy = createTenancy(ctx);
  mountSessions(app, ctx, tenancy);
  tenancy.mountDispatch(app);
  return app;
}

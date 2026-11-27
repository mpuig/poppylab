/**
 * A PAP 1.0 Company gateway on Hono and Web APIs, so the same code runs in
 * Node and in Cloudflare Workers (`nodejs_compat`). It provides discovery
 * metadata (RFC 8414/9728), Direct Sign-In (PKCE S256, private_key_jwt),
 * Device Sign-In (RFC 8628) on the same consent page, DPoP-bound access
 * tokens, refresh and revocation (RFC 7009), verification
 * of the delegated `Poppy-Session` header, one account per Session, and the
 * Operations v3 extension. Each Company supplies its scopes, consent page,
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
 * `persistence`, `discovery`, `signin`, `device` (§4.3), `tokens`, `sessions`, `tenancy`,
 * `conversations` (§8, when the Company defines an `agent`), `feedback`
 * (§9.3), `skills` (§9.4, when the Company publishes any),
 * `browser-session` (§6) and `mcp` (section 7, when `poppy.json` lists the
 * MCP server: the OpenAPI operations as tools, through the same checks).
 * Middleware order matters: body limit and persistence first, then the
 * refusal of changes from a joined browser, and the Session middleware
 * before the business dispatch.
 */
import { Hono } from "hono";
import { createContext } from "./gateway/context.ts";
import { mountPersistence } from "./gateway/persistence.ts";
import { mountDiscovery } from "./gateway/discovery.ts";
import { mountSignIn } from "./gateway/signin.ts";
import { mountDevice } from "./gateway/device.ts";
import { mountTokens } from "./gateway/tokens.ts";
import { mountSessions } from "./gateway/sessions.ts";
import { createTenancy } from "./gateway/tenancy.ts";
import { mountConversations } from "./gateway/conversations.ts";
import { mountFeedback } from "./gateway/feedback.ts";
import { mountMcp } from "./gateway/mcp.ts";
import {
  mountBrowserGuard,
  mountBrowserSession,
} from "./gateway/browser-session.ts";
import type { CompanyDefinition, Deployment } from "./gateway/types.ts";

export * from "./gateway/types.ts";
export { feedbackSection } from "./gateway/feedback.ts";
export { skillRowsHtml } from "./gateway/skills.ts";
export {
  mcpToolRowsHtml,
  mcpToolsOf,
  MCP_VERSION,
  type McpTool,
} from "./gateway/mcp.ts";
export {
  agentActivity,
  keepActivity,
  type ActivityEntry,
  type ActivityItem,
} from "./gateway/activity.ts";

export function createCompany(def: CompanyDefinition, deploy: Deployment) {
  const ctx = createContext(def, deploy);
  const app = new Hono();
  mountPersistence(app, ctx);
  // Before every route a browser could post to, the consent page included.
  mountBrowserGuard(app, ctx);
  mountDiscovery(app, ctx);
  const signIn = mountSignIn(app, ctx);
  if (def.deviceSignIn !== false) mountDevice(app, ctx, signIn);
  mountTokens(app, ctx, signIn.codes);
  const tenancy = createTenancy(ctx);
  const sessions = mountSessions(app, ctx, tenancy);
  mountMcp(app, ctx, sessions, tenancy);
  mountConversations(app, ctx, tenancy);
  mountFeedback(app, ctx, tenancy);
  mountBrowserSession(app, ctx);
  tenancy.mountDispatch(app);
  return app;
}

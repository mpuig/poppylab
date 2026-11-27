/**
 * The Personal Agent's core: conversations with Companies over PAP 1.0,
 * for any channel (docs/pap-agent.md). This entry is the channel-neutral
 * API; each module is also its own entry point
 * (`@poppy-lab/pap-agent/<module>`), so a page imports only what it shows.
 */
export * from "./api";
export * from "./api-events";
export { API_PREFIX, ROUTES, v1 } from "./api-http";
export { openApiDocument } from "./openapi";
export * from "./identity";
export { configureAgent, agentName, type AgentProfile } from "./agent";
export {
  configureBackend,
  configureStorage,
  type Backend,
  type Versioned,
} from "./runs";
export type { Caller, CookieStore, Reply } from "./web";

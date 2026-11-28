/**
 * The Personal Agent's core: conversations with Companies over PAP 1.0,
 * for any channel (docs/pap-agent.md). This entry is the channel-neutral
 * API. The package also exposes an explicit set of entry points for the
 * parts used by the playground, without exposing every source module.
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

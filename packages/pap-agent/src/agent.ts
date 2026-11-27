/**
 * Who the agent is, for the sentences it says in its own voice ("Iris
 * connected it to this conversation", "Approved by Iris on your standing
 * instruction"). The name is the channel's configuration, never the
 * core's: the playground calls its agent Iris.
 *
 * A channel calls `configureAgent` once, before its first request. A web
 * page that renders the core's sentences in the browser can't count on
 * that call having run in every bundle, so a build may also set the name
 * in `AGENT_NAME`, which the bundler writes into the code.
 */
export type AgentProfile = {
  /** How the agent is named to the User, as in "Iris connected it". */
  name: string;
};

const global = globalThis as typeof globalThis & {
  papAgentProfile?: AgentProfile;
};

export function configureAgent(profile: AgentProfile) {
  global.papAgentProfile = { ...profile };
}

/** The name used when no channel configured one. */
export const DEFAULT_AGENT_NAME = "Agent";

export function agentName() {
  return (
    global.papAgentProfile?.name ??
    (typeof process === "undefined" ? undefined : process.env.AGENT_NAME) ??
    DEFAULT_AGENT_NAME
  );
}

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The tests read the agent's sentences as the playground configures
    // them: its agent is called Iris (`agentName`).
    env: { AGENT_NAME: "Iris" },
  },
});

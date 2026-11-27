/**
 * The playground's configuration of the agent's core
 * (`@poppy-lab/pap-agent`). Every route that reaches the core imports
 * this first: the agent is called Iris, and on Workers conversations are
 * kept in the visitor's Durable Object; in Node the core keeps them
 * itself.
 */
import { onWorkers } from "@poppy-lab/pap-client";
import { configureAgent } from "@poppy-lab/pap-agent/agent";
import { configureStorage } from "@poppy-lab/pap-agent/runs";
import { AGENT_NAME } from "./agent-name";
import { visitorStorage } from "./visitor-storage";

configureAgent({ name: AGENT_NAME });
if (onWorkers()) configureStorage(visitorStorage);

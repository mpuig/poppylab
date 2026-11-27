/**
 * The playground's configuration of the agent's core
 * (`@poppy-lab/pap-agent`). Every route that reaches the core imports
 * this first: on Workers, conversations are kept in the visitor's
 * Durable Object; in Node the core keeps them itself.
 */
import { onWorkers } from "@poppy-lab/pap-client";
import { configureStorage } from "@poppy-lab/pap-agent/runs";
import { visitorStorage } from "./visitor-storage";

if (onWorkers()) configureStorage(visitorStorage);

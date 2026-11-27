/**
 * The playground's configuration of the agent's core
 * (`@poppy-lab/pap-agent`). Every route that reaches the core imports
 * this first: the agent is called Iris, and on Workers conversations are
 * kept in the visitor's Durable Object and agent accounts in their own,
 * and the free model is the Worker's Workers AI binding; in Node the core
 * keeps both itself, in memory, with the conversations also in the vault,
 * and there is no free model.
 */
import { onWorkers } from "@poppy-lab/pap-client";
import { configureAgent } from "@poppy-lab/pap-agent/agent";
import { configureAccountStorage } from "@poppy-lab/pap-agent/account-store";
import { configureFreeModel } from "@poppy-lab/pap-agent/free-model";
import { configureStorage } from "@poppy-lab/pap-agent/runs";
import { AGENT_NAME } from "./agent-name";
import { accountStorage, visitorStorage, workersAi } from "./visitor-storage";

configureAgent({ name: AGENT_NAME });
if (onWorkers()) {
  configureStorage(visitorStorage);
  configureAccountStorage(accountStorage);
  configureFreeModel({ binding: workersAi });
}

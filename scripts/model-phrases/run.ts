/**
 * `pnpm phrases`: about fifteen real phrases, asked of a real model
 * through the agent's own code, by hand before a promotion and never in
 * CI. See docs/model-phrases.md.
 *
 * The environment is set before the agent's core is loaded: development
 * on this machine, with the lab's Companies on their local addresses, and
 * nothing of a deployment's (its public origin, public mode or keys).
 */
import process from "node:process";

process.env.NODE_ENV = "development";
process.env.PAP_ALLOW_PRIVATE_NETWORK = "true";
for (const name of [
  "AGENT_PUBLIC_ORIGIN",
  "POPPY_PUBLIC",
  "POPPY_IDENTITY",
  "POPPY_STATE_KEY",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
])
  delete process.env[name];

void import("./runner.ts")
  .then(({ main }) => main(process.argv.slice(2)))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    // The Companies' and wrangler's sockets would keep the process open.
    setTimeout(() => process.exit(), 500).unref();
  });

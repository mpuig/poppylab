import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { AGENT_NAME } from "./lib/agent-name";

export default defineConfig({
  resolve: {
    alias: { "@/": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // As next.config.ts gives it to the page's bundles.
    env: { AGENT_NAME },
    // A Worker build leaves traced copies of the workspace, tests included,
    // under these folders: they are build output, not this package's tests.
    exclude: [...configDefaults.exclude, ".next/**", ".open-next/**"],
  },
});

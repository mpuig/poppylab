import { test as base } from "@playwright/test";
import { startServers } from "./servers.ts";

/**
 * The scenario's test, with the servers started for its worker. Playwright
 * starts a new worker for a retry, so a retry gets new servers too, with
 * every Company's fictional accounts as they were: the plan switch and the
 * order change of a first attempt are not there to refuse the second.
 */
export const test = base.extend<object, { servers: void }>({
  servers: [
    // Playwright reads the fixtures a fixture uses from this pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const stop = await startServers();
      try {
        await use();
      } finally {
        await stop();
      }
    },
    { scope: "worker", auto: true, timeout: 240_000 },
  ],
});
export { expect } from "@playwright/test";

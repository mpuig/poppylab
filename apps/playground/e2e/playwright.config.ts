/**
 * The browser scenario (`pnpm e2e`): one long conversation in the real
 * playground, in Chromium, against local Companies and a scripted model
 * (`e2e/`). It is not part of `pnpm test`.
 */
import { defineConfig, devices } from "@playwright/test";
import { PLAYGROUND } from "./servers.ts";

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "../test-results/run",
  // The whole conversation is one test.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { open: "never", outputFolder: "../test-results/report" }],
      ]
    : [["list"]],
  use: {
    baseURL: PLAYGROUND,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The playground answers in the conversation's language; the page's
    // own clock reads times in the browser's.
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

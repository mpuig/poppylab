/**
 * Browser join (§6) at Juniper: the endpoint is listed and its page loads.
 * The three steps are tested where they are built, in the gateway
 * (`packages/pap-company/src/gateway/browser-session.test.ts`).
 */
import { expect, it } from "vitest";
import { juniperApp } from "./test-app.js";

const origin = "http://juniper.localhost:4100";

it("lists its browser-session endpoint, and serves the page there", async () => {
  const { app } = juniperApp({ fetchJson: async () => ({}) });
  const discovery = (await (
    await app.request("/.well-known/poppy.json")
  ).json()) as { web: Record<string, unknown> };
  // Nothing else: the website isn't `unscoped`, since no join signs in.
  expect(discovery.web).toEqual({
    browser_session_endpoint: `${origin}/poppy/browser-session`,
  });
  const page = await app.request("/poppy/browser-session");
  expect(page.status).toBe(200);
  expect(page.headers.get("cache-control")).toBe("no-store");
  const html = await page.text();
  expect(html).toContain("Juniper Market");
  expect(html).toMatch(
    /<form method="post" action="\/poppy\/browser-session"><input type="hidden" name="code" value="bc_[\w.-]+"><button>Continue<\/button><\/form>/,
  );
  // Joins are signed out, so the scope that signs a browser in isn't offered.
  const metadata = (await (
    await app.request("/.well-known/oauth-authorization-server")
  ).json()) as { scopes_supported: string[] };
  expect(metadata.scopes_supported).not.toContain("poppy:browser-sign-in");
});

import { expect, it } from "vitest";
import { setup } from "./test-harness.ts";

it("lets the consent page load the utility's own faces", async () => {
  const h = await setup();
  const { page } = await h.authorize("elena", ["account:read"]);
  const policy = String(page.headers["content-security-policy"]);
  expect(policy).toContain(
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
  );
  expect(policy).toContain("font-src https://fonts.gstatic.com");
  expect(policy).not.toContain("script-src");
  expect(page.body).toContain("family=IBM+Plex+Sans");
});

import { expect, it } from "vitest";
import { fernwick } from "./fernwick.ts";
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

it("opens the consent page on the customer the gateway names, else on the first", () => {
  const page = (account?: string) =>
    fernwick.consent({
      nonce: "n",
      passwordRequired: false,
      scopes: "account:read",
      client: "Iris",
      clientHost: "poppylab.dev",
      ...(account ? { account } : {}),
    });
  expect(page("robin")).toContain('id="account-robin" value="robin" checked>');
  expect(page("robin")).not.toContain('value="elena" checked');
  expect(page()).toContain('id="account-elena" value="elena" checked>');
});

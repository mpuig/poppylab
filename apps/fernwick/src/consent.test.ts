import { expect, it } from "vitest";
import { fernwick } from "./fernwick.ts";
import { inject, origin, setup } from "./test-harness.ts";

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

it("answers a consent page that ran out with a page of the utility, and a tool with the error", async () => {
  await setup();
  // A page the utility no longer holds, from a browser without its cookie.
  const allow = (headers: Record<string, string>) =>
    inject({
      method: "POST",
      url: "/oauth/authorize",
      headers,
      payload: { nonce: "n".repeat(32), decision: "approve", account: "elena" },
    });
  const page = await allow({ origin, accept: "text/html,*/*;q=0.8" });
  expect(page.statusCode).toBe(400);
  expect(page.headers["content-type"]).toContain("text/html");
  expect(page.body).toContain(
    "<title>This page has expired · Fernwick Power &amp; Light</title>",
  );
  expect(page.body).toContain(
    '<span class="brand">Fernwick Power &amp; Light</span>',
  );
  expect(page.body).toContain(
    "connect to your Fernwick account works for five minutes after it opens, and this one is older. Your answer arrived too late, so nothing was allowed and nothing has changed.</p><p>To connect the agent, go back to it and start the sign-in again.</p>",
  );
  expect(page.body).not.toMatch(/<form|<script|<button|n{32}/);
  expect(page.headers["content-security-policy"]).toContain(
    "font-src https://fonts.gstatic.com; form-action 'none'",
  );
  const tool = await allow({ origin });
  expect(tool.statusCode).toBe(400);
  expect(tool.json()).toEqual({ error: "invalid_request" });
});

import { afterEach, expect, it, vi } from "vitest";
import { GRANT_MS, TOKEN_MS } from "@poppy-lab/pap-company";
import { consentPage } from "./site.ts";
import { harborline } from "./harborline.ts";
import { client, inject, origin, redirect, setup } from "./test-harness.ts";

afterEach(() => vi.useRealTimers());

const page = (scopes: string) =>
  consentPage({
    nonce: "n",
    passwordRequired: false,
    scopes,
    client: "Iris",
    clientHost: "poppylab.dev",
  });

it("says how long the agent stays connected, in the gateway's own two lengths", () => {
  // The sentence is written from the constants `grantLifetime` returns.
  expect(GRANT_MS).toBe(7 * 24 * 60 * 60 * 1000);
  expect(TOKEN_MS).toBe(60 * 60 * 1000);
  const html = page("accounts:read offline_access");
  expect(html).toContain(
    "The agent stays connected for 7 days. Without this, it is disconnected after 1 hour. Optional and off by default.",
  );
  // Off until the customer ticks it.
  expect(html).toContain(
    '<h3>While you&#39;re away</h3><label class="sheet-option"><input type="checkbox" name="allow_offline" value="yes">',
  );
  expect(page("accounts:read")).not.toContain("allow_offline");
});

it("lets the consent page load the bank's own faces", async () => {
  const h = await setup();
  const { page } = await h.authorize("elena", ["accounts:read"]);
  const policy = String(page.headers["content-security-policy"]);
  expect(policy).toContain(
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
  );
  expect(policy).toContain("font-src https://fonts.gstatic.com");
  expect(policy).not.toContain("script-src");
  expect(page.body).toContain("family=Barlow+Condensed");
});

it("lists each requested permission in words, each change as its own ticked option, and no scope name", () => {
  const html = page("accounts:read cards:read transfers:request cards:write");
  expect(html).toContain("Iris wants to connect to your Harborline account");
  for (const words of [
    "<strong>Owned accounts and balances</strong>",
    "<strong>Cards, masked digits, status and limits</strong>",
    '<input type="checkbox" name="allow_transfers_request" value="yes" checked>',
    '<input type="checkbox" name="allow_cards_write" value="yes" checked>',
    "No real account exists.",
  ])
    expect(html).toContain(words);
  for (const scope of ["accounts:read", "transfers:request", "cards:write"])
    expect(html).not.toContain(scope);
  expect(html).not.toContain("<script");
});

it("opens the consent page on the customer the gateway names, else on the first", () => {
  const page = (account?: string) =>
    harborline.consent({
      nonce: "n",
      passwordRequired: false,
      scopes: "accounts:read",
      client: "Iris",
      clientHost: "poppylab.dev",
      ...(account ? { account } : {}),
    });
  expect(page("robin")).toContain('id="account-robin" value="robin" checked>');
  expect(page("robin")).not.toContain('value="elena" checked');
  expect(page()).toContain('id="account-elena" value="elena" checked>');
});

it("answers Allow on a consent page left open too long with a page of the bank, and a tool with the error", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await setup();
  const opened = await inject(
    `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state: "s".repeat(32), scope: "accounts:read", code_challenge_method: "S256", code_challenge: "c".repeat(43) })}`,
  );
  const nonce = /name="nonce" value="([^"]+)"/.exec(opened.body)![1]!;
  const allow = (headers: Record<string, string>) =>
    inject({
      method: "POST",
      url: "/oauth/authorize",
      headers,
      payload: { nonce, decision: "approve", account: "elena" },
    });
  // 540 seconds on, the browser no longer holds the page's cookie.
  vi.setSystemTime(Date.now() + 540000);
  const page = await allow({ origin, accept: "text/html,*/*;q=0.8" });
  expect(page.statusCode).toBe(400);
  expect(page.headers["content-type"]).toContain("text/html");
  expect(page.body).toContain(
    "<title>This page has expired · Harborline Bank</title>",
  );
  expect(page.body).toContain('<span class="brand">Harborline Bank</span>');
  expect(page.body).toContain(
    '<h1>This page has expired</h1></div><div class="sheet-expired"><p>A page that asks whether an agent may connect to your Harborline account works for five minutes after it opens, and this one is older. Your answer arrived too late, so nothing was allowed and nothing has changed.</p><p>To connect the agent, go back to it and start the sign-in again.</p>',
  );
  // Nothing of the request, and nothing to press.
  for (const secret of [nonce, "s".repeat(32), "c".repeat(43), redirect])
    expect(page.body).not.toContain(secret);
  expect(page.body).not.toMatch(/<form|<script|<button/);
  expect(String(page.headers["content-security-policy"])).toContain(
    "font-src https://fonts.gstatic.com; form-action 'none'",
  );
  // A tool posting the same answer still gets the protocol's error.
  const tool = await allow({ origin });
  expect(tool.statusCode).toBe(400);
  expect(tool.json()).toEqual({ error: "invalid_request" });
  // A pushed request's page loaded again once the bank has forgotten it.
  const reload = (headers: Record<string, string>) =>
    inject({
      url: `/oauth/authorize?${new URLSearchParams({ client_id: client, request_uri: "urn:ietf:params:oauth:request_uri:gone" })}`,
      headers,
    });
  const again = await reload({ accept: "text/html,*/*;q=0.8" });
  expect(again.statusCode).toBe(400);
  expect(again.body).toContain(
    "<title>This page has expired · Harborline Bank</title>",
  );
  expect(again.body).toContain(
    "connect to your Harborline account can be answered once, within five minutes of opening, and this one can&#39;t be shown again. Opening it again changed nothing.</p><p>To connect the agent, go back to it and start the sign-in again.</p>",
  );
  expect((await reload({})).json()).toEqual({ error: "invalid_request_uri" });
});

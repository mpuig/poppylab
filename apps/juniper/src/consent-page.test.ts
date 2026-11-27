import { it, expect } from "vitest";
import { consentPage } from "./consent-page.js";
import { personas } from "./personas.js";
import { juniperApp, localClient } from "./test-app.js";
it("renders complete English consent with native accessible controls and no scripts", () => {
  const html = consentPage("test_nonce", false);
  expect(html).toContain('<html lang="en">');
  for (const text of [
    "Iris wants to connect to your Juniper account",
    "<legend>Sign in as</legend>",
    "What Iris may do",
    "without asking you again",
    "Basket, orders and recurring deliveries",
    "Profile, address",
    "Support cases and their messages",
    "each one waits for your approval",
    "Untick it to give read-only access",
    "Test customers. Choosing one doesn&#39;t verify who you are.",
    'type="radio" name="account" id="account-elena" value="elena" checked',
    'type="radio" name="account" id="account-robin" value="robin">',
    "<strong>Elena Maren</strong><small>Has a recurring delivery</small>",
    'name="write" value="yes" checked>',
    "Nothing changes when you allow.",
    "Connected agents in your Juniper account",
    'value="approve">Allow</button>',
    `value="decline" formnovalidate>Don&#39;t allow</button>`,
    "Juniper Market is a fictional company in Poppy&nbsp;Lab",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("<script");
  expect(html).not.toContain('type="password"');
  // Nothing on the page leads away from the decision.
  expect(html).not.toContain("<a ");
  // The page is built without the visitor's account, so it names no
  // delivery day: the customer may have moved theirs since.
  for (const person of personas) expect(html).not.toContain(person.day);
});
it("says so when nothing is read or no change can be proposed", () => {
  const readOnly = consentPage("n", false, "poppy:read");
  expect(readOnly).toContain(
    "None. If you want a change later, your agent will ask you again.",
  );
  expect(readOnly).not.toContain('name="write"');
  const writeOnly = consentPage("n", false, "poppy:write");
  expect(writeOnly).toContain(
    "No permission to read your account is requested.",
  );
  // All that was asked for can't be unticked and then allowed.
  expect(writeOnly).toContain('name="write" value="yes" checked required>');
  expect(writeOnly).toContain("It does not include read access.");
});
it("escapes consent nonce, retains password protection and allows declining without filling password", () => {
  const html = consentPage('"><script>alert(1)</script>', true);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&#34;&#62;&#60;script&#62;");
  expect(html).toContain('name="password" required');
  expect(html).toContain('autocomplete="current-password"');
  expect(html).toContain("It protects the whole demo");
  expect(html).toContain('value="decline" formnovalidate');
  expect(html).not.toContain('value="approve" formnovalidate');
});
it("shows the agent's self-asserted name with its verified host, escaped", () => {
  const html = consentPage(
    "n",
    false,
    "poppy:read",
    "<b>Iris</b>",
    "agent.example",
  );
  expect(html).toContain(
    '<strong>&#60;b&#62;Iris&#60;/b&#62;</strong><span>from agent.example</span><span class="sheet-verified">address verified</span>',
  );
  expect(html).not.toContain("<b>Iris");
});
it("opens the consent page on the customer the gateway names, else on the first", () => {
  const page = (account?: string) =>
    consentPage("n", false, "poppy:read", "Iris", "poppylab.dev", account);
  expect(page("robin")).toContain('id="account-robin" value="robin" checked>');
  expect(page("robin")).not.toContain('value="elena" checked');
  expect(page()).toContain('id="account-elena" value="elena" checked>');
});
it("answers a consent page that ran out with a page of the shop, and a tool with the error", async () => {
  const origin = "http://juniper.localhost:4100";
  const app = juniperApp({ fetchJson: async () => localClient });
  // A page the shop no longer holds, from a browser without its cookie.
  const allow = (headers: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: "/oauth/authorize",
      headers,
      payload: { nonce: "n".repeat(32), decision: "approve", account: "elena" },
    });
  const page = await allow({ origin, accept: "text/html,*/*;q=0.8" });
  expect(page.statusCode).toBe(400);
  expect(page.headers["content-type"]).toContain("text/html");
  expect(page.body).toContain(
    "<title>This page has expired · Juniper Market</title>",
  );
  expect(page.body).toContain('<span class="brand">Juniper Market</span>');
  expect(page.body).toContain(
    "connect to your Juniper account works for five minutes after it opens, and this one is older. Your answer arrived too late, so nothing was allowed and nothing has changed.</p><p>To connect the agent, go back to it and start the sign-in again.</p>",
  );
  expect(page.body).not.toMatch(/<form|<script|<button|<a |n{32}/);
  expect(page.headers["content-security-policy"]).toContain(
    "style-src 'unsafe-inline'; form-action 'none'",
  );
  const tool = await allow({ origin });
  expect(tool.statusCode).toBe(400);
  expect(tool.json()).toEqual({ error: "invalid_request" });
  // A pushed request's page loaded again once the shop has forgotten it.
  const reload = (headers: Record<string, string>) =>
    app.inject({
      url: `/oauth/authorize?${new URLSearchParams({ client_id: "https://agent.example/client.json", request_uri: "urn:ietf:params:oauth:request_uri:gone" })}`,
      headers,
    });
  const again = await reload({ accept: "text/html,*/*;q=0.8" });
  expect(again.statusCode).toBe(400);
  expect(again.body).toContain(
    "<title>This page has expired · Juniper Market</title>",
  );
  expect(again.body).toContain(
    "connect to your Juniper account can be answered once, within five minutes of opening, and this one can&#39;t be shown again. Opening it again changed nothing.</p><p>To connect the agent, go back to it and start the sign-in again.</p>",
  );
  expect((await reload({})).json()).toEqual({ error: "invalid_request_uri" });
});

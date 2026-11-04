import { it, expect } from "vitest";
import { consentPage } from "./consent-page.js";
it("renders complete English consent with native accessible controls and no scripts", () => {
  const html = consentPage("test_nonce", false);
  expect(html).toContain('<html lang="en">');
  for (const text of [
    "Basket, orders and recurring deliveries",
    "Profile, address",
    "Support cases and their messages",
    "read-only access",
    "Each change needs your separate approval",
    "without further approval",
    "These are fictional accounts",
    'value="alex"',
    'value="maya"',
    'value="leo"',
    'name="write" value="yes" checked',
    'value="approve">Allow access',
    "Connecting Iris from poppylab.dev",
    `value="decline" formnovalidate>Don't allow`,
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("<script");
  expect(html).not.toContain('type="password"');
});
it("escapes consent nonce, retains password protection and allows declining without filling password", () => {
  const html = consentPage('"><script>alert(1)</script>', true);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&#34;&#62;&#60;script&#62;");
  expect(html).toContain('name="password" required');
  expect(html).toContain('autocomplete="current-password"');
  expect(html).toContain("It protects the whole environment");
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
    "Connecting &#60;b&#62;Iris&#60;/b&#62; from agent.example",
  );
  expect(html).not.toContain("<b>Iris");
});

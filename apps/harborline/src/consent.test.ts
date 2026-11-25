import { expect, it } from "vitest";
import { GRANT_MS, TOKEN_MS } from "@poppy-lab/pap-company";
import { consentPage } from "./site.ts";

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

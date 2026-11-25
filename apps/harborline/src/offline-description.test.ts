import { expect, it } from "vitest";
import { GRANT_MS, TOKEN_MS } from "@poppy-lab/pap-company";
import { inject, setup } from "./test-harness.ts";

it("describes offline_access with the grant's two real lifetimes", async () => {
  await setup();
  const discovery = (await inject("/.well-known/poppy.json")).json();
  const description: string = discovery.auth.scopes.offline_access;
  // The sentence is written from the lengths `grantLifetime` returns.
  expect(GRANT_MS).toBe(7 * 24 * 60 * 60 * 1000);
  expect(TOKEN_MS).toBe(60 * 60 * 1000);
  expect(description).toContain("for up to 7 days");
  expect(description).toContain(
    "Without it, the grant ends with its first access token, after 1 hour.",
  );
});

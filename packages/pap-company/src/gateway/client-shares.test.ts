/**
 * Each client's share of the gateway's caps: a fifth by default, so one
 * agent can't use them up for everyone, and more for a client the
 * deployment names in `clientShares`, such as a lab's own agent that all
 * its visitors share.
 */
import { expect, it } from "vitest";
import { memoryStore } from "../memory.ts";
import { client, setup } from "./test-company.ts";
import type { Deployment, Grant } from "./types.ts";

/** A Company where `client` already holds `held` live grants. */
async function holding(held: number, deploy: Partial<Deployment> = {}) {
  const store = memoryStore();
  for (let i = 0; i < held; i++)
    store.value.grants[`g${i}`] = {
      account: "elena",
      id: `g${i}`,
      client,
      scopes: "things:read",
      expires: Date.now() + 86400000,
    } satisfies Grant;
  return setup({ store, ...deploy });
}

// A 429 has no body: "token: " and nothing after it.
it("holds a client to a fifth of the grants: the next sign-in gets 429", async () => {
  const x = await holding(200);
  await expect(x.signIn()).rejects.toThrow(/^token: $/);
});

it("gives a client the deployment names its larger share, and no other", async () => {
  const x = await holding(200, { clientShares: { [client]: 0.6 } });
  expect(await x.signIn()).toHaveProperty("access_token");
  const full = await holding(600, { clientShares: { [client]: 0.6 } });
  await expect(full.signIn()).rejects.toThrow(/^token: $/);
  const other = await holding(200, {
    clientShares: { "https://other.test/client.json": 0.6 },
  });
  await expect(other.signIn()).rejects.toThrow(/^token: $/);
});

it("won't start with a share that isn't more than 0 and at most 1", async () => {
  for (const share of [0, -0.1, 1.5, Number.NaN])
    await expect(
      setup({ clientShares: { [client]: share } }),
      String(share),
    ).rejects.toThrow("clientShares");
});

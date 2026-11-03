import { afterEach, it, expect, vi } from "vitest";
import { createRelay } from "./identity-relay.mjs";
import { URLSearchParams } from "node:url";
const { fetch, Response } = globalThis;
let server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
async function start(data) {
  const fetchPublic = vi.fn(async () => Response.json(data));
  server = createRelay({ fetchPublic });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, fetchPublic };
}
it.each([
  "/api/chat",
  "/api/account",
  "/.poppy/identity.json",
  "/.env.local",
  "/agent/client.json?url=https://evil.example",
])("never proxies private route %s", async (path) => {
  const { base, fetchPublic } = await start({});
  expect((await fetch(base + path)).status).toBe(404);
  expect(fetchPublic).not.toHaveBeenCalled();
});
it("proxies only the fixed public JWKS route and refuses private keys", async () => {
  const { base, fetchPublic } = await start({
    keys: [{ kty: "EC", d: "NEVER_PUBLIC" }],
  });
  const r = await fetch(base + "/agent/jwks.json");
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("NEVER_PUBLIC");
  expect(fetchPublic.mock.calls[0][0]).toBe(
    "http://localhost:3000/agent/jwks.json",
  );
});
it("serves the public identity without publishing the app", async () => {
  const data = {
    client_id: "https://identity.example/agent/client.json",
    jwks_uri: "https://identity.example/agent/jwks.json",
  };
  const { base } = await start(data);
  const r = await fetch(base + "/agent/client.json");
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual(data);
});
it.each(["https://food.papsandbox.com"])(
  "relays the exact approved issuer %s only to fixed localhost, never fetching the code",
  async (issuer) => {
    const { base, fetchPublic } = await start({});
    const query = new URLSearchParams({
      state: "a".repeat(32),
      code: "one-time-code",
      iss: issuer,
    });
    const r = await fetch(base + "/api/account/callback?" + query, {
      redirect: "manual",
    });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(
      "http://localhost:3000/api/account/callback?" + query,
    );
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(fetchPublic).not.toHaveBeenCalled();
  },
);
it("rejects arbitrary callback issuers and redirect parameters", async () => {
  const { base } = await start({});
  for (const extra of [
    "&iss=https://evil.example",
    "&iss=https://api.ample.computer",
    "&iss=https://api.ample.computer/poppy/other",
    "&iss=https://api.ample.computer.evil.example/poppy",
    "&iss=https://food.papsandbox.com&next=https://evil.example",
    "&iss=https://food.papsandbox.com&state=duplicate",
  ]) {
    expect(
      (
        await fetch(
          base +
            "/api/account/callback?state=" +
            "a".repeat(32) +
            "&code=x" +
            extra,
          { redirect: "manual" },
        )
      ).status,
    ).toBe(400);
  }
});

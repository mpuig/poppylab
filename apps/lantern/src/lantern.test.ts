import { afterEach, expect, it, vi } from "vitest";
import { createIdentity } from "@poppy-lab/pap-client/core";
import {
  createCompany,
  memoryStore,
  splitStore,
  type KeyValue,
} from "@poppy-lab/pap-company";
import { lantern } from "./lantern.ts";
import {
  client,
  inject,
  lab,
  origin,
  redirect,
  setup,
} from "./test-harness.ts";
afterEach(() => vi.restoreAllMocks());

it("publishes its own issuer, scopes and an Operations v2 contract", async () => {
  const x = await setup();
  const metadata = (
    await inject("/.well-known/oauth-authorization-server")
  ).json();
  expect(metadata).toMatchObject({
    issuer: origin,
    protected_resources: [origin],
    scopes_supported: ["orders:read", "orders:write"],
    grant_types_supported: ["authorization_code", "refresh_token"],
  });
  const spec = (await inject("/openapi.json")).json();
  expect(spec.info.title).toBe("Lantern Noodle Bar");
  expect(
    spec.paths["/api/account/orders/{order_id}/changes"].post.responses,
  ).toHaveProperty("403");
  // Juniper's routes are not mounted on this Company.
  expect((await x.call("", "GET", "/api/products")).statusCode).toBe(404);
});

it("serves the menu signed out and challenges for orders:read", async () => {
  const x = await setup();
  expect(
    (await x.call("", "GET", "/api/menu")).json().dishes.length,
  ).toBeGreaterThan(3);
  const orders = await x.call("", "GET", "/api/account/orders");
  expect(orders.statusCode).toBe(401);
  expect(orders.headers["www-authenticate"]).toBe('DPoP scope="orders:read"');
});

it("changes a scheduled order only after approval, once, for the right customer", async () => {
  const x = await setup();
  const robin = await x.sign("robin", true);
  expect(robin.scope).toBe("orders:read orders:write");
  const order = (
    await x.call(robin.access_token, "GET", "/api/account/orders")
  ).json().orders[0];
  expect(order).toMatchObject({ id: "ord_LNB2001", slot: { id: "sat-1230" } });
  const url = `/api/account/orders/${order.id}/changes`;
  const body = {
    slot_id: "sun-1300",
    add: [{ dish_id: "veg-gyoza", quantity: 1 }],
  };
  const refused = await x.call(robin.access_token, "POST", url, body);
  expect(refused.statusCode).toBe(403);
  const op = refused.json().operation;
  expect(op.terms).toMatchObject({
    to_slot: "sun-1300",
    price_difference_cents: 750,
  });
  expect(op.summary).toContain("USD 7.50 more");
  // Sam can't use Robin's approval.
  const sam = await x.sign("sam", true);
  expect(
    (await x.call(sam.access_token, "POST", url, body, op)).statusCode,
  ).toBe(404);
  // Read-only access can't even get the operation.
  const read = await x.sign("robin", false);
  expect(
    (await x.call(read.access_token, "POST", url, body)).json().error,
  ).toBe("insufficient_scope");
  const done = await x.call(robin.access_token, "POST", url, body, op);
  expect(done.statusCode).toBe(200);
  expect(done.json().data).toMatchObject({
    slot: { id: "sun-1300" },
    version: 2,
  });
  expect(
    (await x.call(robin.access_token, "POST", url, body, op)).json(),
  ).toEqual(done.json());
  const after = (
    await x.call(robin.access_token, "GET", `/api/account/orders/${order.id}`)
  ).json();
  expect(
    after.items.find((i: { dish_id: string }) => i.dish_id === "veg-gyoza")
      .quantity,
  ).toBe(1);
});

it("performs an operation at most once; another revision gets the first response", async () => {
  const x = await setup();
  const sam = await x.sign("sam", true);
  const url = "/api/account/orders/ord_LNB1001/changes";
  const first = (
    await x.call(sam.access_token, "POST", url, { slot_id: "sat-1900" })
  ).json().operation;
  const second = (
    await x.call(sam.access_token, "POST", url, { remove: ["edamame"] })
  ).json().operation;
  expect(second.operation_id).toBe(first.operation_id);
  expect(
    (
      await x.call(
        sam.access_token,
        "POST",
        url,
        { slot_id: "sat-1900" },
        first,
      )
    ).statusCode,
  ).toBe(200);
  const stale = await x.call(
    sam.access_token,
    "POST",
    url,
    { remove: ["edamame"] },
    second,
  );
  // Same operation (same order version), other revision: already performed,
  // so the first response comes back and nothing else is applied.
  expect(stale.statusCode).toBe(200);
  expect(stale.json().data.slot.id).toBe("sat-1900");
  // A new request is a new action on the new order version.
  const fresh = await x.call(sam.access_token, "POST", url, {
    remove: ["edamame"],
  });
  expect(fresh.json().operation.operation_id).not.toBe(first.operation_id);
  const order = (
    await x.call(sam.access_token, "GET", "/api/account/orders/ord_LNB1001")
  ).json();
  expect(
    order.items.some((i: { dish_id: string }) => i.dish_id === "edamame"),
  ).toBe(true);
});

it.each([
  [{}],
  [{ slot_id: "fri-1830" }],
  [{ slot_id: "mon-0900" }],
  [{ add: [{ dish_id: "pizza", quantity: 1 }] }],
  [{ add: [{ dish_id: "edamame", quantity: 9 }] }],
  [{ remove: ["shoyu-ramen", "edamame"] }],
  [{ remove: ["matcha-ice"] }],
  [{ note: "extra field" }],
])("rejects an invalid or empty change: %j", async (body) => {
  const x = await setup();
  const sam = await x.sign("sam", true);
  const r = await x.call(
    sam.access_token,
    "POST",
    "/api/account/orders/ord_LNB1001/changes",
    body,
  );
  expect(r.statusCode).toBe(400);
});

it("accepts only redirect URIs from the client's own metadata and HTTPS clients", async () => {
  await setup();
  const query = (overrides: Record<string, string>) =>
    "/oauth/authorize?" +
    new URLSearchParams({
      client_id: client,
      redirect_uri: redirect,
      response_type: "code",
      state: "s".repeat(32),
      scope: "orders:read",
      code_challenge_method: "S256",
      code_challenge: "a".repeat(43),
      ...overrides,
    });
  expect((await inject(query({}))).statusCode).toBe(200);
  expect(
    (await inject(query({ redirect_uri: "http://localhost:3000/evil" })))
      .statusCode,
  ).toBe(400);
  // Plain HTTP clients are refused unless explicitly allowed for development.
  expect(
    (
      await inject(query({ client_id: "http://agent.example/client.json" }))
    ).json(),
  ).toEqual({
    error: "invalid_client",
  });
});

it("saves only when state can change, and fails closed if storage fails", async () => {
  const keys = await createIdentity();
  const store = memoryStore();
  lab.app = createCompany(lantern, {
    origin,
    domain: "noodles.localhost",
    store,
    fetchJson: async () => ({ keys: [keys.publicKey] }),
  });
  // Plain reads write nothing; a POST or a Session header does.
  await inject("/health");
  await inject("/.well-known/poppy.json");
  await inject("/api/menu"); // no Session header: refused before any state
  expect(store.saves).toBe(0);
  await inject({ method: "POST", url: "/oauth/revoke", payload: {} });
  expect(store.saves).toBe(1);
  store.save = () => {
    throw new Error("disk full");
  };
  expect(
    (await inject({ method: "POST", url: "/oauth/revoke", payload: {} }))
      .statusCode,
  ).toBe(503);
  expect((await inject("/.well-known/poppy.json")).statusCode).toBe(503);
});

it("limits chunked bodies on the stream and caps one client's share of consents", async () => {
  const x = await setup();
  const big = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(20000)));
      controller.close();
    },
  });
  const chunked = await lab.app.request("/oauth/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: big,
    // @ts-expect-error: streaming request bodies need duplex in Node.
    duplex: "half",
  });
  expect(chunked.status).toBe(413);
  // 100 open consent pages are one client's whole share of 500.
  let last = 200;
  for (let i = 0; i < 101 && last === 200; i++)
    last = (
      await inject(
        `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state: "s".repeat(32), scope: "orders:read", code_challenge_method: "S256", code_challenge: "c".repeat(43) })}`,
      )
    ).statusCode;
  expect(last).toBe(429);
  void x;
});

it("gives each visitor their own customers, and a grant only to its first user", async () => {
  const x = await setup({ isolation: "visitor" });
  const ana = await x.sign("robin", true);
  const url = "/api/account/orders/ord_LNB2001/changes";
  const body = { slot_id: "sun-1300" };
  const op = (
    await x.call(ana.access_token, "POST", url, body, undefined, "usr_ana")
  ).json().operation;
  const done = await x.call(ana.access_token, "POST", url, body, op, "usr_ana");
  expect(done.json().data.slot.id).toBe("sun-1300");
  // Another visitor signs in as the same fictional Robin: untouched copy.
  const ben = await x.sign("robin", true);
  const order = (
    await x.call(
      ben.access_token,
      "GET",
      "/api/account/orders",
      undefined,
      undefined,
      "usr_ben",
    )
  ).json().orders[0];
  expect(order).toMatchObject({ slot: { id: "sat-1230" }, version: 1 });
  // Ana's token can't be replayed for Ben, even by the same client.
  const stolen = await x.call(
    ana.access_token,
    "GET",
    "/api/account/orders",
    undefined,
    undefined,
    "usr_ben",
  );
  expect(stolen.statusCode).toBe(401);
  expect(stolen.json().error).toBe("invalid_token");
  // Public reads still work for anyone.
  expect(
    (await x.call("", "GET", "/api/menu", undefined, undefined, "usr_cy"))
      .statusCode,
  ).toBe(200);
});

it("evicts the least recently used visitor and persists tenants separately", async () => {
  const data = new Map<string, unknown>();
  const kv: KeyValue = {
    async get<T>(k: string) {
      return structuredClone(data.get(k)) as T | undefined;
    },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map(
        [...data]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k, structuredClone(v) as T]),
      );
    },
    async put(entries) {
      for (const [k, v] of Object.entries(entries))
        data.set(k, structuredClone(v));
    },
    async delete(keys) {
      for (const k of keys) data.delete(k);
      return keys.length;
    },
  };
  const x = await setup({
    isolation: "visitor",
    maxTenants: 2,
    store: await splitStore(kv),
  });
  const robin = await x.sign("robin", true);
  const url = "/api/account/orders/ord_LNB2001/changes";
  const op = (
    await x.call(
      robin.access_token,
      "POST",
      url,
      { slot_id: "sun-1300" },
      undefined,
      "usr_a",
    )
  ).json().operation;
  await x.call(
    robin.access_token,
    "POST",
    url,
    { slot_id: "sun-1300" },
    op,
    "usr_a",
  );
  const tenants = () => [...data.keys()].filter((k) => k.startsWith("tenant:"));
  expect(tenants()).toHaveLength(1);
  // The core record never carries business data.
  expect(JSON.stringify(data.get("state"))).not.toContain("ord_LNB2001");
  // A reload sees the change.
  const reloaded = await splitStore(kv);
  expect(JSON.stringify(Object.values(reloaded.value.tenants))).toContain(
    "sun-1300",
  );
  // Two more visitors: usr_a (least recent) is evicted and its key deleted.
  await x.call("", "GET", "/api/menu", undefined, undefined, "usr_b");
  await x.call("", "GET", "/api/menu", undefined, undefined, "usr_c");
  expect(tenants()).toHaveLength(2);
  expect(JSON.stringify([...data.values()])).not.toContain("sun-1300");
  // usr_a starts again from the seed data.
  const order = (
    await x.call(
      robin.access_token,
      "GET",
      "/api/account/orders",
      undefined,
      undefined,
      "usr_a",
    )
  ).json().orders[0];
  expect(order).toMatchObject({ slot: { id: "sat-1230" }, version: 1 });
});

it("keeps two consent pages open at once (another tab can't replace a consent)", async () => {
  await setup();
  const open = async () => {
    const page = await inject(
      `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state: "s".repeat(32), scope: "orders:read", code_challenge_method: "S256", code_challenge: "c".repeat(43) })}`,
    );
    return String(page.headers["set-cookie"]).split(";")[0]!;
  };
  const first = await open(),
    second = await open();
  expect(first.split("=")[0]).not.toBe(second.split("=")[0]);
  const consent = await inject({
    method: "POST",
    url: "/oauth/authorize",
    headers: { cookie: `${first}; ${second}`, origin },
    payload: { nonce: first.split("=")[1], decision: "approve" },
  });
  expect(consent.statusCode).toBe(302);
  // A cookie for another consent never stands in for this one.
  const swapped = await inject({
    method: "POST",
    url: "/oauth/authorize",
    headers: { cookie: first, origin },
    payload: { nonce: second.split("=")[1], decision: "approve" },
  });
  expect(swapped.statusCode).toBe(400);
});

it("serves the website pages with their own headers and fonts allowed on consent", async () => {
  await setup();
  const home = await lab.app.request("/");
  expect(home.status).toBe(200);
  expect(home.headers.get("content-security-policy")).toContain(
    "font-src https://fonts.gstatic.com",
  );
  const html = await home.text();
  // The page shows the same menu and slots the API serves.
  for (const dish of ["Shoyu ramen", "Matcha ice cream"])
    expect(html.toLowerCase()).toContain(dish.toLowerCase());
  expect(html).toContain("Sunday");
  expect(html).not.toContain("<script");
  const agents = await lab.app.request("/for-agents");
  expect(agents.status).toBe(200);
  expect(await agents.text()).toContain("/.well-known/poppy.json");
  const consent = await inject(
    `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state: "s".repeat(32), scope: "orders:read", code_challenge_method: "S256", code_challenge: "c".repeat(43) })}`,
  );
  expect(consent.headers["content-security-policy"]).toContain(
    "font-src https://fonts.gstatic.com",
  );
  expect(consent.headers["content-security-policy"]).toContain(
    "form-action 'self' http://localhost:3000",
  );
});

async function webLogin(account: string) {
  const page = await inject("/site/login");
  const login = String(page.headers["set-cookie"]).split(";")[0]!;
  const entered = await lab.app.request("/site/login", {
    method: "POST",
    headers: {
      cookie: login,
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ account }).toString(),
    redirect: "manual",
  });
  expect(entered.status).toBe(302);
  const web = entered.headers
    .getSetCookie()
    .find((c) => c.startsWith("lantern_web="))!
    .split(";")[0]!;
  return {
    cookie: web,
    headers: { cookie: web, origin, "X-Lantern-Account": account },
  };
}

it("customer website: signs in, shows the agent's orders, edits one and makes the pending proposal stale, revokes a grant", async () => {
  const x = await setup();
  const robin = await x.sign("robin", true);
  const url = "/api/account/orders/ord_LNB2001/changes";
  const op = (
    await x.call(robin.access_token, "POST", url, { slot_id: "sun-1300" })
  ).json().operation;
  // The browser (shared tenant in this test) sees the same order, unchanged.
  const web = await webLogin("robin");
  expect((await inject("/account")).statusCode).toBe(302);
  const page = await lab.app.request("/account", {
    headers: { cookie: web.cookie },
  });
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain(
    "script-src 'self'",
  );
  const state = (await (
    await lab.app.request("/site/state", { headers: { cookie: web.cookie } })
  ).json()) as { orders: unknown[]; activity: unknown[] };
  expect(state.orders[0]).toMatchObject({
    id: "ord_LNB2001",
    version: 1,
    slot: { id: "sat-1230" },
  });
  expect(state.activity[0]).toMatchObject({ state: "proposed" });
  // A website edit needs the session, the Origin and the account header.
  const edit = (headers: Record<string, string>, body: unknown) =>
    lab.app.request("/site/orders/ord_LNB2001", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (
      await edit(
        { cookie: web.cookie, origin },
        { version: 1, slot_id: "sat-1900", lines: { "miso-ramen": 2 } },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await edit(web.headers, {
        version: 1,
        slot_id: "sat-1900",
        lines: { "miso-ramen": 0 },
      })
    ).status,
  ).toBe(400);
  const saved = await edit(web.headers, {
    version: 1,
    slot_id: "sat-1900",
    lines: { "miso-ramen": 2, edamame: 1 },
  });
  expect(saved.status).toBe(200);
  expect(((await saved.json()) as { order: unknown }).order).toMatchObject({
    version: 2,
    slot: { id: "sat-1900" },
  });
  expect(
    (
      await edit(web.headers, {
        version: 1,
        slot_id: "sun-1300",
        lines: { "miso-ramen": 1 },
      })
    ).status,
  ).toBe(409);
  // The agent's earlier proposal is stale: approving it performs nothing.
  const approved = await x.call(
    robin.access_token,
    "POST",
    url,
    { slot_id: "sun-1300" },
    op,
  );
  expect(approved.statusCode).not.toBe(200);
  const after = (
    await x.call(robin.access_token, "GET", "/api/account/orders")
  ).json();
  expect(after.orders[0]).toMatchObject({
    version: 2,
    slot: { id: "sat-1900" },
  });
  // Connected agents: the grant is listed and can be revoked from the website.
  const grants = (await (
    await lab.app.request("/site/access", { headers: { cookie: web.cookie } })
  ).json()) as { grants: Array<{ id: string }> };
  expect(grants.grants).toHaveLength(1);
  expect(
    (
      await lab.app.request(`/site/access/${grants.grants[0]!.id}/revoke`, {
        method: "POST",
        headers: web.headers,
      })
    ).status,
  ).toBe(200);
  expect(
    (await x.call(robin.access_token, "GET", "/api/account/orders")).statusCode,
  ).toBe(401);
  // The script parses and matches its source.
  const { readFileSync } = await import("node:fs");
  const { render, source, target } = await import("../scripts/site-script.mjs");
  expect(readFileSync(target, "utf8")).toBe(
    render(readFileSync(source, "utf8")),
  );
  const script = await (await lab.app.request("/site/app.js")).text();
  expect(() => new Function(script)).not.toThrow();
});

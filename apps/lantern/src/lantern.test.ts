import { existsSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createIdentity } from "@poppy-lab/pap-client/core";
import {
  createCompany,
  memoryStore,
  restartingStore,
  splitStore,
  type KeyValue,
} from "@poppy-lab/pap-company";
import { slots } from "./data.ts";
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

it("gives every dish a photo URL on its own origin, and the photo exists", async () => {
  const x = await setup();
  const { dishes } = (await x.call("", "GET", "/api/menu")).json() as {
    dishes: Array<{ id: string; image: string }>;
  };
  for (const dish of dishes) {
    const url = new URL(dish.image);
    expect(url.pathname).toBe(`/img/${dish.id}.webp`);
    expect(url.search).toBe("");
    expect(
      existsSync(new URL(`../public${url.pathname}`, import.meta.url)),
    ).toBe(true);
  }
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
  // Elena can't use Robin's approval.
  const elena = await x.sign("elena", true);
  expect(
    (await x.call(elena.access_token, "POST", url, body, op)).statusCode,
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
  const elena = await x.sign("elena", true);
  const url = "/api/account/orders/ord_LNB1001/changes";
  const first = (
    await x.call(elena.access_token, "POST", url, { slot_id: "sat-1900" })
  ).json().operation;
  const second = (
    await x.call(elena.access_token, "POST", url, { remove: ["edamame"] })
  ).json().operation;
  expect(second.operation_id).toBe(first.operation_id);
  expect(
    (
      await x.call(
        elena.access_token,
        "POST",
        url,
        { slot_id: "sat-1900" },
        first,
      )
    ).statusCode,
  ).toBe(200);
  const stale = await x.call(
    elena.access_token,
    "POST",
    url,
    { remove: ["edamame"] },
    second,
  );
  // Same operation (the next change to this order), other revision: already
  // performed, so the first response comes back and nothing else is applied.
  expect(stale.statusCode).toBe(200);
  expect(stale.json().data.slot.id).toBe("sat-1900");
  // A new request is the change after that one: a new operation.
  const fresh = await x.call(elena.access_token, "POST", url, {
    remove: ["edamame"],
  });
  expect(fresh.json().operation.operation_id).not.toBe(first.operation_id);
  const order = (
    await x.call(elena.access_token, "GET", "/api/account/orders/ord_LNB1001")
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
  const elena = await x.sign("elena", true);
  const r = await x.call(
    elena.access_token,
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

it("opens the consent page on the customer the gateway names, else on the first", () => {
  const page = (account?: string) =>
    lantern.consent({
      nonce: "n",
      passwordRequired: false,
      scopes: "orders:read",
      client: "Iris",
      clientHost: "poppylab.dev",
      ...(account ? { account } : {}),
    });
  expect(page("robin")).toContain('id="account-robin" value="robin" checked>');
  expect(page("robin")).not.toContain('value="elena" checked');
  expect(page()).toContain('id="account-elena" value="elena" checked>');
  // The page is built without the visitor's orders, so it names no
  // delivery slot: the customer may have moved theirs since.
  expect(page()).toContain(
    "<strong>Elena Maren</strong><small>Has a scheduled order</small>",
  );
  for (const slot of slots) expect(page()).not.toContain(slot.label);
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
  // The footer: what Lantern is, then the lab's groups, with this site as text.
  const foot = html.slice(html.indexOf("<footer>"));
  expect(foot).toContain(
    '<p class="lab-foot-name">Lantern Noodle Bar</p><p>Lantern Noodle Bar is a fictional restaurant for testing personal agents. Nothing is sold, charged or delivered.</p><p>Part of <a href="http://localhost:3000">Poppy&nbsp;Lab</a>, an independent experiment that is not affiliated with or endorsed by the authors of the Personal Agent Protocol.',
  );
  expect(foot).toContain('<span aria-current="page">Lantern Noodle Bar</span>');
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

it("answers a consent page that ran out with a page of the shop, and a tool with the error", async () => {
  await setup();
  // A page the shop no longer holds, from a browser without its cookie.
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
    "<title>This page has expired · Lantern Noodle Bar</title>",
  );
  expect(page.body).toContain('<span class="brand">Lantern Noodle Bar</span>');
  expect(page.body).toContain(
    "connect to your Lantern account works for five minutes after it opens, and this one is older. Your answer arrived too late, so nothing was allowed and nothing has changed.</p><p>To connect the agent, go back to it and start the sign-in again.</p>",
  );
  expect(page.body).not.toMatch(/<form|<script|<button|n{32}/);
  expect(page.headers["content-security-policy"]).toContain(
    "font-src https://fonts.gstatic.com; form-action 'none'",
  );
  const tool = await allow({ origin });
  expect(tool.statusCode).toBe(400);
  expect(tool.json()).toEqual({ error: "invalid_request" });
});

it("explains on How it works what its own endpoints serve, not a copy of it", async () => {
  await setup();
  const page = await lab.app.request("/how-it-works");
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain(
    "font-src https://fonts.gstatic.com",
  );
  const html = (await page.text()).replace(/<wbr>/g, "");
  const text = (value: string) =>
    value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  // Step 1: every part of the discovery document, as the well-known address serves it.
  const discovery = (await (
    await lab.app.request("/.well-known/poppy.json")
  ).json()) as Record<string, unknown>;
  for (const key of Object.keys(discovery))
    expect(html).toContain(`<span class="k">${text(`"${key}"`)}</span>`);
  const { issuer, scopes } = discovery.auth as {
    issuer: string;
    scopes: Record<string, string>;
  };
  expect(html).toContain(text(JSON.stringify(issuer)));
  for (const description of Object.values(scopes))
    expect(html).toContain(text(JSON.stringify(description)));
  // Step 2: every operation of the API, and only the one that proposes is lit.
  const api = (await (await lab.app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, { operationId: string }>>;
  };
  const operations = Object.entries(api.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
  );
  expect(operations.length).toBeGreaterThan(0);
  for (const operation of operations) expect(html).toContain(text(operation));
  expect(html.match(/class="op lit"/g)).toHaveLength(1);
  expect(html).toMatch(
    /class="op lit">.*?POST \/api\/account\/orders\/\{order_id\}\/changes/,
  );
  // Step 3: the example is Elena's seeded order, priced by the shop's own sums.
  expect(html).toContain("ord_LNB1001");
  expect(html).toContain("<dt>Was</dt><dd>$37.00</dd>");
  expect(html).toContain("<dt>New total</dt><dd>$43.00</dd>");
  expect(html).toContain("<dt>Difference</dt><dd>+ $6.00</dd>");
  // The questions name what the document rules out.
  expect(html).toContain(
    "An agent can&#39;t cancel an order or change the delivery address of an order.",
  );
  expect(html).not.toContain("<script");
  // The page is in the menu of every page, and the home leads to it.
  expect(html).toContain(
    '<a href="/how-it-works" aria-current="page">How it works</a>',
  );
  const home = await (await lab.app.request("/")).text();
  expect(home).toContain('<a href="/how-it-works">How it works</a>');
  expect(home).toContain(
    '<a href="/how-it-works">See each step as your agent sees it</a>',
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
    body: new URLSearchParams({
      account,
      login_token: login.split("=")[1]!,
    }).toString(),
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

it("accepts the login form after a restart, and gives a form without its token a page with a way back", async () => {
  const load = restartingStore();
  await setup({ store: load(), isolation: "visitor" });
  // A browser the site has seen: opening the form again saves nothing.
  const first = await lab.app.request("/site/login");
  const browser = first.headers
    .getSetCookie()
    .find((entry) => entry.includes("pap_browser="))!
    .split(";")[0]!;
  const page = await lab.app.request("/site/login", {
    headers: { cookie: browser },
  });
  const login = page.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("lantern_login="))!
    .split(";")[0]!;
  const post = (fields: Record<string, string>) =>
    lab.app.request("/site/login", {
      method: "POST",
      headers: {
        cookie: `${browser}; ${login}`,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ account: "robin", ...fields }).toString(),
    });
  // The Durable Object was dropped from memory while the form was open.
  await setup({ store: load(), isolation: "visitor" });
  const refused = await post({});
  expect(refused.status).toBe(403);
  const html = await refused.text();
  expect(html).toContain("This sign-in page has expired.");
  expect(html).toContain(
    '<a href="/site/login">Open the sign-in page again</a>',
  );
  const entered = await post({ login_token: login.split("=")[1]! });
  expect(entered.status).toBe(302);
  expect(entered.headers.get("location")).toBe("/account");
  // The form is used up.
  expect(
    entered.headers
      .getSetCookie()
      .some((entry) => entry.startsWith("lantern_login=;")),
  ).toBe(true);
});

it("keeps the customer's record of an applied request and of who approved it after the gateway has forgotten the operation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const x = await setup();
    const robin = await x.sign("robin", true);
    const move = (slot_id: string, approval?: Parameters<typeof x.call>[4]) =>
      x.call(
        robin.access_token,
        "POST",
        "/api/account/orders/ord_LNB2001/changes",
        { slot_id },
        approval,
      );
    const op = (await move("sun-1300")).json().operation;
    expect((await move("sun-1300", op)).statusCode).toBe(200);
    const web = await webLogin("robin");
    const activity = async () =>
      (
        (await (
          await lab.app.request("/site/state", {
            headers: { cookie: web.cookie },
          })
        ).json()) as { activity: Array<Record<string, unknown>> }
      ).activity;
    const applied = {
      state: "succeeded",
      approver: "user",
      summary: op.summary,
    };
    expect(await activity()).toMatchObject([applied]);
    // Eleven minutes on, the next request makes the gateway forget the
    // performed operation. The customer's record of it stays.
    vi.setSystemTime(Date.now() + 11 * 60000);
    const next = (await move("sat-1230")).json().operation;
    const later = await activity();
    expect(later).toMatchObject([
      { state: "proposed", summary: next.summary },
      applied,
    ]);
    expect(later[1]!.when).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC$/);
    // The proposal that waits says until when, and what a decline in the
    // agent, which the Company is not told about, means.
    expect(later[0]!.when).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC$/);
    expect(later[0]!.result).toBe(
      `It waits for your approval in your agent until ${later[0]!.when}. If you decline it there or let it run out, nothing changes. Your agent doesn't tell us when you decline, so it shows as awaiting until then.`,
    );
  } finally {
    vi.useRealTimers();
  }
});

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
  // The page's own read of the account carries the list, in the consent
  // page's words, so it shows with the page and stays current.
  const agents = async () =>
    (
      (await (
        await lab.app.request("/site/state", {
          headers: { cookie: web.cookie },
        })
      ).json()) as { agents: Array<Record<string, unknown>> }
    ).agents;
  expect(await agents()).toMatchObject([
    {
      id: grants.grants[0]!.id,
      name: "Iris",
      host: "localhost:3000",
      client,
      permissions: [
        "Read: Your scheduled orders.",
        "Propose changes: Your scheduled orders.",
      ],
      expires: expect.stringMatching(
        /^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC$/,
      ),
    },
  ]);
  expect(await page.text()).not.toContain("load-access");
  expect(
    (
      await lab.app.request(`/site/access/${grants.grants[0]!.id}/revoke`, {
        method: "POST",
        headers: web.headers,
      })
    ).status,
  ).toBe(200);
  expect(await agents()).toEqual([]);
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

it("keeps a waiting change one operation when the order is edited on the website: new terms, a new revision", async () => {
  const x = await setup();
  const elena = await x.sign("elena", true);
  const url = "/api/account/orders/ord_LNB1001/changes";
  const body = {
    slot_id: "sun-1300",
    add: [{ dish_id: "matcha-ice", quantity: 1 }],
  };
  const first = (await x.call(elena.access_token, "POST", url, body)).json()
    .operation;
  expect(first.terms).toMatchObject({
    order_version: 1,
    new_total_cents: 4300,
  });
  // Elena adds a pork gyoza on the website while the proposal waits.
  const web = await webLogin("elena");
  const saved = await lab.app.request("/site/orders/ord_LNB1001", {
    method: "POST",
    headers: { ...web.headers, "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      slot_id: "fri-1830",
      lines: { "shoyu-ramen": 2, edamame: 1, "pork-gyoza": 1 },
    }),
  });
  expect(saved.status).toBe(200);
  // Approving the old terms applies nothing and returns the same operation
  // with the terms as they are now, under another revision.
  const refused = await x.call(elena.access_token, "POST", url, body, first);
  expect(refused.statusCode).toBe(403);
  const second = refused.json().operation;
  expect(second.operation_id).toBe(first.operation_id);
  expect(second.revision).not.toBe(first.revision);
  expect(second.terms).toMatchObject({
    order_version: 2,
    before_total_cents: 4500,
    new_total_cents: 5100,
    lines: { "pork-gyoza": 1, "matcha-ice": 1 },
  });
  expect(second.summary).toContain("New total USD 51.00");
  const order = () =>
    x
      .call(elena.access_token, "GET", "/api/account/orders/ord_LNB1001")
      .then((r) => r.json());
  expect(await order()).toMatchObject({
    version: 2,
    slot: { id: "fri-1830" },
    total_cents: 4500,
  });
  // The website shows one proposal for the order, not two.
  const state = (await (
    await lab.app.request("/site/state", { headers: { cookie: web.cookie } })
  ).json()) as { activity: Array<{ id: string; summary: string }> };
  expect(state.activity).toHaveLength(1);
  expect(state.activity[0]!.summary).toContain("New total USD 51.00");
  // The old revision stays refused; the new one is applied, once.
  expect(
    (await x.call(elena.access_token, "POST", url, body, first)).statusCode,
  ).toBe(403);
  expect((await order()).version).toBe(2);
  const done = await x.call(elena.access_token, "POST", url, body, second);
  expect(done.statusCode).toBe(200);
  expect(done.json().data).toMatchObject({
    version: 3,
    slot: { id: "sun-1300" },
    total_cents: 5100,
  });
  expect(
    (await x.call(elena.access_token, "POST", url, body, second)).json(),
  ).toEqual(done.json());
  expect((await order()).version).toBe(3);
  // The same request again is a new change to the order, so a new operation.
  const again = await x.call(elena.access_token, "POST", url, body);
  expect(again.statusCode).toBe(403);
  expect(again.json().operation.operation_id).not.toBe(first.operation_id);
  expect(again.json().operation.terms.new_total_cents).toBe(5700);
});

it("customer website: shows the agent's feedback reports, newest first and escaped (§9.3)", async () => {
  const x = await setup();
  const web = await webLogin("robin");
  const empty = await (
    await lab.app.request("/account", { headers: { cookie: web.cookie } })
  ).text();
  expect(empty).toContain("Feedback from agents");
  expect(empty).toContain("No reports yet");
  expect(empty).toContain("such as booking a table for a large group.");
  for (const task of ["Buy a gift card", "Pick <b>chopsticks</b>"])
    expect(
      (
        await x.call("", "POST", "/poppy/feedback", {
          task,
          description: "The User wanted it.",
        })
      ).statusCode,
    ).toBeLessThan(300);
  const html = await (
    await lab.app.request("/account", { headers: { cookie: web.cookie } })
  ).text();
  const section = html.slice(html.indexOf('id="agent-feedback"'));
  expect(section).toContain("Pick &#60;b&#62;chopsticks&#60;/b&#62;");
  expect(section).not.toContain("<b>chopsticks");
  expect(section.indexOf("chopsticks")).toBeLessThan(
    section.indexOf("Buy a gift card"),
  );
  expect(section).toContain(
    '<li class="record" data-tone="info"><div class="record-head"><span class="record-tag">Alternative offered</span>',
  );
  expect(section).toContain(
    '<li class="record" data-tone="muted"><div class="record-head"><span class="record-tag">Received</span>',
  );
  expect(section).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC/);
  expect(section).toContain("From localhost:3000");
});

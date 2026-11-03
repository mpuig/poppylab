import { it, expect } from "vitest";
import { testApp } from "./test-app.js";
import { operations, catalogue, type Commerce } from "./operations.js";
import { website } from "./website.js";
import { approvalOf } from "./test-v2.js";
// Each operation's exact request, resent with the approval (Operations v2).
type Sent = {
  url: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  op: { operation_id: string; revision: string };
};
const origin = "http://juniper.localhost:4100";
const quantities = (coffee = 1) =>
  Object.fromEntries(
    catalogue.map((p) => [p.id, p.id === "coffee" ? coffee : 0]),
  );
async function setup() {
  const app = testApp(),
    state: Commerce = { customers: {}, records: {} };
  const c = operations(
    app,
    () => ({
      client: "agent",
      user: "u",
      account: "alex",
      expires: Date.now() + 60000,
    }),
    state,
  );
  const sent = new Map<string, Sent>();
  website(app, origin, c.view, new Map(), c.services);
  const page = await app.inject("/site/login");
  const login = await app.inject({
    method: "POST",
    url: "/site/login",
    headers: {
      origin,
      cookie: String(page.headers["set-cookie"]).split(";")[0]!,
    },
    payload: {},
  });
  const cookie = (login.headers["set-cookie"] as string[])
    .find((v) => v.startsWith("juniper_web="))!
    .split(";")[0]!;
  return {
    app,
    state,
    cookie,
    post: async (url: string, payload: Record<string, unknown>) => {
      const headers = { origin, cookie, "x-juniper-account": "alex" };
      const r = await app.inject({ method: "POST", url, headers, payload });
      if (r.statusCode === 403 && r.json().error === "approval_required")
        sent.set(r.json().operation.operation_id, {
          url,
          payload,
          headers,
          op: r.json().operation,
        });
      return r;
    },
    confirm: (id: string) => {
      const last = sent.get(id);
      if (!last) throw new Error("No operation " + id);
      return app.inject({
        method: "POST",
        url: last.url,
        headers: { ...last.headers, ...approvalOf(last.op) },
        payload: last.payload,
      });
    },
  };
}
it("web basket edits invalidate both basket and checkout proposals without changing delivery or creating orders", async () => {
  const { app, post, confirm, state } = await setup();
  try {
    const basket = (
      await post("/api/account/basket-change", {
        product_id: "coffee",
        quantity: 2,
      })
    ).json().operation;
    const checkout = (
      await post("/api/account/checkout", { day: "Saturday" })
    ).json().operation;
    expect(
      (await post("/site/basket", { version: 1, items: quantities(3) }))
        .statusCode,
    ).toBe(200);
    for (const id of [basket.operation_id, checkout.operation_id])
      expect((await confirm(id)).statusCode).toBeGreaterThanOrEqual(403);
    const b = (await app.inject("/api/account/basket")).json();
    expect(b.total_cents).toBe(4200);
    expect(b.delivery_fee_cents).toBe(0);
    expect(b.version).toBe(2);
    expect(state.customers.alex!.orders).toHaveLength(0);
    expect(state.customers.alex!.deliveryItems).toEqual({
      oranges: 1,
      coffee: 1,
    });
    expect(
      (await post("/site/basket", { version: 1, items: quantities(2) }))
        .statusCode,
    ).toBe(409);
    expect(state.customers.alex!.basket.coffee).toBe(3);
    const fresh = (
      await post("/api/account/basket-change", {
        product_id: "coffee",
        quantity: 4,
      })
    ).json().operation;
    expect((await confirm(fresh.operation_id)).statusCode).toBe(200);
    expect(
      (await post("/site/basket", { version: 2, items: quantities(5) }))
        .statusCode,
    ).toBe(409);
    expect(state.customers.alex!.basket.coffee).toBe(4);
  } finally {
    await app.close();
  }
});
it("web delivery edits reject stale day/items proposals including change-away-and-back, preserving the basket", async () => {
  const { app, post, confirm, state, cookie } = await setup();
  try {
    const day = (
      await post("/api/account/delivery-change", { day: "Saturday" })
    ).json().operation;
    const items = (
      await post("/api/account/delivery-items-change", {
        product_id: "coffee",
        quantity: 2,
      })
    ).json().operation;
    expect(
      (
        await post("/site/delivery", {
          version: 1,
          day: "Tuesday",
          items: quantities(2),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post("/site/delivery", {
          version: 2,
          day: "Thursday",
          items: quantities(1),
        })
      ).statusCode,
    ).toBe(200);
    for (const id of [day.operation_id, items.operation_id])
      expect((await confirm(id)).statusCode).toBeGreaterThanOrEqual(403);
    expect(state.customers.alex!.basket).toEqual({ oranges: 1, coffee: 1 });
    const view = (
      await app.inject({ url: "/site/state", headers: { cookie } })
    ).json();
    expect(view.delivery.version).toBe(3);
    expect(view.basket.version).toBe(1);
    const fresh = (
      await post("/api/account/delivery-change", { day: "Saturday" })
    ).json().operation;
    for (let i = 0; i < 2; i++)
      expect((await confirm(fresh.operation_id)).statusCode).toBe(200);
    expect(state.customers.alex!.deliveryVersion).toBe(4);
    expect(
      (
        await post("/site/delivery", {
          version: 3,
          day: "Tuesday",
          items: quantities(3),
        })
      ).statusCode,
    ).toBe(409);
    expect(state.customers.alex!.day).toBe("Saturday");
  } finally {
    await app.close();
  }
});
it("rejects malformed quantities, authority fields, stale drafts and missing browser authority atomically", async () => {
  const { app, post, state, cookie } = await setup();
  try {
    await app.inject("/api/account/basket");
    const before = structuredClone(state.customers.alex);
    for (const payload of [
      { version: 1, items: { coffee: 1 } },
      { version: 1, items: { ...quantities(), coffee: 13 } },
      { version: 1, items: { ...quantities(), coffee: 1.5 } },
      { version: 1, items: { ...quantities(), coffee: "1" } },
      { version: 1, items: { ...quantities(), coffee: -1 } },
      { version: 1, items: quantities(), approved_by: "user" },
      { version: "1", items: quantities() },
    ])
      expect((await post("/site/basket", payload)).statusCode).toBe(400);
    expect(
      (
        await post("/site/delivery", {
          version: 1,
          items: quantities(),
          day: "Sunday",
        })
      ).statusCode,
    ).toBe(400);
    for (const headers of [
      { origin },
      { cookie, origin: "https://evil.example" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/site/basket",
            headers,
            payload: { version: 1, items: quantities() },
          })
        ).statusCode,
      ).toBe(403);
    expect(state.customers.alex).toEqual(before);
  } finally {
    await app.close();
  }
});
it("allows explicit zero-item saves with zero fees, without inventing orders or shipments", async () => {
  const { app, post, state } = await setup();
  try {
    const empty = quantities(0);
    expect(
      (await post("/site/basket", { version: 1, items: empty })).json()
        .total_cents,
    ).toBe(0);
    expect(
      (
        await post("/site/delivery", {
          version: 1,
          items: empty,
          day: "Saturday",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject("/api/account/deliveries")).json().deliveries[0]
        .total_cents,
    ).toBe(0);
    expect(state.customers.alex!.orders).toHaveLength(0);
  } finally {
    await app.close();
  }
});

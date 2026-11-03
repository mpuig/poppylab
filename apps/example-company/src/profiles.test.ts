import { it, expect } from "vitest";
import { testApp } from "./test-app.js";
import { operations, type Commerce } from "./operations.js";
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
const values = {
  name: "Alex Demo",
  email: "alex@juniper.invalid",
  address: "12 Forest Road — fictional address",
};
async function setup(state: Commerce = { customers: {}, records: {} }) {
  const app = testApp();
  const commerce = operations(
    app,
    (r) => ({
      client: "agent",
      user: "u",
      account: String(r.headers["x-test-account"] ?? "alex"),
      expires: Date.now() + 60000,
    }),
    state,
  );
  const sent = new Map<string, Sent>();
  website(app, origin, commerce.view, new Map(), commerce.services);
  const start = await app.inject("/site/login");
  const login = await app.inject({
    method: "POST",
    url: "/site/login",
    headers: {
      origin,
      cookie: String(start.headers["set-cookie"]).split(";")[0]!,
    },
    payload: {},
  });
  const cookie = (login.headers["set-cookie"] as string[])
    .find((v) => v.startsWith("juniper_web="))!
    .split(";")[0]!;
  return {
    app,
    cookie,
    post: async (url: string, payload: Record<string, unknown>) => {
      const headers = { cookie, origin, "x-juniper-account": "alex" };
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
it("keeps proposals separate, rejects stale profile confirmation and confirms a fresh version once", async () => {
  const { app, post, confirm } = await setup();
  try {
    const proposal = (
      await post("/api/account/profile-proposal", { ...values, version: 1 })
    ).json().operation;
    expect((await app.inject("/api/account/profile")).json().profile.name).toBe(
      "Alex Rivers",
    );
    expect(
      (await post("/site/profile", { ...values, version: 1 })).statusCode,
    ).toBe(200);
    expect(
      (await confirm(proposal.operation_id)).statusCode,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (await post("/site/profile", { ...values, version: 1 })).statusCode,
    ).toBe(409);
    const fresh = (
      await post("/api/account/profile-proposal", {
        ...values,
        name: "Alex Nuevo",
        version: 2,
      })
    ).json().operation;
    for (let i = 0; i < 2; i++)
      expect((await confirm(fresh.operation_id)).statusCode).toBe(200);
    const current = (await app.inject("/api/account/profile")).json();
    expect(current.profile_version).toBe(3);
    expect(current.profile.name).toBe("Alex Nuevo");
    expect(
      (
        await app.inject({
          url: "/api/account/profile",
          headers: { "x-test-account": "other" },
        })
      ).json().profile.name,
    ).toBe("Alex Rivers");
    await post("/site/profile", {
      ...values,
      name: "Alex After",
      version: 3,
    });
    expect(
      // A retry of the performed operation returns its first response.
      (await confirm(fresh.operation_id)).json().data.profile.name,
    ).toBe("Alex Nuevo");
  } finally {
    await app.close();
  }
});
it("binds checkout to the reviewed profile and preserves destination snapshots on existing orders", async () => {
  const { app, post, confirm } = await setup();
  try {
    const old = (
      await post("/api/account/checkout", { day: "Saturday" })
    ).json().operation;
    await post("/site/profile", { ...values, version: 1 });
    expect((await confirm(old.operation_id)).statusCode).toBeGreaterThanOrEqual(
      403,
    );
    expect(
      (await app.inject("/api/account/orders")).json().orders,
    ).toHaveLength(0);
    const fresh = (
      await post("/api/account/checkout", { day: "Saturday" })
    ).json().operation;
    expect(fresh.terms.destination).toBe(values.address);
    expect(fresh.terms.recipient).toBe(values.name);
    expect((await confirm(fresh.operation_id)).statusCode).toBe(200);
    await post("/site/profile", {
      ...values,
      address: "Otro destino ficticio",
      version: 2,
    });
    const order = (await app.inject("/api/account/orders")).json().orders[0];
    expect(order.destination).toBe(values.address);
    expect(order.recipient).toBe(values.name);
  } finally {
    await app.close();
  }
});
it("migrates existing contact data without inventing historical shipping addresses or coupling basket versions", async () => {
  const state: Commerce = {
    customers: {
      alex: {
        profile: {
          name: "Eli Demo",
          email: "eli@example.invalid",
          address: "Earlier fictional address",
        },
        day: "Tuesday",
        version: 55,
        basket: { coffee: 1 },
        deliveryItems: { coffee: 1 },
        deliveryVersion: 22,
        orders: [
          {
            id: "old",
            items: [],
            total_cents: 1900,
            currency: "USD",
            delivery_day: "Tuesday",
            status: "simulated",
          },
        ],
      },
    },
    records: {},
  };
  const { app, post, confirm } = await setup(state);
  try {
    const old = structuredClone(state.customers.alex!.orders);
    const p = (await app.inject("/api/account/profile")).json();
    expect(p.profile.name).toBe("Eli Demo");
    expect(p.profile_version).toBe(1);
    const profile = (
      await post("/api/account/profile-proposal", { ...values, version: 1 })
    ).json().operation;
    const basket = (
      await post("/api/account/basket-change", {
        product_id: "coffee",
        quantity: 2,
      })
    ).json().operation;
    expect((await confirm(basket.operation_id)).statusCode).toBe(200);
    expect((await confirm(profile.operation_id)).statusCode).toBe(200);
    expect(state.customers.alex!.orders).toEqual(old);
    expect(state.customers.alex!.orders[0]!.destination).toBeUndefined();
    expect(state.customers.alex!.version).toBe(56);
    expect(state.customers.alex!.deliveryVersion).toBe(22);
    expect(state.customers.alex!.profile_version).toBe(2);
  } finally {
    await app.close();
  }
});
it("requires browser authority, fictional contact data and an exact version", async () => {
  const { app, cookie, post } = await setup();
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/site/profile",
          headers: { cookie, origin: "https://evil.example" },
          payload: { ...values, version: 1 },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/site/profile",
          headers: { origin },
          payload: { ...values, version: 1 },
        })
      ).statusCode,
    ).toBe(403);
    for (const value of [
      { ...values, email: "alex@example.com", version: 1 },
      { ...values, name: " ", version: 1 },
      { ...values, address: "x".repeat(241), version: 1 },
      { ...values, version: 1, approved_by: "user" },
      { ...values, name: "Alex\nInjected", version: 1 },
      { ...values, version: "1" },
    ])
      expect(
        (await post("/api/account/profile-proposal", value)).statusCode,
      ).toBe(400);
    expect(
      (await post("/api/account/profile-proposal", { ...values, version: 0 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post("/api/account/profile-proposal", { ...values, version: 2 }))
        .statusCode,
    ).toBe(409);
    expect(
      (await app.inject("/api/account/profile")).json().profile_version,
    ).toBe(1);
  } finally {
    await app.close();
  }
});

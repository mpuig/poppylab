import { it, expect } from "vitest";
import { testApp } from "./test-app.js";
import { operations, type Commerce } from "./operations.js";
import { website } from "./website.js";
import { approvalOf } from "./test-v2.js";
const origin = "http://juniper.localhost:4100";
async function setup(state: Commerce = { customers: {}, records: {} }) {
  const app = testApp();
  const c = operations(
    app,
    (req) => ({
      client: "agent",
      user: "u",
      account: String(req.headers["x-test-account"] ?? "alex"),
      expires: Date.now() + 60000,
    }),
    state,
  );
  website(app, origin, c.view, new Map(), c.services);
  return app;
}
async function cookie(app: Awaited<ReturnType<typeof setup>>) {
  const p = await app.inject("/site/login");
  const entered = await app.inject({
    method: "POST",
    url: "/site/login",
    headers: { origin, cookie: String(p.headers["set-cookie"]).split(";")[0]! },
    payload: {},
  });
  return (entered.headers["set-cookie"] as string[])
    .find((c) => c.startsWith("juniper_web="))!
    .split(";")[0]!;
}
const body = {
  topic: "delivery",
  subject: "Test delivery",
  message: "I need help with my fictional delivery.",
};
it("opens a case only after agent approval and retries never duplicate it", async () => {
  const app = await setup();
  try {
    const op = (
      await app.inject({
        method: "POST",
        url: "/api/account/case-proposal",
        payload: body,
      })
    ).json().operation;
    const retry = (
      await app.inject({
        method: "POST",
        url: "/api/account/case-proposal",
        payload: body,
      })
    ).json().operation;
    expect(retry.operation_id).toBe(op.operation_id);
    expect((await app.inject("/api/account/cases")).json().cases).toHaveLength(
      0,
    );
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/account/case-proposal",
            payload: body,
            headers: approvalOf(op),
          })
        ).statusCode,
      ).toBe(200);
    const cases = (await app.inject("/api/account/cases")).json().cases;
    expect(cases).toHaveLength(1);
    const detail = (
      await app.inject("/api/account/cases/" + cases[0].id)
    ).json();
    expect(detail.messages[1].actor).toBe("simulated_support");
    expect(detail.messages[1].text).toContain("Automatic test reply");
    expect(
      (
        await app.inject({
          url: "/api/account/cases/" + cases[0].id,
          headers: { "x-test-account": "other" },
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
it("shares website cases with PAP, enforces browser authority and invalidates a stale closure", async () => {
  const app = await setup();
  try {
    const web = await cookie(app);
    const post = (
      url: string,
      payload: Record<string, unknown>,
      headers: Record<string, string> = {
        cookie: web,
        origin,
        "x-juniper-account": "alex",
      },
    ) => app.inject({ method: "POST", url, headers, payload });
    expect((await post("/site/cases", body, { origin })).statusCode).toBe(403);
    expect(
      (
        await post("/site/cases", body, {
          cookie: web,
          origin: "https://evil.example",
        })
      ).statusCode,
    ).toBe(403);
    const created = await post("/site/cases", body);
    expect(created.statusCode).toBe(201);
    const c = created.json().case;
    expect((await app.inject("/api/account/cases")).json().cases[0].id).toBe(
      c.id,
    );
    const op = (
      await post("/api/account/case-resolution", { case_id: c.id })
    ).json().operation;
    await post(`/site/cases/${c.id}/messages`, {
      message: "I have more information.",
    });
    expect(
      (
        await post(
          "/api/account/case-resolution",
          { case_id: c.id },
          {
            cookie: web,
            origin,
            "x-juniper-account": "alex",
            ...approvalOf(op),
          },
        )
      ).statusCode,
    ).toBe(403);
    expect((await app.inject("/api/account/cases/" + c.id)).json().status).toBe(
      "open",
    );
    const fresh = (
      await post("/api/account/case-resolution", { case_id: c.id })
    ).json().operation;
    expect(
      (
        await post(
          "/api/account/case-resolution",
          { case_id: c.id },
          {
            cookie: web,
            origin,
            "x-juniper-account": "alex",
            ...approvalOf(fresh),
          },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({ url: "/site/state", headers: { cookie: web } })
      ).json().cases[0].status,
    ).toBe("resolved");
  } finally {
    await app.close();
  }
});
it("rejects invalid subjects, extra authority fields and unrelated orders", async () => {
  const app = await setup();
  try {
    for (const payload of [
      { ...body, subject: "" },
      { ...body, approved_by: "user" },
      { ...body, order_id: "other-order" },
      { ...body, message: "x".repeat(2001) },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/account/case-proposal",
            payload,
          })
        ).statusCode,
      ).toBe(400);
    expect((await app.inject("/help")).body).toContain(
      "Is anything actually charged?",
    );
    expect(
      (await app.inject("/api/account/profile")).json().profile.email,
    ).toBe("alex@example.invalid");
    expect((await app.inject("/api/account/invoices")).json().invoices).toEqual(
      [],
    );
  } finally {
    await app.close();
  }
});
it("upgrades old commerce records without resetting existing orders or basket", async () => {
  const state: Commerce = {
    customers: {
      alex: {
        day: "Tuesday",
        version: 8,
        basket: { coffee: 2 },
        deliveryItems: { apples: 1 },
        deliveryVersion: 4,
        orders: [
          {
            id: "existing",
            items: [],
            total_cents: 2800,
            currency: "USD",
            delivery_day: "Tuesday",
            status: "simulated",
          },
        ],
      },
    },
    records: {},
  };
  const app = await setup(state);
  try {
    const invoices = (await app.inject("/api/account/invoices")).json()
      .invoices;
    expect(invoices[0].total_cents).toBe(2800);
    expect(state.customers.alex!.basket).toEqual({ coffee: 2 });
    expect(state.customers.alex!.version).toBe(8);
    const op = (
      await app.inject({
        method: "POST",
        url: "/api/account/case-proposal",
        payload: body,
      })
    ).json().operation;
    state.records[op.operation_id]!.revisions[0]!.terms = {
      kind: "unknown_future_type",
      basket_version: 8,
    };
    // Terms tampered in storage no longer match the request: refused.
    const result = await app.inject({
      method: "POST",
      url: "/api/account/case-proposal",
      payload: body,
      headers: approvalOf(op),
    });
    expect(result.statusCode).toBe(403);
    expect(state.customers.alex!.orders).toHaveLength(1);
    expect(state.customers.alex!.basket).toEqual({ coffee: 2 });
  } finally {
    await app.close();
  }
});

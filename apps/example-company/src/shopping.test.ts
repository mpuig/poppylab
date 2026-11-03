import { it, expect } from "vitest";
import { testApp } from "./test-app.js";
import { operations, type Commerce } from "./operations.js";
import { approvalOf } from "./test-v2.js";
function setup(state: Commerce = { customers: {}, records: {} }) {
  const app = testApp();
  operations(
    app,
    () => ({
      client: "agent",
      user: "user",
      account: "alex",
      expires: Date.now() + 60000,
    }),
    state,
  );
  const post = (
    url: string,
    payload: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: "POST",
      url,
      payload: payload as Record<string, unknown>,
      headers,
    });
  return { app, post };
}
it("basket edits and checkout require approval; checkout is exactly-once and survives reload", async () => {
  const state: Commerce = { customers: {}, records: {} };
  let { app, post } = setup(state);
  const editBody = { product_id: "apples", quantity: 2 };
  const edit = (await post("/api/account/basket-change", editBody)).json()
    .operation;
  expect((await app.inject("/api/account/basket")).json().items).toHaveLength(
    2,
  );
  expect(
    (await post("/api/account/basket-change", editBody, approvalOf(edit)))
      .statusCode,
  ).toBe(200);
  expect((await app.inject("/api/account/basket")).json().items).toHaveLength(
    3,
  );
  const checkout = (
    await post("/api/account/checkout", { day: "Saturday" })
  ).json().operation;
  expect(checkout.terms.total_cents).toBe(3130);
  expect((await app.inject("/api/account/orders")).json().orders).toHaveLength(
    0,
  );
  const result = await post(
    "/api/account/checkout",
    { day: "Saturday" },
    approvalOf(checkout),
  );
  expect(result.statusCode).toBe(200);
  await app.close();
  ({ app, post } = setup(JSON.parse(JSON.stringify(state)) as Commerce));
  expect(
    (
      await post(
        "/api/account/checkout",
        { day: "Saturday" },
        approvalOf(checkout),
      )
    ).json(),
  ).toEqual(result.json());
  expect((await app.inject("/api/account/orders")).json().orders).toHaveLength(
    1,
  );
  expect((await app.inject("/api/account/basket")).json().items).toHaveLength(
    0,
  );
  await app.close();
});
it("refuses a stale checkout approval after the basket changed, placing no order", async () => {
  const { app, post } = setup();
  const checkout = (
    await post("/api/account/checkout", { day: "Saturday" })
  ).json().operation;
  const editBody = { product_id: "oranges", quantity: 0 };
  const edit = (await post("/api/account/basket-change", editBody)).json()
    .operation;
  expect(
    (await post("/api/account/basket-change", editBody, approvalOf(edit)))
      .statusCode,
  ).toBe(200);
  const stale = await post(
    "/api/account/checkout",
    { day: "Saturday" },
    approvalOf(checkout),
  );
  expect(stale.statusCode).toBe(403);
  expect(stale.json().operation.terms.total_cents).not.toBe(
    checkout.terms.total_cents,
  );
  expect((await app.inject("/api/account/orders")).json().orders).toHaveLength(
    0,
  );
  await app.close();
});
it("rejects invalid quantities, products, delivery days", async () => {
  const { app, post } = setup();
  for (const payload of [
    { product_id: "coffee", quantity: -1 },
    { product_id: "coffee", quantity: 100 },
    { product_id: "coffee", quantity: 1.5 },
    { product_id: "evil", quantity: 1 },
  ])
    expect((await post("/api/account/basket-change", payload)).statusCode).toBe(
      400,
    );
  expect(
    (await post("/api/account/checkout", { day: "Monday" })).statusCode,
  ).toBe(400);
  await app.close();
});

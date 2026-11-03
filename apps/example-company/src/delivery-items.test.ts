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
  return app;
}
it("removes recurring oranges only after approval, leaving basket/orders alone, and remains idempotent after reload", async () => {
  const state: Commerce = { customers: {}, records: {} };
  let app = setup(state);
  const post = (
    url: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => app.inject({ method: "POST", url, payload, headers });
  const before = (await app.inject("/api/account/basket")).json();
  const response = await post("/api/account/delivery-items-change", {
    product_id: "oranges",
    quantity: 0,
  });
  expect(response.statusCode).toBe(403);
  const op = response.json().operation;
  expect(
    (await app.inject("/api/account/deliveries")).json().deliveries[0].items,
  ).toContain("Cara cara oranges");
  expect(op.terms.total_cents).toBe(1900);
  const body = { product_id: "oranges", quantity: 0 };
  const approvedResponse = await post(
    "/api/account/delivery-items-change",
    body,
    approvalOf(op),
  );
  expect(approvedResponse.statusCode).toBe(200);
  const approved = approvedResponse.json();
  expect(
    (await app.inject("/api/account/deliveries")).json().deliveries[0].items,
  ).toEqual(["Juniper house coffee"]);
  expect((await app.inject("/api/account/basket")).json()).toEqual(before);
  expect((await app.inject("/api/account/orders")).json().orders).toHaveLength(
    0,
  );
  await app.close();
  app = setup(JSON.parse(JSON.stringify(state)) as Commerce);
  expect(
    (
      await post("/api/account/delivery-items-change", body, approvalOf(op))
    ).json(),
  ).toEqual(approved);
  expect(
    (await app.inject("/api/account/deliveries")).json().deliveries[0].items,
  ).not.toContain("Cara cara oranges");
  await app.close();
});
it("refuses stale recurring approvals and invalid quantities without changing items", async () => {
  const app = setup();
  const post = (
    url: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => app.inject({ method: "POST", url, payload, headers });
  const op = (
    await post("/api/account/delivery-items-change", {
      product_id: "oranges",
      quantity: 0,
    })
  ).json().operation;
  const move = (
    await post("/api/account/delivery-change", { day: "Saturday" })
  ).json().operation;
  expect(
    (
      await post(
        "/api/account/delivery-change",
        { day: "Saturday" },
        approvalOf(move),
      )
    ).statusCode,
  ).toBe(200);
  // The delivery changed version: the old removal is refused, not applied.
  const stale = await post(
    "/api/account/delivery-items-change",
    { product_id: "oranges", quantity: 0 },
    approvalOf(op),
  );
  expect(stale.statusCode).toBe(403);
  expect(stale.json().operation.operation_id).not.toBe(op.operation_id);
  // Declining is the agent's choice: Juniper simply never gets the approval.
  for (const quantity of [-1, 1.5, 100])
    expect(
      (
        await post("/api/account/delivery-items-change", {
          product_id: "oranges",
          quantity,
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (await app.inject("/api/account/deliveries")).json().deliveries[0].items,
  ).toContain("Cara cara oranges");
  await app.close();
});
it("upgrades old saved customers without resetting their basket or orders", async () => {
  const state = JSON.parse(
    JSON.stringify({
      customers: {
        alex: {
          day: "Saturday",
          version: 7,
          basket: { apples: 2 },
          orders: [],
        },
      },
      records: {},
    }),
  ) as Commerce;
  const app = setup(state);
  expect(
    (await app.inject("/api/account/deliveries")).json().deliveries[0]
      .line_items[0].id,
  ).toBe("oranges");
  expect((await app.inject("/api/account/basket")).json().items[0].id).toBe(
    "apples",
  );
  expect(state.customers.alex!.version).toBe(7);
  await app.close();
});

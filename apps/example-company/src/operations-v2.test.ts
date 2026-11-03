import { afterEach, expect, it, vi } from "vitest";
import { testApp } from "./test-app.js";
import { operations, type Commerce } from "./operations.js";

let session = { client: "agent", user: "usr_a", account: "alex" };
function setup(state: Commerce = { customers: {}, records: {} }) {
  const app = testApp();
  operations(app, () => ({ ...session, expires: Date.now() + 60000 }), state);
  const post = (
    url: string,
    payload: Record<string, unknown>,
    approval?: { operation_id: string; revision: string } | string,
  ) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: approval
        ? {
            "poppy-approval":
              typeof approval === "string"
                ? approval
                : `operation_id="${approval.operation_id}", revision="${approval.revision}"`,
          }
        : {},
    });
  const orders = async () =>
    (await app.inject("/api/account/orders")).json().orders;
  return { app, state, post, orders };
}
afterEach(() => {
  session = { client: "agent", user: "usr_a", account: "alex" };
  vi.useRealTimers();
});

it("refuses without approval, performs nothing, and repeats the same revision for the same request", async () => {
  const x = setup();
  const first = await x.post("/api/account/checkout", { day: "Saturday" });
  expect(first.statusCode).toBe(403);
  const op = first.json().operation;
  expect(first.json().error).toBe("approval_required");
  expect(Object.keys(op).sort()).toEqual([
    "expires_at",
    "operation_id",
    "revision",
    "summary",
    "terms",
  ]);
  expect(typeof op.revision).toBe("string");
  expect(Date.parse(op.expires_at) - Date.now()).toBeGreaterThan(5 * 60000);
  expect(first.headers["www-authenticate"]).toBeUndefined();
  expect(
    (await x.post("/api/account/checkout", { day: "Saturday" })).json()
      .operation,
  ).toEqual(op);
  expect(await x.orders()).toEqual([]);
  await x.app.close();
});

it("performs an approved revision once and replays the first response on retries", async () => {
  const x = setup();
  const op = (await x.post("/api/account/checkout", { day: "Saturday" })).json()
    .operation;
  const done = await x.post("/api/account/checkout", { day: "Saturday" }, op);
  expect(done.statusCode).toBe(200);
  expect(done.json()).toMatchObject({
    operation_id: op.operation_id,
    data: { delivery_day: "Saturday" },
  });
  const again = await x.post("/api/account/checkout", { day: "Saturday" }, op);
  expect(again.json()).toEqual(done.json());
  expect(await x.orders()).toHaveLength(1);
  // Survives a restart from durable state.
  const restored = setup(JSON.parse(JSON.stringify(x.state)));
  expect(
    (
      await restored.post("/api/account/checkout", { day: "Saturday" }, op)
    ).json(),
  ).toEqual(done.json());
  expect(await restored.orders()).toHaveLength(1);
  await x.app.close();
  await restored.app.close();
});

it("keeps the operation_id when terms change and approves only the revision that matches the request", async () => {
  const x = setup();
  const saturday = (
    await x.post("/api/account/checkout", { day: "Saturday" })
  ).json().operation;
  const tuesday = (
    await x.post("/api/account/checkout", { day: "Tuesday" })
  ).json().operation;
  expect(tuesday.operation_id).toBe(saturday.operation_id);
  expect(tuesday.revision).not.toBe(saturday.revision);
  // Approving Saturday's terms for a Tuesday request does nothing.
  const mismatch = await x.post(
    "/api/account/checkout",
    { day: "Tuesday" },
    saturday,
  );
  expect(mismatch.statusCode).toBe(403);
  expect(mismatch.json().operation.revision).toBe(tuesday.revision);
  expect(await x.orders()).toEqual([]);
  // Any returned, unexpired revision can be approved — not only the latest.
  expect(
    (await x.post("/api/account/checkout", { day: "Saturday" }, saturday))
      .statusCode,
  ).toBe(200);
  expect((await x.orders())[0].delivery_day).toBe("Saturday");
  // The operation ran once: the Tuesday revision can't run it again.
  expect(
    (await x.post("/api/account/checkout", { day: "Tuesday" }, tuesday)).json()
      .data.delivery_day,
  ).toBe("Saturday");
  expect(await x.orders()).toHaveLength(1);
  await x.app.close();
});

it("never answers an approval with the revision it names", async () => {
  const x = setup();
  const op = (
    await x.post("/api/account/basket-change", {
      product_id: "apples",
      quantity: 2,
    })
  ).json().operation;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 11 * 60000);
  const expired = await x.post(
    "/api/account/basket-change",
    { product_id: "apples", quantity: 2 },
    op,
  );
  expect(expired.statusCode).toBe(403);
  expect(expired.json().operation.operation_id).toBe(op.operation_id);
  expect(expired.json().operation.revision).not.toBe(op.revision);
  expect(
    (await x.app.inject("/api/account/basket"))
      .json()
      .items.find((i: { id: string }) => i.id === "apples"),
  ).toBeUndefined();
  await x.app.close();
});

it("refuses approval after the account changed, without performing the stale terms", async () => {
  const x = setup();
  const checkout = (
    await x.post("/api/account/checkout", { day: "Saturday" })
  ).json().operation;
  const edit = (
    await x.post("/api/account/basket-change", {
      product_id: "coffee",
      quantity: 3,
    })
  ).json().operation;
  expect(
    (
      await x.post(
        "/api/account/basket-change",
        { product_id: "coffee", quantity: 3 },
        edit,
      )
    ).statusCode,
  ).toBe(200);
  const stale = await x.post(
    "/api/account/checkout",
    { day: "Saturday" },
    checkout,
  );
  expect(stale.statusCode).toBe(403);
  // A new basket version is a new action, with new terms.
  expect(stale.json().operation.operation_id).not.toBe(checkout.operation_id);
  expect(stale.json().operation.terms.total_cents).not.toBe(
    checkout.terms.total_cents,
  );
  expect(await x.orders()).toEqual([]);
  await x.app.close();
});

it("only the same account, client and User can approve; other approvals are ignored", async () => {
  const x = setup();
  const op = (
    await x.post("/api/account/delivery-change", { day: "Saturday" })
  ).json().operation;
  for (const other of [
    { client: "agent", user: "usr_a", account: "maya" },
    { client: "other-agent", user: "usr_a", account: "alex" },
    { client: "agent", user: "usr_b", account: "alex" },
  ]) {
    session = other;
    const r = await x.post(
      "/api/account/delivery-change",
      { day: "Saturday" },
      op,
    );
    expect(r.statusCode).toBe(403);
    expect(r.json().operation.operation_id).not.toBe(op.operation_id);
  }
  session = { client: "agent", user: "usr_a", account: "alex" };
  expect(
    (await x.app.inject("/api/account/deliveries")).json().deliveries[0].day,
  ).not.toBe("Saturday");
  await x.app.close();
});

it.each(['operation_id="op_x"', "garbage", "operation_id=op, revision=r", ""])(
  "treats a malformed Poppy-Approval as no approval: %s",
  async (header) => {
    const x = setup();
    await x.post("/api/account/delivery-change", { day: "Saturday" });
    const r = await x.post(
      "/api/account/delivery-change",
      { day: "Saturday" },
      header || undefined,
    );
    expect(r.statusCode).toBe(403);
    await x.app.close();
  },
);

it("ignores unknown approval members and bounds revisions per operation", async () => {
  const x = setup();
  const op = (
    await x.post("/api/account/delivery-items-change", {
      product_id: "apples",
      quantity: 1,
    })
  ).json().operation;
  const header = `operation_id="${op.operation_id}", revision="${op.revision}", future="yes"`;
  expect(
    (
      await x.post(
        "/api/account/delivery-items-change",
        { product_id: "apples", quantity: 1 },
        header,
      )
    ).statusCode,
  ).toBe(200);
  const y = setup();
  let status = 403;
  for (let q = 1; q <= 25 && status === 403; q++)
    status = (
      await y.post("/api/account/checkout", {
        day: ["Tuesday", "Thursday", "Saturday"][q % 3]! + "",
      })
    ).statusCode;
  expect([403, 429]).toContain(status);
  await x.app.close();
  await y.app.close();
});

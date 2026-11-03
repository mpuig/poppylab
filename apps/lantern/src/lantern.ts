/**
 * Lantern Noodle Bar: a second, fictional PAP 0.3 example Company for local
 * testing. It speaks the same protocol as Juniper through the shared gateway
 * but has its own issuer, scopes, contract and business: scheduled delivery
 * orders that can be moved or changed, each change approved through
 * Operations v2. Independent experiment, not affiliated with the authors of
 * the Personal Agent Protocol or with any sandbox.
 */
import type { Hono } from "hono";
import type {
  CompanyDefinition,
  Gate,
  GrantAccess,
  OperationRecord,
  Session,
} from "@poppy-lab/pap-company";
import type { Context } from "hono";
import {
  consentPage,
  fontSources,
  forAgentsPage,
  homePage,
  pageHeaders,
} from "./site.ts";
import { mountPortal } from "./portal.ts";

export {
  customers,
  DELIVERY_CENTS,
  menu,
  noodlePersona,
  slots,
} from "./data.ts";
import {
  customers,
  DELIVERY_CENTS,
  menu,
  noodlePersona,
  slots,
} from "./data.ts";

export type Order = {
  id: string;
  slot: string;
  lines: Record<string, number>;
  version: number;
  status: "scheduled";
  recipient: string;
  address: string;
};
type State = { orders?: Record<string, Order[]> };
const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
const slotLabel = (id: string) => slots.find((s) => s.id === id)?.label ?? id;
function priced(lines: Record<string, number>) {
  const items = menu
    .filter((d) => lines[d.id])
    .map((d) => ({
      dish_id: d.id,
      name: d.name,
      quantity: lines[d.id]!,
      unit_price_cents: d.price_cents,
      line_total_cents: d.price_cents * lines[d.id]!,
    }));
  const subtotal = items.reduce((n, i) => n + i.line_total_cents, 0);
  return {
    items,
    subtotal_cents: subtotal,
    delivery_cents: DELIVERY_CENTS,
    total_cents: subtotal + DELIVERY_CENTS,
  };
}
const view = (o: Order) => ({
  id: o.id,
  status: o.status,
  slot: { id: o.slot, label: slotLabel(o.slot) },
  recipient: o.recipient,
  address: o.address,
  version: o.version,
  currency: "USD",
  ...priced(o.lines),
  note: "Fictional order: no real food, charge or delivery.",
});
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Validates a change request strictly; returns the new slot and lines. */
function changed(order: Order, body: unknown) {
  if (
    !object(body) ||
    Object.keys(body).some((k) => !["slot_id", "add", "remove"].includes(k))
  )
    return undefined;
  const lines = { ...order.lines };
  let slot = order.slot;
  if (body.slot_id !== undefined) {
    if (!slots.some((s) => s.id === body.slot_id)) return undefined;
    slot = String(body.slot_id);
  }
  if (body.add !== undefined) {
    if (!Array.isArray(body.add) || body.add.length > 6) return undefined;
    for (const item of body.add) {
      if (
        !object(item) ||
        Object.keys(item).some((k) => !["dish_id", "quantity"].includes(k)) ||
        !menu.some((d) => d.id === item.dish_id) ||
        !Number.isSafeInteger(item.quantity) ||
        Number(item.quantity) < 1 ||
        Number(item.quantity) > 5
      )
        return undefined;
      const id = String(item.dish_id);
      lines[id] = Math.min((lines[id] ?? 0) + Number(item.quantity), 9);
    }
  }
  if (body.remove !== undefined) {
    if (!Array.isArray(body.remove) || body.remove.length > 6) return undefined;
    for (const id of body.remove) {
      if (typeof id !== "string" || !lines[id]) return undefined;
      delete lines[id];
    }
  }
  if (!Object.keys(lines).length) return undefined;
  if (
    slot === order.slot &&
    JSON.stringify(lines) === JSON.stringify(order.lines)
  )
    return undefined;
  return { slot, lines };
}

const read = (
  operationId: string,
  summary: string,
  parameters?: unknown[],
) => ({
  get: {
    operationId,
    summary,
    "x-poppy-scopes": ["orders:read"],
    security: [{ dpop: ["orders:read"] }],
    responses: { "200": { description: "Account data" } },
    ...(parameters ? { parameters } : {}),
  },
});
const orderId = {
  name: "order_id",
  in: "path",
  required: true,
  schema: { type: "string", maxLength: 64 },
};
export const noodlePaths = {
  "/api/menu": {
    get: {
      operationId: "menu",
      summary: "Read the fictional menu with prices in USD cents. Public.",
      "x-poppy-scopes": [],
      responses: { "200": { description: "Menu" } },
    },
  },
  "/api/delivery-slots": {
    get: {
      operationId: "delivery_slots",
      summary: "Read the delivery slots an order can be moved to. Public.",
      "x-poppy-scopes": [],
      responses: { "200": { description: "Slots" } },
    },
  },
  "/api/account/orders": read(
    "my_orders",
    "Read the customer's scheduled orders: dishes, slot, address and totals.",
  ),
  "/api/account/orders/{order_id}": read(
    "order_details",
    "Read one scheduled order by ID.",
    [orderId],
  ),
  "/api/account/orders/{order_id}/changes": {
    post: {
      operationId: "change_order",
      summary:
        "Propose changing a scheduled order: move it to another slot_id, add dishes (add: dish_id and quantity) or remove dishes (remove: dish_ids). Read the order and menu first. The user approves the exact new total; a price increase is charged (simulated).",
      "x-poppy-scopes": ["orders:read", "orders:write"],
      security: [{ dpop: ["orders:write"] }],
      "x-poppy-proposal": true,
      parameters: [orderId],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                slot_id: { type: "string", enum: slots.map((s) => s.id) },
                add: {
                  type: "array",
                  maxItems: 6,
                  items: {
                    type: "object",
                    properties: {
                      dish_id: { type: "string", enum: menu.map((d) => d.id) },
                      quantity: { type: "integer", minimum: 1, maximum: 5 },
                    },
                    required: ["dish_id", "quantity"],
                    additionalProperties: false,
                  },
                },
                remove: {
                  type: "array",
                  maxItems: 6,
                  items: { type: "string", enum: menu.map((d) => d.id) },
                },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        "200": { description: "Changed, after the user's approval" },
        "403": {
          description:
            "approval_required: nothing changed; the operation is attached",
        },
      },
    },
  },
};

function mount(
  app: Hono,
  ctx: {
    sessionFor: (c: Context) => Session;
    state: Record<string, unknown>;
    gate: Gate;
    grants: GrantAccess;
    origin: string;
    operations: () => Readonly<Record<string, OperationRecord>>;
  },
) {
  const state = ctx.state as State;
  const orders = (state.orders ??= {});
  const account = (s: Session) => s.account ?? "sam";
  const ordersFor = (id: string) => {
    const customer = noodlePersona(id) ?? customers[0]!;
    return (orders[id] ??= [
      {
        ...customer.order,
        lines: { ...customer.order.lines },
        version: 1,
        status: "scheduled",
        recipient: customer.name,
        address: "Fictional address — Lantern demo",
      },
    ]);
  };
  const ordersOf = (s: Session) => ordersFor(account(s));
  mountPortal(app, ctx, { ordersFor, view, priced, slotLabel });
  app.get("/api/menu", (c) =>
    c.json({
      currency: "USD",
      dishes: menu,
      delivery_cents: DELIVERY_CENTS,
      note: "Fictional menu.",
    }),
  );
  app.get("/api/delivery-slots", (c) => c.json({ slots }));
  app.get("/api/account/orders", (c) =>
    c.json({ orders: ordersOf(ctx.sessionFor(c)).map(view) }),
  );
  app.get("/api/account/orders/:order_id", (c) => {
    const o = ordersOf(ctx.sessionFor(c)).find(
      (x) => x.id === c.req.param("order_id"),
    );
    return o ? c.json(view(o)) : c.json({ error: "order_not_found" }, 404);
  });
  app.post("/api/account/orders/:order_id/changes", async (c) => {
    const s = ctx.sessionFor(c),
      o = ordersOf(s).find((x) => x.id === c.req.param("order_id"));
    if (!o) return c.json({ error: "order_not_found" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_change" }, 400);
    }
    const next = changed(o, body);
    if (!next) return c.json({ error: "invalid_change" }, 400);
    const before = priced(o.lines),
      after = priced(next.lines);
    const difference = after.total_cents - before.total_cents;
    const terms = {
      order_id: o.id,
      order_version: o.version,
      from_slot: o.slot,
      to_slot: next.slot,
      lines: next.lines,
      before_total_cents: before.total_cents,
      new_total_cents: after.total_cents,
      price_difference_cents: difference,
      currency: "USD",
      payment: "Simulated card on file — no real charge",
    };
    const summary = [
      `Change order ${o.id} for ${o.recipient}.`,
      next.slot !== o.slot
        ? `Move delivery from ${slotLabel(o.slot)} to ${slotLabel(next.slot)}.`
        : `Delivery stays ${slotLabel(o.slot)}.`,
      `New dishes: ${after.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}.`,
      `New total ${usd(after.total_cents)} (was ${usd(before.total_cents)}; ${difference > 0 ? `${usd(difference)} more, charged` : difference < 0 ? `${usd(-difference)} less, refunded` : "no price change"} — simulated, no real payment).`,
    ].join(" ");
    return ctx.gate(c, {
      key: `order:${o.id}:${o.version}`,
      terms,
      summary,
      perform: (t) => {
        o.slot = String(t.to_slot);
        o.lines = { ...(t.lines as Record<string, number>) };
        o.version++;
        return {
          summary: `Order ${o.id} changed: ${slotLabel(o.slot)}, total ${usd(priced(o.lines).total_cents)}. Simulated; nothing is charged or delivered.`,
          data: view(o),
        };
      },
      stale: (t) => o.version !== t.order_version,
    });
  });
}

export const lantern: CompanyDefinition = {
  name: "Lantern Noodle Bar",
  readScope: "orders:read",
  writeScope: "orders:write",
  consent: consentPage,
  persona: noodlePersona,
  defaultAccount: "sam",
  paths: noodlePaths,
  mount,
  discovery: (origin, domain) => ({
    protocol_version: "0.3",
    organization: { name: "Lantern Noodle Bar", domain },
    auth: {
      issuer: origin,
      scopes: {
        "orders:read":
          "See your scheduled orders: dishes, delivery slot, address and price. Read only.",
        "orders:write":
          "Change a scheduled order: move its slot, or add or remove dishes. A change can cost more, which can't be undone. You approve each change. Doesn't include reading your orders.",
      },
      scope_hints: {
        "orders:read": { changes: "none", personal_data: true },
        "orders:write": { changes: "irreversible", personal_data: true },
      },
    },
    apis: [
      {
        type: "openapi",
        url: `${origin}/openapi.json`,
        description:
          "Menu, delivery slots, the customer's scheduled orders, and changes to them",
      },
    ],
    web: {},
    excluded_tasks: { url: `${origin}/poppy/excluded-tasks.json` },
    extensions: { operations: { version: "2" } },
  }),
  excludedTasks: (origin) => ({
    tasks: [
      {
        task: "Cancel an order",
        alternative: {
          instructions:
            "Scheduled orders can't be cancelled through the protocol. They can be moved to another slot instead.",
          references: [
            {
              type: "openapi",
              url: `${origin}/openapi.json`,
              operation_id: "change_order",
            },
          ],
        },
      },
      { task: "Change the delivery address of an order" },
    ],
  }),
  landing: homePage,
  pages: { "/for-agents": forAgentsPage },
  pageHeaders,
  fontSources,
};

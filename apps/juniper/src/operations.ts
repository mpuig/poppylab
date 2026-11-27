import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import { randomId } from "@poppy-lab/pap-client";
import {
  agentActivity,
  approvals,
  keepActivity,
  type Action,
  type ActivityEntry,
  type ActivityItem,
  type OperationRecord,
} from "@poppy-lab/pap-company";
import type { Session } from "@poppy-lab/pap-company";
import { profileState } from "./profiles.js";
import { persona } from "./personas.js";
import {
  ShoppingConflict,
  shoppingInput,
  validDay,
  validQuantity,
} from "./shopping-edits.js";
import { customerServices, type ServiceCustomer } from "./customer-services.js";
import { body } from "./request.js";
export const catalogue = [
  {
    id: "oranges",
    name: "Cara cara oranges",
    price: 450,
    unit: "bag",
    stock: 24,
  },
  {
    id: "broccoli",
    name: "Purple sprouting broccoli",
    price: 325,
    unit: "bunch",
    stock: 18,
  },
  {
    id: "apples",
    name: "Pink lady apples",
    price: 390,
    unit: "bag",
    stock: 32,
  },
  {
    id: "coffee",
    name: "Juniper house coffee",
    price: 1400,
    unit: "250g bag",
    stock: 12,
  },
];
type Customer = ServiceCustomer & {
  day: string;
  version: number;
  basket: Record<string, number>;
  deliveryItems: Record<string, number>;
  deliveryVersion: number;
  orders: Array<{
    id: string;
    items: unknown;
    total_cents: number;
    currency: string;
    delivery_day: string;
    status: string;
    recipient?: string;
    destination?: string;
  }>;
};
export type Commerce = {
  customers: Record<string, Customer>;
  records: Record<string, OperationRecord>;
  /** Without the gateway: what the gate finished (the gateway keeps its own). */
  activity?: ActivityEntry[];
};
/** Operations v3 from the gateway; standalone (tests) builds its own. */
export type Approve = (ctx: Context, action: Action) => Response;
export function operations(
  app: Hono,
  sessionFor: (ctx: Context) => Session,
  state: Commerce = { customers: {}, records: {} },
  gateway?: Approve,
  /** With the gateway: its record of an account's agent activity. */
  activity: (account: string) => ActivityItem[] = (account) =>
    agentActivity(account, state.records, state.activity ?? []),
) {
  const account = (s: Session) => s.account ?? "elena";
  const customer = (s: Session) => {
    const p = persona(account(s));
    const c = (state.customers[account(s)] ??= {
      ...(p
        ? { profile: { name: p.name, email: p.email, address: p.address } }
        : {}),
      day: p?.day ?? "Thursday",
      version: 1,
      basket: { ...(p?.items ?? { oranges: 1, coffee: 1 }) } as Record<
        string,
        number
      >,
      deliveryItems: { ...(p?.items ?? { oranges: 1, coffee: 1 }) } as Record<
        string,
        number
      >,
      deliveryVersion: 1,
      orders: [],
    });
    // Upgrade old encrypted snapshots without resetting baskets or orders.
    c.deliveryItems ??= { oranges: 1, coffee: 1 };
    c.deliveryVersion ??= 1;
    return c;
  };
  const basket = (c: Customer) => {
    const items = catalogue
      .filter((p) => c.basket[p.id])
      .map((p) => ({
        ...p,
        quantity: c.basket[p.id]!,
        line_total_cents: p.price * c.basket[p.id]!,
      }));
    const subtotal = items.reduce((n, p) => n + p.line_total_cents, 0);
    const fee = subtotal >= 3500 || !items.length ? 0 : 500;
    return {
      items,
      subtotal_cents: subtotal,
      delivery_fee_cents: fee,
      total_cents: subtotal + fee,
      currency: "USD",
      version: c.version,
    };
  };
  const owner = (ctx: Context) => {
    const s = sessionFor(ctx);
    return { client: s.client, user: s.user, account: account(s) };
  };
  let approve = gateway;
  if (!approve) {
    // Without the gateway (unit tests): the same engine, and its §7 replay.
    const engine = approvals(state.records, {
      finished: (entry) => keepActivity((state.activity ??= []), entry),
    });
    app.use("*", async (ctx, next) => {
      if (
        ctx.req.method === "POST" &&
        ctx.req.path.startsWith("/api/account/")
      ) {
        const first = engine.replay(
          owner(ctx),
          ctx.req.header("poppy-approval"),
        );
        if (first) return ctx.json(first, 200);
      }
      await next();
    });
    approve = (ctx, action) => {
      const outcome = engine.gate(
        owner(ctx),
        ctx.req.header("poppy-approval"),
        action,
      );
      return Response.json(outcome.body, { status: outcome.status });
    };
  }
  const services = customerServices(app, sessionFor, customer, gate);
  app.get("/api/account/deliveries", (ctx) => {
    const c = customer(sessionFor(ctx)),
      recurring = basket({ ...c, basket: c.deliveryItems });
    return ctx.json({
      customer: profileState(c).profile.name,
      deliveries: [
        {
          id: "delivery_001",
          day: c.day,
          items: catalogue
            .filter((p) => c.deliveryItems[p.id])
            .map((p) => p.name),
          line_items: recurring.items,
          total_cents: recurring.total_cents,
          currency: "USD",
          version: c.deliveryVersion,
          note: "Fictional recurring delivery; no real shipment.",
        },
      ],
    });
  });
  app.get("/api/account/basket", (ctx) =>
    ctx.json(basket(customer(sessionFor(ctx)))),
  );
  app.get("/api/account/orders", (ctx) =>
    ctx.json({ orders: customer(sessionFor(ctx)).orders }),
  );
  app.get("/api/account/orders/:id", (ctx) => {
    const order = customer(sessionFor(ctx)).orders.find(
      (o) => o.id === ctx.req.param("id"),
    );
    return order
      ? ctx.json(order)
      : ctx.json({ error: "order_not_found" }, 404);
  });
  const comparable = (t: Record<string, unknown>) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(t).filter(
          ([key]) => t.kind !== "support_case" || key !== "case_id",
        ),
      ),
    );
  /** The action a request is for: same action → same operation_id (§3). */
  function actionKey(c: Customer, t: Record<string, unknown>) {
    switch (t.kind) {
      case "delivery":
        return `delivery:${t.delivery_version}`;
      case "delivery_items":
        return `delivery_items:${t.product_id}:${t.delivery_version}`;
      case "basket":
        return `basket:${t.product_id}:${t.basket_version}`;
      case "checkout":
        return `checkout:${t.basket_version}`;
      case "support_resolution":
        return `resolution:${t.case_id}:${t.case_version}`;
      case "profile_change":
        return `profile:${t.profile_version}`;
      default:
        return `case:${(c.cases ?? []).length}:${createHash("sha256").update(comparable(t)).digest("base64url").slice(0, 16)}`;
    }
  }
  /** Juniper's proposals, through the shared Operations v3 gate. */
  function gate(
    ctx: Context,
    s: Session,
    terms: Record<string, unknown>,
    summary: string,
  ) {
    return approve!(ctx, {
      key: actionKey(customer(s), terms),
      terms,
      summary,
      // A generated case ID is not part of what the customer asked for.
      ...(terms.kind === "support_case" ? { ignore: ["case_id"] } : {}),
      perform: (t) => perform(s, t),
      stale: (t) =>
        ["support_case", "support_resolution", "profile_change"].includes(
          String(t.kind),
        ) && services.stale(s, t),
    });
  }
  app.post("/api/account/delivery-change", async (ctx) => {
    const to = ((await body(ctx)) as { day?: string } | undefined)?.day;
    if (!validDay(to)) return ctx.json({ error: "invalid_day" }, 400);
    const s = sessionFor(ctx),
      c = customer(s);
    return gate(
      ctx,
      s,
      {
        kind: "delivery",
        delivery_id: "delivery_001",
        from: c.day,
        delivery_version: c.deliveryVersion,
        to,
        fee_cents: 0,
        currency: "USD",
      },
      `Move ${profileState(c).profile.name}’s fictional delivery delivery_001 from ${c.day} to ${to}, recurring weekly. No charge (USD 0.00). No real shipment is affected.`,
    );
  });
  app.post("/api/account/delivery-items-change", async (ctx) => {
    const b = (await body(ctx)) as
        { product_id?: string; quantity?: number } | undefined,
      s = sessionFor(ctx),
      c = customer(s),
      p = catalogue.find((p) => p.id === b?.product_id),
      quantity = b?.quantity;
    if (!p || !validQuantity(quantity, p.stock))
      return ctx.json({ error: "invalid_quantity_or_product" }, 400);
    const nextItems = { ...c.deliveryItems, [p.id]: quantity! };
    const next = basket({ ...c, basket: nextItems });
    return gate(
      ctx,
      s,
      {
        kind: "delivery_items",
        delivery_id: "delivery_001",
        product_id: p.id,
        product_name: p.name,
        from_quantity: c.deliveryItems[p.id] ?? 0,
        quantity,
        unit: p.unit,
        unit_price_cents: p.price,
        delivery_version: c.deliveryVersion,
        delivery_day: c.day,
        frequency: "weekly",
        next_items: next.items,
        subtotal_cents: next.subtotal_cents,
        delivery_fee_cents: next.delivery_fee_cents,
        tax_cents: 0,
        total_cents: next.total_cents,
        currency: "USD",
      },
      `${quantity === 0 ? "Remove" : `Set quantity to ${quantity} for`} ${p.name} in ${profileState(c).profile.name}’s fictional recurring delivery delivery_001 (${c.day}, weekly). New items: ${next.items.map((i) => `${i.quantity} × ${i.name} (${i.unit}), USD ${(i.line_total_cents / 100).toFixed(2)}`).join("; ") || "none"}. New weekly subtotal USD ${(next.subtotal_cents / 100).toFixed(2)}, delivery USD ${(next.delivery_fee_cents / 100).toFixed(2)}, tax USD 0.00, total USD ${(next.total_cents / 100).toFixed(2)}. No items means no shipment. This does not change the shopping basket or existing orders. No real payment or shipment.`,
    );
  });
  app.post("/api/account/basket-change", async (ctx) => {
    const b = (await body(ctx)) as
        { product_id?: string; quantity?: number } | undefined,
      s = sessionFor(ctx),
      c = customer(s),
      p = catalogue.find((p) => p.id === b?.product_id),
      quantity = b?.quantity;
    if (!p || !validQuantity(quantity, p.stock))
      return ctx.json({ error: "invalid_quantity_or_product" }, 400);
    return gate(
      ctx,
      s,
      {
        kind: "basket",
        product_id: p.id,
        product_name: p.name,
        from_quantity: c.basket[p.id] ?? 0,
        unit: p.unit,
        quantity,
        unit_price_cents: p.price,
        currency: "USD",
        basket_version: c.version,
      },
      `Set ${p.name} to ${quantity} ${p.unit}(s) in ${profileState(c).profile.name}’s fictional basket at USD ${(p.price / 100).toFixed(2)} per ${p.unit}. Quantity zero removes it. No payment or order is placed.`,
    );
  });
  function checkoutQuote(c: Customer, day: string) {
    const b = basket(c);
    const terms = {
      kind: "checkout",
      tax_cents: 0,
      ...b,
      delivery_day: day,
      recipient: profileState(c).profile.name,
      destination: profileState(c).profile.address,
      profile_version: profileState(c).profile_version,
      payment: "Simulation only — no real charge",
      basket_version: c.version,
    };
    const summary = `Place a fictional order for ${terms.recipient}: ${b.items.map((p) => `${p.quantity} × ${p.name} (${p.unit}), USD ${(p.line_total_cents / 100).toFixed(2)}`).join("; ")}. Subtotal USD ${(b.subtotal_cents / 100).toFixed(2)}, delivery USD ${(b.delivery_fee_cents / 100).toFixed(2)}, tax USD 0.00, total USD ${(b.total_cents / 100).toFixed(2)}. Deliver ${day} to “${terms.destination}”. Simulation only: no real payment or shipment. The basket will be cleared.`;
    return { terms, summary };
  }
  app.post("/api/account/checkout", async (ctx) => {
    const s = sessionFor(ctx),
      c = customer(s),
      b = basket(c),
      day = ((await body(ctx)) as { day?: string } | undefined)?.day ?? c.day;
    if (!b.items.length) return ctx.json({ error: "empty_basket" }, 400);
    if (!validDay(day)) return ctx.json({ error: "invalid_day" }, 400);
    if (c.orders.length >= 1000) return ctx.json({ error: "order_limit" }, 429);
    const { terms, summary } = checkoutQuote(c, day);
    return gate(ctx, s, terms, summary);
  });
  /** Performs approved terms; responds as the request would without operations. */
  function perform(s: Session, t: Record<string, unknown>) {
    const c = customer(s);
    if (
      t.kind === "support_case" ||
      t.kind === "support_resolution" ||
      t.kind === "profile_change"
    )
      return services.apply(s, t);
    if (t.kind === "delivery") {
      c.day = String(t.to);
      c.deliveryVersion++;
      return {
        summary: `Fictional delivery delivery_001 now repeats weekly on ${c.day}. USD 0.00 charged. No real shipment affected.`,
      };
    }
    if (t.kind === "delivery_items") {
      c.deliveryItems[String(t.product_id)] = Number(t.quantity);
      c.deliveryVersion++;
      return {
        summary: `Fictional recurring delivery delivery_001 updated: ${t.product_id} quantity ${t.quantity}, weekly on ${c.day}. Weekly total USD ${(Number(t.total_cents) / 100).toFixed(2)}. Shopping basket and existing orders unchanged. No real payment or shipment.`,
      };
    }
    if (t.kind === "basket") {
      c.basket[String(t.product_id)] = Number(t.quantity);
      c.version++;
      return {
        summary: `Fictional basket updated: ${t.product_id} quantity ${t.quantity}. No payment or order placed.`,
      };
    }
    const order = {
      id: `ord_${randomId()}`,
      items: t.items,
      total_cents: Number(t.total_cents),
      currency: "USD",
      delivery_day: String(t.delivery_day),
      recipient: String(t.recipient),
      destination: String(t.destination),
      status: "simulated",
    };
    c.orders.push(order);
    c.basket = {};
    c.version++;
    return {
      summary: `Fictional order ${order.id} placed for USD ${(order.total_cents / 100).toFixed(2)}, delivery ${order.delivery_day}. Basket cleared. No real payment or shipment.`,
      data: order,
    };
  }
  return {
    /** What the agents asked for, for the website to list. */
    activity,
    services: {
      ...services,
      updateBasket(s: Session, data: unknown) {
        const c = customer(s),
          input = shoppingInput(data, catalogue, false);
        if (c.version !== input.version) throw new ShoppingConflict();
        c.basket = input.items;
        c.version++;
        return basket(c);
      },
      updateDelivery(s: Session, data: unknown) {
        const c = customer(s),
          input = shoppingInput(data, catalogue, true);
        if (c.deliveryVersion !== input.version) throw new ShoppingConflict();
        c.deliveryItems = input.items;
        c.day = input.day;
        c.deliveryVersion++;
        return { version: c.deliveryVersion };
      },
    },
    view(s: Session) {
      const c = customer(s),
        recurring = basket({ ...c, basket: c.deliveryItems });
      return {
        customer: profileState(c).profile.name,
        account_id: account(s),
        ...services.view(s),
        catalogue,
        basket: basket(c),
        delivery: {
          id: "delivery_001",
          day: c.day,
          frequency: "weekly",
          ...recurring,
          version: c.deliveryVersion,
        },
        orders: c.orders.slice().reverse(),
      };
    },
  };
}

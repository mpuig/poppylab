import type { Req, Router } from "./router.js";
import { createHash } from "node:crypto";
import { randomId } from "@poppy-lab/pap-client";
import {
  approvals,
  type Action,
  type OperationRecord,
} from "@poppy-lab/pap-company";
import type { Reply } from "./router.js";
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
};
/** Operations v2 from the gateway; standalone (tests) builds its own. */
export type Approve = (req: Req, action: Action) => Response;
export function operations(
  app: Router,
  sessionFor: (request: Req) => Session,
  state: Commerce = { customers: {}, records: {} },
  gateway?: Approve,
  /** With the gateway: its operation records, for the website's activity. */
  records: () => Readonly<Record<string, OperationRecord>> = () =>
    state.records,
) {
  const account = (s: Session) => s.account ?? "alex";
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
  const owner = (req: Req) => {
    const s = sessionFor(req);
    return { client: s.client, user: s.user, account: account(s) };
  };
  let approve = gateway;
  if (!approve) {
    // Without the gateway (unit tests): the same engine, and its §7 replay.
    const engine = approvals(state.records);
    app.addHook("preHandler", (req, reply) => {
      if (req.method !== "POST" || !req.url.startsWith("/api/account/")) return;
      const first = engine.replay(owner(req), req.headers["poppy-approval"]);
      if (first) return reply.code(200).send(first);
    });
    approve = (req, action) => {
      const outcome = engine.gate(
        owner(req),
        req.headers["poppy-approval"],
        action,
      );
      return Response.json(outcome.body, { status: outcome.status });
    };
  }
  const services = customerServices(app, sessionFor, customer, gate);
  app.get("/api/account/deliveries", async (req) => ({
    customer: profileState(customer(sessionFor(req))).profile.name,
    deliveries: [
      {
        id: "delivery_001",
        day: customer(sessionFor(req)).day,
        items: catalogue
          .filter((p) => customer(sessionFor(req)).deliveryItems[p.id])
          .map((p) => p.name),
        line_items: basket({
          ...customer(sessionFor(req)),
          basket: customer(sessionFor(req)).deliveryItems,
        }).items,
        total_cents: basket({
          ...customer(sessionFor(req)),
          basket: customer(sessionFor(req)).deliveryItems,
        }).total_cents,
        currency: "USD",
        version: customer(sessionFor(req)).deliveryVersion,
        note: "Fictional recurring delivery; no real shipment.",
      },
    ],
  }));
  app.get("/api/account/basket", async (req) =>
    basket(customer(sessionFor(req))),
  );
  app.get("/api/account/orders", async (req) => ({
    orders: customer(sessionFor(req)).orders,
  }));
  app.get<{ Params: { id: string } }>(
    "/api/account/orders/:id",
    async (req, reply) => {
      const order = customer(sessionFor(req)).orders.find(
        (o) => o.id === req.params.id,
      );
      return order ?? reply.code(404).send({ error: "order_not_found" });
    },
  );
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
  /** Juniper's proposals, through the shared Operations v2 gate. */
  function gate(
    req: Req,
    reply: Reply,
    s: Session,
    terms: Record<string, unknown>,
    summary: string,
  ) {
    void reply;
    return approve!(req, {
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
  app.post<{ Body: { day?: string } }>(
    "/api/account/delivery-change",
    async (req, reply) => {
      const to = req.body?.day;
      if (!validDay(to)) return reply.code(400).send({ error: "invalid_day" });
      const s = sessionFor(req),
        c = customer(s);
      return gate(
        req,
        reply,
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
    },
  );
  app.post<{ Body: { product_id?: string; quantity?: number } }>(
    "/api/account/delivery-items-change",
    async (req, reply) => {
      const s = sessionFor(req),
        c = customer(s),
        p = catalogue.find((p) => p.id === req.body?.product_id),
        quantity = req.body?.quantity;
      if (!p || !validQuantity(quantity, p.stock))
        return reply.code(400).send({ error: "invalid_quantity_or_product" });
      const nextItems = { ...c.deliveryItems, [p.id]: quantity! };
      const next = basket({ ...c, basket: nextItems });
      return gate(
        req,
        reply,
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
    },
  );
  app.post<{ Body: { product_id?: string; quantity?: number } }>(
    "/api/account/basket-change",
    async (req, reply) => {
      const s = sessionFor(req),
        c = customer(s),
        p = catalogue.find((p) => p.id === req.body?.product_id),
        quantity = req.body?.quantity;
      if (!p || !validQuantity(quantity, p.stock))
        return reply.code(400).send({ error: "invalid_quantity_or_product" });
      return gate(
        req,
        reply,
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
    },
  );
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
  app.post<{ Body: { day?: string } }>(
    "/api/account/checkout",
    async (req, reply) => {
      const s = sessionFor(req),
        c = customer(s),
        b = basket(c),
        day = req.body?.day ?? c.day;
      if (!b.items.length)
        return reply.code(400).send({ error: "empty_basket" });
      if (!validDay(day)) return reply.code(400).send({ error: "invalid_day" });
      if (c.orders.length >= 1000)
        return reply.code(429).send({ error: "order_limit" });
      const { terms, summary } = checkoutQuote(c, day);
      return gate(req, reply, s, terms, summary);
    },
  );
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
        activity: Object.entries(records())
          .filter(([, r]) => r.account === account(s))
          .slice(-8)
          .reverse()
          .map(([id, r]) => {
            const latest = r.revisions.at(-1);
            const expired =
              !r.performed &&
              (!latest || Date.parse(latest.expires_at) < Date.now());
            return {
              id,
              state: r.performed
                ? "succeeded"
                : expired
                  ? "expired"
                  : "proposed",
              summary:
                r.revisions.find((v) => v.revision === r.performed?.revision)
                  ?.summary ??
                latest?.summary ??
                r.performed?.body.summary ??
                "",
              result: r.performed
                ? r.performed.body.summary
                : expired
                  ? "The proposal expired without changing anything."
                  : null,
            };
          }),
      };
    },
  };
}

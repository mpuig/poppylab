/**
 * Lantern's customer account area (`/account`, `/site/*`): the same
 * capabilities as Juniper's, in Lantern's terms. A browser signs in as a
 * test customer and sees the scheduled orders the agent sees, can edit an
 * order itself (which invalidates any pending agent proposal, because the
 * order's version moves on), reads the agent's activity, and revokes the
 * agent's grants. Pending proposals never show as changes. The gateway
 * routes each browser to its own tenant, or to the agent user's tenant once
 * that browser approved the agent's consent.
 *
 * An agent's own browser, joined to its Session (§6), is served here too
 * (`siteViewer`): signed in through the join it sees the orders and the
 * last delivery with `orders:read`, as the API shows them, and never the
 * connected agents, their activity or their reports. It is offered no
 * control, and the gateway refuses every change it sends.
 */
import type { Hono } from "hono";
import {
  AGENT_BROWSER_LOGIN,
  agentBrowserNotice,
  agentBrowserState,
  feedbackSection,
  mountCustomerPortal,
  viewerSees,
  type CustomerPortalContext,
  type FeedbackReport,
  type SitePart,
} from "@poppy-lab/pap-company";
import { customers, menu, slots } from "./data.ts";
import type { Order } from "./lantern.ts";
import { deliveredView, type Refund } from "./agent.ts";
import { consentWords } from "@poppy-lab/pap-core";
import { escape, permissions, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type Deps = {
  ordersFor: (account: string) => Order[];
  refundsFor: (account: string) => Refund[];
  view: (o: Order) => unknown;
  priced: (lines: Record<string, number>) => { total_cents: number };
  slotLabel: (id: string) => string;
};
type Ctx = CustomerPortalContext & {
  feedback: () => readonly FeedbackReport[];
};
/** What an agent's browser sees only with the scope that reads it in the API. */
const PARTS: SitePart[] = [
  { name: "Scheduled orders and the last delivery", scope: "orders:read" },
];

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function mountPortal(app: Hono, ctx: Ctx, deps: Deps) {
  const { origin } = ctx;
  const portal = mountCustomerPortal(app, ctx, {
    name: "lantern",
    isCustomer: (account) => customers.some((p) => p.id === account),
    pages: {
      joined: () =>
        shell(
          "Not signed in · Lantern Noodle Bar",
          `<main class="wrap"><section class="intro"><h1>This browser isn't signed in.</h1><p>${escape(AGENT_BROWSER_LOGIN)}</p></section></main>`,
          "/account",
          origin,
        ),
      form: (token) => {
        const options = customers
          .map((p) => `<option value="${p.id}">${escape(p.name)}</option>`)
          .join("");
        return shell(
          "Sign in · Lantern Noodle Bar",
          `<main class="wrap"><section class="intro"><h1>Your orders, on the board.</h1><p>Sign in to see your scheduled orders, edit them, and manage which agents may act for you. A connected agent sees the same orders.</p></section><section class="plain"><form class="card form" method="post" action="/site/login"><input type="hidden" name="login_token" value="${token}"><label for="account">Test customer</label><select id="account" name="account">${options}</select><button type="submit">Sign in</button><p class="notice">There is no password: this is a demo, and nobody's identity is checked. Don't enter credentials from other services.</p></form></section></main>`,
          "/account",
          origin,
        );
      },
      expired: () =>
        shell(
          "Sign in again · Lantern Noodle Bar",
          `<main class="wrap"><section class="intro"><h1>This sign-in page has expired.</h1><p>A sign-in page works for five minutes after it opens, and this one is older. You aren't signed in, and nothing has changed.</p><p><a href="/site/login">Open the sign-in page again</a></p></section></main>`,
          "/account",
          origin,
        ),
    },
    tooMany: "Too many sessions.",
    results: {
      waiting: (until) =>
        `It waits for your approval in your agent until ${until}. If you decline it there or let it run out, nothing changes. Your agent doesn't tell us when you decline, so it shows as awaiting until then.`,
      unchanged: {
        expired: "The proposal expired without changing anything.",
        declined: "Lantern declined this approval without changing anything.",
        refused:
          "Your order had changed when this was approved, so the proposal changed nothing.",
      },
    },
    permissions: (scopes) => consentWords(permissions(scopes)),
    view: (viewer, { activity, agents }) => {
      const { account } = viewer;
      const customer = customers.find((p) => p.id === account)!;
      const orders = viewerSees(viewer, "orders:read");
      return {
        account_id: account,
        customer: customer.name,
        menu,
        slots,
        orders: orders ? deps.ordersFor(account).map(deps.view) : [],
        delivered: orders
          ? deliveredView(account, deps.refundsFor(account))
          : null,
        activity,
        // With the account, so the page's own two-second read keeps the list
        // of connected agents current, in the consent page's words.
        agents,
        ...agentBrowserState(viewer, PARTS),
      };
    },
    script: siteScript,
  });
  /**
   * A website edit replaces the order's slot and dishes and moves its
   * version on, so a pending agent proposal for the old version is stale.
   */
  app.post("/site/orders/:order_id", async (c) => {
    const record = portal.changer(c);
    if (!record)
      return c.json({ error: "customer_session_and_origin_required" }, 403);
    const order = deps
      .ordersFor(record.account)
      .find((o) => o.id === c.req.param("order_id"));
    if (!order) return c.json({ error: "order_not_found" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (
      !object(body) ||
      Object.keys(body).some(
        (k) => !["version", "slot_id", "lines"].includes(k),
      ) ||
      !slots.some((s) => s.id === body.slot_id) ||
      !object(body.lines) ||
      Object.entries(body.lines).some(
        ([id, q]) =>
          !menu.some((d) => d.id === id) ||
          !Number.isSafeInteger(q) ||
          Number(q) < 0 ||
          Number(q) > 9,
      )
    )
      return c.json({ error: "invalid_order" }, 400);
    const lines = Object.fromEntries(
      Object.entries(body.lines as Record<string, number>).filter(
        ([, q]) => q > 0,
      ),
    );
    if (!Object.keys(lines).length)
      return c.json({ error: "invalid_order" }, 400);
    if (Number(body.version) !== order.version)
      return c.json({ error: "order_changed" }, 409);
    order.slot = String(body.slot_id);
    order.lines = lines;
    order.version++;
    return c.json({ order: deps.view(order) }, 200, {
      "Cache-Control": "no-store",
    });
  });
  app.get("/account", (c) => {
    const record = portal.viewer(c);
    if (!record) return c.redirect("/site/login", 302);
    // An agent's browser is told whose it is, and gets no control: no
    // switch of customer, no log out, and only the parts its scopes cover.
    const about = record.readOnly
      ? agentBrowserNotice(record, PARTS)
          .map((line) => `<p class="notice">${escape(line)}</p>`)
          .join("")
      : `<p>The same scheduled orders your agent reads. A proposal from your agent changes nothing until you approve it in your agent. <a href="/site/login">Switch test customer</a></p>`;
    const orders = viewerSees(record, "orders:read")
      ? `<section class="plain" id="orders"><h2>Scheduled orders</h2><div id="order-list"></div></section><section class="plain" id="delivered"><h2>Last delivery</h2><div id="delivered-order"></div></section>`
      : "";
    const own = record.agent
      ? ""
      : `<section class="plain" id="activity"><h2>Your agent's activity</h2><p class="notice">A pending proposal doesn't change your order. Approve or decline it in your agent.</p><div id="activity-list"></div></section>${feedbackSection(ctx.feedback(), { section: "plain", notice: "notice", example: "booking a table for a large group" })}<section class="plain" id="agent-access"><h2>Connected agents</h2><p class="notice">Disconnecting an agent ends its access. Logging out of this website doesn't.</p><div id="access-list"></div><p id="access-status" role="status"></p></section>`;
    const body = `<main class="wrap account" data-account="${escape(record.account)}"><section class="intro"><h1>Your orders.</h1><p id="current-account" class="notice"></p>${about}<div class="live-row"><p id="status" class="live" role="status">Loading your account…</p><div><button id="refresh" class="secondary" type="button">Refresh now</button>${record.readOnly ? "" : ' <button id="logout" class="secondary" type="button">Log out</button>'}</div></div></section><div id="content" aria-busy="true">${orders}${own}</div></main><script defer src="/site/app.js"></script>`;
    return c.html(
      shell("Your account · Lantern Noodle Bar", body, "/account", origin),
      200,
      portal.headers,
    );
  });
}

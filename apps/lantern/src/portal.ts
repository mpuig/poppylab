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
import type { Context, Hono } from "hono";
import { randomId, tokenHash } from "@poppy-lab/pap-client/core";
import {
  AGENT_BROWSER_LOGIN,
  agentBrowserNotice,
  agentBrowserState,
  feedbackSection,
  LOGIN_FORM_MS,
  loginFormToken,
  loginFormValid,
  siteViewer,
  viewerSees,
  type ActivityItem,
  type BrowserJoin,
  type FeedbackReport,
  type GrantAccess,
  type SitePart,
  type SiteViewer,
} from "@poppy-lab/pap-company";
import { customers, menu, slots } from "./data.ts";
import type { Order } from "./lantern.ts";
import { deliveredView, type Refund } from "./agent.ts";
import { consentWords } from "@poppy-lab/pap-core";
import { escape, permissions, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type WebSession = { expires: number; account: string };
type Deps = {
  ordersFor: (account: string) => Order[];
  refundsFor: (account: string) => Refund[];
  view: (o: Order) => unknown;
  priced: (lines: Record<string, number>) => { total_cents: number };
  slotLabel: (id: string) => string;
};
type Ctx = {
  state: Record<string, unknown>;
  grants: GrantAccess;
  origin: string;
  activity: (account: string) => ActivityItem[];
  feedback: () => readonly FeedbackReport[];
  browser: (c: Context) => BrowserJoin | undefined;
};
/** What an agent's browser sees only with the scope that reads it in the API. */
const PARTS: SitePart[] = [
  { name: "Scheduled orders and the last delivery", scope: "orders:read" },
];

const cookie = (c: Context, name: string) =>
  (c.req.header("cookie") ?? "")
    .split(/;\s*/)
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1) ?? "";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function mountPortal(app: Hono, ctx: Ctx, deps: Deps) {
  const { origin } = ctx;
  const secure = origin.startsWith("https:");
  const sessions = (ctx.state.webSessions ??= {}) as Record<string, WebSession>;
  // The login form carries its own token now; the nonces kept here went.
  delete ctx.state.webLogins;
  const setCookie = (name: string, value: string, maxAge: number) =>
    `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const pageHeaders = {
    "Cache-Control": "no-store",
    // The portal's own script and same-origin fetches, plus the web fonts.
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Referrer-Policy": "same-origin",
  };
  const current = (c: Context) => {
    const record = sessions[tokenHash(cookie(c, "lantern_web"))];
    return record && record.expires > Date.now() ? record : undefined;
  };
  /** A signed-in browser whose POSTs name the account they were opened for. */
  const active = (c: Context) => {
    const record = current(c);
    return (
      !!record &&
      (c.req.method !== "POST" ||
        c.req.header("x-lantern-account") === record.account)
    );
  };
  const sameOrigin = (c: Context) => c.req.header("origin") === origin;
  /** Who a read is for: a join's account first, then the browser's login. */
  const viewer = (c: Context) => siteViewer(ctx.browser(c), current(c));

  app.get("/site/login", (c) => {
    // An agent's browser gets no login form: its sign-in is the agent's.
    const join = ctx.browser(c);
    if (join?.account) return c.redirect("/account", 302);
    if (join)
      return c.html(
        shell(
          "Not signed in · Lantern Noodle Bar",
          `<main class="wrap"><section class="intro"><h1>This browser isn't signed in.</h1><p>${escape(AGENT_BROWSER_LOGIN)}</p></section></main>`,
          "/account",
          origin,
        ),
        200,
        pageHeaders,
      );
    // In a cookie and in the form: the two must arrive equal (site-login.ts).
    const token = loginFormToken();
    const options = customers
      .map((p) => `<option value="${p.id}">${escape(p.name)}</option>`)
      .join("");
    return c.html(
      shell(
        "Sign in · Lantern Noodle Bar",
        `<main class="wrap"><section class="intro"><h1>Your orders, on the board.</h1><p>Sign in to see your scheduled orders, edit them, and manage which agents may act for you. A connected agent sees the same orders.</p></section><section class="plain"><form class="card form" method="post" action="/site/login"><input type="hidden" name="login_token" value="${token}"><label for="account">Test customer</label><select id="account" name="account">${options}</select><button type="submit">Sign in</button><p class="notice">There is no password: this is a demo, and nobody's identity is checked. Don't enter credentials from other services.</p></form></section></main>`,
        "/account",
        origin,
      ),
      200,
      {
        ...pageHeaders,
        "Set-Cookie": setCookie("lantern_login", token, LOGIN_FORM_MS / 1000),
      },
    );
  });
  app.post("/site/login", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    if (
      !sameOrigin(c) ||
      !loginFormValid(cookie(c, "lantern_login"), body.login_token)
    )
      return c.html(
        shell(
          "Sign in again · Lantern Noodle Bar",
          `<main class="wrap"><section class="intro"><h1>This sign-in page has expired.</h1><p>A sign-in page works for five minutes after it opens, and this one is older. You aren't signed in, and nothing has changed.</p><p><a href="/site/login">Open the sign-in page again</a></p></section></main>`,
          "/account",
          origin,
        ),
        403,
        pageHeaders,
      );
    const selected = customers.find((p) => p.id === body.account);
    if (!selected) return c.json({ error: "invalid_account" }, 400);
    delete sessions[tokenHash(cookie(c, "lantern_web"))];
    for (const [id, s] of Object.entries(sessions))
      if (s.expires < Date.now()) delete sessions[id];
    if (Object.keys(sessions).length >= 1000)
      return c.text("Too many sessions.", 429);
    const token = randomId();
    sessions[tokenHash(token)] = {
      expires: Date.now() + 1800000,
      account: selected.id,
    };
    c.header("Set-Cookie", setCookie("lantern_web", token, 1800), {
      append: true,
    });
    c.header("Set-Cookie", setCookie("lantern_login", "", 0), { append: true });
    c.header("Cache-Control", "no-store");
    return c.redirect("/account", 302);
  });
  app.post("/site/logout", (c) => {
    if (!sameOrigin(c)) return c.json({ error: "same_origin_required" }, 403);
    delete sessions[tokenHash(cookie(c, "lantern_web"))];
    return c.json({ ok: true }, 200, {
      "Set-Cookie": setCookie("lantern_web", "", 0),
      "Cache-Control": "no-store",
    });
  });

  const stateFor = (viewer: SiteViewer) => {
    const { account } = viewer;
    const customer = customers.find((p) => p.id === account)!;
    const orders = viewerSees(viewer, "orders:read");
    // A proposal that waits. Declining one is between the customer and their
    // agent: the protocol has the agent send an approval or nothing
    // (Operations §5), so until the proposal ends we can't tell the two apart.
    const waiting = (until: string) =>
      `It waits for your approval in your agent until ${until}. If you decline it there or let it run out, nothing changes. Your agent doesn't tell us when you decline, so it shows as awaiting until then.`;
    // What a request that changed nothing says, when the gate gave no reason.
    const unchanged: Record<string, string> = {
      expired: "The proposal expired without changing anything.",
      declined: "Lantern declined this approval without changing anything.",
      refused:
        "Your order had changed when this was approved, so the proposal changed nothing.",
    };
    // What the customer's agents asked for and who is connected are the
    // customer's own to see, not an agent's browser's.
    const activity = viewer.agent
      ? []
      : ctx.activity(account).map((item) => ({
          ...item,
          result:
            item.result ??
            (item.state === "proposed"
              ? waiting(item.when)
              : unchanged[item.state]) ??
            null,
        }));
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
      agents: viewer.agent
        ? []
        : ctx.grants.list(account).map((grant) => ({
            ...grant,
            permissions: consentWords(permissions(grant.scopes)),
          })),
      ...agentBrowserState(viewer, PARTS),
    };
  };
  app.get("/site/state", (c) => {
    const seen = viewer(c);
    if (!seen)
      return c.json({ error: "sign_in_required" }, 401, {
        "Cache-Control": "no-store",
      });
    return c.json(stateFor(seen), 200, {
      "Cache-Control": "no-store",
    });
  });
  /**
   * A website edit replaces the order's slot and dishes and moves its
   * version on, so a pending agent proposal for the old version is stale.
   */
  app.post("/site/orders/:order_id", async (c) => {
    const record = current(c);
    if (!active(c) || !sameOrigin(c) || !record)
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
  app.get("/site/access", (c) => {
    const record = viewer(c);
    if (!record) return c.json({ error: "sign_in_required" }, 401);
    // The connected agents are the customer's own to see.
    if (record.agent)
      return c.json({ error: "customers_own_browser_only" }, 403);
    return c.json({ grants: ctx.grants.list(record.account) }, 200, {
      "Cache-Control": "no-store",
    });
  });
  app.post("/site/access/:id/revoke", (c) => {
    const record = current(c);
    if (!active(c) || !sameOrigin(c) || !record)
      return c.json({ error: "customer_session_and_origin_required" }, 403);
    if (!ctx.grants.revoke(record.account, c.req.param("id")))
      return c.json({ error: "grant_not_found" }, 404);
    return c.json({ revoked: true }, 200, { "Cache-Control": "no-store" });
  });

  app.get("/account", (c) => {
    const record = viewer(c);
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
      pageHeaders,
    );
  });
  app.get("/site/app.js", (c) =>
    c.text(`"use strict";\n${siteScript}`, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  );
}

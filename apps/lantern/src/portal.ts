/**
 * Lantern's customer account area (`/account`, `/site/*`): the same
 * capabilities as Juniper's, in Lantern's terms. A browser signs in as a
 * test customer and sees the scheduled orders the agent sees, can edit an
 * order itself (which invalidates any pending agent proposal, because the
 * order's version moves on), reads the agent's activity, and revokes the
 * agent's grants. Pending proposals never show as changes. The gateway
 * routes each browser to its own tenant, or to the agent user's tenant once
 * that browser approved the agent's consent.
 */
import type { Context, Hono } from "hono";
import { randomId, tokenHash } from "@poppy-lab/pap-client/core";
import type { GrantAccess, OperationRecord } from "@poppy-lab/pap-company";
import { customers, menu, slots } from "./data.ts";
import type { Order } from "./lantern.ts";
import { escape, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type WebSession = { expires: number; account: string };
type Deps = {
  ordersFor: (account: string) => Order[];
  view: (o: Order) => unknown;
  priced: (lines: Record<string, number>) => { total_cents: number };
  slotLabel: (id: string) => string;
};
type Ctx = {
  state: Record<string, unknown>;
  grants: GrantAccess;
  origin: string;
  operations: () => Readonly<Record<string, OperationRecord>>;
};

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
  const pending = (ctx.state.webLogins ??= {}) as Record<string, number>;
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

  app.get("/site/login", (c) => {
    for (const [id, expires] of Object.entries(pending))
      if (expires < Date.now()) delete pending[id];
    if (Object.keys(pending).length >= 500)
      return c.text("Too many attempts. Try again in a few minutes.", 429);
    const nonce = randomId();
    pending[tokenHash(nonce)] = Date.now() + 300000;
    const options = customers
      .map((p) => `<option value="${p.id}">${escape(p.name)}</option>`)
      .join("");
    return c.html(
      shell(
        "Sign in · Lantern Noodle Bar",
        `<main class="wrap"><section class="intro"><h1>Your orders, on the board.</h1><p>Sign in to see your scheduled orders, edit them, and manage which agents may act for you. You share the same data with your agent in Poppy Lab.</p></section><section class="plain"><form class="card form" method="post" action="/site/login"><label for="account">Test customer</label><select id="account" name="account">${options}</select><p class="notice">Fictional accounts for testing the protocol. Choosing one doesn't verify who you are.</p><button type="submit">Sign in to the selected account</button><p class="notice">Don't enter credentials from other services. Your agent's proposals are approved in Poppy Lab.</p></form></section></main>`,
        "/account",
      ),
      200,
      {
        ...pageHeaders,
        "Set-Cookie": setCookie("lantern_login", nonce, 300),
      },
    );
  });
  app.post("/site/login", async (c) => {
    const key = tokenHash(cookie(c, "lantern_login")),
      expires = pending[key];
    if (!sameOrigin(c) || !expires || expires < Date.now())
      return c.text(
        "This sign-in has expired. Open /site/login and try again.",
        403,
      );
    const body = (await c.req.parseBody()) as Record<string, string>;
    const selected = customers.find((p) => p.id === body.account);
    if (!selected) return c.json({ error: "invalid_account" }, 400);
    delete pending[key];
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

  const stateFor = (account: string) => {
    const customer = customers.find((p) => p.id === account)!;
    const activity = Object.entries(ctx.operations())
      .filter(([, r]) => r.account === account)
      .slice(-8)
      .reverse()
      .map(([id, r]) => {
        const latest = r.revisions.at(-1);
        const expired =
          !r.performed &&
          (!latest || Date.parse(latest.expires_at) < Date.now());
        return {
          id,
          state: r.performed ? "succeeded" : expired ? "expired" : "proposed",
          summary:
            r.revisions.find((v) => v.revision === r.performed?.revision)
              ?.summary ??
            latest?.summary ??
            "",
          result: r.performed
            ? r.performed.body.summary
            : expired
              ? "The proposal expired without changing anything."
              : null,
        };
      });
    return {
      account_id: account,
      customer: customer.name,
      menu,
      slots,
      orders: deps.ordersFor(account).map(deps.view),
      activity,
    };
  };
  app.get("/site/state", (c) => {
    const record = current(c);
    if (!record)
      return c.json({ error: "sign_in_required" }, 401, {
        "Cache-Control": "no-store",
      });
    return c.json(stateFor(record.account), 200, {
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
    const record = current(c);
    if (!record) return c.json({ error: "sign_in_required" }, 401);
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
    const record = current(c);
    if (!record) return c.redirect("/site/login", 302);
    const body = `<main class="wrap account" data-account="${escape(record.account)}"><section class="intro"><h1>Your orders.</h1><p id="current-account" class="notice"></p><p>The same scheduled orders your agent reads. A pending proposal changes nothing until you approve it in Poppy Lab. <a href="/site/login">Switch test customer</a></p><div class="live-row"><p id="status" class="live" role="status">Loading your account…</p><div><button id="refresh" class="secondary" type="button">Refresh now</button> <button id="logout" class="secondary" type="button">Log out</button></div></div></section><div id="content" aria-busy="true"><section class="plain" id="orders"><h2>Scheduled orders</h2><div id="order-list"></div></section><section class="plain" id="activity"><h2>Your agent's activity</h2><p class="notice">A pending proposal doesn't change your order. Approve or decline it in Poppy Lab.</p><div id="activity-list"></div></section><section class="plain" id="agent-access"><h2>Connected agents</h2><p class="notice">Revoking ends that grant's access. It doesn't log you out of this website. Logging out here doesn't revoke the agent.</p><button id="load-access" type="button" class="secondary">Show grants</button><div id="access-list"></div><p id="access-status" role="status"></p></section></div></main><script defer src="/site/app.js"></script>`;
    return c.html(
      shell("Your account · Lantern Noodle Bar", body, "/account"),
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

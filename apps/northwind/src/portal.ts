/** Northwind customer portal: fictional account data shared with the PAP APIs. */
import type { Context, Hono } from "hono";
import { randomId, tokenHash } from "@poppy-lab/pap-client/core";
import {
  feedbackSection,
  type FeedbackReport,
  type GrantAccess,
  type OperationRecord,
} from "@poppy-lab/pap-company";
import { customers, FICTION_NOTICE, northwindPersona } from "./data.ts";
import type { Booking, FlightInventory } from "./northwind.ts";
import { escape, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type WebSession = { expires: number; account: string };
type Ctx = {
  state: Record<string, unknown>;
  grants: GrantAccess;
  origin: string;
  operations: () => Readonly<Record<string, OperationRecord>>;
  feedback: () => readonly FeedbackReport[];
};
type Deps = {
  bookingsFor: (account: string) => Booking[];
  inventory: Record<string, FlightInventory>;
  bookingView: (
    booking: Booking,
    inventory: Record<string, FlightInventory>,
  ) => Record<string, unknown>;
};
const cookie = (c: Context, name: string) =>
  (c.req.header("cookie") ?? "")
    .split(/;\s*/)
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";

export function mountPortal(app: Hono, ctx: Ctx, deps: Deps) {
  const secure = ctx.origin.startsWith("https:");
  const sessions = (ctx.state.webSessions ??= {}) as Record<string, WebSession>;
  const pending = (ctx.state.webLogins ??= {}) as Record<string, number>;
  const setCookie = (name: string, value: string, maxAge: number) =>
    `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const headers = {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Referrer-Policy": "same-origin",
  };
  const current = (c: Context) => {
    const record = sessions[tokenHash(cookie(c, "northwind_web"))];
    return record && record.expires > Date.now() ? record : undefined;
  };
  const active = (c: Context) => {
    const record = current(c);
    return (
      !!record &&
      (c.req.method !== "POST" ||
        c.req.header("x-northwind-account") === record.account)
    );
  };
  const sameOrigin = (c: Context) => c.req.header("origin") === ctx.origin;

  app.get("/site/login", (c) => {
    for (const [id, expires] of Object.entries(pending))
      if (expires < Date.now()) delete pending[id];
    if (Object.keys(pending).length >= 500)
      return c.text("Too many attempts. Try again shortly.", 429);
    const nonce = randomId();
    pending[tokenHash(nonce)] = Date.now() + 300000;
    const body = `<main class="wrap account-shell"><section class="account-head"><div><h1>Log in to My Northwind.</h1><p>Choose a test passenger to see their trip, loyalty points and preferences. There is no password: this is a demo, and nobody's identity is checked. A connected agent sees the same account.</p></div></section><form class="search-panel" method="post" action="/site/login"><label for="account">Test passenger</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)} · ${customer.booking.reference}</option>`).join("")}</select><button type="submit">Log in</button><p class="notice">Never enter a real booking reference, passport or payment card.</p><p class="notice">${escape(FICTION_NOTICE)}</p></form></main>`;
    return c.html(
      shell("Sign in · Northwind Air", body, "/account", ctx.origin),
      200,
      {
        ...headers,
        "Set-Cookie": setCookie("northwind_login", nonce, 300),
      },
    );
  });
  app.post("/site/login", async (c) => {
    const loginKey = tokenHash(cookie(c, "northwind_login"));
    if (!sameOrigin(c) || !pending[loginKey] || pending[loginKey] < Date.now())
      return c.text(
        "This sign-in expired. Open /site/login and try again.",
        403,
      );
    const form = (await c.req.parseBody()) as Record<string, string>;
    const selected = northwindPersona(form.account);
    if (!selected) return c.json({ error: "invalid_account" }, 400);
    delete pending[loginKey];
    delete sessions[tokenHash(cookie(c, "northwind_web"))];
    for (const [id, session] of Object.entries(sessions))
      if (session.expires < Date.now()) delete sessions[id];
    if (Object.keys(sessions).length >= 1000)
      return c.text("Too many sessions.", 429);
    const token = randomId();
    sessions[tokenHash(token)] = {
      expires: Date.now() + 1800000,
      account: selected.id,
    };
    c.header("Set-Cookie", setCookie("northwind_web", token, 1800), {
      append: true,
    });
    c.header("Set-Cookie", setCookie("northwind_login", "", 0), {
      append: true,
    });
    return c.redirect("/account", 302);
  });
  app.post("/site/logout", (c) => {
    if (!sameOrigin(c)) return c.json({ error: "same_origin_required" }, 403);
    delete sessions[tokenHash(cookie(c, "northwind_web"))];
    return c.json({ ok: true }, 200, {
      "Set-Cookie": setCookie("northwind_web", "", 0),
      "Cache-Control": "no-store",
    });
  });

  const stateFor = (account: string) => {
    const customer = northwindPersona(account)!;
    const activity = Object.entries(ctx.operations())
      .filter(([, record]) => record.account === account)
      .slice(-12)
      .reverse()
      .map(([id, record]) => {
        const latest = record.revisions.at(-1);
        const expired =
          !record.performed &&
          (!latest || Date.parse(latest.expires_at) < Date.now());
        return {
          id,
          state: record.performed
            ? "succeeded"
            : expired
              ? "expired"
              : "proposed",
          summary:
            record.revisions.find(
              (revision) => revision.revision === record.performed?.revision,
            )?.summary ??
            latest?.summary ??
            "",
          result: record.performed?.body.summary ?? null,
        };
      });
    return {
      account_id: account,
      customer: customer.name,
      loyalty: customer.loyalty,
      bookings: deps
        .bookingsFor(account)
        .map((booking) => deps.bookingView(booking, deps.inventory)),
      activity,
      notice: FICTION_NOTICE,
    };
  };
  app.get("/site/state", (c) => {
    const record = current(c);
    return record
      ? c.json(stateFor(record.account), 200, { "Cache-Control": "no-store" })
      : c.json({ error: "sign_in_required" }, 401, {
          "Cache-Control": "no-store",
        });
  });
  app.get("/site/access", (c) => {
    const record = current(c);
    return record
      ? c.json({ grants: ctx.grants.list(record.account) }, 200, {
          "Cache-Control": "no-store",
        })
      : c.json({ error: "sign_in_required" }, 401);
  });
  app.post("/site/access/:id/revoke", (c) => {
    const record = current(c);
    if (!record || !active(c) || !sameOrigin(c))
      return c.json({ error: "customer_session_and_origin_required" }, 403);
    return ctx.grants.revoke(record.account, c.req.param("id"))
      ? c.json({ revoked: true }, 200, { "Cache-Control": "no-store" })
      : c.json({ error: "grant_not_found" }, 404);
  });

  app.get("/account", (c) => {
    const record = current(c);
    if (!record) return c.redirect("/site/login", 302);
    const body = `<main class="wrap account-shell account" data-account="${escape(record.account)}"><section class="account-head"><div><h1>My Northwind.</h1><p id="current-account"></p><p>A proposal from your agent changes nothing here until you approve it in your agent. <a href="/site/login">Switch test passenger</a>.</p></div><div class="live-row"><p id="status" role="status">Loading the account…</p><button id="refresh" class="secondary" type="button">Refresh</button><button id="logout" class="secondary" type="button">Log out</button></div></section><div class="account-grid" id="content" aria-busy="true"><div><section><h2>Upcoming trips</h2><div id="trip-list"></div></section><section><h2>Agent activity</h2><p class="notice">A waiting proposal has changed nothing yet. Approve or decline it in your agent.</p><div id="activity-list"></div></section></div><aside><section><h2>Gale loyalty</h2><div id="loyalty"></div></section><section><h2>Passenger preferences</h2><div id="preferences"></div></section>${feedbackSection(ctx.feedback(), { notice: "notice" })}<section><h2>Connected agents</h2><p class="notice">Disconnecting an agent ends its access. Logging out of this website does not.</p><button id="load-access" class="secondary" type="button">Show connected agents</button><div id="access-list"></div><p id="access-status" role="status"></p></section></aside></div></main><script defer src="/site/app.js"></script>`;
    return c.html(
      shell("My Northwind · Northwind Air", body, "/account", ctx.origin),
      200,
      headers,
    );
  });
  app.get("/site/app.js", (c) =>
    c.text(`"use strict";\n${siteScript}`, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  );
}

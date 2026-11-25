/** Harborline's fictional customer portal backed by the same tenant state as PAP. */
import type { Context, Hono } from "hono";
import { randomId, tokenHash } from "@poppy-lab/pap-client/core";
import {
  feedbackSection,
  type FeedbackReport,
  type GrantAccess,
  type OperationRecord,
} from "@poppy-lab/pap-company";
import { customers, FICTION_NOTICE } from "./data.ts";
import type { CustomerState } from "./harborline.ts";
import { escape, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type WebSession = { expires: number; account: string };
type PortalContext = {
  state: Record<string, unknown>;
  grants: GrantAccess;
  origin: string;
  operations: () => Readonly<Record<string, OperationRecord>>;
  feedback: () => readonly FeedbackReport[];
};
type Deps = { customerFor: (account: string) => CustomerState };
const cookie = (c: Context, name: string) =>
  (c.req.header("cookie") ?? "")
    .split(/;\s*/)
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";

export function mountPortal(app: Hono, ctx: PortalContext, deps: Deps) {
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
    const record = sessions[tokenHash(cookie(c, "harborline_web"))];
    return record && record.expires > Date.now() ? record : undefined;
  };
  const active = (c: Context) => {
    const record = current(c);
    return (
      !!record &&
      (c.req.method !== "POST" ||
        c.req.header("x-harborline-account") === record.account)
    );
  };
  const sameOrigin = (c: Context) => c.req.header("origin") === ctx.origin;

  app.get("/site/login", (c) => {
    for (const [id, expires] of Object.entries(pending))
      if (expires < Date.now()) delete pending[id];
    if (Object.keys(pending).length >= 500)
      return c.text("Too many attempts. Try again in a few minutes.", 429);
    const nonce = randomId();
    pending[tokenHash(nonce)] = Date.now() + 300000;
    return c.html(
      shell(
        "Sign in · Harborline Bank",
        `<main class="wrap"><section class="account-head"><h1>Log in to Harborline.</h1><p>Choose a test customer to open their accounts. There is no password: this is a demo, and nobody's identity is checked. A connected agent sees the same accounts.</p></section><section class="section"><form class="form-card" method="post" action="/site/login"><label for="account">Test customer</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)}</option>`).join("")}</select><button type="submit">Log in</button><p class="fine">Never enter a real bank password, account number, card number or any real financial data.</p></form></section></main>`,
        "/account",
        ctx.origin,
      ),
      200,
      { ...headers, "Set-Cookie": setCookie("harborline_login", nonce, 300) },
    );
  });
  app.post("/site/login", async (c) => {
    const key = tokenHash(cookie(c, "harborline_login"));
    const expires = pending[key];
    if (!sameOrigin(c) || !expires || expires < Date.now())
      return c.text(
        "This fictional sign-in expired. Open /site/login and try again.",
        403,
      );
    const body = (await c.req.parseBody()) as Record<string, string>;
    const selected = customers.find((customer) => customer.id === body.account);
    if (!selected) return c.json({ error: "invalid_account" }, 400);
    delete pending[key];
    delete sessions[tokenHash(cookie(c, "harborline_web"))];
    for (const [id, session] of Object.entries(sessions))
      if (session.expires < Date.now()) delete sessions[id];
    if (Object.keys(sessions).length >= 1000)
      return c.text("Too many fictional portal sessions.", 429);
    const token = randomId();
    sessions[tokenHash(token)] = {
      expires: Date.now() + 1800000,
      account: selected.id,
    };
    c.header("Set-Cookie", setCookie("harborline_web", token, 1800));
    c.header("Cache-Control", "no-store");
    return c.redirect("/account", 302);
  });
  app.post("/site/logout", (c) => {
    if (!sameOrigin(c)) return c.json({ error: "same_origin_required" }, 403);
    delete sessions[tokenHash(cookie(c, "harborline_web"))];
    return c.json({ ok: true }, 200, {
      "Set-Cookie": setCookie("harborline_web", "", 0),
      "Cache-Control": "no-store",
    });
  });

  const portalState = (account: string) => {
    const customer = deps.customerFor(account);
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
          result: record.performed
            ? record.performed.body.summary
            : expired
              ? "The proposal expired. No fictional state changed."
              : null,
        };
      });
    return {
      account_id: customer.id,
      customer: { name: customer.name, email: customer.email },
      accounts: customer.accounts,
      transactions: customer.transactions,
      cards: customer.cards,
      recipients: customer.recipients,
      budgets: customer.budgets,
      payments: customer.payments,
      transfers: customer.transfers,
      activity,
      note: FICTION_NOTICE,
    };
  };
  app.get("/site/state", (c) => {
    const record = current(c);
    if (!record)
      return c.json({ error: "sign_in_required" }, 401, {
        "Cache-Control": "no-store",
      });
    return c.json(portalState(record.account), 200, {
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
    const body = `<main class="wrap account" data-account="${escape(record.account)}"><section class="account-head"><h1>Your accounts.</h1><p id="current-account"></p><p>A proposal from your agent changes nothing here until you approve it in your agent. <a href="/site/login">Switch test customer</a>.</p><div class="live-row"><p id="status" class="live" role="status">Loading your accounts…</p><div><button id="refresh" class="secondary" type="button">Refresh now</button> <button id="logout" class="secondary" type="button">Log out</button></div></div></section><div id="content" aria-busy="true"><div class="account-grid"><div><section class="section"><h2>Accounts and balances</h2><div id="accounts" class="data-list"></div></section><section class="section"><h2>Recent transactions</h2><div id="transactions" class="data-list"></div></section><section class="section"><h2>Budgets</h2><div id="budgets" class="data-list"></div></section></div><div><section class="section"><h2>Cards</h2><div id="cards" class="data-list"></div></section><section class="section"><h2>Recipients</h2><div id="recipients" class="data-list"></div></section><section class="section"><h2>Agent activity</h2><p class="fine">Proposed means nothing has changed yet. Approve or decline it in your agent.</p><div id="activity"></div></section>${feedbackSection(ctx.feedback(), { section: "section", notice: "fine", example: "ordering a checkbook" })}<section class="section"><h2>Connected agents</h2><p class="fine">Disconnecting an agent ends its access. Logging out of the portal does not.</p><button id="load-access" class="secondary" type="button">Show connected agents</button><div id="access"></div><p id="access-status" role="status"></p></section></div></div></div></main><script defer src="/site/app.js"></script>`;
    return c.html(
      shell("Customer portal · Harborline Bank", body, "/account", ctx.origin),
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

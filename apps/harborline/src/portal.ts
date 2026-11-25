/** Harborline's fictional customer portal backed by the same tenant state as PAP. */
import type { Context, Hono } from "hono";
import { randomId, tokenHash } from "@poppy-lab/pap-client/core";
import {
  feedbackSection,
  LOGIN_FORM_MS,
  loginFormToken,
  loginFormValid,
  type ActivityItem,
  type FeedbackReport,
  type GrantAccess,
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
  activity: (account: string) => ActivityItem[];
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
  // The login form carries its own token now; the nonces kept here went.
  delete ctx.state.webLogins;
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
    // In a cookie and in the form: the two must arrive equal (site-login.ts).
    const token = loginFormToken();
    return c.html(
      shell(
        "Sign in · Harborline Bank",
        `<main class="wrap"><section class="account-head"><h1>Log in to Harborline.</h1><p>Choose a test customer to open their accounts. There is no password: this is a demo, and nobody's identity is checked. A connected agent sees the same accounts.</p></section><section class="section"><form class="form-card" method="post" action="/site/login"><input type="hidden" name="login_token" value="${token}"><label for="account">Test customer</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)}</option>`).join("")}</select><button type="submit">Log in</button><p class="fine">Never enter a real bank password, account number, card number or any real financial data.</p></form></section></main>`,
        "/account",
        ctx.origin,
      ),
      200,
      {
        ...headers,
        "Set-Cookie": setCookie(
          "harborline_login",
          token,
          LOGIN_FORM_MS / 1000,
        ),
      },
    );
  });
  app.post("/site/login", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    if (
      !sameOrigin(c) ||
      !loginFormValid(cookie(c, "harborline_login"), body.login_token)
    )
      return c.html(
        shell(
          "Log in again · Harborline Bank",
          `<main class="wrap"><section class="account-head"><h1>This login page has expired.</h1><p>A login page works for five minutes after it opens, and this one is older. You are not logged in, and nothing has changed.</p><p><a href="/site/login">Open the login page again</a></p></section></main>`,
          "/account",
          ctx.origin,
        ),
        403,
        headers,
      );
    const selected = customers.find((customer) => customer.id === body.account);
    if (!selected) return c.json({ error: "invalid_account" }, 400);
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
    // The form is used up, and the login gets its own cookie.
    c.header("Set-Cookie", setCookie("harborline_login", "", 0), {
      append: true,
    });
    c.header("Set-Cookie", setCookie("harborline_web", token, 1800), {
      append: true,
    });
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
    // A proposal that waits. Declining one is between the customer and their
    // agent: the protocol has the agent send an approval or nothing
    // (Operations §5), so until the proposal ends we can't tell the two apart.
    const waiting = (until: string) =>
      `It waits for your approval in your agent until ${until}. If you decline it there or let it run out, no fictional state changes. Your agent does not tell us when you decline, so it shows as awaiting until then.`;
    // What a request that changed nothing says, when the gate gave no reason.
    const unchanged: Record<string, string> = {
      expired: "The proposal expired. No fictional state changed.",
      declined:
        "Harborline declined this approval. No fictional state changed.",
      refused:
        "Your accounts had changed when this was approved. No fictional state changed.",
    };
    const activity = ctx.activity(account).map((item) => ({
      ...item,
      result:
        item.result ??
        (item.state === "proposed"
          ? waiting(item.when)
          : unchanged[item.state]) ??
        null,
    }));
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
    const body = `<main class="wrap account" data-account="${escape(record.account)}"><section class="account-head"><h1>Your accounts.</h1><p id="current-account"></p><p>A proposal from your agent changes nothing here until you approve it in your agent. <a href="/site/login">Switch test customer</a>.</p><div class="live-row"><p id="status" class="live" role="status">Loading your accounts…</p><div><button id="refresh" class="secondary" type="button">Refresh now</button> <button id="logout" class="secondary" type="button">Log out</button></div></div></section><div id="content" aria-busy="true"><div class="account-grid"><div><section class="section"><h2>Accounts and balances</h2><div id="accounts" class="data-list"></div></section><section class="section"><h2>Recent transactions</h2><div id="transactions" class="data-list"></div></section><section class="section"><h2>Budgets</h2><div id="budgets" class="data-list"></div></section></div><div><section class="section"><h2>Cards</h2><div id="cards" class="data-list"></div></section><section class="section"><h2>Recipients</h2><div id="recipients" class="data-list"></div></section><section class="section"><h2>Agent activity</h2><p class="fine">Awaiting approval means nothing has changed yet. Approve or decline it in your agent.</p><div id="activity"></div></section>${feedbackSection(ctx.feedback(), { section: "section", notice: "fine", example: "ordering a checkbook" })}<section class="section"><h2>Connected agents</h2><p class="fine">Disconnecting an agent ends its access. Logging out of the portal does not.</p><button id="load-access" class="secondary" type="button">Show connected agents</button><div id="access"></div><p id="access-status" role="status"></p></section></div></div></div></main><script defer src="/site/app.js"></script>`;
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

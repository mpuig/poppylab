/** Fernwick's fictional customer portal, backed by the same tenant state as the APIs. */
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
import { addressLine, customers, FICTION_NOTICE } from "./data.ts";
import { billsFor, monthToDate, readings } from "./billing.ts";
import { DAY, dayStart, isoDay, nowSeconds } from "./time.ts";
import type { Customer } from "./state.ts";
import { consentWords } from "@poppy-lab/pap-core";
import { escape, permissions, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type WebSession = { expires: number; account: string };
type PortalContext = {
  state: Record<string, unknown>;
  grants: GrantAccess;
  origin: string;
  activity: (account: string) => ActivityItem[];
  feedback: () => readonly FeedbackReport[];
};
type Deps = { customerFor: (account: string) => Customer };
const cookie = (c: Context, name: string) =>
  (c.req.header("cookie") ?? "")
    .split(/;\s*/)
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";
const cents = (amount: number) => Math.round(amount / 1000);

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
    const record = sessions[tokenHash(cookie(c, "fernwick_web"))];
    return record && record.expires > Date.now() ? record : undefined;
  };
  const active = (c: Context) => {
    const record = current(c);
    return (
      !!record &&
      (c.req.method !== "POST" ||
        c.req.header("x-fernwick-account") === record.account)
    );
  };
  const sameOrigin = (c: Context) => c.req.header("origin") === ctx.origin;

  app.get("/site/login", (c) => {
    // In a cookie and in the form: the two must arrive equal (site-login.ts).
    const token = loginFormToken();
    return c.html(
      shell(
        "Sign in · Fernwick Power & Light",
        `<main class="wrap"><section class="account-head"><h1>Sign in to Fernwick.</h1><p>Choose a test customer to open their account. There is no password: this is a demo, and nobody's identity is checked. A connected agent sees the same meters.</p></section><section class="section"><form class="form-card" method="post" action="/site/login"><input type="hidden" name="login_token" value="${token}"><label for="account">Test customer</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)}</option>`).join("")}</select><button type="submit">Sign in</button><p class="fine">Never enter a real utility account number, password, address or bill.</p></form></section></main>`,
        "/account",
        ctx.origin,
      ),
      200,
      {
        ...headers,
        "Set-Cookie": setCookie("fernwick_login", token, LOGIN_FORM_MS / 1000),
      },
    );
  });
  app.post("/site/login", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    if (
      !sameOrigin(c) ||
      !loginFormValid(cookie(c, "fernwick_login"), body.login_token)
    )
      return c.html(
        shell(
          "Sign in again · Fernwick Power & Light",
          `<main class="wrap"><section class="account-head"><h1>This sign-in page has expired.</h1><p>A sign-in page works for five minutes after it opens, and this one is older. You are not signed in, and nothing has changed.</p><p><a href="/site/login">Open the sign-in page again</a></p></section></main>`,
          "/account",
          ctx.origin,
        ),
        403,
        headers,
      );
    const selected = customers.find((customer) => customer.id === body.account);
    if (!selected) return c.json({ error: "invalid_account" }, 400);
    delete sessions[tokenHash(cookie(c, "fernwick_web"))];
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
    c.header("Set-Cookie", setCookie("fernwick_login", "", 0), {
      append: true,
    });
    c.header("Set-Cookie", setCookie("fernwick_web", token, 1800), {
      append: true,
    });
    c.header("Cache-Control", "no-store");
    return c.redirect("/account", 302);
  });
  app.post("/site/logout", (c) => {
    if (!sameOrigin(c)) return c.json({ error: "same_origin_required" }, 403);
    delete sessions[tokenHash(cookie(c, "fernwick_web"))];
    return c.json({ ok: true }, 200, {
      "Set-Cookie": setCookie("fernwick_web", "", 0),
      "Cache-Control": "no-store",
    });
  });

  /** Everything the portal shows: the whole account, never a grant's view. */
  const portalState = (account: string) => {
    const customer = deps.customerFor(account);
    const now = nowSeconds();
    const today = dayStart(now);
    const meters = customer.meters.map((meter) => {
      const month = monthToDate(meter.seed, meter.history, now);
      const scheduled = meter.history.find((entry) => entry.from > now);
      return {
        id: meter.seed.id,
        label: meter.seed.label,
        plan: [...meter.history].reverse().find((entry) => entry.from <= now)!
          .plan,
        ...(scheduled
          ? {
              scheduled: {
                plan: scheduled.plan,
                effective_date: isoDay(scheduled.from),
              },
            }
          : {}),
        month_kwh: (month.deliveredWh / 1000).toFixed(1),
        ...(month.receivedWh
          ? { month_sent_kwh: (month.receivedWh / 1000).toFixed(1) }
          : {}),
        month_energy_cents: cents(month.energyCost),
        // The last seven whole UTC days.
        days: Array.from({ length: 7 }, (_, i) => {
          const start = today - (7 - i) * DAY;
          return {
            day: isoDay(start),
            kwh: (
              readings(meter.seed, 1, meter.history, start, start + DAY).reduce(
                (sum, r) => sum + r.value,
                0,
              ) / 1000
            ).toFixed(1),
          };
        }),
        bills: billsFor(meter.seed, meter.history, now)
          .reverse()
          .map((bill) => ({
            month: bill.id,
            plan: bill.plan,
            kwh: (bill.deliveredWh / 1000).toFixed(1),
            total_cents: cents(bill.total),
          })),
      };
    });
    // A proposal that waits. Declining one is between the customer and their
    // agent: the protocol has the agent send an approval or nothing
    // (Operations §5), so until the proposal ends we can't tell the two apart.
    const waiting = (until: string) =>
      `It waits for your approval in your agent until ${until}. If you decline it there or let it run out, nothing changes. Your agent does not tell us when you decline, so it shows as awaiting until then.`;
    // What a request that changed nothing says, when the gate gave no reason.
    const unchanged: Record<string, string> = {
      expired: "The proposal expired. Nothing changed.",
      declined: "Fernwick declined this approval. Nothing changed.",
      refused:
        "Your account had changed when this was approved. Nothing changed.",
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
      account_id: customer.seed.id,
      customer: {
        name: customer.seed.name,
        email: customer.seed.email,
        account_number: customer.seed.accountNumber,
        address: addressLine(customer.seed.address),
      },
      meters,
      activity,
      // With the account, so the portal's own two-second read keeps the
      // list of connected agents current, in the consent page's words.
      agents: ctx.grants.list(account).map((grant) => ({
        ...grant,
        permissions: consentWords(permissions(grant.scopes)),
      })),
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
    const body = `<main class="wrap account" data-account="${escape(record.account)}"><section class="account-head"><h1>Your account.</h1><p id="current-account"></p><p>A proposal from your agent changes nothing here until you approve it in your agent. <a href="/site/login">Switch test customer</a>.</p><div class="live-row"><p id="status" class="live" role="status">Loading your account…</p><div><button id="refresh" class="secondary" type="button">Refresh now</button> <button id="logout" class="secondary" type="button">Log out</button></div></div></section><div id="content" aria-busy="true"><div class="account-grid"><div><section class="section"><h2>Meters and this month</h2><div id="meters" class="data-list"></div></section><section class="section"><h2>Last seven days</h2><div id="days" class="data-list"></div></section></div><div><section class="section"><h2>Bills</h2><div id="bills" class="data-list"></div></section><section class="section"><h2>Agent activity</h2><p class="fine">Awaiting approval means nothing has changed yet. Approve or decline it in your agent.</p><div id="activity"></div></section>${feedbackSection(ctx.feedback(), { section: "section", notice: "fine", example: "reporting an outage" })}<section class="section"><h2>Connected agents</h2><p class="fine">Disconnecting an agent ends its access, through every API. Logging out of the portal does not.</p><div id="access"></div><p id="access-status" role="status"></p></section></div></div></div></main><script defer src="/site/app.js"></script>`;
    return c.html(
      shell(
        "Your account · Fernwick Power & Light",
        body,
        "/account",
        ctx.origin,
      ),
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

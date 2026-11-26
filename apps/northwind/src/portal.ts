/**
 * Northwind customer portal: fictional account data shared with the PAP
 * APIs.
 *
 * An agent's own browser, joined to its Session (§6), is served here too
 * (`siteViewer`). Signed in through the join it sees the trips with
 * `bookings:read`, and the loyalty account and the preferences with
 * `profile:read`, as the API shows them, and never the connected agents,
 * their activity or their reports. It is offered no control, and the
 * gateway refuses every change it sends.
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
import { customers, FICTION_NOTICE, northwindPersona } from "./data.ts";
import type { Booking, FlightInventory } from "./northwind.ts";
import { consentWords } from "@poppy-lab/pap-core";
import { escape, permissions, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type WebSession = { expires: number; account: string };
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
  { name: "Upcoming trips", scope: "bookings:read" },
  { name: "Gale loyalty and passenger preferences", scope: "profile:read" },
];
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
  /** Who a read is for: a join's account first, then the browser's login. */
  const viewer = (c: Context) => siteViewer(ctx.browser(c), current(c));

  app.get("/site/login", (c) => {
    // An agent's browser gets no login form: its sign-in is the agent's.
    const join = ctx.browser(c);
    if (join?.account) return c.redirect("/account", 302);
    if (join)
      return c.html(
        shell(
          "Not signed in · Northwind Air",
          `<main class="wrap account-shell"><section class="account-head"><div><h1>This browser isn&#39;t signed in.</h1><p>${escape(AGENT_BROWSER_LOGIN)}</p></div></section></main>`,
          "/account",
          ctx.origin,
        ),
        200,
        headers,
      );
    // In a cookie and in the form: the two must arrive equal (site-login.ts).
    const token = loginFormToken();
    const body = `<main class="wrap account-shell"><section class="account-head"><div><h1>Log in to My Northwind.</h1><p>Choose a test passenger to see their trip, loyalty points and preferences. There is no password: this is a demo, and nobody's identity is checked. A connected agent sees the same account.</p></div></section><form class="search-panel" method="post" action="/site/login"><input type="hidden" name="login_token" value="${token}"><label for="account">Test passenger</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)} · ${customer.booking.reference}</option>`).join("")}</select><button type="submit">Log in</button><p class="notice">Never enter a real booking reference, passport or payment card.</p><p class="notice">${escape(FICTION_NOTICE)}</p></form></main>`;
    return c.html(
      shell("Sign in · Northwind Air", body, "/account", ctx.origin),
      200,
      {
        ...headers,
        "Set-Cookie": setCookie("northwind_login", token, LOGIN_FORM_MS / 1000),
      },
    );
  });
  app.post("/site/login", async (c) => {
    const form = (await c.req.parseBody()) as Record<string, string>;
    if (
      !sameOrigin(c) ||
      !loginFormValid(cookie(c, "northwind_login"), form.login_token)
    )
      return c.html(
        shell(
          "Log in again · Northwind Air",
          `<main class="wrap account-shell"><section class="account-head"><div><h1>This login page has expired.</h1><p>A login page works for five minutes after it opens, and this one is older. You are not logged in, and nothing has changed.</p><p><a href="/site/login">Open the login page again</a></p></div></section></main>`,
          "/account",
          ctx.origin,
        ),
        403,
        headers,
      );
    const selected = northwindPersona(form.account);
    if (!selected) return c.json({ error: "invalid_account" }, 400);
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

  const stateFor = (viewer: SiteViewer) => {
    const { account } = viewer;
    const customer = northwindPersona(account)!;
    const trips = viewerSees(viewer, "bookings:read");
    const profile = viewerSees(viewer, "profile:read");
    const bookings = deps
      .bookingsFor(account)
      .map((booking) => deps.bookingView(booking, deps.inventory));
    // A proposal that waits. Declining one is between the customer and their
    // agent: the protocol has the agent send an approval or nothing
    // (Operations §5), so until the proposal ends we can't tell the two apart.
    const waiting = (until: string) =>
      `It waits for your approval in your agent until ${until}. If you decline it there or let it run out, nothing changes. Your agent does not tell us when you decline, so it shows as awaiting until then.`;
    // What a request that changed nothing says, when the gate gave no reason.
    const unchanged: Record<string, string> = {
      declined: "Northwind declined this approval. Nothing changed.",
      refused:
        "Your booking had changed when this was approved. Nothing changed.",
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
      loyalty: profile ? customer.loyalty : null,
      bookings: trips ? bookings : [],
      // The saved preferences: of the first trip, as the API reads them.
      preference: profile ? (bookings[0]?.preference ?? null) : null,
      activity,
      // With the account, so the page's own two-second read keeps the list
      // of connected agents current, in the consent page's words.
      agents: viewer.agent
        ? []
        : ctx.grants.list(account).map((grant) => ({
            ...grant,
            permissions: consentWords(permissions(grant.scopes)),
          })),
      notice: FICTION_NOTICE,
      ...agentBrowserState(viewer, PARTS),
    };
  };
  app.get("/site/state", (c) => {
    const record = viewer(c);
    return record
      ? c.json(stateFor(record), 200, { "Cache-Control": "no-store" })
      : c.json({ error: "sign_in_required" }, 401, {
          "Cache-Control": "no-store",
        });
  });
  app.get("/site/access", (c) => {
    const record = viewer(c);
    // The connected agents are the customer's own to see.
    if (record?.agent)
      return c.json({ error: "customers_own_browser_only" }, 403);
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
    const record = viewer(c);
    if (!record) return c.redirect("/site/login", 302);
    // An agent's browser is told whose it is, and gets no control: no
    // switch of passenger, no log out, and only the parts its scopes cover.
    const about = record.readOnly
      ? agentBrowserNotice(record, PARTS)
          .map((text) => `<p class="notice">${escape(text)}</p>`)
          .join("")
      : `<p>A proposal from your agent changes nothing here until you approve it in your agent. <a href="/site/login">Switch test passenger</a>.</p>`;
    const trips = viewerSees(record, "bookings:read")
      ? `<section><h2>Upcoming trips</h2><div id="trip-list"></div></section>`
      : "";
    const profile = viewerSees(record, "profile:read")
      ? `<section><h2>Gale loyalty</h2><div id="loyalty"></div></section><section><h2>Passenger preferences</h2><div id="preferences"></div></section>`
      : "";
    const activity = record.agent
      ? ""
      : `<section><h2>Agent activity</h2><p class="notice">A waiting proposal has changed nothing yet. Approve or decline it in your agent.</p><div id="activity-list"></div></section>`;
    const agents = record.agent
      ? ""
      : `${feedbackSection(ctx.feedback(), { notice: "notice", example: "bringing a pet in the cabin" })}<section><h2>Connected agents</h2><p class="notice">Disconnecting an agent ends its access. Logging out of this website does not.</p><div id="access-list"></div><p id="access-status" role="status"></p></section>`;
    const body = `<main class="wrap account-shell account" data-account="${escape(record.account)}"><section class="account-head"><div><h1>My Northwind.</h1><p id="current-account"></p>${about}</div><div class="live-row"><p id="status" role="status">Loading the account…</p><button id="refresh" class="secondary" type="button">Refresh</button>${record.readOnly ? "" : '<button id="logout" class="secondary" type="button">Log out</button>'}</div></section><div class="account-grid" id="content" aria-busy="true"><div>${trips}${activity}</div><aside>${profile}${agents}</aside></div></main><script defer src="/site/app.js"></script>`;
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

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
import { customers, FICTION_NOTICE, northwindPersona } from "./data.ts";
import type { Booking, FlightInventory } from "./northwind.ts";
import { consentWords } from "@poppy-lab/pap-core";
import { escape, permissions, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type Ctx = CustomerPortalContext & {
  feedback: () => readonly FeedbackReport[];
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

export function mountPortal(app: Hono, ctx: Ctx, deps: Deps) {
  const portal = mountCustomerPortal(app, ctx, {
    name: "northwind",
    isCustomer: (account) => !!northwindPersona(account),
    pages: {
      joined: () =>
        shell(
          "Not signed in · Northwind Air",
          `<main class="wrap account-shell"><section class="account-head"><div><h1>This browser isn&#39;t signed in.</h1><p>${escape(AGENT_BROWSER_LOGIN)}</p></div></section></main>`,
          "/account",
          ctx.origin,
        ),
      form: (token) => {
        const body = `<main class="wrap account-shell"><section class="account-head"><div><h1>Log in to My Northwind.</h1><p>Choose a test passenger to see their trip, loyalty points and preferences. There is no password: this is a demo, and nobody's identity is checked. A connected agent sees the same account.</p></div></section><form class="search-panel" method="post" action="/site/login"><input type="hidden" name="login_token" value="${token}"><label for="account">Test passenger</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)} · ${customer.booking.reference}</option>`).join("")}</select><button type="submit">Log in</button><p class="notice">Never enter a real booking reference, passport or payment card.</p><p class="notice">${escape(FICTION_NOTICE)}</p></form></main>`;
        return shell("Sign in · Northwind Air", body, "/account", ctx.origin);
      },
      expired: () =>
        shell(
          "Log in again · Northwind Air",
          `<main class="wrap account-shell"><section class="account-head"><div><h1>This login page has expired.</h1><p>A login page works for five minutes after it opens, and this one is older. You are not logged in, and nothing has changed.</p><p><a href="/site/login">Open the login page again</a></p></div></section></main>`,
          "/account",
          ctx.origin,
        ),
    },
    tooMany: "Too many sessions.",
    results: {
      waiting: (until) =>
        `It waits for your approval in your agent until ${until}. If you decline it there or let it run out, nothing changes. Your agent does not tell us when you decline, so it shows as awaiting until then.`,
      unchanged: {
        expired: "The proposal expired. Nothing changed.",
        declined: "Northwind declined this approval. Nothing changed.",
        refused:
          "Your booking had changed when this was approved. Nothing changed.",
      },
    },
    permissions: (scopes) => consentWords(permissions(scopes)),
    view: (viewer, { activity, agents }) => {
      const { account } = viewer;
      const customer = northwindPersona(account)!;
      const trips = viewerSees(viewer, "bookings:read");
      const profile = viewerSees(viewer, "profile:read");
      const bookings = deps
        .bookingsFor(account)
        .map((booking) => deps.bookingView(booking, deps.inventory));
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
        agents,
        notice: FICTION_NOTICE,
        ...agentBrowserState(viewer, PARTS),
      };
    },
    script: siteScript,
  });

  app.get("/account", (c) => {
    const record = portal.viewer(c);
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
      portal.headers,
    );
  });
}

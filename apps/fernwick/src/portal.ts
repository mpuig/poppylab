/** Fernwick's fictional customer portal, backed by the same tenant state as the APIs. */
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
  type PortalLists,
  type SitePart,
  type SiteViewer,
} from "@poppy-lab/pap-company";
import { addressLine, customers, FICTION_NOTICE } from "./data.ts";
import { billsFor, monthToDate, readings } from "./billing.ts";
import { DAY, dayStart, isoDay, nowSeconds } from "./time.ts";
import { withinGrant, type Customer } from "./state.ts";
import { consentWords } from "@poppy-lab/pap-core";
import { escape, permissions, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type PortalContext = CustomerPortalContext & {
  feedback: () => readonly FeedbackReport[];
};
type Deps = { customerFor: (account: string) => Customer };
/**
 * What an agent's own browser, joined to its Session (§6), sees only with
 * the scope that reads it in an API: the plans and the bills in Fernwick's
 * own, the use of energy in the ESPI-shaped one. It sees the meters its
 * grant shares (`withinGrant`), and never the email, which no scope reads,
 * the connected agents, their activity or their reports. It is offered no
 * control, and the gateway refuses every change it sends.
 */
const PARTS: SitePart[] = [
  { name: "Rate plans and bills", scope: "account:read" },
  {
    name: "This month's use and the last seven days",
    scope: "espi:usage",
  },
];
const cents = (amount: number) => Math.round(amount / 1000);

export function mountPortal(app: Hono, ctx: PortalContext, deps: Deps) {
  /**
   * What the portal shows: the whole account to a customer's own browser,
   * and to an agent's what its scopes read of the meters its grant shares.
   */
  const portalState = (
    viewer: SiteViewer,
    { activity, agents }: PortalLists,
  ) => {
    const { account } = viewer;
    const customer = deps.customerFor(account);
    const now = nowSeconds();
    const today = dayStart(now);
    const sees = (scope: string) => viewerSees(viewer, scope);
    const plans = sees("account:read"),
      use = sees("espi:usage");
    const shared = viewer.agent
      ? withinGrant(customer, viewer.agent.resources)
      : customer.meters;
    const meters = (plans || use ? shared : []).map((meter) => {
      const month = monthToDate(meter.seed, meter.history, now);
      const scheduled = meter.history.find((entry) => entry.from > now);
      return {
        id: meter.seed.id,
        label: meter.seed.label,
        ...(plans
          ? {
              plan: [...meter.history]
                .reverse()
                .find((entry) => entry.from <= now)!.plan,
              ...(scheduled
                ? {
                    scheduled: {
                      plan: scheduled.plan,
                      effective_date: isoDay(scheduled.from),
                    },
                  }
                : {}),
              bills: billsFor(meter.seed, meter.history, now)
                .reverse()
                .map((bill) => ({
                  month: bill.id,
                  plan: bill.plan,
                  kwh: (bill.deliveredWh / 1000).toFixed(1),
                  total_cents: cents(bill.total),
                })),
            }
          : {}),
        ...(use
          ? {
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
                    readings(
                      meter.seed,
                      1,
                      meter.history,
                      start,
                      start + DAY,
                    ).reduce((sum, r) => sum + r.value, 0) / 1000
                  ).toFixed(1),
                };
              }),
            }
          : {}),
      };
    });
    return {
      account_id: customer.seed.id,
      customer: {
        name: customer.seed.name,
        // No scope reads the email. The address is in both APIs.
        email: viewer.agent ? "" : customer.seed.email,
        account_number: plans ? customer.seed.accountNumber : "",
        address:
          plans || sees("espi:customer")
            ? addressLine(customer.seed.address)
            : "",
      },
      meters,
      activity,
      // With the account, so the portal's own two-second read keeps the
      // list of connected agents current, in the consent page's words.
      agents,
      note: FICTION_NOTICE,
      ...agentBrowserState(viewer, PARTS),
    };
  };
  const portal = mountCustomerPortal(app, ctx, {
    name: "fernwick",
    isCustomer: (account) =>
      customers.some((customer) => customer.id === account),
    pages: {
      joined: () =>
        shell(
          "Not signed in · Fernwick Power & Light",
          `<main class="wrap"><section class="account-head"><h1>This browser isn&#39;t signed in.</h1><p>${escape(AGENT_BROWSER_LOGIN)}</p></section></main>`,
          "/account",
          ctx.origin,
        ),
      form: (token) =>
        shell(
          "Sign in · Fernwick Power & Light",
          `<main class="wrap"><section class="account-head"><h1>Sign in to Fernwick.</h1><p>Choose a test customer to open their account. There is no password: this is a demo, and nobody's identity is checked. A connected agent sees the same meters.</p></section><section class="section"><form class="form-card" method="post" action="/site/login"><input type="hidden" name="login_token" value="${token}"><label for="account">Test customer</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)}</option>`).join("")}</select><button type="submit">Sign in</button><p class="fine">Never enter a real utility account number, password, address or bill.</p></form></section></main>`,
          "/account",
          ctx.origin,
        ),
      expired: () =>
        shell(
          "Sign in again · Fernwick Power & Light",
          `<main class="wrap"><section class="account-head"><h1>This sign-in page has expired.</h1><p>A sign-in page works for five minutes after it opens, and this one is older. You are not signed in, and nothing has changed.</p><p><a href="/site/login">Open the sign-in page again</a></p></section></main>`,
          "/account",
          ctx.origin,
        ),
    },
    tooMany: "Too many fictional portal sessions.",
    results: {
      waiting: (until) =>
        `It waits for your approval in your agent until ${until}. If you decline it there or let it run out, nothing changes. Your agent does not tell us when you decline, so it shows as awaiting until then.`,
      unchanged: {
        expired: "The proposal expired. Nothing changed.",
        declined: "Fernwick declined this approval. Nothing changed.",
        refused:
          "Your account had changed when this was approved. Nothing changed.",
      },
    },
    permissions: (scopes) => consentWords(permissions(scopes)),
    view: portalState,
    script: siteScript,
  });

  app.get("/account", (c) => {
    const record = portal.viewer(c);
    if (!record) return c.redirect("/site/login", 302);
    // An agent's browser is told whose it is, and gets no control: no
    // switch of customer, no log out, and only the parts its scopes cover.
    const about = record.readOnly
      ? agentBrowserNotice(record, PARTS)
          .map((text) => `<p class="fine">${escape(text)}</p>`)
          .join("")
      : `<p>A proposal from your agent changes nothing here until you approve it in your agent. <a href="/site/login">Switch test customer</a>.</p>`;
    const plans = viewerSees(record, "account:read"),
      use = viewerSees(record, "espi:usage");
    const section = (shown: boolean, title: string, id: string) =>
      shown
        ? `<section class="section"><h2>${title}</h2><div id="${id}" class="data-list"></div></section>`
        : "";
    const own = record.agent
      ? ""
      : `<section class="section"><h2>Agent activity</h2><p class="fine">Awaiting approval means nothing has changed yet. Approve or decline it in your agent.</p><div id="activity"></div></section>${feedbackSection(ctx.feedback(), { section: "section", notice: "fine", example: "reporting an outage" })}<section class="section"><h2>Connected agents</h2><p class="fine">Disconnecting an agent ends its access, through every API. Logging out of the portal does not.</p><div id="access"></div><p id="access-status" role="status"></p></section>`;
    const body = `<main class="wrap account" data-account="${escape(record.account)}"><section class="account-head"><h1>Your account.</h1><p id="current-account"></p>${about}<div class="live-row"><p id="status" class="live" role="status">Loading your account…</p><div><button id="refresh" class="secondary" type="button">Refresh now</button>${record.readOnly ? "" : ' <button id="logout" class="secondary" type="button">Log out</button>'}</div></div></section><div id="content" aria-busy="true"><div class="account-grid"><div>${section(plans || use, use ? "Meters and this month" : "Meters", "meters")}${section(use, "Last seven days", "days")}</div><div>${section(plans, "Bills", "bills")}${own}</div></div></div></main><script defer src="/site/app.js"></script>`;
    return c.html(
      shell(
        "Your account · Fernwick Power & Light",
        body,
        "/account",
        ctx.origin,
      ),
      200,
      portal.headers,
    );
  });
}

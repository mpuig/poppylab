/**
 * Harborline's fictional customer portal backed by the same tenant state as
 * PAP.
 *
 * An agent's own browser, joined to its Session (§6), is served here too
 * (`siteViewer`). Signed in through the join it sees each part of the page
 * with the scope that reads it in Harborline's API, and only the accounts
 * the grant shares, with their transactions and cards (`withinGrant`). It
 * never sees payments and transfers made, which no scope reads, nor the
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
import { customers, FICTION_NOTICE, withinGrant } from "./data.ts";
import type { CustomerState } from "./harborline.ts";
import { consentWords } from "@poppy-lab/pap-core";
import { escape, permissions, shell } from "./site.ts";
import { siteScript } from "./site/app-script.ts";

type PortalContext = CustomerPortalContext & {
  feedback: () => readonly FeedbackReport[];
};
type Deps = { customerFor: (account: string) => CustomerState };
/** What an agent's browser sees only with the scope that reads it in the API. */
const PARTS: Array<SitePart & { id: string }> = [
  { name: "Accounts and balances", scope: "accounts:read", id: "accounts" },
  {
    name: "Recent transactions",
    scope: "transactions:read",
    id: "transactions",
  },
  { name: "Budgets", scope: "budgets:read", id: "budgets" },
  { name: "Cards", scope: "cards:read", id: "cards" },
  { name: "Recipients", scope: "recipients:read", id: "recipients" },
];

export function mountPortal(app: Hono, ctx: PortalContext, deps: Deps) {
  const portal = mountCustomerPortal(app, ctx, {
    name: "harborline",
    isCustomer: (account) =>
      customers.some((customer) => customer.id === account),
    pages: {
      joined: () =>
        shell(
          "Not signed in · Harborline Bank",
          `<main class="wrap"><section class="account-head"><h1>This browser isn&#39;t signed in.</h1><p>${escape(AGENT_BROWSER_LOGIN)}</p></section></main>`,
          "/account",
          ctx.origin,
        ),
      form: (token) =>
        shell(
          "Sign in · Harborline Bank",
          `<main class="wrap"><section class="account-head"><h1>Log in to Harborline.</h1><p>Choose a test customer to open their accounts. There is no password: this is a demo, and nobody's identity is checked. A connected agent sees the same accounts.</p></section><section class="section"><form class="form-card" method="post" action="/site/login"><input type="hidden" name="login_token" value="${token}"><label for="account">Test customer</label><select id="account" name="account">${customers.map((customer) => `<option value="${customer.id}">${escape(customer.name)}</option>`).join("")}</select><button type="submit">Log in</button><p class="fine">Never enter a real bank password, account number, card number or any real financial data.</p></form></section></main>`,
          "/account",
          ctx.origin,
        ),
      expired: () =>
        shell(
          "Log in again · Harborline Bank",
          `<main class="wrap"><section class="account-head"><h1>This login page has expired.</h1><p>A login page works for five minutes after it opens, and this one is older. You are not logged in, and nothing has changed.</p><p><a href="/site/login">Open the login page again</a></p></section></main>`,
          "/account",
          ctx.origin,
        ),
    },
    tooMany: "Too many fictional portal sessions.",
    results: {
      waiting: (until) =>
        `It waits for your approval in your agent until ${until}. If you decline it there or let it run out, no fictional state changes. Your agent does not tell us when you decline, so it shows as awaiting until then.`,
      unchanged: {
        expired: "The proposal expired. No fictional state changed.",
        declined:
          "Harborline declined this approval. No fictional state changed.",
        refused:
          "Your accounts had changed when this was approved. No fictional state changed.",
      },
    },
    permissions: (scopes) => consentWords(permissions(scopes)),
    view: (viewer, { activity, agents }) => {
      const customer = deps.customerFor(viewer.account);
      const sees = (scope: string) => viewerSees(viewer, scope);
      // As the API: a grant that shares some accounts shows those, with
      // their transactions and cards.
      const shared = withinGrant(customer, viewer.agent?.resources);
      return {
        account_id: customer.id,
        customer: {
          name: customer.name,
          // The email is read through the FDX-shaped API only.
          email: sees("fdx:CUSTOMER_CONTACT") ? customer.email : "",
        },
        accounts: sees("accounts:read") ? shared.accounts : [],
        transactions: sees("transactions:read") ? shared.transactions : [],
        cards: sees("cards:read") ? shared.cards : [],
        recipients: sees("recipients:read") ? customer.recipients : [],
        budgets: sees("budgets:read") ? customer.budgets : [],
        // No scope reads the payments and transfers made.
        payments: viewer.agent ? [] : customer.payments,
        transfers: viewer.agent ? [] : customer.transfers,
        activity,
        // With the account, so the portal's own two-second read keeps the
        // list of connected agents current, in the consent page's words.
        agents,
        note: FICTION_NOTICE,
        ...agentBrowserState(viewer, PARTS),
      };
    },
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
    const part = (id: string) => {
      const found = PARTS.find((p) => p.id === id)!;
      return viewerSees(record, found.scope)
        ? `<section class="section"><h2>${found.name}</h2><div id="${id}" class="data-list"></div></section>`
        : "";
    };
    const own = record.agent
      ? ""
      : `<section class="section"><h2>Agent activity</h2><p class="fine">Awaiting approval means nothing has changed yet. Approve or decline it in your agent.</p><div id="activity"></div></section>${feedbackSection(ctx.feedback(), { section: "section", notice: "fine", example: "ordering a checkbook" })}<section class="section"><h2>Connected agents</h2><p class="fine">Disconnecting an agent ends its access. Logging out of the portal does not.</p><div id="access"></div><p id="access-status" role="status"></p></section>`;
    const body = `<main class="wrap account" data-account="${escape(record.account)}"><section class="account-head"><h1>Your accounts.</h1><p id="current-account"></p>${about}<div class="live-row"><p id="status" class="live" role="status">Loading your accounts…</p><div><button id="refresh" class="secondary" type="button">Refresh now</button>${record.readOnly ? "" : ' <button id="logout" class="secondary" type="button">Log out</button>'}</div></div></section><div id="content" aria-busy="true"><div class="account-grid"><div>${part("accounts")}${part("transactions")}${part("budgets")}</div><div>${part("cards")}${part("recipients")}${own}</div></div></div></main><script defer src="/site/app.js"></script>`;
    return c.html(
      shell("Customer portal · Harborline Bank", body, "/account", ctx.origin),
      200,
      portal.headers,
    );
  });
}

/**
 * The part of a Company's customer portal (`/site/*`) that is the same at
 * every Company: the test customer's login and its cookies, which browser
 * may change the account, the agents it lists and disconnects, and what it
 * says of its agents' requests. Each Company keeps its own pages, words and
 * account routes, and passes them in.
 *
 * A login lives under `state.webSessions`, by the hash of its cookie, where
 * the gateway finds it to move it with a browser that starts to see an
 * agent user's copy of the Company (`gateway/tenancy.ts`). A browser
 * joined to an agent's Session (§6) gets no login form, sees no connected
 * agents or their activity, and can change nothing (`siteViewer`).
 */
import type { Context, Hono } from "hono";
import { randomId, tokenHash } from "@poppy-lab/pap-client/core";
import type { ActivityItem } from "./gateway/activity.ts";
import type { BrowserJoin, GrantAccess } from "./gateway/types.ts";
import { LOGIN_FORM_MS, loginFormToken, loginFormValid } from "./site-login.ts";
import { siteViewer, type SiteViewer } from "./site-viewer.ts";

/** A test customer's login to the portal. */
export type PortalLogin = { expires: number; account: string };

/** What the gateway gives a Company's `mount` that the portal reads. */
export type CustomerPortalContext = {
  state: Record<string, unknown>;
  grants: GrantAccess;
  origin: string;
  activity: (account: string) => ActivityItem[];
  browser: (c: Context) => BrowserJoin | undefined;
};

export type CustomerPortalOptions = {
  /**
   * Names the login's cookie (`{name}_web`), the form's (`{name}_login`),
   * and the header every POST from the account page carries with the
   * account it was opened for (`X-{Name}-Account`).
   */
  name: string;
  /** Whether a posted `account` is one of the Company's test customers. */
  isCustomer: (account: unknown) => boolean;
  /**
   * A Company's own check of a posted login, after its form is found valid
   * and before its account is read, such as a demo password: an answer
   * refuses the login with it.
   */
  login?: (c: Context, form: Record<string, string>) => Response | undefined;
  /** Whole pages, in the Company's own shell and words. */
  pages: {
    /** In the form's place, for an agent's browser that isn't signed in. */
    joined: () => string;
    /** The login form; `token` goes in its hidden `login_token` field. */
    form: (token: string) => string;
    /** For a form posted after its five minutes, or from another site. */
    expired: () => string;
  };
  /** The text of the 429 when the portal holds as many logins as it keeps. */
  tooMany: string;
  /** What a request that changed nothing says, when the gate gave no reason. */
  results: {
    /** For a proposal that waits, until `until`. */
    waiting: (until: string) => string;
    /** By the request's state: `expired`, `declined`, `refused`. */
    unchanged: Record<string, string>;
  };
  /** A grant's scopes in the consent page's words. */
  permissions: (scopes: string) => string[];
  /** What `/site/state` answers, from the two lists the portal keeps. */
  view: (viewer: SiteViewer, lists: PortalLists) => Record<string, unknown>;
  /** The account page's script, served as `/site/app.js`. */
  script: string;
};

/** What the portal shows its customer of their agents, and an agent's browser not. */
export type PortalLists = {
  activity: ReturnType<typeof portalActivity>;
  agents: ReturnType<typeof portalAgents>;
};

const LOGIN_S = 1800;
const MAX_LOGINS = 1000;
const noStore = { "Cache-Control": "no-store" };
/** The portal's own script and same-origin fetches, plus the web fonts. */
export const PORTAL_PAGE_HEADERS = {
  ...noStore,
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "same-origin",
};

const cookie = (c: Context, name: string) =>
  (c.req.header("cookie") ?? "")
    .split(/;\s*/)
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";

/**
 * What the customer's agents asked for, for their own browser only. A
 * proposal that waits says so: declining one is between the customer and
 * their agent, since the protocol has the agent send an approval or nothing
 * (Operations §5), so until the proposal ends the two look the same here.
 */
export const portalActivity = (
  items: (account: string) => ActivityItem[],
  viewer: SiteViewer,
  results: CustomerPortalOptions["results"],
) =>
  viewer.agent
    ? []
    : items(viewer.account).map((item) => ({
        ...item,
        result:
          item.result ??
          (item.state === "proposed"
            ? results.waiting(item.when)
            : results.unchanged[item.state]) ??
          null,
      }));

/**
 * The connected agents, for the customer's own browser only, with what
 * each may do in the consent page's words.
 */
export const portalAgents = (
  grants: GrantAccess,
  viewer: SiteViewer,
  permissions: (scopes: string) => string[],
) =>
  viewer.agent
    ? []
    : grants.list(viewer.account).map((grant) => ({
        ...grant,
        permissions: permissions(grant.scopes),
      }));

/**
 * Mounts the portal's login, logout, state, connected agents and script.
 * Returns what the Company's own routes need: the headers of a page, who a
 * read is for, and the login a change may be made for.
 */
export function mountCustomerPortal(
  app: Hono,
  ctx: CustomerPortalContext,
  options: CustomerPortalOptions,
) {
  const { origin } = ctx;
  const secure = origin.startsWith("https:");
  const web = `${options.name}_web`,
    login = `${options.name}_login`,
    header = `x-${options.name}-account`;
  const sessions = (ctx.state.webSessions ??= {}) as Record<
    string,
    PortalLogin
  >;
  // The login form carries its own token now; the nonces kept here went.
  delete ctx.state.webLogins;
  const setCookie = (name: string, value: string, maxAge: number) =>
    `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const current = (c: Context) => {
    const record = sessions[tokenHash(cookie(c, web))];
    return record && record.expires > Date.now() ? record : undefined;
  };
  const sameOrigin = (c: Context) => c.req.header("origin") === origin;
  /** Who a read is for: a join's account first, then the browser's login. */
  const viewer = (c: Context) => siteViewer(ctx.browser(c), current(c));
  /**
   * The login a change is made for: from this site, by a signed-in browser
   * whose POST names the account its page was opened for.
   */
  const changer = (c: Context) => {
    const record = current(c);
    return record &&
      sameOrigin(c) &&
      (c.req.method !== "POST" || c.req.header(header) === record.account)
      ? record
      : undefined;
  };

  app.get("/site/login", (c) => {
    // An agent's browser gets no login form: its sign-in is the agent's.
    const join = ctx.browser(c);
    if (join?.account) return c.redirect("/account", 302);
    if (join) return c.html(options.pages.joined(), 200, PORTAL_PAGE_HEADERS);
    // In a cookie and in the form: the two must arrive equal (site-login.ts).
    const token = loginFormToken();
    return c.html(options.pages.form(token), 200, {
      ...PORTAL_PAGE_HEADERS,
      "Set-Cookie": setCookie(login, token, LOGIN_FORM_MS / 1000),
    });
  });
  app.post("/site/login", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    if (!sameOrigin(c) || !loginFormValid(cookie(c, login), body.login_token))
      return c.html(options.pages.expired(), 403, PORTAL_PAGE_HEADERS);
    const refused = options.login?.(c, body);
    if (refused) return refused;
    if (!options.isCustomer(body.account))
      return c.json({ error: "invalid_account" }, 400);
    delete sessions[tokenHash(cookie(c, web))];
    for (const [id, session] of Object.entries(sessions))
      if (session.expires < Date.now()) delete sessions[id];
    if (Object.keys(sessions).length >= MAX_LOGINS)
      return c.text(options.tooMany, 429);
    const token = randomId();
    sessions[tokenHash(token)] = {
      expires: Date.now() + LOGIN_S * 1000,
      account: String(body.account),
    };
    // The form is used up, and the login gets its own cookie.
    c.header("Set-Cookie", setCookie(login, "", 0), { append: true });
    c.header("Set-Cookie", setCookie(web, token, LOGIN_S), { append: true });
    c.header("Cache-Control", "no-store");
    return c.redirect("/account", 302);
  });
  app.post("/site/logout", (c) => {
    if (!sameOrigin(c)) return c.json({ error: "same_origin_required" }, 403);
    delete sessions[tokenHash(cookie(c, web))];
    return c.json({ ok: true }, 200, {
      "Set-Cookie": setCookie(web, "", 0),
      ...noStore,
    });
  });

  app.get("/site/state", (c) => {
    const seen = viewer(c);
    if (!seen) return c.json({ error: "sign_in_required" }, 401, noStore);
    return c.json(
      options.view(seen, {
        activity: portalActivity(ctx.activity, seen, options.results),
        agents: portalAgents(ctx.grants, seen, options.permissions),
      }),
      200,
      noStore,
    );
  });
  app.get("/site/access", (c) => {
    const seen = viewer(c);
    if (!seen) return c.json({ error: "sign_in_required" }, 401);
    // The connected agents are the customer's own to see.
    if (seen.agent) return c.json({ error: "customers_own_browser_only" }, 403);
    return c.json({ grants: ctx.grants.list(seen.account) }, 200, noStore);
  });
  app.post("/site/access/:id/revoke", (c) => {
    const record = changer(c);
    if (!record)
      return c.json({ error: "customer_session_and_origin_required" }, 403);
    if (!ctx.grants.revoke(record.account, c.req.param("id")))
      return c.json({ error: "grant_not_found" }, 404);
    return c.json({ revoked: true }, 200, noStore);
  });
  app.get("/site/app.js", (c) =>
    c.text(`"use strict";\n${options.script}`, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      ...noStore,
    }),
  );
  return { headers: PORTAL_PAGE_HEADERS, viewer, changer };
}

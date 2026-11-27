/**
 * Browser join (§6, §10.6): a Personal Agent's own browser joins a Session
 * in three steps. The browser loads the page, which holds a one-time code
 * in a form and sets a cookie that ties the code to that browser. The
 * Personal Agent authorizes the code in a request of its own, with the
 * Session header and, to sign the browser in, an access token that has
 * `poppy:browser-sign-in`. The browser submits the form, and gets the
 * cookie for the Session. Only the browser that loaded the page has the
 * cookie that goes with its code, and only a Personal Agent can authorize
 * it, for its own Session. The access token never reaches the browser.
 *
 * A page load keeps nothing: the code carries when it ends and a keyed hash
 * that only this Company can make, and the join cookie is a keyed hash of
 * the code. So anyone may load the page as often as they like and nothing
 * is written. A code is kept, by its hash, from the Personal Agent's
 * authorization until it ends a minute after the page was loaded.
 *
 * A joined browser is the agent's, so it changes nothing here: every
 * request from one that isn't a read is refused before any route sees it
 * (`mountBrowserGuard`). The Companies' APIs answer a change with a
 * proposal the customer approves in their agent, and their websites have no
 * such step. Signed in, a joined browser sees what the token's scopes
 * cover, which each Company's website applies (`BrowserJoin`), for as long
 * as the Session and the token's grant last.
 */
import type { Context, Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomId } from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import { sessionDestination } from "./sessions.ts";
import {
  BROWSER_SESSION_PATH,
  BROWSER_SIGN_IN,
  hash,
  ObjectMap,
  SHARED_TENANT,
  type BrowserJoin,
  type JoinCode,
  type JoinedBrowser,
} from "./types.ts";

/** How long a code lasts from the page load (guides: within 60 seconds). */
const CODE_MS = 60000;
/** Codes waiting for their form, in all and for one agent user. */
const MAX_CODES = 500,
  MAX_CODES_PER_USER = 10;
/** Codes a form used before any Personal Agent authorized them. */
const MAX_UNAUTHORIZED = 500;
/** Joined browsers, in all and for one agent user. */
const MAX_BROWSERS = 1000,
  MAX_BROWSERS_PER_USER = 20;
/** `bc_`, 24 random bytes, when it ends (base 36), and the keyed hash. */
const CODE = /^bc_([A-Za-z0-9_-]{32}\.[0-9a-z]{8,9})\.([A-Za-z0-9_-]{22})$/;
/** Cookies of one request that are looked at for a website login. */
const MAX_COOKIES = 30;
/** OAuth endpoints an agent calls itself, with its own credentials. */
const AGENT_ENDPOINTS = [
  "/oauth/token",
  "/oauth/par",
  "/oauth/device",
  "/oauth/revoke",
];

const cookies = (c: Context) =>
  (c.req.header("cookie") ?? "").split(/;\s*/).flatMap((pair) => {
    const at = pair.indexOf("=");
    return at > 0 ? [[pair.slice(0, at), pair.slice(at + 1)] as const] : [];
  });
const cookie = (c: Context, name: string) =>
  cookies(c).find(([k]) => k === name)?.[1];
/** Equal, in time that doesn't depend on where they differ. */
const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const sessionCookie = (ctx: Ctx) => `${ctx.cookiePrefix}poppy_session`;

/** A small page of the gateway's own; it loads nothing and runs nothing. */
const shell = (ctx: Ctx, title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · ${escapeHtml(ctx.def.name)}</title><style>:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui,sans-serif}main{max-width:34rem;margin:14vh auto;padding:0 1.25rem}h1{font-size:1.375rem;line-height:1.3;margin:0 0 .75rem}p,form{margin:0 0 1rem}button{font:inherit;padding:.5rem 1.1rem;cursor:pointer}.note{font-size:.875rem;opacity:.75}</style></head><body><main>${body}</main></body></html>`;
/**
 * §6, step 1: not stored by caches, not framed, and no reference kept by a
 * page that opened it (the values the guides suggest). The policy lets a
 * form post to this origin only.
 */
const pageHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/**
 * The join a request's browser belongs to: it sent the cookie of a joined
 * browser, and its Session hasn't ended. Looked up on each request, so the
 * cookie stops working when the Session does (§6).
 */
export function joinedBrowser(ctx: Ctx, c: Context): JoinedBrowser | undefined {
  const raw = cookie(c, sessionCookie(ctx));
  if (!raw || !/^[A-Za-z0-9_-]{32}$/.test(raw)) return undefined;
  const id = hash(raw);
  const browsers = ctx.state.browsers ?? {};
  const joined = Object.hasOwn(browsers, id) ? browsers[id] : undefined;
  const now = Date.now();
  if (!joined || joined.expires < now) return undefined;
  const sessions = ctx.state.sessions;
  const session = Object.hasOwn(sessions, joined.session)
    ? sessions[joined.session]
    : undefined;
  return session && session.expires >= now ? joined : undefined;
}

/**
 * The join as a Company's website is told of it. Signed in only while the
 * grant of the token it was authorized with is there: the agent's
 * revocation, which is how it signs out, Disconnect on the website and the
 * grant's own end all take the grant away, and the browser is signed out
 * on its next request (§5.5, §6). It stays a browser of the Session.
 */
export function browserJoin(ctx: Ctx, c: Context): BrowserJoin | undefined {
  const joined = joinedBrowser(ctx, c);
  if (!joined) return undefined;
  const { grants } = ctx.state;
  const grant =
    joined.grant !== undefined && Object.hasOwn(grants, joined.grant)
      ? grants[joined.grant]
      : undefined;
  if (
    !joined.account ||
    !joined.scopes ||
    !grant ||
    grant.expires < Date.now() ||
    grant.client !== joined.client ||
    grant.account !== joined.account ||
    grant.holder !== joined.holder
  )
    return { scopes: [] };
  return {
    account: joined.account,
    scopes: joined.scopes.split(" ").filter(Boolean),
    ...(grant.resources ? { resources: [...grant.resources] } : {}),
  };
}

/**
 * Refuses every change from a joined browser, signed in or not, whatever
 * route it is for, so a route added later is refused too. A change is any
 * request that isn't a read. What stays open is what a browser's cookie
 * opens nothing at: the join's own form, the Session destinations, which
 * take a verified Session header and no cookie, and the OAuth endpoints an
 * agent calls with its own credentials. The consent page and the page that
 * takes a Device Sign-In's code are not among them: a joined browser can't
 * allow its own agent. A browser the agent
 * drives without joining it is a visitor like any other, which the lab's
 * password-free consent can't tell from the customer (docs/poppy-1.0.md).
 */
export function mountBrowserGuard(app: Hono, ctx: Ctx) {
  const text = `This browser belongs to an agent's session, so it can't change anything at ${ctx.def.name}. Changes are made through the agent and wait for your approval there. Nothing has changed.`;
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (
      ["GET", "HEAD", "OPTIONS"].includes(c.req.method) ||
      path === BROWSER_SESSION_PATH ||
      sessionDestination(ctx, path) ||
      AGENT_ENDPOINTS.includes(path) ||
      !joinedBrowser(ctx, c)
    )
      return next();
    // A form gets a page; a page's script gets the same words as JSON.
    if ((c.req.header("accept") ?? "").includes("text/html"))
      return c.html(
        shell(
          ctx,
          "Nothing changed",
          `<h1>This browser can't change anything here.</h1><p>${escapeHtml(text)}</p>`,
        ),
        403,
        pageHeaders,
      );
    return c.json(
      { error: "read_only_browser", error_description: text },
      403,
      { "Cache-Control": "no-store" },
    );
  });
}

export function mountBrowserSession(app: Hono, ctx: Ctx) {
  const { def, state, secure, cookiePrefix, isolated } = ctx;
  const joins = new ObjectMap<JoinCode>((state.joins ??= {}));
  const browsers = new ObjectMap<JoinedBrowser>((state.browsers ??= {}));
  const joinCookie = `${cookiePrefix}poppy_join`;
  const attributes = `${secure ? "Secure; " : ""}HttpOnly`;

  /**
   * The key of the codes and join cookies, made the first time one is
   * needed and saved by that request. With it, somebody could make codes
   * without loading the page, which gets them nothing a page load doesn't.
   */
  const keyed = (request: Request, label: string, value: string) => {
    if (!state.joinKey) {
      state.joinKey = randomId();
      ctx.markDirty(request);
    }
    return createHmac("sha256", state.joinKey)
      .update(`${label}\n${value}`)
      .digest("base64url");
  };
  /** When a code this Company issued ends; nothing for any other text. */
  const issued = (request: Request, code: string) => {
    const [, body, mac] = CODE.exec(code) ?? [];
    if (!body || !mac) return undefined;
    if (!same(mac, keyed(request, "code", body).slice(0, 22))) return undefined;
    return parseInt(body.split(".")[1]!, 36);
  };
  const prune = (now: number) => {
    for (const [id, join] of joins) if (join.expires < now) joins.delete(id);
    for (const [id, b] of browsers) if (b.expires < now) browsers.delete(id);
  };
  /** §6, step 3: an error page with an error status, and no cookie. */
  const refuse = (c: Context, status: 400 | 429 = 400) =>
    c.html(
      shell(
        ctx,
        "Not connected",
        status === 429
          ? `<h1>This browser wasn't connected.</h1><p>Too many browsers are being connected at the moment. Nothing has changed. Wait a minute, then <a href="${BROWSER_SESSION_PATH}">open the connection page again</a>.</p>`
          : `<h1>This browser wasn't connected.</h1><p>The code from the connection page was missing, used before, older than a minute, or not confirmed by the agent. Nothing has changed, and this browser joined no session.</p><p><a href="${BROWSER_SESSION_PATH}">Open the connection page again</a> to start over.</p>`,
      ),
      status,
      pageHeaders,
    );

  // Step 1: the page, with a code and the cookie that ties it to this
  // browser. It starts, ends and changes no Session and no other cookie.
  app.get(BROWSER_SESSION_PATH, (c) => {
    const body = `${randomId()}.${(Date.now() + CODE_MS).toString(36)}`;
    const code = `bc_${body}.${keyed(c.req.raw, "code", body).slice(0, 22)}`;
    return c.html(
      shell(
        ctx,
        "Connecting",
        `<h1>Connecting this browser to an agent's session</h1><p>${escapeHtml(def.name)} shows this page to a personal agent's own browser. The agent confirms the code this page holds, then continues, and the browser joins the agent's session here. A joined browser reads what the agent may read and can't change anything on this website.</p><form method="post" action="${BROWSER_SESSION_PATH}"><input type="hidden" name="code" value="${code}"><button>Continue</button></form><p class="note">Continue works once, within a minute, and only after the agent has confirmed the code. If you opened this page yourself, you can close it. Nothing has changed.</p>`,
      ),
      200,
      {
        ...pageHeaders,
        "Set-Cookie": `${joinCookie}=${keyed(c.req.raw, "cookie", code)}; Path=/; Max-Age=${CODE_MS / 1000}; ${attributes}; SameSite=Strict`,
      },
    );
  });

  // Step 2: the Personal Agent authorizes the code for its Session, which
  // the Session middleware has verified, and started if its `sid` was new.
  // With an access token, also checked there (one account per Session),
  // the code is authorized for the token's account and scopes.
  app.post(`${BROWSER_SESSION_PATH}/authorize`, async (c) => {
    const s = ctx.sessionFor(c);
    // §6: an access token here needs poppy:browser-sign-in. Refused as at
    // an API (§7), before the code is looked at, so the agent can authorize
    // the same code again without the token.
    if (s.grant && !(s.scopes ?? "").split(" ").includes(BROWSER_SIGN_IN))
      return c.json({ error: "insufficient_scope" }, 403, {
        "WWW-Authenticate": `DPoP error="insufficient_scope", scope="${BROWSER_SIGN_IN}"`,
      });
    let code: unknown;
    try {
      code = ((await c.req.json()) as { code?: unknown } | null)?.code;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const now = Date.now();
    prune(now);
    const expires =
      typeof code === "string" ? issued(c.req.raw, code) : undefined;
    // One this Company issued, not expired, and neither authorized nor
    // used up by a form before.
    if (
      typeof code !== "string" ||
      !expires ||
      expires < now ||
      joins.get(hash(code))
    )
      return c.json({ error: "invalid_request" }, 400);
    const holder = ctx.holderOf(s.client, s.user);
    const waiting = joins
      .values()
      .flatMap((j) =>
        j.client ? [{ client: j.client, holder: j.holder }] : [],
      );
    if (
      ctx.overShare(waiting, s.client, MAX_CODES) ||
      waiting.filter((j) => j.holder === holder).length >= MAX_CODES_PER_USER
    )
      return c.body(null, 429);
    joins.set(hash(code), {
      expires,
      client: s.client,
      holder,
      session: ctx.sessionKeys.get(c.req.raw)!,
      // The token stays with the agent: only what it stands for is kept.
      ...(s.grant && s.account && s.scopes
        ? { account: s.account, scopes: s.scopes, grant: s.grant }
        : {}),
    });
    return c.body(null, 204, { "Cache-Control": "no-store" });
  });

  /**
   * §6: a join with an access token signs the browser in in place of any
   * login it had, and that login doesn't come back. A Company keeps its
   * website logins under `webSessions`, by the hash of each login's
   * cookie, in the copy the browser saw until now. The ones this request's
   * cookies name are this browser's: they are ended there, and the names
   * of their cookies returned, to clear them in the browser.
   *
   * A join without a token leaves such a login as it is and where it is.
   * With a copy per visitor it is not taken to the Session's copy: these
   * websites log a customer in without a password, so a login made
   * elsewhere would show an agent's browser an account no scope covers.
   */
  function endLogins(c: Context) {
    const browser = ctx.browserOf(c);
    const saw = !isolated
      ? SHARED_TENANT
      : browser && (state.links?.[browser]?.tenant ?? `browser:${browser}`);
    const logins = saw
      ? (state.tenants[saw]?.business.webSessions as
          Record<string, unknown> | undefined)
      : undefined;
    if (!saw || !logins || typeof logins !== "object") return [];
    const names: string[] = [];
    for (const [name, value] of cookies(c).slice(0, MAX_COOKIES)) {
      const id = hash(value);
      if (!Object.hasOwn(logins, id)) continue;
      delete logins[id];
      // Only a name that is safe to send back in a header.
      if (/^[\w.-]{1,64}$/.test(name)) names.push(name);
    }
    // That copy changed, so it is the one this request saves.
    if (names.length) ctx.tenantsTouched.set(c.req.raw, saw);
    return names;
  }

  // Step 3: the browser submits the form. The code is used by this request
  // whatever comes of it, and the browser gets the Session's cookie only
  // with the cookie of the page that held the code.
  app.post(BROWSER_SESSION_PATH, async (c) => {
    let code = "";
    try {
      const field = (await c.req.parseBody()).code;
      if (typeof field === "string") code = field;
    } catch {
      // A body that isn't a form has no code.
    }
    const now = Date.now();
    prune(now);
    const expires = issued(c.req.raw, code);
    if (!expires || expires < now) return refuse(c);
    const id = hash(code);
    let join = joins.get(id);
    const first = !join?.used;
    if (join) join.used = true;
    else {
      // Not authorized yet: kept as used, so it can't be authorized and
      // submitted again. Bounded apart from the authorized ones, which a
      // flood of these then can't crowd out.
      const unauthorized = joins
        .values()
        .filter((j) => j.client === undefined).length;
      if (unauthorized >= MAX_UNAUTHORIZED) return refuse(c, 429);
      joins.set(id, (join = { expires, used: true }));
    }
    const sent = cookie(c, joinCookie);
    if (!sent || !same(sent, keyed(c.req.raw, "cookie", code)))
      return refuse(c);
    const { client, holder, session, account, scopes, grant } = join;
    if (!first || !client || !holder || !session) return refuse(c);
    // The Session it was authorized for is still going.
    const record = Object.hasOwn(state.sessions, session)
      ? state.sessions[session]
      : undefined;
    if (!record || record.expires < now) return refuse(c);
    // A join again replaces the cookie the browser had (§6), so that one
    // doesn't count.
    const before = cookie(c, sessionCookie(ctx));
    const replaced = before ? hash(before) : undefined;
    const others = [...browsers].flatMap(([k, b]) =>
      k === replaced ? [] : [b],
    );
    if (
      ctx.overShare(others, client, MAX_BROWSERS) ||
      others.filter((b) => b.holder === holder).length >= MAX_BROWSERS_PER_USER
    )
      return refuse(c, 429);
    if (replaced) browsers.delete(replaced);
    const value = randomId();
    // The cookie doesn't outlive the Session (§6): it ends when the Session
    // would without another request from the agent, and the browser's own
    // requests don't keep the Session going. Signed in, it acts for the
    // account only while the token's grant lasts (`browserJoin`).
    const signedIn = account && scopes && grant;
    browsers.set(hash(value), {
      client,
      holder,
      session,
      expires: record.expires,
      ...(signedIn ? { account, scopes, grant } : {}),
    });
    c.header(
      "Set-Cookie",
      `${sessionCookie(ctx)}=${value}; Path=/; Max-Age=${Math.floor((record.expires - now) / 1000)}; ${attributes}; SameSite=Lax`,
      { append: true },
    );
    for (const name of [joinCookie, ...(signedIn ? endLogins(c) : [])])
      c.header(
        "Set-Cookie",
        `${name}=; Path=/; Max-Age=0; ${attributes}; SameSite=Strict`,
        { append: true },
      );
    c.header("Cache-Control", "no-store");
    return c.redirect("/", 303);
  });
}

/**
 * Browser join (§6, §10.6): a Personal Agent's own browser joins a Session
 * in three steps. The browser loads the page, which holds a one-time code
 * in a form and sets a cookie that ties the code to that browser. The
 * Personal Agent authorizes the code in a request of its own, with the
 * Session header. The browser submits the form, and gets the cookie for the
 * Session. Only the browser that loaded the page has the cookie that goes
 * with its code, and only a Personal Agent can authorize it, for its own
 * Session.
 *
 * A page load keeps nothing: the code carries when it ends and a keyed hash
 * that only this Company can make, and the join cookie is a keyed hash of
 * the code. So anyone may load the page as often as they like and nothing
 * is written. A code is kept, by its hash, from the Personal Agent's
 * authorization until it ends a minute after the page was loaded.
 *
 * Joins are signed out. A join with an access token would sign the browser
 * in to the token's account (§6), and no Company here grants the scope that
 * takes, so step 2 refuses every access token with `insufficient_scope` and
 * the Session's cookie never acts for an account.
 */
import type { Context, Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomId } from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import type { Tenancy } from "./tenancy.ts";
import {
  BROWSER_SESSION_PATH,
  BROWSER_SIGN_IN,
  hash,
  ObjectMap,
  type JoinCode,
  type JoinedBrowser,
  type Tenant,
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

/**
 * The join a website request belongs to: the browser sent the cookie of a
 * joined browser, and its Session hasn't ended. Looked up on each request,
 * so the cookie stops working when the Session does (§6).
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

export function mountBrowserSession(app: Hono, ctx: Ctx, tenancy: Tenancy) {
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

  /** A small page of the gateway's own; it loads nothing and runs nothing. */
  const shell = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · ${escapeHtml(def.name)}</title><style>:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui,sans-serif}main{max-width:34rem;margin:14vh auto;padding:0 1.25rem}h1{font-size:1.375rem;line-height:1.3;margin:0 0 .75rem}p,form{margin:0 0 1rem}button{font:inherit;padding:.5rem 1.1rem;cursor:pointer}.note{font-size:.875rem;opacity:.75}</style></head><body><main>${body}</main></body></html>`;
  /**
   * §6, step 1: not stored by caches, not framed, and no reference kept by
   * a page that opened it (the values the guides suggest). The policy lets
   * the form post to this origin only.
   */
  const pageHeaders = {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  /** §6, step 3: an error page with an error status, and no cookie. */
  const refuse = (c: Context, status: 400 | 429 = 400) =>
    c.html(
      shell(
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
        "Connecting",
        `<h1>Connecting this browser to an agent's session</h1><p>${escapeHtml(def.name)} shows this page to a personal agent's own browser. The agent confirms the code this page holds, then continues, and the browser joins the agent's session here, signed out.</p><form method="post" action="${BROWSER_SESSION_PATH}"><input type="hidden" name="code" value="${code}"><button>Continue</button></form><p class="note">Continue works once, within a minute, and only after the agent has confirmed the code. If you opened this page yourself, you can close it. Nothing has changed.</p>`,
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
  app.post(`${BROWSER_SESSION_PATH}/authorize`, async (c) => {
    const s = ctx.sessionFor(c);
    // §6: an access token here needs poppy:browser-sign-in, and no token
    // of this gateway has it (`context.ts`). Refused as at an API (§7),
    // before the code is looked at, so the agent can authorize the same
    // code again without the token.
    if (s.grant)
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
    });
    return c.body(null, 204, { "Cache-Control": "no-store" });
  });

  /**
   * §6: a join without an access token leaves a login the browser has on
   * the website as it is. Where every visitor has a copy, that login is
   * kept in the copy the browser saw until now, so it is copied to the
   * Session's: a Company keeps its logins under `webSessions`, by the hash
   * of each login's cookie, and the ones this request's cookies name are
   * this browser's. Copied, not moved: the browser sees its earlier copy
   * again when the Session ends, with that login.
   */
  function carryLogins(c: Context, holder: string) {
    const browser = ctx.browserOf(c);
    if (!browser) return;
    const saw = state.links?.[browser]?.tenant ?? `browser:${browser}`;
    const logins = state.tenants[saw]?.business.webSessions as
      Record<string, unknown> | undefined;
    if (saw === holder || !logins || typeof logins !== "object") return;
    const own = cookies(c)
      .slice(0, MAX_COOKIES)
      .map(([, value]) => hash(value))
      .filter((id) => Object.hasOwn(logins, id));
    if (!own.length) return;
    ctx.tenantKeys.set(c.req.raw, holder);
    const to: Tenant = tenancy.enter(c.req.raw).tenant;
    const kept = (to.business.webSessions ??= {}) as Record<string, unknown>;
    for (const id of own) kept[id] = structuredClone(logins[id]);
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
    const { client, holder, session } = join;
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
    // requests don't keep the Session going.
    browsers.set(hash(value), {
      client,
      holder,
      session,
      expires: record.expires,
    });
    if (isolated) carryLogins(c, holder);
    c.header(
      "Set-Cookie",
      `${sessionCookie(ctx)}=${value}; Path=/; Max-Age=${Math.floor((record.expires - now) / 1000)}; ${attributes}; SameSite=Lax`,
      { append: true },
    );
    c.header(
      "Set-Cookie",
      `${joinCookie}=; Path=/; Max-Age=0; ${attributes}; SameSite=Strict`,
      { append: true },
    );
    c.header("Cache-Control", "no-store");
    return c.redirect("/", 303);
  });
}

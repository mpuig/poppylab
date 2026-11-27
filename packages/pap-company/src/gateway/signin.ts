/**
 * Direct Sign-In (§4.2): Pushed Authorization Requests (RFC 9126, offered,
 * not required), the consent page and the one-time code. The consent page
 * always lists every requested scope, so `prompt=consent` needs nothing more
 * (§4.2, §10.8). The Company chooses which scopes, and which resources such
 * as accounts, an approval grants. Device Sign-In (§4.3, `device.ts`) shows
 * the same consent page, whose answer then goes to the device request.
 */
import type { Context, Hono } from "hono";
import { scryptSync, timingSafeEqual } from "node:crypto";
import {
  randomId,
  tokenHash,
  verifyAssertion,
} from "@poppy-lab/pap-client/core";
import {
  assertionKey,
  attemptLimit,
  type ClientInfo,
  type Ctx,
} from "./context.ts";
import { answeredPage, deviceNotice } from "./device-pages.ts";
import {
  BROWSER_SIGN_IN,
  isChallenge,
  ObjectMap,
  type Code,
  type Consent,
  type DeviceRequest,
  type Grant,
  type Pushed,
} from "./types.ts";

const REQUEST_URI = "urn:ietf:params:oauth:request_uri:";
/** Resources one consent may grant (`selectResources`). */
const MAX_RESOURCES = 100;

/**
 * §4.2: a requested redirect URI is a registered one exactly, except for
 * the port of a loopback one, which an app on the User's computer picks
 * when it starts (RFC 8252 §7.3).
 */
function sameRedirect(registered: string, requested: string) {
  if (registered === requested) return true;
  let url: URL;
  try {
    url = new URL(registered);
    if (
      url.protocol !== "http:" ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]")
    )
      return false;
    url.port = new URL(requested).port;
  } catch {
    return false;
  }
  return url.href === requested;
}

export function mountSignIn(app: Hono, ctx: Ctx) {
  const { def, deploy, origin, state, both, isolated, cookiePrefix, secure } =
    ctx;
  // Persisted: a Durable Object may restart while the user reads consent.
  const pending = new ObjectMap<Consent>((state.consents ??= {}));
  const codes = new ObjectMap<Code>((state.codes ??= {}));
  const pushed = new ObjectMap<Pushed>((state.pushed ??= {}));
  const devices = new ObjectMap<DeviceRequest>((state.devices ??= {}));
  /**
   * Wrong passwords: ten a minute from one source (`sourceOf`, else that
   * consent page), so nobody can lock everyone else out, and a backstop
   * for all.
   */
  const failures = attemptLimit(10, 60000, 100);
  /** The demo password's salt and scrypt hash, checked once, here. */
  const password = deploy.passwordHash?.match(/^([^:]+):([0-9a-f]{128})$/i);
  if (deploy.passwordHash !== undefined && !password)
    throw new Error("passwordHash must be salt:hex of a 64-byte scrypt hash");
  /** Whether that consent page is still open: not answered, not expired. */
  const live = (nonce: string) =>
    (pending.get(nonce)?.expires ?? 0) >= Date.now();
  /** What a consent page may load: its own styles and the Company's faces. */
  const styles = `default-src 'none'; style-src 'unsafe-inline'${def.fontSources ? ` ${def.fontSources.style}; font-src ${def.fontSources.font}` : ""}`;

  /**
   * A sign-in request's `scope` in the Company's order, or `undefined` when
   * it is missing, or names a scope the Company lacks or one twice (§4.7).
   */
  const scopesOf = (scope: unknown) => {
    const requested = typeof scope === "string" ? scope.split(" ") : [];
    if (
      !requested.length ||
      requested.some((s) => !both.includes(s)) ||
      new Set(requested).size !== requested.length
    )
      return undefined;
    return both.filter((s) => requested.includes(s)).join(" ");
  };

  /** The authorization request's checks, for a query or a pushed request. */
  async function check(q: Record<string, string | undefined>) {
    const scopes = scopesOf(q.scope);
    if (!scopes) return { error: "invalid_scope" } as const;
    if (
      q.response_type !== "code" ||
      q.code_challenge_method !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? "") ||
      !/^[A-Za-z0-9_-]{20,100}$/.test(q.state ?? "") ||
      !q.client_id ||
      !q.redirect_uri
    )
      return { error: "invalid_request" } as const;
    let info;
    try {
      info = await ctx.client(q.client_id);
    } catch {
      return { error: "invalid_client" } as const;
    }
    // A redirect_uri from the client's own metadata (§4.2).
    if (!info.redirects.some((r) => sameRedirect(r, q.redirect_uri!)))
      return { error: "invalid_request" } as const;
    return {
      info,
      scopes,
      client: q.client_id,
      redirect: q.redirect_uri,
      state: q.state!,
      challenge: q.code_challenge!,
    } as const;
  }

  // RFC 9126: the client pushes the request with its assertion, so the
  // Company knows who asks before the User sees anything (§4.2).
  app.post("/oauth/par", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    const id = String(body.client_id ?? "");
    try {
      await ctx.challengeBeforeConsuming(c);
      if (
        body.client_assertion_type !==
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" ||
        body.request_uri
      )
        return c.json({ error: "invalid_request" }, 400);
      const info = await ctx.client(id);
      const key = assertionKey(info, String(body.client_assertion ?? ""));
      if (!key) throw Error();
      await verifyAssertion(
        body.client_assertion!,
        key,
        id,
        id,
        origin,
        ctx.replay,
      );
    } catch (e) {
      if (isChallenge(e))
        return c.json({ error: "use_dpop_nonce" }, 400, {
          "DPoP-Nonce": e.nonce,
        });
      return c.json({ error: "invalid_client" }, 401);
    }
    const checked = await check(body);
    if ("error" in checked) return c.json({ error: checked.error }, 400);
    // RFC 9449 §10: a DPoP proof here binds the code to that key.
    let dpop: string | undefined;
    if (c.req.header("dpop"))
      try {
        dpop = await ctx.proofOf(
          c.req.header("dpop")!,
          `${origin}/oauth/par`,
          "POST",
          ctx.replay.for(id),
          undefined,
          undefined,
          ctx.nonceFor("token"),
        );
      } catch (e) {
        if (isChallenge(e))
          return c.json({ error: "use_dpop_nonce" }, 400, {
            "DPoP-Nonce": e.nonce,
          });
        return c.json({ error: "invalid_dpop_proof" }, 400);
      }
    // Requests past their 90 seconds go, except one whose consent page is
    // still open: that page's browser may load it again.
    for (const [k, p] of pushed)
      if (p.expires < Date.now() && !(p.consent && live(p.consent)))
        pushed.delete(k);
    if (ctx.overShare(pushed.values(), id, 500))
      return c.json({ error: "rate_limited" }, 429);
    const uri = `${REQUEST_URI}${randomId()}`;
    const params = Object.fromEntries(
      [
        "response_type",
        "client_id",
        "redirect_uri",
        "scope",
        "state",
        "code_challenge",
        "code_challenge_method",
      ].map((k) => [k, String(body[k])]),
    );
    pushed.set(tokenHash(uri), {
      client: id,
      params,
      expires: Date.now() + 90000,
      ...(dpop ? { dpop } : {}),
    });
    ctx.markDirty(c.req.raw);
    return c.json({ request_uri: uri, expires_in: 90 }, 201, {
      "Cache-Control": "no-store",
    });
  });

  /** What this browser sent as the cookie of that consent page. */
  const consentCookie = (c: Context, nonce: string) =>
    (c.req.header("cookie") ?? "")
      .split(/;\s*/)
      .find((s) =>
        s.startsWith(`${cookiePrefix}pap_consent_${nonce.slice(0, 12)}=`),
      )
      ?.split("=")[1];

  /**
   * The account this browser last allowed this client to reach, if the
   * client still holds that permission. The page opens on it, so asking for
   * more permission keeps the same customer unless the User chooses another.
   * It comes from the Company's own records (the grant and the cookie of
   * the browser that approved it), never from what the request says.
   */
  const allowedBefore = (c: Context, client: string) => {
    const browser = ctx.browserOf(c);
    if (!browser) return undefined;
    // The newest; of two approved in the same millisecond, the later one.
    let held: Grant | undefined;
    for (const g of Object.values(state.grants))
      if (
        g.client === client &&
        g.browser === browser &&
        g.expires > Date.now() &&
        (g.created ?? 0) >= (held?.created ?? 0)
      )
        held = g;
    return def.persona(held?.account)?.id;
  };

  /**
   * The Company's page in place of a consent page that ran out, for a
   * person: a browser that asks for HTML, at a Company that has the page.
   * Anything else gets the protocol's error as JSON.
   */
  const ranOut = (
    c: Context,
    how: "answered" | "reopened",
    error: "invalid_request" | "invalid_request_uri",
  ) =>
    def.consentExpired && (c.req.header("accept") ?? "").includes("text/html")
      ? c.html(def.consentExpired(how), 400, {
          "Cache-Control": "no-store",
          "Content-Security-Policy": `${styles}; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
          "Referrer-Policy": "same-origin",
        })
      : c.json({ error }, 400);

  app.get("/oauth/authorize", async (c) => {
    const q = c.req.query();
    if (!q.request_uri) return consent(c, q);
    // A pushed request: only client_id and request_uri count. Its 90 seconds
    // are for opening it; once used, its consent page decides (below).
    const p = pushed.get(tokenHash(q.request_uri));
    if (p && p.client !== q.client_id)
      return c.json({ error: "invalid_request_uri" }, 400);
    // Forgotten, or never opened in its 90 seconds: a reload of a page that
    // ran out, for all the browser can tell.
    if (!p || (!p.consent && p.expires < Date.now()))
      return ranOut(c, "reopened", "invalid_request_uri");
    return consent(c, p.params, p);
  });
  async function consent(
    c: Context,
    q: Record<string, string | undefined>,
    from?: Pushed,
  ) {
    const checked = await check(q);
    if ("error" in checked) return c.json({ error: checked.error }, 400);
    const { info, scopes, client, redirect, state, challenge } = checked;
    let nonce = from?.consent;
    if (nonce) {
      // A pushed request works once (RFC 9126 §7.3), except for a reload:
      // the browser that holds its consent page's cookie gets that page
      // again until it is answered or expires. Nothing changes, so nothing
      // is saved. Answered or expired, a reload gets the Company's page;
      // another browser while the page is open gets the error.
      if (!live(nonce)) return ranOut(c, "reopened", "invalid_request_uri");
      if (consentCookie(c, nonce) !== nonce)
        return c.json({ error: "invalid_request_uri" }, 400);
    } else {
      nonce = open(c, {
        client,
        redirect,
        state,
        scopes,
        challenge,
        expires: Date.now() + 300000,
        ...(from?.dpop ? { dpop: from.dpop } : {}),
      });
      if (!nonce) return c.json({ error: "rate_limited" }, 429);
      // Used from here on: this is the only consent page it will make.
      if (from) from.consent = nonce;
    }
    return render(c, nonce, info, client, scopes, new URL(redirect).origin);
  }

  /**
   * A new consent page for this browser: its nonce, and the cookies that
   * tie it to the browser. `undefined` when the client has too many open.
   */
  function open(c: Context, consent: Consent) {
    for (const [id, p] of pending)
      if (p.expires < Date.now()) pending.delete(id);
    if (ctx.overShare(pending.values(), consent.client, 500)) return undefined;
    ctx.markDirty(c.req.raw);
    const nonce = randomId();
    pending.set(nonce, consent);
    // Isolated deployments remember which browser approved (website link).
    if (isolated && !ctx.browserOf(c))
      c.header("Set-Cookie", ctx.browserCookie(randomId()), { append: true });
    // One cookie per consent page, so another tab can't replace it.
    c.header(
      "Set-Cookie",
      `${cookiePrefix}pap_consent_${nonce.slice(0, 12)}=${nonce}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}; Max-Age=300`,
      { append: true },
    );
    return nonce;
  }

  /**
   * The Company's consent page. `target` is where Direct Sign-In's form
   * leads, the redirect's origin; `notice` goes above the form.
   */
  function render(
    c: Context,
    nonce: string,
    info: ClientInfo,
    client: string,
    scopes: string,
    target?: string,
    notice?: string,
  ) {
    const account = allowedBefore(c, client);
    let html = def.consent({
      nonce,
      passwordRequired: !!password,
      scopes,
      client: info.name,
      clientHost: new URL(client).host,
      ...(account ? { account } : {}),
    });
    if (notice)
      html = html.includes("<form")
        ? html.replace("<form", () => `${notice}<form`)
        : notice + html;
    return c.html(html, 200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": `${styles}; form-action 'self'${target ? ` ${target}` : ""}; frame-ancestors 'none'; base-uri 'none'`,
      "Referrer-Policy": "same-origin",
    });
  }

  /**
   * Device Sign-In (§4.3): the consent page for a request whose code this
   * browser entered. A request has one page open at a time, the newest:
   * a person who moves to another browser gets the page there, and the
   * page they left can no longer answer.
   */
  function deviceConsent(
    c: Context,
    key: string,
    device: DeviceRequest,
    info: ClientInfo,
  ) {
    if (device.consent) pending.delete(device.consent);
    delete device.consent;
    const nonce = open(c, {
      client: device.client,
      redirect: "",
      state: "",
      scopes: device.scopes,
      challenge: "",
      expires: Math.min(Date.now() + 300000, device.expires),
      device: key,
    });
    if (!nonce) return c.json({ error: "rate_limited" }, 429);
    device.consent = nonce;
    return render(
      c,
      nonce,
      info,
      device.client,
      device.scopes,
      undefined,
      deviceNotice(ctx, device.userCode, info.name),
    );
  }
  app.post("/oauth/authorize", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    const nonce = String(body.nonce ?? "");
    const p = pending.get(nonce);
    const own = c.req.header("origin") === origin;
    if (
      !p ||
      consentCookie(c, nonce) !== nonce ||
      p.expires < Date.now() ||
      !own
    ) {
      // The page ran out before its answer: the consent's five minutes are
      // over or, once it is forgotten, the browser no longer holds its
      // cookie, which lasts as long. An answered page posted again still
      // has the cookie, and did not run out.
      const ended = p ? p.expires < Date.now() : !consentCookie(c, nonce);
      // A person gets a page of the Company. That is a browser posting the
      // sheet's form: `Origin` is this Company's, which no other site's
      // page can send, and the browser asks for HTML. Anything else gets
      // the error as JSON.
      if (ended && own) return ranOut(c, "answered", "invalid_request");
      return c.json({ error: "invalid_request" }, 400);
    }
    const source = ctx.sourceOf(c) ?? `consent:${nonce}`;
    if (failures.blocked(source)) return c.json({ error: "rate_limited" }, 429);
    if (body.decision === "approve" && password) {
      const actual = scryptSync(
        String(body.password ?? "").slice(0, 256),
        password[1]!,
        64,
      );
      if (!timingSafeEqual(actual, Buffer.from(password[2]!, "hex"))) {
        failures.count(source);
        return c.json({ error: "invalid_credentials" }, 401);
      }
    }
    const selected = def.persona(body.account ?? def.defaultAccount);
    if (body.decision === "approve" && !selected)
      return c.json({ error: "invalid_account" }, 400);
    const all = p.scopes.split(" ").filter(Boolean);
    // The Company chooses among its own scopes. The protocol's is granted
    // only when it was asked for and the sheet's line for it was left
    // allowed (§6: the User approves it like any other).
    const requested = all.filter((scope) => scope !== BROWSER_SIGN_IN);
    const selectedScopes = [
      ...(def.selectScopes
        ? def.selectScopes({ requested, body })
        : requested.filter(
            (scope) => scope !== def.writeScope || body.write === "yes",
          )),
      ...(all.includes(BROWSER_SIGN_IN) && body.allow_browser === "yes"
        ? [BROWSER_SIGN_IN]
        : []),
    ];
    const allowed = new Set(all);
    if (
      new Set(selectedScopes).size !== selectedScopes.length ||
      selectedScopes.some((scope) => !allowed.has(scope))
    )
      return c.json({ error: "invalid_scope" }, 400);
    const scopes = both
      .filter((scope) => selectedScopes.includes(scope))
      .join(" ");
    if (body.decision === "approve" && !scopes)
      return c.json({ error: "invalid_scope" }, 400);
    // What else the User chose, such as accounts, kept by the code and then
    // the grant. Bounded, since the form is the browser's.
    const chosen =
      body.decision === "approve"
        ? def.selectResources?.({
            persona: selected!.id,
            body,
            scopes: scopes.split(" "),
          })
        : undefined;
    // The Company turns this approval down, say for an empty choice; the
    // consent stays pending, so the User can go back and choose again.
    if (chosen && !Array.isArray(chosen) && typeof chosen.refuse === "string")
      return c.json(
        {
          error: "invalid_request",
          error_description: chosen.refuse.slice(0, 300),
        },
        400,
        { "Cache-Control": "no-store" },
      );
    if (
      chosen &&
      (!Array.isArray(chosen) ||
        chosen.length > MAX_RESOURCES ||
        new Set(chosen).size !== chosen.length ||
        chosen.some((r) => typeof r !== "string" || !r || r.length > 128))
    )
      return c.json({ error: "invalid_request" }, 400);
    const resources = chosen as string[] | undefined;
    pending.delete(nonce);
    if (p.device) {
      // Device Sign-In (§4.3): the answer waits for the agent's next poll,
      // and this browser is told what it did. A request that ended, or whose
      // code was since entered in another browser, takes no answer here.
      const device = devices.get(p.device);
      if (
        !device ||
        device.consent !== nonce ||
        device.expires < Date.now() ||
        device.approved ||
        device.declined
      )
        return ranOut(c, "answered", "invalid_request");
      delete device.consent;
      const browser = ctx.browserOf(c);
      if (body.decision === "approve")
        device.approved = {
          account: selected!.id,
          scopes,
          ...(browser ? { browser } : {}),
          ...(resources ? { resources: [...resources] } : {}),
        };
      else device.declined = true;
      return c.html(
        answeredPage(
          ctx,
          device.name ?? new URL(device.client).host,
          !!device.approved,
        ),
        200,
        {
          "Cache-Control": "no-store",
          "Content-Security-Policy": `${styles}; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
          "Referrer-Policy": "same-origin",
        },
      );
    }
    const redirect = new URL(p.redirect);
    redirect.searchParams.set("state", p.state);
    redirect.searchParams.set("iss", origin);
    if (body.decision === "approve") {
      for (const [id, code] of codes)
        if (code.expires < Date.now()) codes.delete(id);
      if (ctx.overShare(codes.values(), p.client, 500))
        return c.json({ error: "rate_limited" }, 429);
      const code = randomId();
      const browser = ctx.browserOf(c);
      codes.set(tokenHash(code), {
        client: p.client,
        redirect: p.redirect,
        challenge: p.challenge,
        scopes,
        account: selected!.id,
        expires: Date.now() + 60000,
        ...(browser ? { browser } : {}),
        ...(p.dpop ? { dpop: p.dpop } : {}),
        ...(resources ? { resources: [...resources] } : {}),
      });
      redirect.searchParams.set("code", code);
    } else redirect.searchParams.set("error", "access_denied");
    return c.redirect(redirect.toString(), 302);
  });
  return { codes, scopesOf, deviceConsent, styles };
}
export type SignIn = ReturnType<typeof mountSignIn>;

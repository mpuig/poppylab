/**
 * Direct Sign-In (§4.2): Pushed Authorization Requests (RFC 9126, offered,
 * not required), the consent page and the one-time code. The consent page
 * always lists every requested scope, so `prompt=consent` needs nothing more
 * (§4.2, §10.8). The Company chooses which scopes, and which resources such
 * as accounts, an approval grants.
 */
import type { Context, Hono } from "hono";
import { scryptSync, timingSafeEqual } from "node:crypto";
import {
  randomId,
  tokenHash,
  verifyAssertion,
} from "@poppy-lab/pap-client/core";
import { assertionKey, type Ctx } from "./context.ts";
import {
  isChallenge,
  ObjectMap,
  type Code,
  type Consent,
  type Pushed,
} from "./types.ts";

const REQUEST_URI = "urn:ietf:params:oauth:request_uri:";
/** Resources one consent may grant (`selectResources`). */
const MAX_RESOURCES = 100;

export function mountSignIn(app: Hono, ctx: Ctx) {
  const { def, deploy, origin, state, both, isolated, cookiePrefix, secure } =
    ctx;
  // Persisted: a Durable Object may restart while the user reads consent.
  const pending = new ObjectMap<Consent>((state.consents ??= {}));
  const codes = new ObjectMap<Code>((state.codes ??= {}));
  const pushed = new ObjectMap<Pushed>((state.pushed ??= {}));
  let failures = 0,
    windowStart = Date.now();

  /** The authorization request's checks, for a query or a pushed request. */
  async function check(q: Record<string, string | undefined>) {
    const requested = typeof q.scope === "string" ? q.scope.split(" ") : [];
    if (
      !requested.length ||
      requested.some((s) => !both.includes(s)) ||
      new Set(requested).size !== requested.length
    )
      return { error: "invalid_scope" } as const;
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
    // Exact redirect_uri from the client's own metadata (§4.2).
    if (!info.redirects.includes(q.redirect_uri))
      return { error: "invalid_request" } as const;
    return {
      info,
      scopes: both.filter((s) => requested.includes(s)).join(" "),
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
          ctx.replay,
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
    for (const [k, p] of pushed) if (p.expires < Date.now()) pushed.delete(k);
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
    ctx.markDirty();
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

  app.get("/oauth/authorize", async (c) => {
    const q = c.req.query();
    if (!q.request_uri) return consent(c, q);
    // A pushed request: only client_id and request_uri count.
    const p = pushed.get(tokenHash(q.request_uri));
    if (!p || p.expires < Date.now() || p.client !== q.client_id)
      return c.json({ error: "invalid_request_uri" }, 400);
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
      // is saved.
      const page = pending.get(nonce);
      if (
        !page ||
        page.expires < Date.now() ||
        consentCookie(c, nonce) !== nonce
      )
        return c.json({ error: "invalid_request_uri" }, 400);
    } else {
      for (const [id, p] of pending)
        if (p.expires < Date.now()) pending.delete(id);
      if (ctx.overShare(pending.values(), client, 500))
        return c.json({ error: "rate_limited" }, 429);
      ctx.markDirty();
      nonce = randomId();
      pending.set(nonce, {
        client,
        redirect,
        state,
        scopes,
        challenge,
        expires: Date.now() + 300000,
        ...(from?.dpop ? { dpop: from.dpop } : {}),
      });
      // Used from here on: this is the only consent page it will make.
      if (from) from.consent = nonce;
      // Isolated deployments remember which browser approved (website link).
      if (isolated && !ctx.browserOf(c))
        c.header("Set-Cookie", ctx.browserCookie(randomId()), { append: true });
      // One cookie per consent page, so another tab can't replace it.
      c.header(
        "Set-Cookie",
        `${cookiePrefix}pap_consent_${nonce.slice(0, 12)}=${nonce}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}; Max-Age=300`,
        { append: true },
      );
    }
    return c.html(
      def.consent({
        nonce,
        passwordRequired: !!deploy.passwordHash,
        scopes,
        client: info.name,
        clientHost: new URL(client).host,
      }),
      200,
      {
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'${def.fontSources ? ` ${def.fontSources.style}; font-src ${def.fontSources.font}` : ""}; form-action 'self' ${new URL(redirect).origin}; frame-ancestors 'none'; base-uri 'none'`,
        "Referrer-Policy": "same-origin",
      },
    );
  }
  app.post("/oauth/authorize", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    const nonce = String(body.nonce ?? "");
    const p = pending.get(nonce);
    if (
      !p ||
      consentCookie(c, nonce) !== nonce ||
      p.expires < Date.now() ||
      c.req.header("origin") !== origin
    )
      return c.json({ error: "invalid_request" }, 400);
    if (Date.now() - windowStart > 60000) {
      failures = 0;
      windowStart = Date.now();
    }
    if (failures >= 10) return c.json({ error: "rate_limited" }, 429);
    if (body.decision === "approve" && deploy.passwordHash) {
      const [salt, expected] = deploy.passwordHash.split(":");
      const actual = scryptSync(
        String(body.password ?? "").slice(0, 256),
        salt!,
        64,
      );
      if (!timingSafeEqual(actual, Buffer.from(expected!, "hex"))) {
        failures++;
        return c.json({ error: "invalid_credentials" }, 401);
      }
    }
    const selected = def.persona(body.account ?? def.defaultAccount);
    if (body.decision === "approve" && !selected)
      return c.json({ error: "invalid_account" }, 400);
    const requested = p.scopes.split(" ").filter(Boolean);
    const selectedScopes = def.selectScopes
      ? def.selectScopes({ requested, body })
      : requested.filter(
          (scope) => scope !== def.writeScope || body.write === "yes",
        );
    const allowed = new Set(requested);
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
  return { codes };
}

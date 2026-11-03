/** Direct Sign-In (§4.2): the consent page and the one-time code. */
import type { Hono } from "hono";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { randomId, tokenHash } from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import { ObjectMap, type Code, type Consent } from "./types.ts";

export function mountSignIn(app: Hono, ctx: Ctx) {
  const { def, deploy, origin, state, both, isolated, cookiePrefix, secure } =
    ctx;
  // Persisted: a Durable Object may restart while the user reads consent.
  const pending = new ObjectMap<Consent>((state.consents ??= {}));
  const codes = new ObjectMap<Code>((state.codes ??= {}));
  let failures = 0,
    windowStart = Date.now();
  app.get("/oauth/authorize", async (c) => {
    const q = c.req.query();
    const requested = typeof q.scope === "string" ? q.scope.split(" ") : [];
    if (
      !requested.length ||
      requested.some((s) => !both.includes(s)) ||
      new Set(requested).size !== requested.length
    )
      return c.json({ error: "invalid_scope" }, 400);
    const scopes = both.filter((s) => requested.includes(s)).join(" ");
    if (
      q.response_type !== "code" ||
      q.code_challenge_method !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? "") ||
      !/^[A-Za-z0-9_-]{20,100}$/.test(q.state ?? "") ||
      !q.client_id ||
      !q.redirect_uri
    )
      return c.json({ error: "invalid_request" }, 400);
    let info;
    try {
      info = await ctx.client(q.client_id);
    } catch {
      return c.json({ error: "invalid_client" }, 400);
    }
    // Exact redirect_uri from the client's own metadata (§4.2).
    if (!info.redirects.includes(q.redirect_uri))
      return c.json({ error: "invalid_request" }, 400);
    for (const [id, p] of pending)
      if (p.expires < Date.now()) pending.delete(id);
    if (ctx.overShare(pending.values(), q.client_id, 500))
      return c.json({ error: "rate_limited" }, 429);
    ctx.markDirty();
    const nonce = randomId();
    pending.set(nonce, {
      client: q.client_id,
      redirect: q.redirect_uri,
      state: q.state!,
      scopes,
      challenge: q.code_challenge!,
      expires: Date.now() + 300000,
    });
    // Isolated deployments remember which browser approved (website link).
    if (isolated && !ctx.browserOf(c))
      c.header("Set-Cookie", ctx.browserCookie(randomId()), { append: true });
    // One cookie per consent page, so another tab can't replace it.
    c.header(
      "Set-Cookie",
      `${cookiePrefix}pap_consent_${nonce.slice(0, 12)}=${nonce}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}; Max-Age=300`,
      { append: true },
    );
    return c.html(
      def.consent({
        nonce,
        passwordRequired: !!deploy.passwordHash,
        scopes,
        client: info.name,
      }),
      200,
      {
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'${def.fontSources ? ` ${def.fontSources.style}; font-src ${def.fontSources.font}` : ""}; form-action 'self' ${new URL(q.redirect_uri).origin}; frame-ancestors 'none'; base-uri 'none'`,
        "Referrer-Policy": "same-origin",
      },
    );
  });
  app.post("/oauth/authorize", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    const nonce = String(body.nonce ?? "");
    const p = pending.get(nonce);
    const cookie = (c.req.header("cookie") ?? "")
      .split(/;\s*/)
      .find((s) =>
        s.startsWith(`${cookiePrefix}pap_consent_${nonce.slice(0, 12)}=`),
      )
      ?.split("=")[1];
    if (
      !p ||
      cookie !== nonce ||
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
    const scopes = p.scopes
      .split(" ")
      .filter((s) => s !== def.writeScope || body.write === "yes")
      .join(" ");
    if (body.decision === "approve" && !scopes)
      return c.json({ error: "invalid_scope" }, 400);
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
      });
      redirect.searchParams.set("code", code);
    } else redirect.searchParams.set("error", "access_denied");
    return c.redirect(redirect.toString(), 302);
  });
  return { codes };
}

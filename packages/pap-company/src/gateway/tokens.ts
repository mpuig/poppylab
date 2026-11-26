/**
 * The token endpoint (§4.4, §4.7) and revocation (§4.6, RFC 7009). Client
 * assertions may be ES256 or PS384 and last up to 5 minutes (§4.1); refresh
 * tokens are bound to the DPoP key they were issued with (§4.4). A grant
 * keeps the scopes and resources of its consent through every refresh, and
 * ends when its lifetime does (`grantLifetime`): no access token outlives it.
 */
import type { Hono } from "hono";
import {
  randomId,
  tokenHash,
  verifyAssertion,
} from "@poppy-lab/pap-client/core";
import { assertionKey, type Ctx } from "./context.ts";
import {
  GRANT_MS,
  hash,
  isChallenge,
  ObjectMap,
  TOKEN_MS,
  type Code,
  type Grant,
  viewOf,
} from "./types.ts";

/** Token response fields `tokenFields` can't replace (RFC 6749 §5.1, §5.2). */
const STANDARD = new Set([
  "access_token",
  "token_type",
  "expires_in",
  "scope",
  "refresh_token",
  "error",
  "error_description",
  "error_uri",
]);

export function mountTokens(app: Hono, ctx: Ctx, codes: ObjectMap<Code>) {
  const { def, origin, state, replay } = ctx;
  /** The Company's own fields for a grant's token response, string-valued. */
  const extra = (grant: Grant) =>
    Object.fromEntries(
      Object.entries(def.tokenFields?.(viewOf(grant), origin) ?? {}).filter(
        ([name, value]) => !STANDARD.has(name) && typeof value === "string",
      ),
    );
  app.post("/oauth/token", async (c) => {
    let fallback = "invalid_client";
    try {
      const now = Date.now();
      for (const [id, t] of Object.entries(state.tokens))
        if (t.expires < now) delete state.tokens[id];
      for (const [id, g] of Object.entries(state.grants))
        if (g.expires < now) delete state.grants[id];
      const body = (await c.req.parseBody()) as Record<string, string>;
      if (
        !["authorization_code", "refresh_token"].includes(
          body.grant_type ?? "",
        ) ||
        body.client_assertion_type !==
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
      )
        return c.json({ error: "unsupported_grant_type" }, 400);
      await ctx.challengeBeforeConsuming(c);
      const id = String(body.client_id ?? "");
      const info = await ctx.client(id);
      const key = assertionKey(info, String(body.client_assertion ?? ""));
      if (!key) throw new Error("invalid_client");
      await verifyAssertion(
        body.client_assertion!,
        key,
        id,
        id,
        origin,
        replay,
      ).catch(() => {
        throw new Error("invalid_client");
      });
      fallback = "invalid_grant";
      // §4.5: one resource, the domain; naming it gets the default token.
      if (body.resource && body.resource !== origin)
        return c.json({ error: "invalid_target" }, 400);
      // An unknown, expired or another client's refresh token is
      // invalid_grant whatever the DPoP proof (RFC 6749 §5.2); a valid one
      // still needs the key it was bound to, below.
      if (body.grant_type === "refresh_token") {
        const found = state.grants[tokenHash(body.refresh_token ?? "")];
        if (!found || found.client !== id || found.expires < now)
          throw new Error("invalid_grant");
      }
      const binding = await ctx.proofOf(
        c.req.header("dpop") ?? "",
        `${origin}/oauth/token`,
        "POST",
        replay,
        undefined,
        undefined,
        ctx.nonceFor("token"),
      );
      if (ctx.overShare(Object.values(state.tokens), id, 2000))
        throw new Error("rate_limited");
      let refreshToken: string | undefined,
        grantKey: string,
        grant: Grant,
        scopes: string;
      if (body.grant_type === "authorization_code") {
        const code = codes.get(tokenHash(body.code ?? ""));
        codes.delete(tokenHash(body.code ?? ""));
        if (
          !code ||
          code.expires < now ||
          code.client !== id ||
          code.redirect !== body.redirect_uri ||
          !/^[A-Za-z0-9_-]{43,128}$/.test(body.code_verifier ?? "") ||
          hash(body.code_verifier ?? "") !== code.challenge ||
          // RFC 9449 §10: a code pushed with a DPoP proof needs that key.
          (code.dpop !== undefined && code.dpop !== binding)
        )
          throw new Error("invalid_grant");
        if (ctx.overShare(Object.values(state.grants), id, 1000))
          throw new Error("rate_limited");
        // The Company's lifetime for what was granted, else GRANT_MS.
        const lifetime = def.grantLifetime
          ? def.grantLifetime(code.scopes.split(" ").filter(Boolean))
          : GRANT_MS;
        if (!Number.isFinite(lifetime) || lifetime <= 0)
          throw new Error("invalid_grant");
        refreshToken = randomId();
        grantKey = tokenHash(refreshToken);
        grant = {
          account: code.account,
          id: randomId(),
          client: id,
          // What the consent page called the agent, for the website's list.
          name: info.name,
          scopes: code.scopes,
          created: now,
          expires: now + lifetime,
          ...(code.browser ? { browser: code.browser } : {}),
          // §4.4: refreshed only with the DPoP key it was issued with.
          dpop: binding,
          // The consent's resources; a refresh keeps this grant, and them.
          ...(code.resources ? { resources: [...code.resources] } : {}),
        };
        state.grants[grantKey] = grant;
        scopes = grant.scopes;
      } else {
        grantKey = tokenHash(body.refresh_token ?? "");
        const found = state.grants[grantKey];
        if (
          !found ||
          found.client !== id ||
          found.expires < now ||
          (found.dpop !== undefined && found.dpop !== binding)
        )
          throw new Error("invalid_grant");
        grant = found;
        scopes = body.scope ?? grant.scopes;
        const requested = scopes.split(" ");
        if (
          !scopes ||
          new Set(requested).size !== requested.length ||
          requested.some((s) => !grant.scopes.split(" ").includes(s))
        )
          throw new Error("invalid_scope");
      }
      const token = randomId();
      // No access token outlives its grant (`grantLifetime`).
      const expires = Math.min(now + TOKEN_MS, grant.expires);
      state.tokens[tokenHash(token)] = {
        client: id,
        binding,
        expires,
        accountId: grant.account,
        scopes,
        grant: grantKey,
      };
      return c.json(
        {
          // First, so the standard fields below always win (RFC 6749 §5.1).
          ...extra(grant),
          access_token: token,
          token_type: "DPoP",
          expires_in: Math.floor((expires - now) / 1000),
          ...(body.scope && body.scope === scopes ? {} : { scope: scopes }),
          ...(refreshToken ? { refresh_token: refreshToken } : {}),
        },
        200,
        { "Cache-Control": "no-store" },
      );
    } catch (e) {
      if (isChallenge(e))
        return c.json({ error: "use_dpop_nonce" }, 400, {
          "DPoP-Nonce": e.nonce,
        });
      const code =
        e instanceof Error &&
        [
          "invalid_scope",
          "invalid_client",
          "invalid_dpop_proof",
          "rate_limited",
        ].includes(e.message)
          ? e.message
          : fallback;
      if (code === "rate_limited") return c.body(null, 429);
      return c.json({ error: code }, code === "invalid_client" ? 401 : 400, {
        "Cache-Control": "no-store",
      });
    }
  });
  app.post("/oauth/revoke", async (c) => {
    try {
      const body = (await c.req.parseBody()) as Record<string, string>;
      await ctx.challengeBeforeConsuming(c);
      const id = String(body.client_id ?? "");
      const info = await ctx.client(id);
      const key = assertionKey(info, String(body.client_assertion ?? ""));
      if (!key) throw new Error();
      await verifyAssertion(
        body.client_assertion ?? "",
        key,
        id,
        id,
        origin,
        replay,
      );
      const revoked = tokenHash(body.token ?? "");
      if (state.grants[revoked]?.client === id) delete state.grants[revoked];
      // RFC 7009 §2.1: access tokens of a revoked refresh token end too.
      for (const [k, t] of Object.entries(state.tokens))
        if (t.grant === revoked && t.client === id) delete state.tokens[k];
      return c.body(null, 200, { "Cache-Control": "no-store" });
    } catch (e) {
      // Answered as at the token endpoint, so the agent can retry with it.
      if (isChallenge(e))
        return c.json({ error: "use_dpop_nonce" }, 400, {
          "DPoP-Nonce": e.nonce,
        });
      return c.json({ error: "invalid_client" }, 401);
    }
  });
}

/** The token endpoint (§4.4, §4.7) and revocation (§4.6, RFC 7009). */
import type { Hono } from "hono";
import {
  decodeProtectedHeader,
  randomId,
  tokenHash,
  verifyAssertion,
} from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import {
  GRANT_MS,
  hash,
  isChallenge,
  ObjectMap,
  TOKEN_MS,
  type Code,
  type Grant,
} from "./types.ts";

export function mountTokens(app: Hono, ctx: Ctx, codes: ObjectMap<Code>) {
  const { origin, state, replay } = ctx;
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
      const kid = decodeProtectedHeader(
        String(body.client_assertion ?? ""),
      ).kid;
      const key = info.keys.find((k) => k.kid === kid) ?? info.keys[0];
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
      if (body.resource) return c.json({ error: "invalid_target" }, 400);
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
          hash(body.code_verifier ?? "") !== code.challenge
        )
          throw new Error("invalid_grant");
        if (ctx.overShare(Object.values(state.grants), id, 1000))
          throw new Error("rate_limited");
        refreshToken = randomId();
        grantKey = tokenHash(refreshToken);
        grant = {
          account: code.account,
          id: randomId(),
          client: id,
          scopes: code.scopes,
          expires: now + GRANT_MS,
          ...(code.browser ? { browser: code.browser } : {}),
        };
        state.grants[grantKey] = grant;
        scopes = grant.scopes;
      } else {
        grantKey = tokenHash(body.refresh_token ?? "");
        const found = state.grants[grantKey];
        if (!found || found.client !== id || found.expires < now)
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
      state.tokens[tokenHash(token)] = {
        client: id,
        binding,
        expires: now + TOKEN_MS,
        operations: info.operations,
        accountId: grant.account,
        scopes,
        grant: grantKey,
      };
      return c.json(
        {
          access_token: token,
          token_type: "DPoP",
          expires_in: TOKEN_MS / 1000,
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
      const kid = decodeProtectedHeader(
        String(body.client_assertion ?? ""),
      ).kid;
      const key = info.keys.find((k) => k.kid === kid) ?? info.keys[0];
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
    } catch {
      return c.json({ error: "invalid_client" }, 401);
    }
  });
}

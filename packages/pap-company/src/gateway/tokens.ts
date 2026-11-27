/**
 * The token endpoint (§4.4, §4.7), for Direct Sign-In's codes, Device
 * Sign-In's polls (§4.3) and refreshes, and revocation (§4.6, RFC 7009). Client
 * assertions may be ES256 or PS384 and last up to 5 minutes (§4.1); refresh
 * tokens are bound to the DPoP key they were issued with (§4.4). A grant
 * keeps the scopes and resources of its consent through every refresh, and
 * ends when its lifetime does (`grantLifetime`): no access token outlives it.
 * A token request may name a `resource` (§4.5, RFC 8707): the domain, for
 * the default token, or the MCP server, for a token that works only there.
 * Every token is DPoP-bound, except one for the MCP server requested without
 * a proof: that is a Bearer token, and so is every token its grant gets.
 */
import type { Hono } from "hono";
import {
  randomId,
  tokenHash,
  verifyAssertion,
} from "@poppy-lab/pap-client/core";
import { assertionKey, type Ctx } from "./context.ts";
import {
  DEVICE_GRANT,
  GRANT_MS,
  hash,
  isChallenge,
  ObjectMap,
  TOKEN_MS,
  type Code,
  type DeviceRequest,
  type Grant,
  viewOf,
} from "./types.ts";

/** What a consent page approved: a code's, or a device request's (§4.3). */
type Approved = {
  account: string;
  scopes: string;
  browser?: string;
  resources?: string[];
};

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
  const { def, origin, state, replay, mcp } = ctx;
  const devices = new ObjectMap<DeviceRequest>((state.devices ??= {}));
  /** The Company's own fields for a grant's token response, string-valued. */
  const extra = (grant: Grant) =>
    Object.fromEntries(
      Object.entries(def.tokenFields?.(viewOf(grant), origin) ?? {}).filter(
        ([name, value]) => !STANDARD.has(name) && typeof value === "string",
      ),
    );
  app.post("/oauth/token", async (c) => {
    /** A poll's answer while no tokens are issued (RFC 8628 §3.5). */
    const polled = (
      error:
        | "authorization_pending"
        | "slow_down"
        | "access_denied"
        | "expired_token",
    ) => c.json({ error }, 400, { "Cache-Control": "no-store" });
    let fallback = "invalid_client";
    try {
      const now = Date.now();
      for (const [id, t] of Object.entries(state.tokens))
        if (t.expires < now) delete state.tokens[id];
      for (const [id, g] of Object.entries(state.grants))
        if (g.expires < now) delete state.grants[id];
      const body = (await c.req.parseBody()) as Record<string, string>;
      if (
        ![
          "authorization_code",
          "refresh_token",
          ...(def.deviceSignIn === false ? [] : [DEVICE_GRANT]),
        ].includes(body.grant_type ?? "") ||
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
      // §4.5: the domain, whose naming gets the default token, and the MCP
      // server when there is one, whose token works only there (section 7).
      // A sign-in names no resource, so every grant covers both.
      if (body.resource && body.resource !== origin && body.resource !== mcp)
        return c.json({ error: "invalid_target" }, 400);
      const resource = body.resource && body.resource === mcp ? mcp : undefined;
      // An unknown, expired or another client's refresh token is
      // invalid_grant whatever the DPoP proof (RFC 6749 §5.2); a valid one
      // still needs the key it was bound to, below.
      if (body.grant_type === "refresh_token") {
        const found = state.grants[tokenHash(body.refresh_token ?? "")];
        if (!found || found.client !== id || found.expires < now)
          throw new Error("invalid_grant");
      }
      // §4.5, section 7: a token for the MCP server may be a Bearer token,
      // for MCP clients without DPoP. Every other one needs the proof.
      const binding =
        c.req.header("dpop") || !resource
          ? await ctx.proofOf(
              c.req.header("dpop") ?? "",
              `${origin}/oauth/token`,
              "POST",
              replay,
              undefined,
              undefined,
              ctx.nonceFor("token"),
            )
          : undefined;
      if (ctx.overShare(Object.values(state.tokens), id, 2000))
        throw new Error("rate_limited");
      let refreshToken: string | undefined,
        grantKey: string,
        grant: Grant,
        scopes: string;
      /** What a consent page approved, for a new grant. */
      let approved: Approved | undefined;
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
        approved = code;
      } else if (body.grant_type === DEVICE_GRANT) {
        // §4.3, RFC 8628 §3.5: each poll says where the request stands.
        const key = tokenHash(body.device_code ?? "");
        const device = devices.get(key);
        if (!device || device.client !== id) throw new Error("invalid_grant");
        if (device.declined) return polled("access_denied");
        if (device.expires < now) return polled("expired_token");
        // Bound to one key from the first poll on, if not from the start.
        if (binding) device.dpop ??= binding;
        if (device.dpop !== binding) throw new Error("invalid_grant");
        if (!device.approved) {
          // A second of grace, for polls that a slow network bunches up.
          const early =
            device.polled !== undefined &&
            now - device.polled < device.interval * 1000 - 1000;
          device.polled = now;
          if (!early) return polled("authorization_pending");
          device.interval += 5;
          return polled("slow_down");
        }
        // Its tokens are issued once.
        devices.delete(key);
        approved = device.approved;
      }
      if (approved) {
        if (ctx.overShare(Object.values(state.grants), id, 1000))
          throw new Error("rate_limited");
        // The Company's lifetime for what was granted, else GRANT_MS.
        const lifetime = def.grantLifetime
          ? def.grantLifetime(approved.scopes.split(" ").filter(Boolean))
          : GRANT_MS;
        if (!Number.isFinite(lifetime) || lifetime <= 0)
          throw new Error("invalid_grant");
        refreshToken = randomId();
        grantKey = tokenHash(refreshToken);
        grant = {
          account: approved.account,
          id: randomId(),
          client: id,
          // What the consent page called the agent, for the website's list.
          name: info.name,
          scopes: approved.scopes,
          created: now,
          expires: now + lifetime,
          ...(approved.browser ? { browser: approved.browser } : {}),
          // §4.4: refreshed only with the DPoP key it was issued with, or,
          // issued without one, only to Bearer tokens for the MCP server.
          ...(binding ? { dpop: binding } : { bearer: true as const }),
          // The consent's resources; a refresh keeps this grant, and them.
          ...(approved.resources ? { resources: [...approved.resources] } : {}),
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
          (found.dpop !== undefined && found.dpop !== binding) ||
          // A refresh keeps the token type the grant was issued with.
          (!found.bearer && !binding) ||
          (found.bearer && !resource)
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
      // A Bearer grant's proof, if a refresh sends one, binds nothing.
      const bound = grant.bearer ? undefined : binding;
      state.tokens[tokenHash(token)] = {
        client: id,
        ...(bound ? { binding: bound } : {}),
        expires,
        accountId: grant.account,
        scopes,
        grant: grantKey,
        ...(resource ? { resource } : {}),
      };
      return c.json(
        {
          // First, so the standard fields below always win (RFC 6749 §5.1).
          ...extra(grant),
          access_token: token,
          token_type: bound ? "DPoP" : "Bearer",
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

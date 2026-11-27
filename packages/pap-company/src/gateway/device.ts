/**
 * Device Sign-In (§4.3, RFC 8628): the device authorization endpoint and
 * the verification page where a person enters the code. The consent page
 * and its answer are Direct Sign-In's (`signin.ts`); the token endpoint
 * issues the tokens (`tokens.ts`). It follows RFC 10027 §6.1: codes last
 * ten minutes and work once, wrong codes are limited, and the consent page
 * says what allowing does and to decline a code the person didn't ask for.
 */
import type { Context, Hono } from "hono";
import { randomInt } from "node:crypto";
import {
  randomId,
  tokenHash,
  verifyAssertion,
} from "@poppy-lab/pap-client/core";
import { assertionKey, attemptLimit, type Ctx } from "./context.ts";
import {
  CODE_LENGTH,
  CODE_LETTERS,
  entryPage,
  formatCode,
  normalizeCode,
  type EntryProblem,
} from "./device-pages.ts";
import type { SignIn } from "./signin.ts";
import { isChallenge, ObjectMap, type DeviceRequest } from "./types.ts";

/** Where a person enters the code (`verification_uri`). */
export const DEVICE_PAGE = "/device";
/** The device authorization endpoint. */
export const DEVICE_ENDPOINT = "/oauth/device";
/** RFC 10027 §6.1.4: a short life. */
export const DEVICE_MS = 600000;
/** Seconds between polls when the request starts. */
const INTERVAL = 5;
/**
 * How long an ended request is kept, so its polls get `expired_token`
 * rather than `invalid_grant`.
 */
const KEPT_MS = 600000;
/**
 * Wrong codes from one source in `WINDOW_MS`, and from everyone in a
 * minute: a backstop far above what one source may send.
 */
const WRONG_PER_SOURCE = 10,
  WRONG_IN_ALL = 1000,
  WINDOW_MS = 600000;

export function mountDevice(app: Hono, ctx: Ctx, signIn: SignIn) {
  const { origin, state } = ctx;
  const devices = new ObjectMap<DeviceRequest>((state.devices ??= {}));
  const prune = () => {
    for (const [k, d] of devices)
      if (d.expires + KEPT_MS < Date.now()) devices.delete(k);
  };
  const live = (d: DeviceRequest) =>
    d.expires >= Date.now() && !d.approved && !d.declined;

  app.post(DEVICE_ENDPOINT, async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    const id = String(body.client_id ?? "");
    try {
      await ctx.challengeBeforeConsuming(c);
      if (
        body.client_assertion_type !==
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
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
    const scopes = signIn.scopesOf(body.scope);
    if (!scopes) return c.json({ error: "invalid_scope" }, 400);
    // §4.5: one resource, the domain, as at the token endpoint.
    if (body.resource && body.resource !== origin)
      return c.json({ error: "invalid_target" }, 400);
    // A proof here binds the tokens to its key, as a pushed request's does.
    let dpop: string | undefined;
    if (c.req.header("dpop"))
      try {
        dpop = await ctx.proofOf(
          c.req.header("dpop")!,
          `${origin}${DEVICE_ENDPOINT}`,
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
    prune();
    if (ctx.overShare(devices.values(), id, 500))
      return c.json({ error: "rate_limited" }, 429);
    // Unique among the requests kept, so a code names one request.
    const taken = new Set(devices.values().map((d) => d.userCode));
    let userCode: string;
    do
      userCode = Array.from(
        { length: CODE_LENGTH },
        () => CODE_LETTERS[randomInt(CODE_LETTERS.length)],
      ).join("");
    while (taken.has(userCode));
    const deviceCode = randomId();
    devices.set(tokenHash(deviceCode), {
      client: id,
      scopes,
      userCode,
      expires: Date.now() + DEVICE_MS,
      interval: INTERVAL,
      ...(dpop ? { dpop } : {}),
    });
    ctx.markDirty(c.req.raw);
    const page = `${origin}${DEVICE_PAGE}`;
    return c.json(
      {
        device_code: deviceCode,
        user_code: formatCode(userCode),
        verification_uri: page,
        verification_uri_complete: `${page}?user_code=${formatCode(userCode)}`,
        expires_in: DEVICE_MS / 1000,
        interval: INTERVAL,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  const pageHeaders = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": `${signIn.styles}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    // The link's code stays on this site.
    "Referrer-Policy": "same-origin",
  };
  const entry = (
    c: Context,
    status: 200 | 400 | 429 | 503,
    input: { code?: string; problem?: EntryProblem },
  ) => c.html(entryPage(ctx, input), status, pageHeaders);

  // Opening the page, with or without the code in its link, changes
  // nothing and approves nothing (§4.3).
  app.get(DEVICE_PAGE, (c) =>
    entry(c, 200, { code: normalizeCode(c.req.query("user_code") ?? "") }),
  );

  /** Wrong codes, by where they come from (`sourceOf`). */
  const wrong = attemptLimit(WRONG_PER_SOURCE, WINDOW_MS, WRONG_IN_ALL);

  app.post(DEVICE_PAGE, async (c) => {
    // Only this page's own form: another site can't send a code in.
    if (c.req.header("origin") !== origin)
      return c.json({ error: "invalid_request" }, 400);
    const body = (await c.req.parseBody()) as Record<string, string>;
    const source = ctx.sourceOf(c) ?? "unknown";
    if (wrong.blocked(source)) return entry(c, 429, { problem: "too_many" });
    const entered = normalizeCode(String(body.user_code ?? ""));
    prune();
    const found = entered
      ? [...devices].find(([, d]) => d.userCode === entered && live(d))
      : undefined;
    if (!found) {
      wrong.count(source);
      // Kept in the field, so a typo can be corrected.
      return entry(c, 400, {
        ...(entered ? { code: entered } : {}),
        problem: "unknown",
      });
    }
    const [key, device] = found;
    let info;
    try {
      info = await ctx.client(device.client);
    } catch {
      return entry(c, 503, { code: entered, problem: "unreachable" });
    }
    // It may have ended, or been answered, while the client was fetched.
    if (devices.get(key) !== device || !live(device))
      return entry(c, 400, { problem: "unknown" });
    device.name = info.name;
    return signIn.deviceConsent(c, key, device, info);
  });
}

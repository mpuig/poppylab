/**
 * Request bounds, single-writer persistence and the security headers every
 * response carries.
 */
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Ctx } from "./context.ts";
import type { Changes } from "./types.ts";

const securityHeaders = (formTargets: string[]) => ({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${formTargets.join(" ")}`.trim(),
});

export function mountPersistence(app: Hono, ctx: Ctx) {
  const { state, store, replay, flags, deploy } = ctx;
  // Counted on the stream, so a chunked body can't skip the limit. First,
  // because it may replace c.req.raw, which later middleware keys on.
  app.use(
    "*",
    bodyLimit({
      maxSize: 16384,
      onError: (c) => c.json({ error: "request_too_large" }, 413),
    }),
  );
  /**
   * Save only when state may have changed: any non-GET, any request with a
   * Session header (sessions, replays), or a path that marked itself dirty
   * (consent pages, tenant creation and eviction, grant links). Website polls
   * and discovery reads then cost no storage write.
   */
  app.use("*", async (c, next) => {
    if (flags.failed)
      return c.json({ error: "storage_unavailable_restart_required" }, 503, {
        "Retry-After": "60",
      });
    flags.dirty = c.req.method !== "GET" || !!c.req.header("poppy-session");
    await next();
    if (flags.dirty || ctx.removed.length) {
      state.replays = replay.snapshot();
      const touched = ctx.tenantsTouched.get(c.req.raw);
      const changes: Changes = {
        tenants: touched ? [touched] : [],
        removed: ctx.removed.splice(0),
      };
      try {
        await store.save(changes);
      } catch {
        flags.failed = true;
        c.res = c.json({ error: "storage_unavailable_restart_required" }, 503);
      }
    }
    const formTargets = new Set<string>();
    for (const client of deploy.httpClients ?? [])
      formTargets.add(new URL(client).origin);
    for (const [k, v] of Object.entries(securityHeaders([...formTargets])))
      if (!c.res.headers.has(k)) c.res.headers.set(k, v);
    if (c.res.status === 429 && !c.res.headers.has("Retry-After"))
      c.res.headers.set("Retry-After", "60");
  });
}

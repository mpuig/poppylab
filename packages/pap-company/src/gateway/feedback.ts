/**
 * §9.3 feedback: `POST /poppy/feedback` with the Session header (verified by
 * the Session middleware, so a report is attributed) and no scope. The body
 * is `{task, description}`; the Company answers 202, or 200 with an
 * alternative (§9.2) when the Company's `feedback` hook knows one.
 *
 * A report is data, never instructions: it's matched by the Company's own
 * code (no model) and kept in a bounded list in the caller's tenant, so a
 * public visitor's text is never shown to anyone else.
 */
import type { Context, Hono } from "hono";
import type { Ctx } from "./context.ts";
import type { Tenancy } from "./tenancy.ts";

export const FEEDBACK_PATH = "/poppy/feedback";
const KEEP = 50;
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined;

export function mountFeedback(app: Hono, ctx: Ctx, tenancy: Tenancy) {
  const { def } = ctx;
  app.post(FEEDBACK_PATH, async (c: Context) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const task = text(body?.task, 200);
    const description = text(body?.description, 2000);
    if (!task || !description) return c.json({ error: "invalid_request" }, 400);
    const s = ctx.sessionFor(c);
    const tenant = tenancy.enter(c.req.raw).tenant;
    const reports = (tenant.feedback ??= []);
    reports.push({
      task,
      description,
      client: s.client,
      user: s.user,
      at: new Date().toISOString(),
    });
    if (reports.length > KEEP) reports.splice(0, reports.length - KEEP);
    const alternative = def.feedback?.({ task, description }, ctx.origin);
    if (alternative) return c.json(alternative, 200);
    return c.body(null, 202);
  });
}

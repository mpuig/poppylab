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
import type { FeedbackReport } from "./types.ts";

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
    const alternative = def.feedback?.({ task, description }, ctx.origin);
    const reports = (tenant.feedback ??= []);
    reports.push({
      task,
      description,
      client: s.client,
      user: s.user,
      at: new Date().toISOString(),
      answer: alternative ? "alternative" : "accepted",
    });
    if (reports.length > KEEP) reports.splice(0, reports.length - KEEP);
    if (alternative) return c.json(alternative, 200);
    return c.body(null, 202);
  });
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const agentHost = (client: string) => {
  try {
    return new URL(client).host;
  } catch {
    return "an unknown agent";
  }
};

/**
 * A Company website's "Feedback from agents" section: this tenant's reports,
 * newest first, every value escaped. Report text is shown as data. `classes`
 * lets each website use its own section and note styles.
 */
export function feedbackSection(
  reports: readonly FeedbackReport[],
  classes: { section?: string; notice?: string } = {},
): string {
  const notice = classes.notice ? ` class="${classes.notice}"` : "";
  const items = [...reports]
    .reverse()
    .map(
      (r) =>
        `<li class="feedback-report"><p class="feedback-task"><strong>${escapeHtml(r.task)}</strong></p><p>${escapeHtml(r.description)}</p><p${notice}>From ${escapeHtml(agentHost(r.client))} · <time datetime="${escapeHtml(r.at)}">${escapeHtml(r.at.slice(0, 16).replace("T", " "))} UTC</time> · ${r.answer === "alternative" ? "We answered with another way to do it" : "Received, no alternative offered"}</p></li>`,
    )
    .join("");
  return `<section${classes.section ? ` class="${classes.section}"` : ""} id="agent-feedback"><h2>Feedback from agents</h2><p${notice}>Tasks your agent couldn't do here and reported to us (Poppy §9.3). Reports describe the task, not you; their text is shown as written. Reload the page to see new ones.</p>${items ? `<ol class="feedback-list">${items}</ol>` : `<p${notice}>No reports yet. Ask your agent for something we don't offer through Poppy, such as paying with a gift card.</p>`}</section>`;
}

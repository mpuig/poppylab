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

/**
 * §9.3 as a link into the published text, opening in a new tab. Written out
 * here because this package does not depend on pap-core, where the other
 * section links live; a test in the playground checks the heading exists.
 */
const FEEDBACK_SECTION =
  '<a href="https://personalagentprotocol.org/docs/1.0/spec#feedback" target="_blank" rel="noopener noreferrer">§9.3</a>';

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
/** "Nov 25, 09:14 UTC": the same for every viewer. */
export const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(d)} UTC`;
};
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
 * lets each website use its own section and note styles, and `example`
 * names a task that fits the Company for the empty state.
 */
export function feedbackSection(
  reports: readonly FeedbackReport[],
  classes: {
    section?: string;
    notice?: string;
    /** A task this Company doesn't offer, for the empty state. */
    example?: string;
  } = {},
): string {
  const notice = classes.notice ? ` class="${classes.notice}"` : "";
  const items = [...reports]
    .reverse()
    .map((r) => {
      const offered = r.answer === "alternative";
      return `<li class="record" data-tone="${offered ? "info" : "muted"}"><div class="record-head"><span class="record-tag">${offered ? "Alternative offered" : "Received"}</span><time class="record-when" datetime="${escapeHtml(r.at)}">${escapeHtml(when(r.at))}</time></div><p class="record-title">${escapeHtml(r.task)}</p><p class="record-body">${escapeHtml(r.description)}</p><p class="record-meta">From ${escapeHtml(agentHost(r.client))}</p></li>`;
    })
    .join("");
  return `<section${classes.section ? ` class="${classes.section}"` : ""} id="agent-feedback"><h2>Feedback from agents</h2><p${notice}>Tasks your agent couldn't do here and reported to us (Poppy ${FEEDBACK_SECTION}). Reports describe the task, not you; their text is shown as written. Reload the page to see new ones.</p>${items ? `<ol class="records">${items}</ol>` : `<p${notice}>No reports yet. Ask your agent for something we don't offer through Poppy, such as ${escapeHtml(classes.example ?? "a task this Company doesn't handle")}.</p>`}</section>`;
}

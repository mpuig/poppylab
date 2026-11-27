/**
 * The pages and words of Device Sign-In (§4.3) that a person sees: where
 * they enter the code, what the consent page adds, and what the answer did.
 * The same words at every Company. Each page wears the Company's frame,
 * the one its consent pages have, so the code is entered on a page that
 * looks like the Company's own.
 */
import type { Ctx } from "./context.ts";

/**
 * The letters of a `user_code` (RFC 8628 §6.1): consonants only, so no code
 * spells a word, and none that is read as another, such as 0 and O.
 */
export const CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
export const CODE_LENGTH = 8;

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * A code as typed, in the stored form: capitals, without the dash, spaces
 * or anything else between the letters. Empty when it can't be a code.
 */
export function normalizeCode(typed: string) {
  const letters = typed
    .slice(0, 64)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return letters.length === CODE_LENGTH &&
    [...letters].every((l) => CODE_LETTERS.includes(l))
    ? letters
    : "";
}
/** A stored code as people read it: two groups of four, "WDJB-MJHT". */
export const formatCode = (code: string) =>
  `${code.slice(0, 4)}-${code.slice(4)}`;

/**
 * A page of this sign-in in the Company's own frame. The frame comes from
 * the page a Company shows for a consent page that ran out, with this
 * `<main>` in the sheet's place, so every Company has it without wiring
 * anything more. A Company without that page gets a plain one.
 */
export function signInPage(ctx: Ctx, title: string, main: string) {
  const page = ctx.def.consentExpired?.("reopened");
  const sheet = /<main class="sheet">[\s\S]*<\/main>/;
  if (page && sheet.test(page))
    return page
      .replace(sheet, () => main)
      .replace(/<title>[^<·]*/, () => `<title>${escapeHtml(title)} `);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · ${escapeHtml(ctx.def.name)}</title><style>body{margin:0;font:16px/1.5 system-ui,sans-serif}.sheet{max-width:40rem;margin:10vh auto;padding:0 1.25rem}</style></head><body>${main}</body></html>`;
}

/** What the code entry page says when the code wasn't taken. */
export type EntryProblem = "unknown" | "too_many" | "unreachable";

/**
 * The verification page (`verification_uri`): one field and a button.
 * Opening it changes nothing, with or without a code in its link (§4.3):
 * the code is checked when the person continues, and then the consent
 * page asks.
 */
export function entryPage(
  ctx: Ctx,
  input: { code?: string; problem?: EntryProblem },
) {
  const company = escapeHtml(ctx.def.name);
  const problems: Record<EntryProblem, string> = {
    unknown: `${company} isn&#39;t waiting for that code. Check it against the code your agent shows. A code works once, for ten minutes; if yours is older, start the sign-in again in your agent.`,
    too_many: `Too many codes that didn&#39;t match were entered here, so ${company} has stopped checking them for a while. Nothing has changed. Wait ten minutes, then enter the code again.`,
    unreachable: `${company} couldn&#39;t reach the agent that asked for this code, so there is nothing to show you yet. Nothing has changed. Try again in a minute.`,
  };
  const lead = input.code
    ? "Check that this code is the one your agent shows, then continue."
    : "Enter the code your agent shows you. It has eight letters and works for ten minutes.";
  const main = `<main class="sheet"><div class="sheet-head"><h1>Connect an agent to your ${company} account</h1><p class="sheet-lead">${lead}</p></div><form class="sheet-entry" method="post" action="/device">${input.problem ? `<p class="sheet-error" role="alert">${problems[input.problem]}</p>` : ""}<div class="sheet-field"><label for="user_code">Code</label><input id="user_code" name="user_code" value="${escapeHtml(input.code ? formatCode(input.code) : "")}" required maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="user-code-note"></div><p id="user-code-note" class="sheet-note">Enter a code only if you asked an agent to sign in to ${company} yourself. If someone sent you a code, close this page. Continuing allows nothing: the next page shows what the agent asks for, and you choose.</p><div class="sheet-actions"><button>Continue</button></div></form></main>`;
  return signInPage(ctx, "Enter your code", main);
}

/**
 * What the consent page adds for Device Sign-In, above its form: the
 * Company's name and domain, the code to compare, what allowing does and
 * when not to (RFC 10027 §6.1).
 */
export function deviceNotice(ctx: Ctx, code: string, agent: string) {
  const company = escapeHtml(ctx.def.name),
    name = escapeHtml(agent);
  return `<section class="sheet-device" aria-label="Signing in on another device"><p>You are signing in to <strong>${company}</strong> at <strong>${escapeHtml(new URL(ctx.origin).host)}</strong> with the code <strong class="sheet-code">${formatCode(code)}</strong>.</p><p>Allowing signs ${name} in on the device where the sign-in started, not in this browser. Allow only if you asked ${name} to sign in yourself and it shows this same code. If someone sent you this code or its link, choose Don&#39;t allow.</p></section>`;
}

/** The page after the consent page's answer, in place of a redirect. */
export function answeredPage(ctx: Ctx, agent: string, approved: boolean) {
  const company = escapeHtml(ctx.def.name),
    name = escapeHtml(agent);
  const main = approved
    ? `<main class="sheet"><div class="sheet-head"><h1>You allowed ${name}</h1></div><div class="sheet-expired"><p>${name} finishes signing in to your ${company} account on the device where you started, within a few seconds.</p><p>You can close this page.</p></div></main>`
    : `<main class="sheet"><div class="sheet-head"><h1>Nothing was allowed</h1></div><div class="sheet-expired"><p>${name} is told that you declined, and nothing has changed at ${company}.</p><p>You can close this page.</p></div></main>`;
  return signInPage(
    ctx,
    approved ? `${agent} allowed` : "Nothing was allowed",
    main,
  );
}

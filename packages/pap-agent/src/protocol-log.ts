import { apiSection } from "./spec-sections";

/** How an exchange ended, as far as its own words say. */
export type ProtocolOutcome = "ok" | "error" | "refused" | "waiting" | "info";

/**
 * One exchange in the session, stamped when the page received it, or when
 * the server kept it if the page was loaded since (`inspector-log.ts`).
 */
export type ProtocolEntry = {
  at: number;
  /** The spec section it meets; empty when none is known. */
  section: string;
  method?: string;
  /** Origin and path only: never a query string or fragment. */
  url?: string;
  text: string;
  outcome: ProtocolOutcome;
};

const request = /^(GET|POST|PUT|PATCH|DELETE|HEAD) (\S+)/;

/** An address without its query or fragment, which can carry tokens. */
function bareUrl(value: string) {
  return value.replace(/[?#].*$/, "");
}

/**
 * The line for a request the Company answered with an error: its status and
 * its error code (the protocol's, or one short token of the Company's own),
 * never its words, its body or a header. Below 500 the Company refused the
 * request; from 500 on, the request failed.
 */
export function refusedLine(
  method: string,
  path: string,
  status: number,
  code?: string,
) {
  return `${method} ${path} · ${status < 500 ? "refused by the Company" : "request failed"} · HTTP ${status}${code ? ` ${code}` : ""}`;
}

/**
 * A number the Company put in its refusal under a key we know, in our own
 * words: the balance available, or a limit, in cents (Harborline's
 * `insufficient_funds` and `recipient_limit_exceeded`). Only a whole number
 * under such a key is shown, never the Company's free text. It is written
 * as money when the same answer names its currency as a three-letter code;
 * without one the number stands alone, since no currency is assumed. The
 * chat's error and the approval card both say a refusal with these.
 */
export function refusalFacts(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const from = body as Record<string, unknown>;
  const currency =
    typeof from.currency === "string" && /^[A-Z]{3}$/.test(from.currency)
      ? from.currency
      : undefined;
  return (
    [
      ["available_cents", "available balance"],
      ["limit_cents", "limit"],
    ] as const
  ).flatMap(([key, label]) => {
    const cents = from[key];
    return typeof cents === "number" &&
      Number.isSafeInteger(cents) &&
      cents >= 0 &&
      cents <= 1e13
      ? [
          `${label}: ${(cents / 100).toLocaleString("en-US", {
            ...(currency ? { style: "currency", currency } : {}),
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`,
        ]
      : [];
  });
}

function outcomeOf(text: string): ProtocolOutcome {
  // Iris stopped before asking: nothing happened, whatever the address
  // it names says.
  if (/^Not sent\b/.test(text)) return "info";
  // A refusal (`refusedLine`), whatever words its error code is made of:
  // `payment_failed` is still the Company saying no.
  if (/^ · refused by the Company\b/.test(text)) return "refused";
  if (/approval required/i.test(text)) return "waiting";
  // The User's own revocation went through: done, not declined.
  if (/consent revoked/i.test(text)) return "ok";
  if (/declin|refus|revoked/i.test(text)) return "refused";
  if (/fail|error|could not|unavailable|unknown/i.test(text)) return "error";
  if (/complet|succeed|started|loaded|signed in/i.test(text)) return "ok";
  return "info";
}

/** Turns a trace line the server wrote into an entry. */
export function logEntry(line: string, at = Date.now()): ProtocolEntry {
  const text = line.replace(/([/\w.-])[?#]\S*/g, "$1");
  const match = request.exec(text);
  // The outcome comes from the event's own words: an address such as
  // /payments/failed says nothing about how the request went.
  const words = match ? text.slice(match[0].length) : text;
  return {
    at,
    section: apiSection(text),
    ...(match ? { method: match[1], url: bareUrl(match[2] ?? "") } : {}),
    text,
    outcome: outcomeOf(words),
  };
}

export const outcomeLabel: Record<ProtocolOutcome, string> = {
  ok: "OK",
  error: "Error",
  refused: "Declined",
  waiting: "Needs you",
  info: "Note",
};

/** "14:05:09.123": a protocol log needs seconds. */
export function clock(at: number) {
  const d = new Date(at);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** A file name for a download: the Company's host and the date. */
export function traceFileName(company: string, at = new Date()) {
  const host = company
    .replace(/^https?:\/\//, "")
    .replace(/[^A-Za-z0-9.-]+/g, "-")
    .replace(/^-|-$/g, "");
  return `poppy-trace-${host || "company"}-${at.toISOString().slice(0, 10)}.txt`;
}

import { apiSection } from "./spec-sections";

/** How an exchange ended, as far as its own words say. */
export type ProtocolOutcome = "ok" | "error" | "refused" | "waiting" | "info";

/** One exchange in the session, stamped when the page received it. */
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

function outcomeOf(text: string): ProtocolOutcome {
  if (/approval required/i.test(text)) return "waiting";
  if (/declin|refus|revoked|signed out/i.test(text)) return "refused";
  if (/fail|error|could not|unavailable|unknown/i.test(text)) return "error";
  if (/complet|succeed|started|loaded|signed\b/i.test(text)) return "ok";
  return "info";
}

/** Turns a trace line the server wrote into an entry. */
export function logEntry(line: string, at = Date.now()): ProtocolEntry {
  const text = line.replace(/([/\w.-])[?#]\S*/g, "$1");
  const match = request.exec(text);
  return {
    at,
    section: apiSection(text),
    ...(match ? { method: match[1], url: bareUrl(match[2] ?? "") } : {}),
    text,
    outcome: outcomeOf(text),
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

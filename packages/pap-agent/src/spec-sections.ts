import type { ProtocolEntry } from "./protocol-log";

/**
 * The PAP 1.0 section each inspector step meets, so a trace reads against
 * the spec. Labels, never claims of conformance.
 */
const discovery: Record<string, string> = {
  poppy: "§3",
  domain: "§3",
  extension: "§3.3",
  link: "§3",
  resource: "§3.2",
  issuer: "§3.2",
  metadata: "§3.2",
};
export const discoverySection = (id: string) => discovery[id] ?? "";

const api: Array<[RegExp, string]> = [
  [/Conversation operation/i, "§8.4 · Operations §4"],
  [/approval required|Poppy-Approval/i, "Operations §4–6"],
  [/Conversation authorization/i, "§8.11"],
  [/Conversation handoff/i, "§8.9"],
  [/Conversation state/i, "§8.7"],
  [/Company Agent conversations/i, "§8.1"],
  [/Conversation (started|message)/i, "§8.3"],
  [/tasks for this Session|Tasks unavailable|excluded tasks/i, "§9"],
  // A feedback report (`feedbackTool`), not a request to one of its APIs.
  [/ · feedback · /, "§9.3"],
  [/^(GET|POST|PUT|PATCH|DELETE) |API tools|OpenAPI/i, "§7"],
  [/MCP/, "§7"],
  [/Session header|Poppy Session|Session (signed|started)/i, "§5.2"],
  [/sign(ed)? ?in|consent/i, "§4.2"],
];
export function apiSection(event: string) {
  return api.find(([pattern]) => pattern.test(event))?.[1] ?? "";
}

/** A plain-text trace for an interoperability report, oldest first, in UTC. Holds no secrets. */
export function traceReport(input: {
  company: string;
  steps: Array<{
    id: string;
    label: string;
    detail: string;
    status: string;
    durationMs?: number | undefined;
  }>;
  events: ProtocolEntry[];
  at?: Date;
}) {
  const lines = [
    `Poppy Lab trace · Poppy 1.0 · ${input.company}`,
    `Recorded ${(input.at ?? new Date()).toISOString()}`,
    "",
    "Discovery",
    ...input.steps.map(
      (s) =>
        `- [${s.status}] ${s.label}${discoverySection(s.id) ? ` (${discoverySection(s.id)})` : ""}: ${s.detail}${s.durationMs !== undefined ? ` · ${s.durationMs} ms` : ""}`,
    ),
  ];
  if (input.events.length)
    lines.push(
      "",
      "Session and API calls",
      ...input.events.map(
        (e) =>
          `- ${new Date(e.at).toISOString()}${e.section ? ` (${e.section})` : ""} ${e.text} [${e.outcome}]`,
      ),
    );
  lines.push(
    "",
    "Recorded: time, spec section, method, address without its query, and the event's own words.",
    "Times are when this page received each event, or when the server kept it for events from before the page was loaded; one turn's events arrive together.",
    "Never recorded: headers, bodies, tokens, Session JWTs, DPoP proofs, keys, codes or sign-in values.",
  );
  return lines.join("\n");
}

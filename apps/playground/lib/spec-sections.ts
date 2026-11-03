/**
 * The PAP 0.3 section each inspector step meets, so a trace reads against
 * the spec. Labels, never claims of conformance.
 */
const discovery: Record<string, string> = {
  poppy: "§3",
  domain: "§3",
  link: "§3",
  resource: "§3.2",
  issuer: "§3.2",
  metadata: "§3.2",
};
export const discoverySection = (id: string) => discovery[id] ?? "";

const api: Array<[RegExp, string]> = [
  [/approval required|Poppy-Approval/i, "Operations §4–6"],
  [/excluded tasks/i, "§9.1"],
  [/^(GET|POST|PUT|PATCH|DELETE) |API tools|OpenAPI/i, "§7"],
  [/MCP/, "§7"],
  [/Session header|Poppy Session|Session (signed|started)/i, "§5.2"],
  [/sign(ed)? ?in|consent/i, "§4.2"],
];
export function apiSection(event: string) {
  return api.find(([pattern]) => pattern.test(event))?.[1] ?? "";
}

/** A plain-text trace for an interoperability report. Holds no secrets. */
export function traceReport(input: {
  company: string;
  steps: Array<{
    id: string;
    label: string;
    detail: string;
    status: string;
    durationMs?: number | undefined;
  }>;
  events: string[];
  at?: Date;
}) {
  const lines = [
    `Poppy Lab trace · PAP draft 0.3 · ${input.company}`,
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
        (e) => `- ${e}${apiSection(e) ? ` (${apiSection(e)})` : ""}`,
      ),
    );
  return lines.join("\n");
}

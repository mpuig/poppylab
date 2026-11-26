/**
 * What the page shows of a chat answer, and of the Inspector's lines, each
 * with the Company it came from. Plain data, so a turn with several
 * Companies can be checked without a page.
 */
import { agentStep } from "@/lib/agent-steps";
import { logEntry, type ProtocolEntry } from "@/lib/protocol-log";
import type { Choice, CompanyRef, Message } from "./companies";

/** An Inspector line, and the Company the request was for. */
export type PageLine = ProtocolEntry & { from?: CompanyRef };

/** The lines a request wrote, for the Company it was for. */
export const linesFor = (
  lines: readonly string[] | undefined,
  from?: CompanyRef,
  at = Date.now(),
): PageLine[] =>
  (lines ?? []).map((line) => ({
    ...logEntry(line, at),
    ...(from ? { from } : {}),
  }));

/** The lines the conversation keeps, as a reload or an answer lists them. */
export const keptLines = (kept: unknown): PageLine[] =>
  Array.isArray(kept)
    ? (kept as Array<{ at: number; text: string; from?: CompanyRef }>).map(
        (line) => ({
          ...logEntry(line.text, line.at),
          ...(line.from ? { from: line.from } : {}),
        }),
      )
    : [];

/** A chat answer, in the members the page reads to show it. */
export type ChatAnswer = {
  text?: string;
  mode?: string;
  from?: CompanyRef;
  before?: string;
  choices?: Choice[];
  data?: unknown;
  trace?: string[];
  company?: Array<{
    author: string;
    text?: string;
    data?: string;
    note?: string;
    direct?: boolean;
    from?: CompanyRef;
  }>;
};

/**
 * What a turn adds to the conversation after the User's line: Iris's own
 * line from before it asked a Company (`before`), what the Company's own
 * agent said, and the answer. Iris's own words come from no Company and
 * carry no steps: what they report was done for the conversation, not
 * asked of a Company.
 */
export function turnMessages(data: ChatAnswer): Message[] {
  const from = data.from ? { from: data.from } : {};
  const own = data.mode === "iris";
  return [
    ...(data.before ? [{ role: "Iris" as const, text: data.before }] : []),
    ...(data.company ?? []).map((entry): Message => ({
      role: "Company",
      author: entry.author,
      text: entry.text ?? "",
      ...(entry.data ? { data: entry.data } : {}),
      ...(entry.note ? { note: entry.note } : {}),
      ...(entry.direct ? { direct: true } : {}),
      ...(entry.from ? { from: entry.from } : from),
    })),
    // In a Direct Conversation Iris says nothing unless something changed.
    ...(data.text
      ? [
          own
            ? {
                role: "Iris" as const,
                text: data.text,
                ...(data.choices?.length ? { choices: data.choices } : {}),
              }
            : {
                role: (data.mode === "demo"
                  ? "Demo"
                  : "Agent") as Message["role"],
                text: data.text,
                // Demo mode: the Company's exact answer, behind "Data".
                ...(typeof data.data === "string" ? { data: data.data } : {}),
                steps: (data.trace ?? []).map((line) =>
                  agentStep(logEntry(line)),
                ),
                ...from,
              },
        ]
      : []),
  ];
}

/**
 * The Companies a conversation has shown, by origin: the connected ones
 * and the ones removed. Messages name their Company once there are two.
 */
export const shownCompanies = (
  ...lists: Array<ReadonlyArray<{ origin: string }>>
) => new Set(lists.flatMap((list) => list.map((c) => c.origin))).size;

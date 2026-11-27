/**
 * What the page shows of a chat answer, and of the Inspector's lines, each
 * with the Company it came from. Plain data, so a turn with several
 * Companies can be checked without a page.
 */
import { agentStep, type AgentStep } from "@poppy-lab/pap-agent/agent-steps";
import {
  logEntry,
  type ProtocolEntry,
} from "@poppy-lab/pap-agent/protocol-log";
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

/**
 * The lines an answer carries, each with its Company: a turn with several
 * says whose each line is (`traces`); any other turn's are its Company's.
 */
export const answerLines = (
  data: {
    trace?: string[];
    traces?: Array<{ from: CompanyRef; trace: string[] }>;
  },
  from?: CompanyRef,
  at = Date.now(),
): PageLine[] =>
  data.traces
    ? data.traces.flatMap((group) => linesFor(group.trace, group.from, at))
    : linesFor(data.trace, from, at);

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
  /**
   * Iris's question after the answer, when something now waits for the
   * person: a proposal to approve, a sign-in the turn stopped for, an
   * invitation. Its buttons are quick replies; a typed answer works too.
   */
  question?: { text: string; choices?: Choice[] };
  data?: unknown;
  trace?: string[];
  /**
   * A turn with several Companies: each Company's own lines, its steps as
   * the server made them (each with its Company and the call's
   * arguments), and the Companies it used, in that order.
   */
  traces?: Array<{ from: CompanyRef; trace: string[] }>;
  steps?: AgentStep[];
  using?: CompanyRef[];
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
 * The `mode` of the agent's own answer before it was `"own"`, from a
 * server that still says it (a Worker rolled back, a reply in flight
 * during a deploy). Read the same until 31 January 2027, then removed.
 */
const OLD_OWN_MODE = "iris";

/**
 * What a turn adds to the conversation after the User's line: Iris's own
 * line from before it asked a Company (`before`), what the Company's own
 * agent said, and the answer. Iris's own words come from no Company and
 * carry no steps: what they report was done for the conversation, not
 * asked of a Company.
 */
export function turnMessages(data: ChatAnswer): Message[] {
  const from = data.from ? { from: data.from } : {};
  // "iris" is what a server before the rename called it (`OLD_OWN_MODE`).
  const own = data.mode === "own" || data.mode === OLD_OWN_MODE;
  return [
    ...(data.before ? [{ role: "Own" as const, text: data.before }] : []),
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
                role: "Own" as const,
                text: data.text,
                ...(data.choices?.length ? { choices: data.choices } : {}),
              }
            : {
                role: (data.mode === "demo"
                  ? "Demo"
                  : "Agent") as Message["role"],
                text: data.text,
                // The Company's exact answer, behind "Data": the demo's one,
                // or each one a model's tools got.
                ...(typeof data.data === "string" ? { data: data.data } : {}),
                steps:
                  data.steps ??
                  (data.trace ?? []).map((line) => agentStep(logEntry(line))),
                ...from,
                ...(data.using?.length ? { using: data.using } : {}),
              },
        ]
      : []),
    // Iris's own words, from no Company, as the server keeps them.
    ...(data.question?.text
      ? [
          {
            role: "Own" as const,
            text: data.question.text,
            ...(data.question.choices?.length
              ? { choices: data.question.choices }
              : {}),
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

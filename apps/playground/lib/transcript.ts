import { agentStep, type AgentStep } from "./agent-steps";
import type { CompanyEntry, DirectAction } from "./conversations";
import { keepSignedOutLines } from "./inspector-log";
import { logEntry } from "./protocol-log";
import type { Operation, Run } from "./runtime";

/**
 * One thing the page showed, kept so a reload or the History view shows it
 * again: the User's words, an answer, or Company content. Only what was on
 * screen is kept: no token, header or request body. An entry stored before
 * this had a role and its words only, and still reads.
 */
export type TranscriptEntry = {
  role: "user" | "assistant" | "company";
  content: string;
  /** An answer of the demo's rules, which the page labels "Protocol demo". */
  demo?: true;
  /** An answer's "What Iris did". */
  steps?: AgentStep[];
  /** The Company's exact answer or message data, as JSON, behind "Data". */
  data?: string;
  /** Company content: who wrote it, and Iris's short note about it. */
  author?: string;
  note?: string;
  /** §8.10: said in the User's Direct Conversation, by them or the Company. */
  direct?: true;
  /**
   * Shown while no account was signed in, so nothing in it was read with
   * one. Only these stay when a sign-in resets the conversation.
   */
  signedOut?: true;
};

/** What a turn put on the page besides the words. */
export type Shown = {
  /** Company content, in the order it arrived. */
  company?: CompanyEntry[];
  /** The turn's trace: the steps behind "What Iris did". */
  trace?: string[];
  /** The demo's rules answered, not a model. */
  demo?: boolean;
  /** The Company's exact answer, as the page got it for "Data". */
  data?: string | undefined;
};

/**
 * Bounds of the stored transcript. A run is sealed into one stored value
 * with its tokens and keys (`runs.ts`, `sealed.ts`), and a Durable Object
 * value can't be larger than a few megabytes, a third of which sealing
 * uses up. Whatever a Company or a model sends, the transcript stays a
 * small part of that.
 */
export const TRANSCRIPT_LIMITS = {
  entries: 200,
  /** Characters of one entry's words; the page's own messages are shorter. */
  text: 12_000,
  /** Characters of one entry's data: what the chat route sends the page. */
  data: 20_000,
  steps: 30,
  /** UTF-8 bytes of the whole transcript as JSON. */
  bytes: 256 * 1024,
} as const;

const encoder = new TextEncoder();
const size = (entry: TranscriptEntry) =>
  encoder.encode(JSON.stringify(entry)).length + 1;
const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** One entry within its own limits. Data too large to keep is left out. */
function clipped(entry: TranscriptEntry): TranscriptEntry {
  const { data, steps, note, author, ...rest } = entry;
  return {
    ...rest,
    content: cut(entry.content, TRANSCRIPT_LIMITS.text),
    ...(author ? { author: cut(author, 200) } : {}),
    ...(note ? { note: cut(note, 600) } : {}),
    ...(steps?.length
      ? {
          steps: steps
            .slice(0, TRANSCRIPT_LIMITS.steps)
            .map((step) => ({ ...step, text: cut(step.text, 300) })),
        }
      : {}),
    ...(data && data.length <= TRANSCRIPT_LIMITS.data ? { data } : {}),
  };
}

/**
 * The transcript within its bounds, newest entries last. Over the size, the
 * oldest data goes first, then the oldest steps, then the oldest entries:
 * the words of the conversation outlast their disclosures.
 */
export function bounded(entries: TranscriptEntry[]): TranscriptEntry[] {
  const kept = entries.slice(-TRANSCRIPT_LIMITS.entries);
  let total = kept.reduce((sum, entry) => sum + size(entry), 0);
  for (const field of ["data", "steps"] as const)
    for (let i = 0; i < kept.length && total > TRANSCRIPT_LIMITS.bytes; i++) {
      const entry = kept[i]!;
      if (entry[field] === undefined) continue;
      const rest = { ...entry };
      delete rest[field];
      total += size(rest) - size(entry);
      kept[i] = rest;
    }
  while (kept.length && total > TRANSCRIPT_LIMITS.bytes)
    total -= size(kept.shift()!);
  return kept;
}

/** Adds entries to the transcript the page shows, and not to the model's. */
function show(run: Run, ...entries: TranscriptEntry[]) {
  const signedOut = run.accountToken ? {} : { signedOut: true as const };
  run.transcript = bounded([
    ...(run.transcript ?? run.history),
    ...entries.map((entry) => ({ ...clipped(entry), ...signedOut })),
  ]);
}

/**
 * A sign-in may be for another account, so the conversation goes back to
 * what it was before any account access, as `history` does. The page keeps
 * that part as it showed it. Everything shown with an account goes, and so
 * does an entry that doesn't say which it was: a transcript stored before
 * entries said so is dropped whole, and the page shows `history` instead.
 *
 * History lists the conversation under its first request (`title`), which
 * may be one of those that went. It is then listed under the first request
 * the page still shows, and under none when nothing is left: the next
 * request names it.
 */
export function keepSignedOutTranscript(run: Run) {
  const kept = (run.transcript ?? []).filter((entry) => entry.signedOut);
  if (kept.length) run.transcript = kept;
  else delete run.transcript;
  const shown: TranscriptEntry[] = run.transcript ?? run.history;
  // Not words the User said to the Company in a Direct Conversation.
  const first = shown.find((entry) => entry.role === "user" && !entry.direct);
  if (first) run.title = first.content.trim().slice(0, 80);
  else delete run.title;
  // The Inspector's lines follow the same rule.
  keepSignedOutLines(run);
}

/** A turn's Company content, as the page showed it. */
const companyEntries = (shown: Shown): TranscriptEntry[] =>
  (shown.company ?? []).map((entry) => ({
    role: "company",
    content: entry.text ?? "",
    author: entry.author,
    ...(entry.data ? { data: entry.data } : {}),
    ...(entry.note ? { note: entry.note } : {}),
    ...(entry.direct ? { direct: true } : {}),
  }));

/**
 * An answer with its label and disclosures. The steps are the trace as the
 * page words it, with every address already cut to its path.
 */
const answerEntry = (content: string, shown: Shown): TranscriptEntry => ({
  role: "assistant",
  content,
  ...(shown.demo ? { demo: true } : {}),
  ...(shown.trace?.length
    ? { steps: shown.trace.map((line) => agentStep(logEntry(line))) }
    : {}),
  ...(shown.data ? { data: shown.data } : {}),
});

/**
 * Adds turns to the model's context (`history`, which callers cut to the
 * last ten) and to the transcript the page shows, which keeps the whole
 * conversation up to a bound.
 */
export function record(run: Run, ...turns: Run["history"]) {
  show(run, ...turns);
  run.history.push(...turns);
}

/**
 * One turn with Iris. The model's context gets the two turns' words and
 * nothing else. The page's transcript also keeps what the turn showed:
 * Company content, which is never the model's to read again as a turn, and
 * the answer's label, steps and data.
 */
export function recordTurn(
  run: Run,
  said: string,
  answer: string,
  shown: Shown = {},
) {
  const user = { role: "user" as const, content: said };
  show(run, user, ...companyEntries(shown), answerEntry(answer, shown));
  run.history.push(user, { role: "assistant", content: answer });
}

/**
 * How an approval ended, in a line for the model that has the Company's
 * words: its result, or why it declined. The page never showed that line.
 * It shows the outcome on the operation's own entry, and gets it again with
 * the run's operations, so the transcript takes nothing here.
 *
 * For an operation proposed in the User's Direct Conversation (§8.10) those
 * words were said in a thread the page tells the User Iris doesn't read.
 * The model is then told only that an operation there was approved or
 * declined: no summary, terms, result or reason.
 */
export function recordOutcome(
  run: Run,
  op: Pick<Operation, "direct">,
  outcome: "performed" | "declined",
  content: string,
) {
  // A run with no transcript yet is restored from `history`: keep what the
  // page showed so far before the model's line joins it.
  show(run);
  let line = content;
  if (op.direct) {
    const company = run.company?.document.organization.name ?? "the Company";
    line =
      outcome === "performed"
        ? `(An operation proposed in the user's direct conversation with ${company} was approved and performed.)`
        : `(The Company declined an operation proposed in the user's direct conversation with ${company}. Nothing was performed.)`;
  }
  run.history.push({ role: "assistant", content: line });
}

/**
 * §8.10: one of the User's own actions on a Direct Conversation. The page
 * tells them Iris doesn't read what they type there, so their words stay in
 * the transcript, for the page to show again after a reload, and never go
 * to the model. Nor does what the Company said there. The model gets Iris's
 * own line and that the User wrote to the Company; when Iris said nothing,
 * it gets nothing.
 *
 * The transcript keeps what the page showed: the User's words as their own
 * direct line, the Company's content, and Iris's line when it had one.
 * Accepting, declining and leaving are buttons, not words, and the page
 * showed Iris's line about them, so no line of the User's is kept.
 *
 * `sent` says their words reached the Company. Iris's line is sometimes
 * that they didn't (the thread had closed, sign-in was needed), and then
 * the model isn't told they were said; the page shows that line after them.
 */
export function recordDirect(
  run: Run,
  company: string,
  action: DirectAction,
  words: string,
  said: string,
  sent: boolean,
  shown: Shown = {},
) {
  const spoke = action === "say" || action === "start";
  show(
    run,
    ...(spoke
      ? [{ role: "user" as const, content: words, direct: true as const }]
      : []),
    ...companyEntries(shown),
    ...(said ? [answerEntry(said, shown)] : []),
  );
  if (said)
    run.history.push(
      {
        role: "user",
        content: !spoke
          ? `(Direct conversation with ${company}: ${action})`
          : sent
            ? `(The user wrote to ${company} directly, without Iris.)`
            : `(The user tried to write to ${company} directly, without Iris; it may not have been sent.)`,
      },
      { role: "assistant", content: said },
    );
}

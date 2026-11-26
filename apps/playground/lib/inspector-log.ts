import { logEntry, type ProtocolEntry } from "./protocol-log";
import type { Run } from "./runtime";

/**
 * One line of the Inspector's "Session & API calls", kept with the
 * conversation so a reload or the History view lists it again. Only what
 * the Inspector showed is kept: the line's words, as `logEntry` cuts them
 * for the screen, and a time. A line names a method, a path, a status and
 * an error code at most: no token, header, body, one-time code or query
 * string.
 */
export type KeptLine = {
  /** When the server kept it: the end of the request that wrote it. */
  at: number;
  text: string;
  /**
   * Names nothing an account holds: written by a request made while no
   * account was signed in, or the line that says a sign-in completed. Only
   * these stay when a sign-in resets the conversation.
   */
  signedOut?: true;
};

/**
 * Bounds of the kept lines. A turn writes about five to ten, a request of
 * the account row one or two, and a run has twenty turns at most, so a
 * whole walk-through fits in the count. The lines are sealed into the same
 * stored value as the transcript (`transcript.ts`), and stay a quarter of
 * its size at most whatever a path or an error code holds.
 */
export const LOG_LIMITS = {
  lines: 400,
  /** Characters of one line; the lab's own lines are shorter. */
  text: 300,
  /** UTF-8 bytes of all the lines as JSON. */
  bytes: 64 * 1024,
} as const;

const encoder = new TextEncoder();
const size = (line: KeptLine) =>
  encoder.encode(JSON.stringify(line)).length + 1;

/** The lines within their bounds: over them, the oldest go first. */
function bounded(lines: KeptLine[]): KeptLine[] {
  const kept = lines.slice(-LOG_LIMITS.lines);
  let total = kept.reduce((sum, line) => sum + size(line), 0);
  while (kept.length && total > LOG_LIMITS.bytes) total -= size(kept.shift()!);
  return kept;
}

/**
 * Keeps the lines a request wrote for the Inspector, in the words the page
 * shows them in. `withAccount` says an account was signed in when the
 * request began: a request that signs it out still wrote its lines with it.
 * The sign-in callback passes false for its one line, which names no
 * account data.
 */
export function keepLines(
  run: Run,
  lines: readonly string[],
  at = Date.now(),
  withAccount = !!run.accountToken,
) {
  if (!lines.length) return;
  const signedOut = withAccount ? {} : { signedOut: true as const };
  run.log = bounded([
    ...(run.log ?? []),
    ...lines.map((line) => ({
      at,
      text: logEntry(line).text.slice(0, LOG_LIMITS.text),
      ...signedOut,
    })),
  ]);
}

/**
 * A sign-in may be for another account, and a path can name what an account
 * holds (an order, a consent). So the lines go back to those written before
 * any account access, as the transcript does (`keepSignedOutTranscript`),
 * and those that say a sign-in completed.
 */
export function keepSignedOutLines(run: Run) {
  const kept = (run.log ?? []).filter((line) => line.signedOut);
  if (kept.length) run.log = kept;
  else delete run.log;
}

/**
 * Two lines the page writes itself, because no answer can carry them: one
 * before it asks, one when a file arrives. The server keeps the same words.
 */
export const applyingLine = (covered: string) =>
  `Applying your standing instruction · ${covered}`;
export const statementLine = (statementId: string, bytes: number) =>
  `Statement ${statementId} · PDF downloaded · ${bytes} bytes · not shown to Iris`;

/**
 * The line for a change the User's standing instruction leaves to them.
 * The page decides it, since the instruction lives in the browser; the
 * account route makes the check again, writes the line and keeps it once.
 */
export const notAppliedLine = (reason: string) =>
  `Standing instruction not applied · ${reason}; waiting for you`;

/** The kept lines as the Inspector lists them. */
export const shownLines = (kept: KeptLine[] | undefined): ProtocolEntry[] =>
  (kept ?? []).map((line) => logEntry(line.text, line.at));

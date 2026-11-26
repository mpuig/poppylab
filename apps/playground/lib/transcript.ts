import { agentStep, type AgentStep } from "./agent-steps";
import type { CompanyEntry, DirectAction } from "./conversations";
import {
  cameFrom,
  companyName,
  forPage,
  from,
  holdsAccount,
  noteFormer,
  originOf,
  type FromCompany,
} from "./connections";
import { dropLines, keepSignedOutLines } from "./inspector-log";
import { operationAccounts } from "./operation-store";
import { logEntry } from "./protocol-log";
import type { Connection, Operation, Run, Turn } from "./runtime";

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
   * Shown while no account could be in it: none was signed in at the
   * Company it came from, and a model that wrote it was sent nothing read
   * with another Company's. Only these stay when a sign-in at the Company
   * it came from resets the conversation.
   */
  signedOut?: true;
  /** The origin of the Company the entry came from (`connections.ts`). */
  company?: string;
  /** The origins of the Companies whose accounts could be in it. */
  accounts?: string[];
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
  /**
   * The turns a model was sent with this one. What they hold of any
   * Company's account can be in its answer (`accountsIn`).
   */
  context?: readonly Turn[] | undefined;
  /**
   * What the User typed, when that isn't the request the turn answered:
   * the name of a Company, in answer to Iris asking which one a request
   * was for. The page showed these words, and the model gets the request.
   * `null` when the page showed nothing more: the request is the rest of
   * a message it already shows ("connect with Lantern and show the menu").
   */
  typed?: string | null | undefined;
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

/**
 * The Companies whose accounts could be in a turn of the model's context.
 * A turn stored before turns listed them is taken to hold its own
 * Company's, when that one is signed in now.
 */
const accountsOf = (run: Pick<Run, "connections">, turn: Turn) =>
  turn.accounts ??
  run.connections
    .filter((c) => c.accountToken && cameFrom(turn, c))
    .map(originOf);

/**
 * The Companies whose accounts could be in what a turn with `connection`
 * says: its own, when it is signed in, and those of the turns a model was
 * sent with it (`context`). A model is sent the last turns of the whole
 * conversation, whichever Company each was with, so its answer to a turn
 * with one Company can repeat what it read with another's account. The
 * demo's rules are sent none, and answer from the turn's own Company.
 */
export const accountsIn = (
  run: Pick<Run, "connections">,
  connection: Connection,
  context: readonly Turn[] = [],
) => [
  ...new Set([
    ...(connection.accountToken ? [originOf(connection)] : []),
    ...context.flatMap((turn) => accountsOf(run, turn)),
  ]),
];

/**
 * Adds entries to the transcript the page shows, and not to the model's.
 * `connection` is the Company the turn was with, and `accounts` the
 * Companies whose accounts could be in it: each entry says both, and is
 * marked as shown signed out only when there are none.
 */
function show(
  run: Run,
  connection: Pick<Connection, "url"> | undefined,
  accounts: readonly string[],
  ...entries: TranscriptEntry[]
) {
  const signedOut = accounts.length ? {} : { signedOut: true as const };
  run.transcript = bounded([
    ...(run.transcript ?? run.history),
    ...entries.map((entry) => ({
      ...clipped(entry),
      ...signedOut,
      // A turn Iris answered by itself may be about no Company.
      ...(connection ? from(connection) : {}),
      accounts: [...accounts],
    })),
  ]);
}

/**
 * The transcript as the page gets it: what it showed, or the model's turns
 * in a run that has no transcript yet, each with the Company it came from.
 */
export const shownTranscript = (
  run: Pick<Run, "transcript" | "history" | "connections" | "former">,
) => forPage<TranscriptEntry>(run, run.transcript ?? run.history);

/**
 * History lists the conversation under its first request (`title`), which
 * may be one of those that went. It is then listed under the first request
 * the page still shows, and under none when nothing is left: the next
 * request names it.
 */
function retitle(run: Run) {
  const shown: TranscriptEntry[] = run.transcript ?? run.history;
  // Not words the User said to the Company in a Direct Conversation.
  const first = shown.find((entry) => entry.role === "user" && !entry.direct);
  if (first) run.title = first.content.trim().slice(0, 80);
  else delete run.title;
}

function keepEntriesWhere(run: Run, keep: (entry: TranscriptEntry) => boolean) {
  const kept = (run.transcript ?? []).filter(keep);
  if (kept.length) run.transcript = kept;
  else delete run.transcript;
  retitle(run);
}

/**
 * A sign-in at a Company may be for another account, so what the page
 * shows from that Company goes back to what it was before any access to
 * its account, as `history` does. The page keeps that part as it showed
 * it. Everything shown with that Company's account goes, and so does an
 * entry that doesn't say which it was: a transcript stored before entries
 * said so is dropped whole, and the page shows `history` instead. What
 * came from another Company stays, with or without that one's account,
 * unless this Company's account could be in it: a model's answer to a
 * turn with another Company can repeat what it read with this one's.
 */
export function keepSignedOutTranscript(run: Run, connection: Connection) {
  keepEntriesWhere(
    run,
    (entry) =>
      !holdsAccount(entry, connection) &&
      (!cameFrom(entry, connection) || !!entry.signedOut),
  );
  // The Inspector's lines follow the same rule.
  keepSignedOutLines(run, connection);
}

/**
 * A first sign-in at a Company: what the model was told of it so far is
 * from before any access to its account, and safe to go back to. Its own
 * turns among the model's last ten, as they are now, without those any
 * other Company's account could be in.
 */
export function keepPublicHistory(run: Run, connection: Connection) {
  connection.publicHistory = structuredClone(
    run.history
      .slice(-10)
      .filter((turn) => cameFrom(turn, connection) && !turn.accounts?.length),
  );
}

/**
 * What Iris says when a reset of one Company's account takes back
 * proposals at another: the cards are gone from the page, and this is the
 * line that says why. It names the two Companies and nothing an account
 * holds.
 */
function withdrawnNote(
  from: string,
  account: string,
  waited: number,
  ended: number,
) {
  const count = waited || ended;
  const many = count > 1;
  return `${many ? `${count} proposals` : "A proposal"} from ${from} that ${
    waited ? "waited for your approval" : "Iris showed here"
  } no longer ${many ? "show: they" : "shows: it"} could hold details from your ${account} account, which Iris no longer keeps. ${
    waited
      ? `Nothing was approved. Ask ${from} for the ${many ? "changes again if you still want them" : "change again if you still want it"}.`
      : `What ${from} already performed is not undone.`
  }`;
}

/**
 * Takes back the proposals at other Companies that this Company's account
 * could be in (`Connection.operationAccounts`): the summary, terms, result
 * and stored request of such a proposal can repeat what a model read with
 * this account. One whose approval was sent with an unknown outcome
 * stays, as it does at its own Company's reset: the User must still find
 * it, and not ask for the same change a second time.
 *
 * The page is told why the cards went, in a line of Iris's about the
 * Company that made them. No account is in that line, so it stays through
 * every sign-in. Returns whether anything was taken back.
 */
function withdrawProposals(run: Run, connection: Connection) {
  const origin = originOf(connection);
  let withdrew = false;
  for (const other of run.connections) {
    if (other === connection || !other.operationAccounts) continue;
    let waited = 0;
    let ended = 0;
    for (const id of Object.keys(other.operationAccounts)) {
      if (!operationAccounts(other, id).includes(origin)) continue;
      const op = other.operations?.[id];
      if (op?.state === "uncertain") continue;
      if (op) {
        if (op.state === "proposed") waited++;
        else ended++;
        delete other.operations![id];
      }
      delete other.operationAccounts[id];
    }
    if (!Object.keys(other.operationAccounts).length)
      delete other.operationAccounts;
    if (!waited && !ended) continue;
    withdrew = true;
    show(run, other, [], {
      role: "assistant",
      content: withdrawnNote(
        companyName(other),
        companyName(connection),
        waited,
        ended,
      ),
    });
  }
  return withdrew;
}

/**
 * The conversation as it was before any access to this Company's account:
 * the model's turns with it from then, what the page showed from it while
 * signed out, and no proposal of its own. For a sign-in that may be for
 * another account, and for an access the Company took back. The turns the
 * model still has with other Companies follow those that come back, less
 * the ones this Company's account could be in. Another Company's
 * proposals that this account could be in go too (`withdrawProposals`):
 * returns whether any did.
 */
export function backToPublic(run: Run, connection: Connection) {
  run.history = [
    ...structuredClone(connection.publicHistory ?? []),
    ...run.history.filter((turn) => !ofCompany(turn, connection)),
  ];
  keepSignedOutTranscript(run, connection);
  connection.operations = {};
  delete connection.operationAccounts;
  return withdrawProposals(run, connection);
}

/** From this Company, or with its account in it. */
const ofCompany = (entry: FromCompany, connection: Connection) =>
  cameFrom(entry, connection) || holdsAccount(entry, connection);

/**
 * Sign-out at a Company (§5.5) empties what the conversation holds from
 * it, what was said signed out included: the model's turns with it, what
 * the page showed from it and the Inspector's lines for it. What came from
 * another Company stays, unless this Company's account could be in it:
 * another Company's proposals that it could be in go as well
 * (`withdrawProposals`), and this returns whether any did.
 */
export function forgetCompany(run: Run, connection: Connection) {
  run.history = run.history.filter((turn) => !ofCompany(turn, connection));
  delete connection.publicHistory;
  keepEntriesWhere(run, (entry) => !ofCompany(entry, connection));
  dropLines(run, connection);
  return withdrawProposals(run, connection);
}

/**
 * Removes a Company from the conversation, which goes on with the others.
 * Its connection goes, and with it the Session, the sign-in, the
 * conversation with its agent and its waiting proposals. What the
 * conversation holds from it goes back to what it was before any access
 * to its account (`backToPublic`): what was shown with the account goes,
 * and what was shown signed out stays, still saying which Company it came
 * from (`nameFor` keeps its name).
 *
 * As when an access is lost, an approval that was sent and whose outcome
 * isn't known stays, so the User still finds it and doesn't ask for the
 * same change a second time. It is kept with the Company's name
 * (`Run.former`) and without its request: no Session or sign-in is left to
 * send it with, so it can't be retried from here, only checked in the
 * Company's own records.
 *
 * Nothing is sent to the Company. A caller that removes a signed-in
 * Company revokes its refresh token first (`revokeRefreshToken`), as
 * sign-out does.
 */
export function removeConnection(run: Run, connection: Connection) {
  const place = run.connections.indexOf(connection);
  if (place < 0) return;
  const unknown = Object.entries(connection.operations ?? {})
    .filter(([, op]) => op.state === "uncertain")
    .map(([id, op]) => {
      const rest = { ...op };
      delete rest.request;
      return [id, rest] as const;
    });
  backToPublic(run, connection);
  run.connections.splice(place, 1);
  noteFormer(run, {
    url: connection.url,
    name: companyName(connection),
    ...(unknown.length ? { operations: Object.fromEntries(unknown) } : {}),
  });
}

/**
 * §5.5: the Company no longer takes the sign-in, because the User
 * disconnected Iris there or the access ended, and Iris learned it in this
 * request (`knewBefore`: it was known when the request began). What Iris
 * read and showed with the account then goes, as at a sign-in that may be
 * someone else's, and what it showed signed out stays. The sign-in itself
 * is kept: it is still revoked or replaced at the next one.
 *
 * One kind of proposal stays: an approval that was sent and whose outcome
 * isn't known. It may have been performed, and only its own approval may be
 * sent again (Operations v3 §7), so the User must still find it once the
 * access is back, and not ask for the same change a second time.
 *
 * Returns what the page shows now, for the answer to carry, and nothing
 * when this request changed nothing. `withdrew` says that proposals at
 * other Companies went with it (`withdrawProposals`); `lostAccess` in
 * `conversation-view.ts` turns that into what the page is told. What is
 * said afterwards stays until the next sign-in: the connection still
 * holds an account, so it isn't marked as shown signed out.
 */
export function forgetLostAccount(
  run: Run,
  connection: Connection,
  knewBefore: boolean,
) {
  if (knewBefore || !connection.accountToken || !connection.accountUnavailable)
    return;
  const unknown = Object.entries(connection.operations ?? {}).filter(
    ([, op]) => op.state === "uncertain",
  );
  const accounts = connection.operationAccounts;
  const withdrew = backToPublic(run, connection);
  connection.operations = Object.fromEntries(unknown);
  // What is listed for the approvals that stay, stays with them.
  const listed = Object.fromEntries(
    unknown.flatMap(([id]) => (accounts?.[id] ? [[id, accounts[id]]] : [])),
  );
  if (Object.keys(listed).length) connection.operationAccounts = listed;
  return {
    history: shownTranscript(run),
    operations: Object.values(connection.operations),
    withdrew,
  };
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
 * conversation up to a bound. `connection` is the Company they were with.
 */
export function record(run: Run, connection: Connection, ...turns: Turn[]) {
  const accounts = accountsIn(run, connection);
  show(run, connection, accounts, ...turns);
  tell(run, connection, accounts, ...turns);
}

/**
 * Adds turns to the model's context, each with the Company it was with
 * and the Companies whose accounts could be in it.
 */
function tell(
  run: Run,
  connection: Pick<Connection, "url"> | undefined,
  accounts: readonly string[],
  ...turns: Turn[]
) {
  run.history.push(
    ...turns.map((turn) => ({
      ...turn,
      ...(connection ? from(connection) : {}),
      accounts: [...accounts],
    })),
  );
}

/**
 * One turn with Iris. The model's context gets the two turns' words and
 * nothing else. The page's transcript also keeps what the turn showed:
 * Company content, which is never the model's to read again as a turn, and
 * the answer's label, steps and data.
 */
export function recordTurn(
  run: Run,
  connection: Connection,
  said: string,
  answer: string,
  shown: Shown = {},
) {
  const user = { role: "user" as const, content: said };
  // The User's own words too: they are kept or dropped with the answer.
  const accounts = accountsIn(run, connection, shown.context);
  show(
    run,
    connection,
    accounts,
    ...(shown.typed === null
      ? []
      : [shown.typed === undefined ? user : { ...user, content: shown.typed }]),
    ...companyEntries(shown),
    answerEntry(answer, shown),
  );
  tell(run, connection, accounts, user, {
    role: "assistant",
    content: answer,
  });
}

/**
 * A turn Iris answered by itself, with nothing read from any Company: it
 * connected or removed one, asked which Company a request is for, or said
 * that there is none to ask. `about` is the Company the turn was about, if
 * one: the entries then go where that Company's signed-out entries go.
 * About none, they are the conversation's own and stay through every
 * Company's sign-in and sign-out. No account is in such a turn.
 *
 * `told` is the answer as the model gets it, when that isn't the answer
 * the page shows: words of a Company's own, such as how its discovery
 * describes it, are for the User to read and not for the model to take as
 * Iris's. `false` leaves the turn out of the model's context: a question
 * of Iris's that the next message answers is no part of what was asked.
 *
 * `shown` is false when the page already shows the User's words: `said`
 * is then the rest of a message it showed whole.
 */
export function recordOwn(
  run: Run,
  about: Pick<Connection, "url"> | undefined,
  said: string,
  answer: string,
  told: string | false = answer,
  shown = true,
) {
  const user = { role: "user" as const, content: said };
  show(run, about, [], ...(shown ? [user] : []), {
    role: "assistant",
    content: answer,
  });
  if (told !== false)
    tell(run, about, [], user, { role: "assistant", content: told });
}

/**
 * How an approval ended, in a line for the model that has the Company's
 * words: its result, or why it declined. The page never showed that line.
 * It shows the outcome on the operation's own entry, and gets it again with
 * the connection's operations, so the transcript takes nothing here.
 *
 * For an operation proposed in the User's Direct Conversation (§8.10) those
 * words were said in a thread the page tells the User Iris doesn't read.
 * The model is then told only that an operation there was approved or
 * declined: no summary, terms, result or reason.
 *
 * The line holds what the operation holds: this Company's account, and
 * any other the operation is listed with (`operationAccounts`), since its
 * result can repeat terms a model wrote from what it read elsewhere.
 */
export function recordOutcome(
  run: Run,
  connection: Connection,
  op: Partial<Pick<Operation, "direct" | "operation_id">>,
  outcome: "performed" | "declined",
  content: string,
) {
  // A run with no transcript yet is restored from `history`: keep what the
  // page showed so far before the model's line joins it.
  const accounts = [
    ...new Set([
      ...accountsIn(run, connection),
      ...operationAccounts(connection, op.operation_id),
    ]),
  ];
  show(run, connection, accounts);
  let line = content;
  if (op.direct) {
    const company =
      connection.company?.document.organization.name ?? "the Company";
    line =
      outcome === "performed"
        ? `(An operation proposed in the user's direct conversation with ${company} was approved and performed.)`
        : `(The Company declined an operation proposed in the user's direct conversation with ${company}. Nothing was performed.)`;
  }
  tell(run, connection, accounts, { role: "assistant", content: line });
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
  connection: Connection,
  company: string,
  action: DirectAction,
  words: string,
  said: string,
  sent: boolean,
  shown: Shown = {},
) {
  const spoke = action === "say" || action === "start";
  // No model reads or writes here: the Company's own account at most.
  const accounts = accountsIn(run, connection);
  show(
    run,
    connection,
    accounts,
    ...(spoke
      ? [{ role: "user" as const, content: words, direct: true as const }]
      : []),
    ...companyEntries(shown),
    ...(said ? [answerEntry(said, shown)] : []),
  );
  if (said)
    tell(
      run,
      connection,
      accounts,
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

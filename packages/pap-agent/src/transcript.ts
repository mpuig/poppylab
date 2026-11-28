import { agentName } from "./agent";
import { agentStep, type AgentStep } from "./agent-steps";
import type { ProposalRef } from "./approval-question";
import type { Choice } from "./company-commands";
import type { CompanyEntry, DirectAction } from "./conversations";
import {
  cameFrom,
  companyName,
  companyRef,
  forPage,
  from,
  holdsAccount,
  noteFormer,
  originOf,
  signedOutAt,
  type FromCompany,
} from "./connections";
import { dropLines, keepSignedOutLines } from "./inspector-log";
import { languageOf } from "./language";
import { say } from "./lines";
import { keepUncertainOperations, operationAccounts } from "./operation-store";
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
  /**
   * An answer to a turn with several Companies (`several.ts`): the origin
   * of each, in the order the turn used them. `company` is the one it
   * ended at.
   */
  using?: string[];
  /**
   * Iris's buttons under a question of its own, kept while the question is
   * the last thing said: the next entry takes them away (`show`).
   */
  choices?: Choice[];
  /**
   * The words to say aloud, when they were made from facts the words
   * alone don't hold: a proposal's question, made from its terms
   * (`approval-question.ts`). Any other answer's are made from its words
   * when it is read (`spokenText`).
   */
  spoken?: string;
  /**
   * The proposals that arrived with this entry, each at the revision it
   * came with: Iris's question about new terms names them. The page shows
   * each one's card here, where it arrived, and keeps it there once it is
   * decided. Unlike `choices`, kept when the next entry comes.
   */
  proposals?: ProposalRef[];
  /**
   * Shown with an earlier sign-in at its Company, which a later one wasn't
   * shown to continue (`keepEarlierSignIn`): kept for the User to read, and
   * never sent to a model again.
   */
  earlier?: true;
  /**
   * Iris's question whether to go on with a request that waited for a
   * sign-in (`askToResume`): the request as the question quoted it, and
   * until when it can go on.
   */
  goOn?: { request: string; until: number };
  /**
   * A question to go on that is no longer asked (`noLongerAsked`): its
   * words say so, and the page shows it as a muted line.
   */
  noLongerAsked?: true;
  /**
   * A question to go on that a newer one about the same request replaced
   * (`replaceGoOn`). The page shows nothing for it; it is kept so what the
   * page placed after it (a sign-in done, a permission given) stays where
   * it arose, before the newer question.
   */
  replaced?: true;
};

/** What a turn put on the page besides the words. */
export type Shown = {
  /**
   * Company content, in the order it arrived. In a turn with several
   * Companies each entry says which it came from (`company`).
   */
  company?: Array<CompanyEntry & { company?: string }>;
  /** The turn's trace: the steps behind "What Iris did". */
  trace?: string[];
  /**
   * A turn with several Companies: its steps, each at its Company
   * (`severalSteps`), in place of `trace`'s, and its Companies in the
   * order it used them, the one it ended at among them.
   */
  steps?: AgentStep[];
  turn?: readonly Connection[];
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
  /**
   * Buttons under one question: Iris offers one for each of the lab's
   * Companies at most. Their labels are names, cut like an author's.
   */
  choices: 8,
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
  const { data, steps, note, author, choices, spoken, proposals, ...rest } =
    entry;
  // As many as one question names, each as long as a button's answer.
  const arrived = (proposals ?? [])
    .filter((ref) => JSON.stringify(ref).length <= 8_000)
    .slice(0, TRANSCRIPT_LIMITS.choices);
  // A button whose answer is longer than any Iris makes is left out: three
  // addresses of at most 2048 characters each.
  const buttons = (choices ?? [])
    .filter((c) => JSON.stringify(c.answer).length <= 8_000)
    .slice(0, TRANSCRIPT_LIMITS.choices)
    .map((c) => ({ ...c, label: cut(c.label, 200) }));
  return {
    ...rest,
    ...(buttons.length ? { choices: buttons } : {}),
    ...(arrived.length ? { proposals: arrived } : {}),
    content: cut(entry.content, TRANSCRIPT_LIMITS.text),
    ...(author ? { author: cut(author, 200) } : {}),
    ...(note ? { note: cut(note, 600) } : {}),
    ...(spoken ? { spoken: cut(spoken, 600) } : {}),
    ...(steps?.length
      ? {
          steps: steps.slice(0, TRANSCRIPT_LIMITS.steps).map((step) => ({
            ...step,
            text: cut(step.text, 300),
            ...(step.args ? { args: cut(step.args, 400) } : {}),
          })),
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
 * The same for a turn with several Companies: what it says, and every
 * request it made, can hold what it read at any of them.
 */
export const turnAccounts = (
  run: Pick<Run, "connections">,
  turn: readonly Connection[],
  context: readonly Turn[] = [],
) => [...new Set(turn.flatMap((c) => accountsIn(run, c, context)))];

const TURN_TAG = Symbol("turnTag");
type TaggedTranscriptEntry = TranscriptEntry & { [TURN_TAG]?: symbol };
const activeTurns = new WeakMap<Run, symbol>();

/**
 * Starts marking the entries this turn appends to `run.transcript` while
 * the turn holds the run lock. The tag is a private Symbol so `bounded()`'s
 * byte accounting and JSON serialization ignore it, while spread copies
 * (`clipped`, `withoutChoices`, `offerChoices`, `bounded`) preserve it.
 */
export function beginTurn(run: Run): symbol {
  const tag = Symbol("turn");
  activeTurns.set(run, tag);
  return tag;
}

function withoutTurnTag(entry: TranscriptEntry): TranscriptEntry {
  if (!(TURN_TAG in entry)) return entry;
  const clean = { ...entry } as TaggedTranscriptEntry;
  delete clean[TURN_TAG];
  return clean;
}

/**
 * Finishes the turn started with `beginTurn`: strips the private tag from
 * `run.transcript` and returns the surviving entries added during this turn,
 * shaped exactly as `shownTranscript` shapes them.
 */
export function endTurn(run: Run, tag: symbol, now = Date.now()) {
  if (activeTurns.get(run) === tag) activeTurns.delete(run);
  const transcript = run.transcript;
  if (!transcript?.length) return [];
  const added: TranscriptEntry[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i] as TaggedTranscriptEntry;
    if (entry[TURN_TAG] === tag) added.push(entry);
    if (TURN_TAG in entry) transcript[i] = withoutTurnTag(entry);
  }
  return shownEntries(run, added, now);
}

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
  const tag = activeTurns.get(run);
  run.transcript = bounded([
    // A question is answered, or passed by, once anything follows it.
    ...(run.transcript ?? run.history).map(withoutChoices),
    ...entries.map((entry) => ({
      ...clipped(entry),
      ...signedOut,
      // A turn Iris answered by itself may be about no Company. In a turn
      // with several, Company content says which one it came from.
      ...(connection && entry.company === undefined ? from(connection) : {}),
      accounts: [...accounts],
      ...(tag ? { [TURN_TAG]: tag } : {}),
    })),
  ]);
}

function withoutChoices(entry: TranscriptEntry): TranscriptEntry {
  if (!entry.choices) return entry;
  const rest = { ...entry };
  delete rest.choices;
  return rest;
}

/**
 * Iris's buttons under the question it just asked (`recordOwn`), so a
 * reload or the History view offers them again while that question is
 * the last thing said. They go with the next entry.
 */
export function offerChoices(run: Run, answer: string, choices: Choice[]) {
  const last = run.transcript?.at(-1);
  if (!choices.length || last?.role !== "assistant" || last.content !== answer)
    return;
  run.transcript = bounded([
    ...run.transcript!.slice(0, -1),
    clipped({ ...last, choices }),
  ]);
}

const shownEntries = (
  run: Pick<
    Run,
    "transcript" | "history" | "connections" | "former" | "language"
  >,
  entries: readonly TranscriptEntry[],
  now = Date.now(),
) =>
  forPage<TranscriptEntry>(
    run,
    entries.map((entry) =>
      withoutTurnTag(
        goesOn(run, entry, now) ? entry : noLongerAsked(run, entry),
      ),
    ),
  ).map(({ using, ...entry }) =>
    using ? { ...entry, using: using.map((o) => companyRef(run, o)) } : entry,
  );

/**
 * The transcript as the page gets it: what it showed, or the model's turns
 * in a run that has no transcript yet, each with the Company it came from.
 */
export const shownTranscript = (
  run: Pick<
    Run,
    "transcript" | "history" | "connections" | "former" | "language"
  >,
  now = Date.now(),
) => shownEntries(run, run.transcript ?? run.history, now);

/**
 * Whether a question to go on can still be answered with its button: the
 * request still waits at its Company, and hasn't run out. One already
 * answered has no button, and stays as it was asked.
 */
function goesOn(
  run: Pick<Run, "connections">,
  entry: TranscriptEntry,
  now: number,
) {
  if (!entry.goOn || !entry.choices) return true;
  const waiting = run.connections.find(
    (c) => originOf(c) === entry.company,
  )?.resume;
  return !!waiting && entry.goOn.until >= now;
}

/** A question to go on that a newer one replaced: no words, no buttons. */
function replacedBy(entry: TranscriptEntry): TranscriptEntry {
  const rest = withoutChoices(entry);
  delete rest.goOn;
  delete rest.spoken;
  return { ...rest, content: "", replaced: true };
}

/** A question to go on, folded to a line that says it is no longer asked. */
function noLongerAsked(
  run: Pick<Run, "language">,
  entry: TranscriptEntry,
): TranscriptEntry {
  const rest = withoutChoices(entry);
  delete rest.goOn;
  delete rest.spoken;
  return {
    ...rest,
    content: say(languageOf(run), "resumeNoLonger", {
      request: entry.goOn?.request ?? "",
    }),
    noLongerAsked: true,
  };
}

/**
 * Iris asks again whether to go on (`askToResume`), and only the newest
 * question can be answered. An earlier one the User never answered (no
 * words of theirs follow it) is passed by: about the same request at the
 * same Company it goes, as the new one takes its place (`replaced`: the
 * page no longer shows it); about another request it folds to a line
 * saying it is no longer asked. One the User answered stays as it was
 * asked, with their answer after it.
 */
export function replaceGoOn(run: Run, company: string, request: string) {
  const shown = run.transcript;
  if (!shown?.some((entry) => entry.goOn)) return;
  const lastSaid = shown.map((entry) => entry.role).lastIndexOf("user");
  run.transcript = shown.flatMap((entry, index) =>
    !entry.goOn || index < lastSaid
      ? [entry]
      : entry.company === company && entry.goOn.request === request
        ? [replacedBy(entry)]
        : [noLongerAsked(run, entry)],
  );
}

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
      (!cameFrom(entry, connection) || signedOutAt(entry, connection)),
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
    waited ? "waited for your approval" : `${agentName()} showed here`
  } no longer ${many ? "show: they" : "shows: it"} could hold details from your ${account} account, which ${agentName()} no longer keeps. ${
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
 * signed out, and only approvals whose outcome isn't known. For a sign-in
 * that may be for another account, and for an access the Company took back.
 * The turns the model still has with other Companies follow those that come
 * back, less the ones this Company's account could be in. Another Company's
 * proposals that this account could be in go too (`withdrawProposals`):
 * returns whether any did.
 */
export function backToPublic(run: Run, connection: Connection) {
  run.history = [
    ...structuredClone(connection.publicHistory ?? []),
    ...run.history.filter((turn) => !ofCompany(turn, connection)),
  ];
  keepSignedOutTranscript(run, connection);
  keepUncertainOperations(connection);
  return withdrawProposals(run, connection);
}

/**
 * A later sign-in at a Company that its answers don't show to be for the
 * same account (`signInCallback`). The model's context and the proposals
 * go back to before any access to the account, as `backToPublic` does: a
 * model signed in to another account is never sent what it read with the
 * earlier one, and the earlier sign-in's proposals (except any approval
 * whose outcome isn't known) and their mention at other Companies
 * (`withdrawProposals`) go. The transcript is the User's own
 * view of what they saw, which no Company is sent, so it stays as they saw
 * it. What was shown with that account is marked `earlier`, and its buttons
 * go: the page says those entries are from the earlier sign-in. A sign-out
 * or a lost access still takes them away (`holdsAccount`). Returns whether
 * proposals at other Companies went.
 */
export function keepEarlierSignIn(run: Run, connection: Connection) {
  run.history = [
    ...structuredClone(connection.publicHistory ?? []),
    ...run.history.filter((turn) => !ofCompany(turn, connection)),
  ];
  if (run.transcript)
    run.transcript = run.transcript.map((entry) => {
      const shownWithAccount =
        holdsAccount(entry, connection) ||
        (cameFrom(entry, connection) && !signedOutAt(entry, connection));
      return shownWithAccount
        ? { ...withoutChoices(entry), earlier: true as const }
        : entry;
    });
  keepSignedOutLines(run, connection);
  keepUncertainOperations(connection);
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
  const withdrew = backToPublic(run, connection);
  return {
    history: shownTranscript(run),
    operations: Object.values(connection.operations ?? {}),
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
    ...(entry.company ? { company: entry.company } : {}),
  }));

/**
 * An answer with its label and disclosures. The steps are the trace as the
 * page words it, with every address already cut to its path.
 */
const answerEntry = (content: string, shown: Shown): TranscriptEntry => ({
  role: "assistant",
  content,
  ...(shown.demo ? { demo: true } : {}),
  ...(shown.steps?.length
    ? { steps: shown.steps }
    : shown.trace?.length
      ? { steps: shown.trace.map((line) => agentStep(logEntry(line))) }
      : {}),
  ...(shown.data ? { data: shown.data } : {}),
  ...(shown.turn?.length ? { using: shown.turn.map(originOf) } : {}),
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
  // With several Companies, the answer can hold what any of them showed.
  const accounts = turnAccounts(
    run,
    shown.turn?.length ? shown.turn : [connection],
    shown.context,
  );
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
 * A question of Iris's own, or its answer to one, that can hold what a
 * Company's account showed: a proposal's terms, the request a sign-in
 * stopped. `about` is the Company it is about, and `accounts` the
 * Companies whose accounts could be in it, as for any turn. `said` is
 * the User's line before it, when the page showed one. The model is told
 * nothing: a question the next message answers is no part of what was
 * asked, and how an approval ended reaches it in its own line
 * (`recordOutcome`). The buttons stay while it is the last thing said.
 */
export function recordAsked(
  run: Run,
  about: Pick<Connection, "url"> | undefined,
  accounts: readonly string[],
  asked: {
    said?: string | undefined;
    text: string;
    spoken?: string | undefined;
    choices?: Choice[] | undefined;
    /** The proposals the question brought: their cards go here. */
    proposals?: ProposalRef[] | undefined;
    /** A question to go on: the request it quotes, and until when. */
    goOn?: TranscriptEntry["goOn"];
  },
) {
  show(
    run,
    about,
    accounts,
    ...(asked.said !== undefined
      ? [{ role: "user" as const, content: asked.said }]
      : []),
    {
      role: "assistant",
      content: asked.text,
      ...(asked.spoken ? { spoken: asked.spoken } : {}),
      ...(asked.choices?.length ? { choices: asked.choices } : {}),
      ...(asked.proposals?.length ? { proposals: asked.proposals } : {}),
      ...(asked.goOn ? { goOn: asked.goOn } : {}),
    },
  );
}

/**
 * Iris's question about proposals, when what it asked was decided before
 * the User answered it: its standing instruction approved them. The
 * question is the last thing said and asks about nothing that still
 * waits, so its words become `said`, what Iris did, and its buttons go.
 * The cards stay where they arrived. Returns whether it changed anything:
 * a question something follows, or one about a proposal that still waits,
 * stays as it was.
 */
export function settleQuestion(
  run: Run,
  decided: (ref: ProposalRef) => boolean,
  said: string,
) {
  const asking = run.asking;
  const last = run.transcript?.at(-1);
  if (
    !asking ||
    !("approve" in asking) ||
    !asking.approve.length ||
    !asking.approve.every(decided) ||
    last?.role !== "assistant" ||
    !last.proposals?.some(decided)
  )
    return false;
  const rest = withoutChoices({ ...last, content: said });
  delete rest.spoken;
  run.transcript = [...run.transcript!.slice(0, -1), clipped(rest)];
  delete run.asking;
  return true;
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
            ? `(The user wrote to ${company} directly, without ${agentName()}.)`
            : `(The user tried to write to ${company} directly, without ${agentName()}; it may not have been sent.)`,
      },
      { role: "assistant", content: said },
    );
}

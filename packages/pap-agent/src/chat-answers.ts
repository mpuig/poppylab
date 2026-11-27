/**
 * The agent asks, and the User can answer in words. Everything that waits
 * for the person (a proposal to approve, a sign-in, a request to go on
 * with after it, a Company's invitation, a message to try again) becomes
 * a question of the agent's own in the conversation, with its buttons as
 * quick replies, and the User's next message can answer it.
 *
 * The answer is read here, by fixed rules (`typed-answers.ts`), from the
 * User's own words and nothing else: never Company content, a tool's
 * result or a model's answer, and never a button's label. It is bound to
 * the question asked (`Run.asking`), at the revision it named, and only
 * the next message can answer it: any other drops the question, and the
 * proposal goes on waiting. This runs before any model is asked, and no
 * model ever sees an approval as something it can do.
 *
 * A decision goes through the account route's own handler (`actOn`), the
 * same one the card's button reaches: the same approver, the same check
 * of the terms, the same record.
 */
import { companyProfile } from "@poppy-lab/pap-core";
import { actOn } from "./account";
import { accountCommand } from "./account-command";
import { canChange, canRequestChanges } from "./account-permissions";
import {
  approvalQuestion,
  named,
  proposalName,
  whichQuestion,
  type ProposalRef,
} from "./approval-question";
import type { ChatRequest } from "./chat-body";
import { ownAnswer, type HeldTurn } from "./chat-turn";
import { answeredWith, type Nameable } from "./company-names";
import { choice, type Choice } from "./company-commands";
import {
  companyName,
  companyRef,
  connectionAt,
  nameFor,
  originOf,
} from "./connections";
import { companiesView } from "./conversation-view";
import type { DirectAction } from "./conversations";
import { demoExamplesFor } from "./demo-examples";
import { isAccountCompany } from "./deployment";
import { directState } from "./direct-state";
import { nameable } from "./lab-companies";
import { languageOf, type Language } from "./language";
import { say } from "./lines";
import { spokenText } from "./spoken";
import { operationAccounts } from "./operation-store";
import type { Connection, Operation, Run } from "./runtime";
import { recordAsked } from "./transcript";
import { readApproval, SAYS_YES, tryAgain, yesOrNo } from "./typed-answers";
import type { Caller, Reply } from "./web";

/**
 * The question that waits for the User's answer. Only the next message
 * answers it; the chat drops it as that message comes in.
 *
 * - `approve`: the proposals it named, each at its revision; `which` when
 *   it asked which of them.
 * - `signin`: open the Company's sign-in, or ask it for change permission.
 * - `signout`: sign out at one of these Companies.
 * - `resume`: go on with the request that waited for the sign-in there.
 * - `invitation`: the Company's invitation to a Direct Conversation.
 * - `retry`: the message that failed, to ask again.
 */
export type Asking =
  | { approve: ProposalRef[]; which?: true }
  | { signin: { company: string; access: "read" | "write" } }
  | { signout: string[] }
  | { resume: string }
  | { invitation: string }
  | { retry: { asked: string; company?: string } };

/**
 * A question of the agent's own: its words, the words to say, its buttons,
 * and the proposals that arrived with it, whose cards a page shows here.
 */
export type Question = {
  text: string;
  spoken: string;
  choices: Choice[];
  proposals?: ProposalRef[];
};

/** How long a request waits for its sign-in: the conversation's own time. */
export const RESUME_MS = 30 * 60000;

/** What a turn knew before it ran: its proposals, and its invitations. */
export type Before = { proposals: Set<string>; invited: Set<string> };

const keyOf = (connection: Connection, op: Operation) =>
  `${originOf(connection)} ${op.operation_id} ${op.revision}`;

/** The conversation's proposals and invitations, before a turn. */
export const before = (run: Run): Before => ({
  proposals: new Set(
    run.connections.flatMap((c) =>
      Object.values(c.operations ?? {}).map((op) => keyOf(c, op)),
    ),
  ),
  invited: new Set(
    run.connections
      .filter((c) => directState(c).invitation !== null)
      .map(originOf),
  ),
});

const live = (op: Operation, now = Date.now()) =>
  op.state === "proposed" && Date.parse(op.expires_at) > now;

/** The proposals that wait for the User, in the order they came. */
function waitingProposals(run: Run, now = Date.now()) {
  return run.connections
    .flatMap((connection) =>
      Object.values(connection.operations ?? {})
        .filter((op) => live(op, now))
        .map((op) => ({ connection, op })),
    )
    .sort((a, b) => (a.op.changed ?? 0) - (b.op.changed ?? 0));
}

const refOf = (connection: Connection, op: Operation): ProposalRef => ({
  company: originOf(connection),
  proposal: op.operation_id,
  revision: op.revision,
});

/** The Companies whose accounts could be in what a proposal says. */
const accountsOf = (connection: Connection, op: Operation) => [
  ...new Set([
    ...(connection.accountToken ? [originOf(connection)] : []),
    ...operationAccounts(connection, op.operation_id),
  ]),
];

/** The buttons for proposals: approve and decline each, at most eight. */
function decisionChoices(
  run: Run,
  waiting: ReadonlyArray<{ connection: Connection; op: Operation }>,
  lab: readonly Nameable[],
) {
  return waiting
    .flatMap(({ connection, op }) => [
      choice(run, { approve: refOf(connection, op) }, lab),
      choice(run, { decline: refOf(connection, op) }, lab),
    ])
    .slice(0, 8);
}

/**
 * Asks about proposals that wait: `fresh` ones first, then the others.
 * Records the question, keeps what it named, and gives it for the answer.
 */
function askApproval(
  run: Run,
  fresh: ReadonlyArray<{ connection: Connection; op: Operation }>,
  others: ReadonlyArray<{ connection: Connection; op: Operation }>,
  lab: readonly Nameable[],
  said?: string,
  lead?: string,
): Question | undefined {
  const all = [...fresh, ...others];
  const words = (list: ReadonlyArray<(typeof all)[number]>) =>
    list.map(({ connection, op }) => ({
      op,
      company: companyName(connection),
    }));
  const asked = approvalQuestion(
    words(fresh),
    words(others),
    Date.now(),
    languageOf(run),
  );
  if (!asked) return undefined;
  const question = {
    text: lead ? `${lead} ${asked.text}` : asked.text,
    spoken: lead ? `${lead} ${asked.spoken}` : asked.spoken,
    choices: decisionChoices(run, all, lab),
    // The new ones arrived here; the others' cards are where they came.
    proposals: fresh.map(({ connection, op }) => refOf(connection, op)),
  };
  run.asking = {
    approve: all.map(({ connection, op }) => refOf(connection, op)),
    ...(all.length > 1 ? { which: true as const } : {}),
  };
  recordAsked(
    run,
    all[0]!.connection,
    [
      ...new Set(
        all.flatMap(({ connection, op }) => accountsOf(connection, op)),
      ),
    ],
    { said, ...question },
  );
  return question;
}

/** The User's words, quoted in a sentence of the agent's. */
const quoted = (request: string) => {
  const said = request.replace(/\s+/g, " ").trim();
  // A question or exclamation that opens with "¿" or "¡" keeps its close.
  const words = /[¿¡]/.test(said) ? said : said.replace(/[.!?]+$/, "");
  return words.length > 120 ? `${words.slice(0, 119)}…` : words;
};

/** The Company offers agents a sign-in, and this agent may use it. */
const signsIn = (connection: Connection) =>
  !!connection.company &&
  companyProfile(connection.company).signIn.direct &&
  isAccountCompany(originOf(connection));

/** What a turn stopped for at this Company: a sign-in, or change permission. */
function stoppedFor(connection: Connection, trace: readonly string[]) {
  const unsent = trace.filter((line) => /^Not sent\b/.test(line));
  if (!unsent.length || !signsIn(connection)) return undefined;
  if (
    unsent.some((line) => line.endsWith("sign-in needed")) &&
    !connection.accountToken
  )
    return "read" as const;
  if (
    unsent.some((line) => line.endsWith("permission not granted")) &&
    connection.accountToken &&
    !connection.accountUnavailable &&
    canRequestChanges(
      companyProfile(connection.company!),
      connection.scopes ?? "",
    )
  )
    return "write" as const;
  return undefined;
}

/** The question before a sign-in, for a request or for none. */
function signInQuestion(
  run: Run,
  connection: Connection,
  access: "read" | "write",
  lab: readonly Nameable[],
  request?: string,
): Question {
  const name = companyName(connection);
  const language = languageOf(run);
  const words = { name, request: request ? quoted(request) : undefined };
  const spokenWords = { name, goOn: !!request };
  const text =
    access === "read"
      ? say(language, "signInAsk", words)
      : say(language, "writeAsk", words);
  const spoken =
    access === "read"
      ? say(language, "signInAskSpoken", spokenWords)
      : say(language, "writeAskSpoken", spokenWords);
  return {
    text,
    spoken,
    choices: [
      choice(run, { signin: { company: originOf(connection), access } }, lab),
    ],
  };
}

/**
 * What the agent asks once a turn has answered, if anything waits for the
 * User: a proposal the turn brought (with any that waited already), else
 * a sign-in or the change permission the turn stopped for, else a
 * Company's invitation to talk directly. `at` are the turn's Companies,
 * with the lines each wrote, the one it ended at last. The question is
 * kept with the conversation and given for the answer to carry.
 */
export function askAfter(
  turn: HeldTurn,
  was: Before,
  at: ReadonlyArray<{ connection: Connection; trace: readonly string[] }>,
): Question | undefined {
  const { conversation: run, lab } = turn;
  const waiting = waitingProposals(run);
  const fresh = waiting.filter(
    ({ connection, op }) => !was.proposals.has(keyOf(connection, op)),
  );
  if (fresh.length)
    return askApproval(
      run,
      fresh,
      waiting.filter((w) => !fresh.includes(w)),
      lab,
    );
  for (const { connection, trace } of [...at].reverse()) {
    const access = stoppedFor(connection, trace);
    if (!access) continue;
    // The request waits with this Company, to go on with once it's done.
    connection.resume = {
      asked: turn.asked.slice(0, 2000),
      access,
      at: Date.now(),
    };
    const question = signInQuestion(run, connection, access, lab, turn.asked);
    run.asking = { signin: { company: originOf(connection), access } };
    recordAsked(
      run,
      connection,
      connection.accountToken ? [originOf(connection)] : [],
      question,
    );
    return question;
  }
  for (const { connection } of [...at].reverse()) {
    if (
      directState(connection).invitation === null ||
      was.invited.has(originOf(connection))
    )
      continue;
    const name = companyName(connection);
    const origin = originOf(connection);
    const question = {
      text: say(languageOf(run), "invitationAsk", { name }),
      spoken: say(languageOf(run), "invitationAskSpoken", { name }),
      choices: [
        choice(run, { invitation: { company: origin, accept: true } }, lab),
        choice(run, { invitation: { company: origin, accept: false } }, lab),
      ],
    };
    run.asking = { invitation: origin };
    recordAsked(
      run,
      connection,
      connection.accountToken ? [origin] : [],
      question,
    );
    return question;
  }
  return undefined;
}

/**
 * After a sign-in or a second consent completes at a Company: the request
 * that waited for it, asked about again. Nothing is sent until the User
 * says yes; anything else drops it. Records the question, if there is one.
 */
export function askToResume(
  run: Run,
  connection: Connection,
  now = Date.now(),
) {
  const resume = connection.resume;
  if (!resume) return undefined;
  const profile = connection.company
    ? companyProfile(connection.company)
    : undefined;
  if (
    resume.at + RESUME_MS < now ||
    (resume.access === "write" && !canChange(profile, connection.scopes ?? ""))
  ) {
    delete connection.resume;
    return undefined;
  }
  const name = companyName(connection);
  const origin = originOf(connection);
  const language = languageOf(run);
  const question: Question = {
    text: say(language, "resumeAsk", { name, request: quoted(resume.asked) }),
    spoken: say(language, "resumeAskSpoken", { name }),
    choices: [
      { label: say(language, "resumeButton"), answer: { resume: origin } },
    ],
  };
  run.asking = { resume: origin };
  // The User's own words, asked before this account was signed in. The
  // question is about the sign-in here, so it is kept as the account's:
  // signing out here, or losing the access, takes it away with the rest
  // (`forgetCompany`), and it no longer shows once it doesn't apply.
  recordAsked(run, connection, [origin], question);
  return question;
}

/** What answering the question did: an answer, a Direct Conversation, or go on. */
export type Answered =
  | { reply: Reply }
  | { direct: DirectAction; connection: Connection }
  | undefined;

/**
 * The User's answer to the agent's open question, by a button or in their
 * own words. `open` is the question, taken from the run as this message
 * came in. Answers the turn itself, turns it into a Direct Conversation
 * action, or lets it go on: with the request that waited, when the answer
 * was to go on or to try again, or as the message it is.
 */
export async function answerQuestion(
  turn: HeldTurn,
  request: ChatRequest,
  open: Asking | undefined,
  caller: Caller,
): Promise<Answered> {
  const { conversation: run, message } = turn;
  const { pressed, written, direct, body } = request;
  if (direct) {
    dropResume(run, open);
    return undefined;
  }
  // What the User said: their words, or the label of the button.
  const said = message;
  if (pressed) {
    if ("approve" in pressed)
      return decide(turn, caller, pressed.approve, "approve", said);
    if ("decline" in pressed)
      return decide(turn, caller, pressed.decline, "decline", said);
    if ("signin" in pressed) return signInAgain(turn, pressed.signin, said);
    if ("signout" in pressed)
      return signOut(turn, caller, pressed.signout, said);
    if ("resume" in pressed) return resume(turn, request, pressed.resume);
    if ("invitation" in pressed)
      return invitation(
        turn,
        pressed.invitation.company,
        pressed.invitation.accept,
      );
    dropResume(run, open);
    return undefined;
  }
  if (open && "approve" in open) {
    const asked = open.approve.map((ref) => {
      const connection = connectionAt(run, ref.company);
      const op = connection?.operations?.[ref.proposal];
      const names = connection
        ? (() => {
            const n = nameable(connection, turn.lab);
            return [n.name, n.alias ?? "", ...(n.words ?? [])].filter(Boolean);
          })()
        : [nameFor(run, originOf({ url: ref.company }))];
      return {
        ref,
        connection,
        op,
        named: op ? named(op, names) : { names, noun: "change" },
      };
    });
    const read = readApproval(
      written,
      asked.map((a) => a.named),
      !!open.which,
    );
    if (!read) return undefined;
    if ("unclear" in read) {
      // An answer, but not which: asked again, naming each.
      const listedOnes = asked.flatMap((a) =>
        a.connection && a.op ? [{ connection: a.connection, op: a.op }] : [],
      );
      const again = whichQuestion(
        listedOnes.map(({ connection, op }) => ({
          op,
          company: companyName(connection),
        })),
        read.unclear,
        languageOf(run),
      );
      const question = {
        ...again,
        choices: decisionChoices(run, listedOnes, turn.lab),
      };
      run.asking = { approve: open.approve, which: true };
      recordAsked(
        run,
        listedOnes[0]?.connection,
        [
          ...new Set(
            listedOnes.flatMap(({ connection, op }) =>
              accountsOf(connection, op),
            ),
          ),
        ],
        { said, ...question },
      );
      return {
        reply: ownAnswer(turn, question.text, question.choices, {
          spoken: question.spoken,
        }),
      };
    }
    return decide(
      turn,
      caller,
      asked[read.picked]!.ref,
      read.decision,
      said,
      true,
    );
  }
  if (open && "signin" in open) {
    const answer = yesOrNo(written, SAYS_YES.signin);
    if (answer === "yes") return signInAgain(turn, open.signin, said);
    if (answer === "no") {
      const connection = connectionAt(run, open.signin.company);
      const waited = connection?.resume?.asked;
      if (connection) delete connection.resume;
      const name = nameFor(run, originOf({ url: open.signin.company }));
      const words = { name, waited: waited ? quoted(waited) : undefined };
      return says(
        turn,
        connection,
        open.signin.access === "read"
          ? say(languageOf(run), "stayedSignedOut", words)
          : say(languageOf(run), "accessUnchanged", words),
        said,
      );
    }
    return undefined;
  }
  if (open && "signout" in open) {
    const answer = yesOrNo(written, SAYS_YES.signout);
    const companies = open.signout.flatMap((origin) => {
      const c = connectionAt(run, origin);
      return c ? [c] : [];
    });
    if (answer === "yes" && companies.length === 1)
      return signOut(turn, caller, originOf(companies[0]!), said);
    if (answer === "no")
      return says(
        turn,
        undefined,
        say(languageOf(run), "stayedSignedIn", {
          names: companies.map(companyName),
        }),
        said,
      );
    const picked = answeredWith(
      written,
      companies.map((c) => nameable(c, turn.lab)),
    );
    if (companies.length > 1 && picked.length === 1)
      return signOut(turn, caller, originOf(picked[0]!), said);
    return undefined;
  }
  if (open && "resume" in open) {
    const answer = yesOrNo(written, SAYS_YES.resume);
    if (answer === "yes") return resume(turn, request, open.resume);
    const connection = connectionAt(run, open.resume);
    const waited = connection?.resume?.asked;
    if (connection) delete connection.resume;
    if (answer === "no")
      return says(
        turn,
        undefined,
        say(languageOf(run), "didntResume", {
          name: nameFor(run, originOf({ url: open.resume })),
          waited: waited ? quoted(waited) : undefined,
        }),
        said,
      );
    return undefined;
  }
  if (open && "invitation" in open) {
    const answer = yesOrNo(written, SAYS_YES.invitation);
    if (answer) return invitation(turn, open.invitation, answer === "yes");
    return undefined;
  }
  if (open && "retry" in open) {
    if (!tryAgain(written)) return undefined;
    turn.asked = open.retry.asked;
    turn.typed = said;
    const company = open.retry.company;
    if (company && connectionAt(run, company) && !pairExample(turn.asked))
      body.company = company;
    return undefined;
  }
  // "sign out of Harborline", "sign in to Lantern": asked first.
  if (body.companies === true) {
    const command = accountCommand(
      written,
      run.connections.map((c) => nameable(c, turn.lab)),
    );
    if (command) return accountWords(turn, command, said);
  }
  return undefined;
}

/** The one example of the demo's that is for two Companies at once. */
const pairExample = (asked: string) =>
  demoExamplesFor(asked).some((example) => !!example.with);

/** The request that waited at a Company, now gone with the question. */
function dropResume(run: Run, open: Asking | undefined) {
  if (open && "resume" in open) {
    const connection = connectionAt(run, open.resume);
    if (connection) delete connection.resume;
  }
}

/**
 * An answer of the agent's own, kept as the User's line and its answer.
 * `about` is the Company it is about; the model isn't told.
 */
function says(
  turn: HeldTurn,
  about: Connection | undefined,
  text: string,
  said: string,
  extra: Record<string, unknown> = {},
  question?: Question,
): Answered {
  const run = turn.conversation;
  const full = question ? `${text} ${question.text}` : text;
  recordAsked(run, about, about?.accountToken ? [originOf(about)] : [], {
    said,
    text: full,
    ...(question ? { spoken: `${text} ${question.spoken}` } : {}),
    ...(question ? { choices: question.choices } : {}),
  });
  return {
    reply: ownAnswer(turn, full, question?.choices ?? [], {
      ...(question ? { spoken: `${text} ${question.spoken}` } : {}),
      ...extra,
    }),
  };
}

/**
 * The User's decision on one proposal, at the revision the question
 * named: through the account route's own handler, as the card's button.
 */
async function decide(
  turn: HeldTurn,
  caller: Caller,
  ref: ProposalRef,
  decision: "approve" | "decline",
  said: string,
  /** The User answered in their own words, not with a button. */
  typed = false,
): Promise<Answered> {
  const run = turn.conversation;
  const connection = connectionAt(run, ref.company);
  const op = connection?.operations?.[ref.proposal];
  const name = connection
    ? companyName(connection)
    : nameFor(run, originOf({ url: ref.company }));
  const language = languageOf(run);
  const what = op
    ? proposalName(op, name, language)
    : say(language, "proposalAt", { name });
  const done = { approve: decision === "approve" };
  const accounts = connection && op ? accountsOf(connection, op) : [];
  const record = (text: string, extra: Record<string, unknown> = {}) => {
    recordAsked(run, connection, accounts, { said, text });
    return { reply: ownAnswer(turn, text, [], extra) };
  };
  if (!connection || !op)
    return record(say(language, "proposalGone", { what, ...done }));
  // Terms other than the ones asked about: never approved for the User.
  if (op.revision !== ref.revision) {
    const changed = say(language, "termsChanged", { name, ...done });
    if (live(op)) {
      const question = askApproval(
        run,
        [{ connection, op }],
        waitingProposals(run).filter((w) => w.op !== op),
        turn.lab,
        said,
        changed,
      )!;
      return {
        reply: ownAnswer(turn, question.text, question.choices, {
          spoken: question.spoken,
          proposals: question.proposals,
        }),
      };
    }
    return record(changed);
  }
  if (op.state !== "proposed" || (decision === "decline" && !live(op)))
    return record(settled(op, what, name, done.approve, language));
  const answer = await actOn(
    run,
    connection,
    {
      action: decision,
      company: ref.company,
      id: ref.proposal,
      revision: ref.revision,
      // The approval says how the User gave it; nothing else differs.
      ...(typed ? { input: "typed" } : {}),
    },
    caller,
  );
  const result = (answer.body ?? {}) as {
    operation?: Operation;
    code?: string;
    error?: unknown;
    trace?: string[];
    history?: unknown;
    log?: unknown;
  };
  const from = companyRef(run, originOf(connection));
  const trace = result.trace ?? [];
  const extra = {
    trace,
    // The lines are the Company's, though the words are the agent's.
    traces: [{ from, trace }],
    ...companiesView(run),
    ...(result.history !== undefined ? { history: result.history } : {}),
    ...(result.log !== undefined ? { log: result.log } : {}),
  };
  const now = result.operation ?? op;
  const text =
    answer.status === 200 && now.state === "succeeded"
      ? say(language, "performed", { what, name })
      : answer.status === 200 && result.code === "approval_declined"
        ? say(language, "approvalRefused", { name })
        : answer.status === 200 && now.state === "declined"
          ? say(language, "declined", { name })
          : typeof result.error === "string" && result.error
            ? result.error
            : say(language, "notSent", { name, ...done });
  // New terms in answer to the approval: asked about, as any proposal is.
  const next =
    result.code === "terms_changed" && result.operation
      ? connection.operations?.[result.operation.operation_id]
      : undefined;
  if (next && live(next)) {
    const question = askApproval(
      run,
      [{ connection, op: next }],
      waitingProposals(run).filter((w) => w.op !== next),
      turn.lab,
      said,
      text,
    )!;
    return {
      reply: ownAnswer(turn, question.text, question.choices, {
        ...extra,
        spoken: question.spoken,
        proposals: question.proposals,
      }),
    };
  }
  // Once decided, what else waits is asked about; after a refusal the
  // card and these words say what to do, and nothing else is asked.
  if (answer.status !== 200) {
    recordAsked(run, connection, accounts, { said, text });
    return { reply: ownAnswer(turn, text, [], extra) };
  }
  return remaining(turn, connection, accounts, said, text, extra, op);
}

/** After one decision: what else the question named and still waits. */
function remaining(
  turn: HeldTurn,
  connection: Connection,
  accounts: string[],
  said: string,
  text: string,
  extra: Record<string, unknown>,
  decided: Operation,
): Answered {
  const run = turn.conversation;
  const left = waitingProposals(run).filter((w) => w.op !== decided);
  if (!left.length) {
    recordAsked(run, connection, accounts, { said, text });
    return { reply: ownAnswer(turn, text, [], extra) };
  }
  const language = languageOf(run);
  const names = left.map(({ connection: c, op }) =>
    proposalName(op, companyName(c), language),
  );
  const follow =
    left.length === 1
      ? say(language, "stillWaitsOne", { what: names[0]! })
      : say(language, "stillWaitMany", { names });
  const question = {
    text: `${text} ${follow}`,
    spoken: spokenText(`${text} ${follow}`, language),
    choices: decisionChoices(run, left, turn.lab),
  };
  run.asking = {
    approve: left.map(({ connection: c, op }) => refOf(c, op)),
    ...(left.length > 1 ? { which: true as const } : {}),
  };
  recordAsked(
    run,
    connection,
    [
      ...new Set([
        ...accounts,
        ...left.flatMap(({ connection: c, op }) => accountsOf(c, op)),
      ]),
    ],
    { said, ...question },
  );
  return {
    reply: ownAnswer(turn, question.text, question.choices, {
      ...extra,
    }),
  };
}

/** Why a proposal takes no answer any more, in the agent's words. */
function settled(
  op: Operation,
  what: string,
  name: string,
  approve: boolean,
  language: Language,
) {
  switch (op.state) {
    case "succeeded":
      return say(language, "alreadyApproved", {
        what,
        name,
        byAgent: op.approvedBy?.approver === "agent",
      });
    case "declined":
      return say(language, "alreadyDeclined", { what, name });
    case "uncertain":
      return say(language, "outcomeUnknown", { what, name });
    case "proposed":
    case "expired":
      return say(language, "expired", { what, approve });
    default:
      return say(language, "noLongerWaits", { what, approve });
  }
}

/**
 * "Yes" to a sign-in, when it reaches the agent: only the User's browser
 * or app can open the Company's page, so the agent answers with the
 * button that does, and the question stays open.
 */
function signInAgain(
  turn: HeldTurn,
  asked: { company: string; access: "read" | "write" },
  said: string,
): Answered {
  const run = turn.conversation;
  const connection = connectionAt(run, asked.company);
  const language = languageOf(run);
  if (!connection)
    return says(
      turn,
      undefined,
      say(language, "notConnectedAnyMore", {
        name: nameFor(run, originOf({ url: asked.company })),
      }),
      said,
    );
  const name = companyName(connection);
  if (!signsIn(connection))
    return says(
      turn,
      connection,
      say(language, "noSignInOffered", { names: [name] }),
      said,
    );
  const origin = originOf(connection);
  const text = say(language, "signInOpen", {
    name,
    write: asked.access === "write",
  });
  const choices = [
    choice(
      run,
      { signin: { company: origin, access: asked.access } },
      turn.lab,
    ),
  ];
  run.asking = { signin: { company: origin, access: asked.access } };
  recordAsked(run, connection, [], { said, text, choices });
  return { reply: ownAnswer(turn, text, choices) };
}

/** Signs out at one Company, through the account route's own handler. */
async function signOut(
  turn: HeldTurn,
  caller: Caller,
  company: string,
  said: string,
): Promise<Answered> {
  const run = turn.conversation;
  const connection = connectionAt(run, company);
  const name = connection
    ? companyName(connection)
    : nameFor(run, originOf({ url: company }));
  const language = languageOf(run);
  if (!connection?.accountToken)
    return says(
      turn,
      undefined,
      say(language, "notSignedIn", { names: [name] }),
      said,
    );
  const answer = await actOn(
    run,
    connection,
    { action: "signout", company: originOf(connection) },
    caller,
  );
  const result = (answer.body ?? {}) as {
    error?: unknown;
    trace?: string[];
    history?: unknown;
    log?: unknown;
  };
  const from = companyRef(run, originOf(connection));
  const trace = result.trace ?? [];
  const text =
    answer.status === 200
      ? say(language, "signedOut", { name })
      : typeof result.error === "string" && result.error
        ? result.error
        : say(language, "signOutFailed", { name });
  // What the conversation shows after the sign-out comes first, then this.
  return says(turn, undefined, text, said, {
    trace,
    traces: [{ from, trace }],
    ...companiesView(run),
    ...(result.history !== undefined ? { history: result.history } : {}),
    ...(result.log !== undefined ? { log: result.log } : {}),
  });
}

/** Goes on with the request that waited for the sign-in at a Company. */
function resume(
  turn: HeldTurn,
  request: ChatRequest,
  company: string,
): Answered {
  const run = turn.conversation;
  const connection = connectionAt(run, company);
  const waited = connection?.resume;
  if (connection) delete connection.resume;
  if (!connection || !waited || waited.at + RESUME_MS < Date.now())
    return says(
      turn,
      connection,
      say(languageOf(run), "nothingToResume", {
        name: connection ? companyName(connection) : undefined,
      }),
      turn.message,
    );
  turn.asked = waited.asked;
  turn.typed = turn.message;
  if (!pairExample(waited.asked)) request.body.company = originOf(connection);
  return undefined;
}

/** §8.10: the User's answer to a Company's invitation to talk directly. */
function invitation(
  turn: HeldTurn,
  company: string,
  accept: boolean,
): Answered {
  const run = turn.conversation;
  const connection = connectionAt(run, company);
  if (!connection || directState(connection).invitation === null)
    return says(
      turn,
      connection,
      say(languageOf(run), "invitationGone", {
        name: nameFor(run, originOf({ url: company })),
      }),
      turn.message,
    );
  return { direct: accept ? "accept" : "decline", connection };
}

/** "sign out of Harborline", "sign in to Lantern": the agent asks first. */
function accountWords(
  turn: HeldTurn,
  command: NonNullable<ReturnType<typeof accountCommand>>,
  said: string,
): Answered {
  const run = turn.conversation;
  const lab = turn.lab;
  const language = languageOf(run);
  const named = command.named.flatMap((n) => {
    const c = connectionAt(run, n.url);
    return c ? [c] : [];
  });
  if (command.verb === "signout") {
    const signedIn = (named.length ? named : run.connections).filter(
      (c) => c.accountToken,
    );
    if (!signedIn.length)
      return says(
        turn,
        undefined,
        named.length
          ? say(language, "notSignedIn", { names: named.map(companyName) })
          : say(language, "notSignedInAnywhere"),
        said,
      );
    if (signedIn.length > 1) {
      const question = {
        text: say(language, "whichSignOut", {
          names: signedIn.map(companyName),
        }),
        spoken: "",
        choices: signedIn.map((c) =>
          choice(run, { signout: originOf(c) }, lab),
        ),
      };
      question.spoken = question.text;
      run.asking = { signout: signedIn.map(originOf) };
      recordAsked(run, undefined, [], { said, ...question });
      return { reply: ownAnswer(turn, question.text, question.choices) };
    }
    const connection = signedIn[0]!;
    const name = companyName(connection);
    const question = {
      text: say(language, "signOutAsk", { name }),
      spoken: say(language, "signOutAskSpoken", { name }),
      choices: [choice(run, { signout: originOf(connection) }, lab)],
    };
    run.asking = { signout: [originOf(connection)] };
    recordAsked(run, undefined, [], { said, ...question });
    return {
      reply: ownAnswer(turn, question.text, question.choices, {
        spoken: question.spoken,
      }),
    };
  }
  // A sign-in: at the Company named, or the one there is to sign in to.
  const offered = (named.length ? named : run.connections).filter(signsIn);
  const targets = named.length
    ? offered
    : offered.length > 1
      ? offered.filter((c) => !c.accountToken)
      : offered;
  if (!targets.length)
    return says(
      turn,
      undefined,
      named.length
        ? say(language, "noSignInOffered", { names: named.map(companyName) })
        : run.connections.length
          ? say(language, "nothingToSignIn")
          : say(language, "noCompanyYet"),
      said,
    );
  if (targets.length > 1) {
    const question = {
      text: say(language, "whichSignIn", { names: targets.map(companyName) }),
      choices: targets.map((c) =>
        choice(run, { signin: { company: originOf(c), access: "read" } }, lab),
      ),
    };
    recordAsked(run, undefined, [], { said, ...question });
    return { reply: ownAnswer(turn, question.text, question.choices) };
  }
  const connection = targets[0]!;
  const signedIn = !!connection.accountToken && !connection.accountUnavailable;
  const more =
    signedIn &&
    canRequestChanges(
      companyProfile(connection.company!),
      connection.scopes ?? "",
    );
  if (signedIn && !more)
    return says(
      turn,
      connection,
      say(language, "alreadySignedIn", { name: companyName(connection) }),
      said,
    );
  const access = more ? "write" : "read";
  const question = signInQuestion(run, connection, access, lab);
  run.asking = { signin: { company: originOf(connection), access } };
  recordAsked(run, connection, signedIn ? [originOf(connection)] : [], {
    said,
    ...question,
  });
  return {
    reply: ownAnswer(turn, question.text, question.choices, {
      spoken: question.spoken,
    }),
  };
}

/**
 * Whether the message can be answered with no model: a button that does
 * something itself, an answer to the open question, one of the agent's
 * own commands, or one of demo mode's scripted examples. Such a turn
 * takes no free-model turn and waits for no browser check.
 */
export function withoutModel(
  run: Run,
  request: ChatRequest,
  open: Asking | undefined,
  lab: readonly Nameable[],
  commands: (message: string) => boolean,
) {
  const { pressed, written } = request;
  if (pressed) return !("company" in pressed) && !("resume" in pressed);
  if (demoExamplesFor(written).length) return true;
  if (open && "approve" in open)
    return (
      readApproval(
        written,
        open.approve.map((ref) => {
          const c = connectionAt(run, ref.company);
          const op = c?.operations?.[ref.proposal];
          const names = c
            ? [nameable(c, lab).name, nameable(c, lab).alias ?? ""]
            : [];
          return op ? named(op, names) : { names, noun: "change" };
        }),
        !!open.which,
      ) !== undefined
    );
  if (open && ("signin" in open || "signout" in open || "invitation" in open))
    if (yesOrNo(written, Object.values(SAYS_YES).flat())) return true;
  if (open && "resume" in open && yesOrNo(written) === "no") return true;
  if (
    accountCommand(
      written,
      run.connections.map((c) => nameable(c, lab)),
    )
  )
    return true;
  return commands(written);
}

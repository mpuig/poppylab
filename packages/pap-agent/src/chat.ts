import type { ApiTool } from "@poppy-lab/pap-client";
import { companyProfile } from "@poppy-lab/pap-core";
import { runModel } from "@poppy-lab/llm-adapters/server";
import { agentName } from "./agent";
import { accountNote } from "./account-permissions";
import {
  answerStream,
  turnEvents,
  wantsEvents,
  type TurnStream,
} from "./answer-stream";
import { answerQuestion, askAfter, before, withoutModel } from "./chat-answers";
import { checkChatBody } from "./chat-body";
import { chooseCompany } from "./chat-companies";
import { demoReply } from "./chat-demo";
import { failedTurn } from "./chat-failure";
import { severalTurn } from "./chat-several";
import {
  companiesNow,
  turnAddressed,
  turnState,
  type HeldTurn,
  type TurnScope,
} from "./chat-turn";
import {
  companiesTool,
  newCompaniesUse,
  type CompaniesUse,
} from "./companies-tool";
import { answerLabel, answers, typedAnswer } from "./company-commands";
import { connectCommand } from "./connect-command";
import {
  companyRef,
  connectionAt,
  connectionNamed,
  newConnection,
  originOf,
} from "./connections";
import { lostAccess } from "./conversation-view";
import type { CompanyEntry, DirectAction } from "./conversations";
import { publicMode, serving } from "./deployment";
import { directState } from "./direct-state";
import { admitFreeTurn, modelProvider, type FreeTurn } from "./free-model";
import { keepLines } from "./inspector-log";
import { labCompanies, nameable } from "./lab-companies";
import { conversationEnded, overBudget } from "./limits";
import { noteOperationAccounts } from "./operation-store";
import { offeredTools } from "./routing";
import { notSaved } from "./run-size";
import { acquireRun, createRun, releaseRun, type Held } from "./runs";
import {
  connect,
  directConversation,
  type Connection,
  type Run,
} from "./runtime";
import { shownSkills, shownTasks } from "./shown-tasks";
import { spokenText } from "./spoken";
import {
  accountsIn,
  forgetLostAccount,
  recordAsked,
  recordDirect,
  recordTurn,
  turnAccounts,
} from "./transcript";
import { UserFacingError } from "./user-error";
import {
  browserCaller,
  json,
  readJson,
  toResponse,
  type Caller,
  type CookieStore,
  type Reply,
} from "./web";

let active = 0;
let count = 0;
let windowStart = Date.now();
/** What `reply` tells `chatTurn` besides its answer. */
type Outcome = {
  /** The conversation the turn was in. */
  id?: string;
  /** Why the conversation couldn't be saved after the turn, if it wasn't. */
  unsaved?: unknown;
};
/**
 * One request of the chat: the User's message, or the answer one of the
 * buttons under Iris's own answer carries, or an action on a Direct
 * Conversation. `read` gives its body (`ChatBody`), and is called once
 * the request is let in; `conversation` names the conversation it is in,
 * if any.
 */
export type ChatInput = {
  read: () => Promise<unknown>;
  conversation?: string | undefined;
  /** Where the model's answer goes as it is written, for a client that streams it. */
  stream?: TurnStream | undefined;
};
/** The answer, and the conversation it was in (new or the one named). */
export type ChatTurn = Reply & { conversation?: string };
/**
 * A turn of the chat, for any channel. A turn whose conversation couldn't
 * be saved is answered as that and not with its answer: a reload wouldn't
 * show the answer, and a proposal in it couldn't be approved.
 */
export async function chatTurn(
  input: ChatInput,
  caller: Caller,
): Promise<ChatTurn> {
  const started: Outcome = {};
  const answer = await reply(input, caller, started);
  const failed = started.unsaved ? notSaved(started.unsaved) : undefined;
  return {
    ...(failed
      ? json(
          { code: failed.code, error: failed.error, stage: "save", trace: [] },
          { status: failed.status, headers: { "Cache-Control": "no-store" } },
        )
      : answer),
    ...(started.id ? { conversation: started.id } : {}),
  };
}
/**
 * `POST /api/chat` as the playground's page speaks it: the conversation
 * in the `X-Poppy-Conversation` header, both ways, so the page can keep
 * its address (docs/chat-continuity.md).
 */
export async function chat(request: Request, cookies: CookieStore) {
  const input: ChatInput = {
    read: () => readJson(request, 6000),
    conversation: request.headers.get("x-poppy-conversation") ?? undefined,
  };
  const caller = await browserCaller(request, cookies);
  const answer = (turn: ChatTurn) => {
    const response = toResponse(turn);
    if (turn.conversation)
      response.headers.set("X-Poppy-Conversation", turn.conversation);
    return response;
  };
  if (!wantsEvents(request)) return answer(await chatTurn(input, caller));
  // The page shows the model's answer as it is written, and the rest of
  // the turn whole, from the event that ends the stream: `answer`, with
  // the status, headers and body the response would have had.
  return turnEvents(async (send) => {
    const { stream } = answerStream(send);
    let lines = 0;
    const turn = await chatTurn(
      {
        ...input,
        stream: {
          text: stream.text,
          // Iris's own line before the answer, whole, which the page shows
          // as its own words and not as an answer.
          line: (text) =>
            send({
              type: "message.delta",
              message: `own-${++lines}`,
              index: 0,
              text,
              own: true,
            } as { type: string }),
        },
      },
      caller,
    );
    return {
      last: {
        type: "answer",
        status: turn.status,
        headers: {
          ...turn.headers,
          ...(turn.conversation
            ? { "X-Poppy-Conversation": turn.conversation }
            : {}),
        },
        body: turn.body,
      },
      instead: () => answer(turn),
    };
  });
}
/**
 * One turn, from the guards that let it in to the bookkeeping after it:
 * the body is checked (`checkChatBody`), the conversation held, the
 * Company chosen (`chooseCompany`), and the turn asked of it, of several
 * (`severalTurn`), of the demo's rules (`demoReply`) or of the model.
 */
async function reply(
  input: ChatInput,
  caller: Caller,
  started: Outcome,
): Promise<Reply> {
  if (!serving())
    return json(
      { error: "Chat is disabled on this deployment." },
      { status: 403 },
    );
  if (!caller.authentic)
    return json(
      { error: "Same-origin browser requests required" },
      { status: 403 },
    );
  if (Date.now() - windowStart > 60000) {
    count = 0;
    windowStart = Date.now();
  }
  // Per isolate; public budgets per visitor, IP and globally follow.
  if (active >= (publicMode() ? 20 : 3) || count >= (publicMode() ? 120 : 20))
    return json({ error: "Chat is busy; retry in a minute." }, { status: 429 });
  active++;
  count++;
  const scope: TurnScope = {
    parts: [],
    stage: "request",
    knewLost: false,
    trace: [],
    did: { changed: false, kept: 0 },
  };
  const { trace } = scope;
  let held: Held | undefined;
  let visitor: string | undefined;
  let free: FreeTurn | undefined;
  try {
    const request = checkChatBody(await input.read(), caller);
    if ("refused" in request) return request.refused;
    const { body, pressed } = request;
    let direct = request.direct;
    visitor = caller.user(true);
    const limited = await overBudget(caller.ip, visitor, "chat");
    if (limited) return limited;
    const named = input.conversation;
    const current = await acquireRun(visitor, named);
    if (current === "busy")
      throw new UserFacingError("Wait for the current response.");
    held = current;
    // One that ended is still on the page that names it: the page is told,
    // and nothing is answered in another conversation under its messages.
    const over = held ? undefined : await conversationEnded(visitor, named);
    if (over) return over;
    // A conversation unknown here continues as a new one, and so does one
    // that isn't connected to the Company the page shows.
    const fresh =
      !held || (body.url !== undefined && !connectionAt(held.run, body.url));
    // The Companies of the conversation the turn would be in: the one
    // named, or a new one's, which starts with the Company at `url`.
    const within: Pick<Run, "connections"> =
      held && !fresh
        ? held.run
        : {
            connections:
              body.url === undefined ? [] : [newConnection({}, body.url)],
          };
    const lab = labCompanies(caller.origin);
    // What follows is refused before a conversation is started, so a
    // refusal leaves none behind.
    const refuse = (refusal: object) => {
      if (held && !fresh) started.id = held.id;
      return json(refusal, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    };
    // The Company the request names has to be one of the conversation's,
    // and so has the Company a button picks.
    const picked =
      pressed && "company" in pressed ? pressed.company : body.company;
    if (picked !== undefined && !connectionAt(within, picked))
      return refuse(connectionNamed(within, picked));
    // A button connects a Company of the lab's and no other: an address
    // is never taken from a request as something to read. One that is
    // connected already is answered so.
    if (
      pressed &&
      "connect" in pressed &&
      !lab.some((c) => originOf(c) === originOf({ url: pressed.connect })) &&
      !connectionAt(within, pressed.connect)
    )
      return refuse({
        code: "invalid_answer",
        error:
          "That button is for a company the lab doesn't list. To connect another company, type its address in the address box.",
      });
    // A conversation with no Company yet is for a page that can show one
    // and let the User choose its Companies. A page that shows one
    // Company names it, as it always had to.
    if (fresh && body.url === undefined && body.companies !== true)
      throw new UserFacingError(
        "Enter a Company URL and a message of at most 2000 characters.",
      );
    if (fresh) {
      if (held) await releaseRun(visitor, held).catch(() => {});
      held = await createRun(visitor, body.url);
    }
    if (!held) throw new Error("No conversation for the turn");
    started.id = held.id;
    const run = (scope.run = held.run);
    // What the User said: their words, or the label of the button they
    // pressed, which the page showed as their line. The label is worked
    // out again here: nothing a button sends is ever taken as words.
    const message = pressed ? answerLabel(run, pressed, lab) : request.written;
    if (!pressed) run.title ??= message.trim().slice(0, 80);
    if (run.calls >= 20)
      throw new UserFacingError(
        "This run reached its 20-turn limit. Connect again to start another run.",
      );
    // The agent's own question, open until this message, which may answer
    // it; and what the conversation held before, for the question after.
    const open = run.asking;
    delete run.asking;
    scope.before = before(run);
    // A message that needs no model: an answer to the agent's question,
    // one of its commands or a scripted example (`withoutModel`). It runs
    // as the demo does, and never waits for or mentions the browser check.
    const typedOnly =
      !direct &&
      !pressed &&
      withoutModel(run, request, open, lab, (words) => {
        if (run.removing && typedAnswer(words, run.removing)) return true;
        if (body.companies !== true) return false;
        const command = connectCommand(words, {
          connected: run.connections.map((c) => nameable(c, lab)),
          lab,
        });
        return !!command && (!("rest" in command) || !command.rest);
      });
    // The free model past its checks and limits, or demo mode with Iris's
    // line about why, shown before the answer. Checked only after the
    // conversation's cheap pre-flight guards and only when the request
    // needs a model (never for Direct Conversations, buttons that don't
    // continue to a model turn, or what `typedOnly` holds), so rejected
    // and non-model requests don't burn a Turnstile token or free-model
    // quota.
    let provider = request.provider;
    let modelConfig: HeldTurn["modelConfig"] = request.modelConfig;
    const needsModel =
      !direct &&
      (pressed
        ? ("company" in pressed && !!run.waiting) ||
          // The request that waited for a sign-in, asked now.
          "resume" in pressed ||
          ("remove" in pressed &&
            !!run.removing &&
            answers(run.removing, pressed.remove) &&
            !!run.removing.rest)
        : !typedOnly);
    if (provider === "free" && typedOnly) provider = "demo";
    if (provider === "free" && needsModel) {
      const admitted = await admitFreeTurn(caller, visitor, request.turnstile);
      if ("notice" in admitted) {
        provider = "demo";
        scope.did.before = admitted.notice;
      } else {
        free = admitted;
        modelConfig = { ...modelConfig, workersAi: admitted.workersAi };
      }
    }
    const turn: HeldTurn = {
      scope,
      conversation: run,
      lab,
      provider,
      modelConfig,
      message,
      asked: message,
      typed: undefined,
      also: [],
      stream: input.stream,
    };
    // The User's answer to that question, read before any model or rule
    // of the demo sees the message.
    const answered = await answerQuestion(turn, request, open, caller);
    if (answered && "reply" in answered) {
      delete run.waiting;
      delete run.removing;
      return answered.reply;
    }
    if (answered) {
      // "Yes" to a Company's invitation: the User's own §8.10 action.
      delete run.waiting;
      delete run.removing;
      direct = answered.direct;
      scope.connection = answered.connection;
    } else {
      const chosen = await chooseCompany(turn, request);
      if (chosen) return chosen;
    }
    const connection = scope.connection;
    if (!connection) throw new Error("No connection for the turn");
    // A newer request here takes the place of one that waited for a
    // sign-in; this one is kept if it stops for one too.
    delete connection.resume;
    // What "try again" asks again, should the turn fail. A User's words
    // to a Company in a Direct Conversation are theirs to send again.
    if (!direct)
      scope.retry = { asked: turn.asked, company: originOf(connection) };
    if (turn.also.length && !direct)
      return await severalTurn(turn, [...turn.also, connection], connection);
    scope.knewLost = !!connection.accountUnavailable;
    scope.proposals = new Set(Object.values(connection.operations ?? {}));
    const shown: CompanyEntry[] = [];
    scope.stage = "pap";
    // What the model does about the conversation's Companies this turn.
    const use = newCompaniesUse();
    // Each tool is this Company's only while the request was asked of it.
    const tools = await connect(
      connection,
      trace,
      shown,
      turnAddressed(turn, [connection], () => use.used),
    );
    // What it offers stays with the connection, for the next turn's choice.
    connection.offered = offeredTools(tools);
    // A turn counts once the Company answered; a failed discovery is free.
    run.calls++;
    // Which Company the answer and each piece of Company content came from.
    const from = companyRef(run, originOf(connection));
    if (direct) return await directReply(turn, connection, direct, shown);
    // A model's answer keeps what each tool it called answered.
    const { text, raw } =
      turn.provider === "demo"
        ? await demoReply(turn, connection, tools)
        : await modelReply(
            turn,
            connection,
            tools,
            // Only a page that shows several Companies can show another.
            body.companies === true ? use : undefined,
          );
    const exact =
      raw !== undefined ? JSON.stringify(raw).slice(0, 20000) : undefined;
    // The model's context gets the two turns. The page's transcript also
    // keeps what this turn shows, to show it again after a reload.
    recordTurn(run, connection, turn.asked, text, {
      company: shown,
      trace,
      demo: turn.provider === "demo",
      data: exact,
      context: scope.context,
      typed: turn.typed,
    });
    run.history = run.history.slice(-10);
    // What waits for the User now, asked in the agent's own words: the
    // removal the model asked for comes first, as the typed one would.
    const asked = use.question;
    if (asked) recordAsked(run, undefined, [], asked);
    const question =
      asked ?? askAfter(turn, scope.before!, [{ connection, trace }]);
    // The turn ended with an answer though the access went during it: what
    // the page showed with the account goes all the same, this turn too.
    const lost = lostAccess(run, connection, scope.knewLost);
    return json(
      {
        text,
        spoken: spokenText(text),
        ...(question ? { question } : {}),
        ...(exact !== undefined ? { data: exact } : {}),
        trace,
        // A Company the model connected has its own lines, under its name.
        ...(use.lines.length
          ? {
              traces: [
                ...use.lines.map(({ company, line }) => ({
                  from: companyRef(run, company),
                  trace: [line],
                })),
                { from, trace },
              ],
            }
          : {}),
        mode: turn.provider,
        // The Company the turn was with: the answer came from there, and
        // the state that follows is that Company's.
        from,
        // Iris's own line from before it asked the Company, to show first.
        ...(scope.did.before ? { before: scope.did.before } : {}),
        ...turnState(connection),
        company: shown.map((entry) => ({ ...entry, from })),
        ...companiesNow(turn),
        ...lost,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // "Try again", typed next, asks the same request again.
    if (scope.run && scope.retry) scope.run.asking = { retry: scope.retry };
    return failedTurn(error, scope);
  } finally {
    const { run, connection, parts, context, proposals, did, knewLost } = scope;
    // Whose accounts what the turn did could hold: in a turn with several
    // Companies, what it read at any of them.
    const accounts =
      run && connection
        ? parts.length
          ? turnAccounts(
              run,
              parts.map((part) => part.connection),
              context,
            )
          : accountsIn(run, connection, context)
        : [];
    // A proposal this turn left can hold what a model read with another
    // Company's account, as the turn's answer can: it is listed with the
    // same accounts, and goes when one of them is reset.
    if (run && connection && proposals)
      noteOperationAccounts(connection, proposals, accounts);
    for (const part of parts)
      noteOperationAccounts(part.connection, part.proposals, accounts);
    // The lines stay with the conversation, for a reload and History, each
    // with the Company it was written for.
    if (run && connection)
      keepLines(
        run,
        connection,
        trace.slice(did.kept),
        Date.now(),
        !!connection.accountToken,
        accounts,
      );
    for (const part of parts)
      if (run)
        keepLines(
          run,
          part.connection,
          part.trace,
          Date.now(),
          !!part.connection.accountToken,
          accounts,
        );
    // However the turn ended: an error of another kind can follow the
    // request in which the Company refused the sign-in. After the lines
    // are kept, so those written with the account go with the rest.
    if (run && connection) forgetLostAccount(run, connection, knewLost);
    for (const part of parts)
      if (run && part.connection !== connection)
        forgetLostAccount(run, part.connection, part.knewLost);
    if (held && visitor)
      await releaseRun(visitor, held).catch((error: unknown) => {
        started.unsaved = error;
      });
    // What the free model cost, however the turn ended.
    if (free) await free.settle().catch(() => {});
    active--;
  }
}

/**
 * §8.10: the User's own action on a Direct Conversation, not the model's.
 * Their words go to the Company as written; Iris adds only a line about
 * what happened.
 */
async function directReply(
  turn: HeldTurn,
  connection: Connection,
  direct: DirectAction,
  shown: CompanyEntry[],
) {
  const { scope, conversation: run, message } = turn;
  const { trace } = scope;
  const companyName = connection.company!.document.organization.name;
  const from = companyRef(run, originOf(connection));
  const result = (await directConversation(
    connection,
    direct,
    direct === "say" || direct === "start" ? message : undefined,
    trace,
    shown,
  )) as { note?: string; error?: string };
  const text =
    result.note ??
    {
      accept: `You're talking with ${companyName} directly. ${agentName()} doesn't read or answer here: what you type goes to ${companyName} as your own words.`,
      start: `You're talking with ${companyName} directly. ${agentName()} doesn't read or answer here: what you type goes to ${companyName} as your own words.`,
      say: "",
      decline: `${agentName()} told ${companyName} you're not available to talk directly right now.`,
      close: `You've left the direct conversation with ${companyName}. ${agentName()} is back.`,
    }[direct];
  // Their words are kept for the page, never for the model. They count
  // as sent only when the Company answered and Iris has nothing to say
  // about it: an error, or a note such as "this message wasn't sent",
  // may mean they never reached the Company.
  recordDirect(
    run,
    connection,
    companyName,
    direct,
    message,
    text,
    !result.error && !result.note,
    // What the page shows this turn, to show it again after a reload.
    { company: shown, trace },
  );
  run.history = run.history.slice(-10);
  const lost = lostAccess(run, connection, scope.knewLost);
  return json(
    {
      text,
      ...(text ? { spoken: spokenText(text) } : {}),
      trace,
      sessionId: connection.sessionId,
      mode: "direct",
      // The Company the User is talking with, whose state this is.
      from,
      signedIn: !!connection.accountToken && !connection.accountUnavailable,
      scopes: connection.scopes,
      operations: Object.values(connection.operations ?? {}),
      company: shown.map((entry) => ({ ...entry, from })),
      excludedTasks: shownTasks(connection),
      skills: shownSkills(connection),
      ...directState(connection),
      ...lost,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * The model's turn with one Company: its tools, the conversation's last
 * turns and what the User has there. `raw` keeps what each tool it
 * called answered, in order, for "Data".
 */
async function modelReply(
  turn: HeldTurn,
  connection: Connection,
  tools: Record<string, ApiTool>,
  /** The tool that connects or removes a Company, when the page can show it. */
  companies?: CompaniesUse,
): Promise<{ text: string; raw: unknown }> {
  const { scope, conversation: run } = turn;
  const companyName = connection.company!.document.organization.name;
  scope.stage = "provider";
  // The model is sent the last turns of the whole conversation, so what
  // it read with any Company's account can be in this answer and in the
  // requests it makes: both are kept as holding those accounts.
  const context = (scope.context = run.history.slice(-10));
  // Each tool's answer as the Company gave it, in the order the model
  // called them, for "Data" as demo mode keeps its one answer. The model
  // itself gets each one cut short.
  const answered: Array<{ tool: string; output: unknown }> = [];
  const recorded = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (input?: Record<string, unknown>) => {
          const output = await tool.execute(input);
          answered.push({ tool: name, output });
          return output;
        },
      },
    ]),
  );
  // Iris's own line from before the model, said before its answer.
  if (scope.did.before) turn.stream?.line(scope.did.before);
  const text = await runModel(
    modelProvider(turn.provider),
    // The roles and the words, without the Company each turn was with.
    [
      ...context.map(({ role, content }) => ({ role, content })),
      { role: "user", content: turn.asked },
    ],
    // Iris's own tool, last, so no Company's tool takes its name. What it
    // answers is Iris's, not the Company's, and isn't under "Data".
    companies
      ? { ...recorded, connect_company: companiesTool(turn, companies) }
      : recorded,
    {
      ...turn.modelConfig,
      name: agentName(),
      onText: turn.stream?.text,
      // Whether the User is signed in here, and with what: Company
      // content may say what a request needs, never what the User has.
      context: accountNote(companyName, {
        signedIn: !!connection.accountToken,
        lost: !!connection.accountUnavailable,
        granted: connection.scopes ?? "",
        profile: companyProfile(connection.company!),
      }),
    },
  );
  return { text, raw: answered.length ? answered : undefined };
}

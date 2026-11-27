import {
  accountRecovery,
  accountUnavailableNotice,
} from "@/lib/account-recovery";
import { accountNote } from "@/lib/account-permissions";
import { NextResponse } from "next/server";
import {
  InvalidToolArguments,
  ProtocolError,
  randomId,
} from "@poppy-lab/pap-client";
import { shoppingTarget } from "@/lib/shopping-context";
import { cookies } from "next/headers";
import {
  connect,
  directConversation,
  type Connection,
  type Operation,
  type Run,
  type Turn,
} from "@/lib/runtime";
import { noteOperationAccounts } from "@/lib/operation-store";
import {
  companyName as nameOf,
  companyRef,
  connectionAt,
  connectionNamed,
  MAX_CONNECTIONS,
  newConnection,
  originOf,
} from "@/lib/connections";
import { answeredWith } from "@/lib/company-names";
import {
  answerLabel,
  answers,
  choice,
  companiesAt,
  connectFor,
  keepCompanies,
  listed,
  noRoomFor,
  performCommand,
  readAnswer,
  typedAnswer,
  type Answer,
  type Choice,
  type Performed,
} from "@/lib/company-commands";
import { connectCommand, type ConnectCommand } from "@/lib/connect-command";
import { companiesView, lostAccess } from "@/lib/conversation-view";
import { labCompanies, nameable } from "@/lib/lab-companies";
import { directConnection, offeredTools, turnConnection } from "@/lib/routing";
import {
  accountsIn,
  forgetLostAccount,
  offerChoices,
  recordDirect,
  recordOwn,
  recordTurn,
} from "@/lib/transcript";
import { keepLines } from "@/lib/inspector-log";
import { shownSkills, shownTasks } from "@/lib/shown-tasks";
import type { CompanyEntry, DirectAction } from "@/lib/conversations";
import { directState } from "@/lib/direct-state";
import {
  acquireRun,
  createRun,
  releaseRun,
  visitorOf,
  type Held,
} from "@/lib/runs";
import { conversationEnded, overBudget } from "@/lib/limits";
import { notSaved } from "@/lib/run-size";
import { pickDemoTool } from "@/lib/demo-tool";
import {
  agentAnswer,
  feedbackAnswer,
  notSentReply,
  readable,
} from "@/lib/demo-text";
import { demoExamplesFor, demoGuidedReply } from "@/lib/demo-examples";
import {
  demoAside,
  demoChange,
  demoChangeKind,
  demoChangeReply,
} from "@/lib/demo-changes";
import { demoFdxAnswer, demoFdxRead, demoFdxReply } from "@/lib/demo-fdx";
import { demoEspiAnswer, demoEspiRead, demoEspiReply } from "@/lib/demo-espi";
import { UserFacingError } from "@/lib/user-error";
import { refusalFacts } from "@/lib/protocol-log";
import { companyProfile, PapDiscoveryError } from "@poppy-lab/pap-core";
import { localOrigins, publicMode, serving } from "@/lib/deployment";
import {
  askModel,
  runModel,
  ModelRequestError,
} from "@poppy-lab/llm-adapters/server";

export const runtime = "nodejs";

/**
 * One Company's state as a chat answer carries it: its Session, sign-in,
 * proposals, what its Session read (§9.1, §9.4; never for the model) and
 * its Direct Conversation. For a conversation with no Company, none.
 */
const turnState = (connection: Connection | undefined) => ({
  sessionId: connection?.sessionId,
  signedIn: !!connection?.accountToken && !connection.accountUnavailable,
  scopes: connection?.scopes,
  recovery: connection?.accountUnavailable
    ? accountUnavailableNotice
    : undefined,
  operations: Object.values(connection?.operations ?? {}),
  excludedTasks: connection ? shownTasks(connection) : [],
  skills: connection ? shownSkills(connection) : [],
  ...directState(connection ?? {}),
});

let active = 0;
let count = 0;
let windowStart = Date.now();
/** What `reply` tells `POST` besides its answer. */
type Outcome = {
  /** The conversation the turn was in. */
  id?: string;
  /** Why the conversation couldn't be saved after the turn, if it wasn't. */
  unsaved?: unknown;
};
/**
 * Names the conversation in a header, so the page can keep its address.
 * A turn whose conversation couldn't be saved is answered as that and not
 * with its answer: a reload wouldn't show the answer, and a proposal in
 * it couldn't be approved.
 */
export async function POST(request: Request) {
  const started: Outcome = {};
  const answer = await reply(request, started);
  const failed = started.unsaved ? notSaved(started.unsaved) : undefined;
  const response = failed
    ? NextResponse.json(
        { code: failed.code, error: failed.error, stage: "save", trace: [] },
        { status: failed.status, headers: { "Cache-Control": "no-store" } },
      )
    : answer;
  if (started.id) response.headers.set("X-Poppy-Conversation", started.id);
  return response;
}
async function reply(request: Request, started: Outcome) {
  if (!serving())
    return NextResponse.json(
      { error: "Chat is disabled on this deployment." },
      { status: 403 },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json(
      { error: "Same-origin browser requests required" },
      { status: 403 },
    );
  if (Date.now() - windowStart > 60000) {
    count = 0;
    windowStart = Date.now();
  }
  // Per isolate; public budgets per visitor, IP and globally follow.
  if (active >= (publicMode() ? 20 : 3) || count >= (publicMode() ? 120 : 20))
    return NextResponse.json(
      { error: "Chat is busy; retry in a minute." },
      { status: 429 },
    );
  active++;
  count++;
  let run: Run | undefined;
  // The Company this turn is for (`turnConnection`). None for a turn Iris
  // answers by itself: nothing is then sent to any Company.
  let connection: Connection | undefined;
  let held: Held | undefined;
  let visitor: string | undefined;
  let stage = "request";
  // Iris already knew, before this turn, that the Company no longer takes
  // the sign-in. A turn in which it learns that drops what it showed with
  // the account (`forgetLostAccount`).
  let knewLost = false;
  // The proposals the turn's Company had when the turn began: the ones it
  // leaves besides are this turn's (`noteOperationAccounts`).
  let proposals: Set<Operation> | undefined;
  // What Iris did this turn. A turn that fails answers with it too, so the
  // Inspector lists the request the Company refused. Every answer of a run
  // carries it, and the run keeps it (`finally`).
  const trace: string[] = [];
  // The turns a model was sent this turn; the demo's rules are sent none.
  let context: Turn[] | undefined;
  // What the User's words did to the conversation's Companies before the
  // turn was asked of one ("connect with Lantern and show me the menu"):
  // Iris's line about it, whether the Companies changed, what the
  // conversation still shows after a removal, and how many of the trace's
  // lines are kept with the conversation already. Every answer carries
  // these, a failed turn's too.
  const did: {
    before?: string;
    changed: boolean;
    left?: Performed["left"];
    kept: number;
  } = { changed: false, kept: 0 };
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new UserFacingError("Use JSON");
    const reader = request.body?.getReader();
    if (!reader) throw new UserFacingError("Missing request");
    let data = "";
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new UserFacingError("Request timed out")),
        3000,
      );
    });
    try {
      while (true) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (chunk.done) break;
        data += Buffer.from(chunk.value).toString("utf8");
        if (Buffer.byteLength(data) > 6000)
          throw new UserFacingError("Request too large");
      }
    } finally {
      clearTimeout(timer!);
      void reader.cancel();
    }
    const body = JSON.parse(data) as {
      /**
       * The Company the page shows, as a page with one Company sends it:
       * where a conversation unknown here starts, and otherwise the
       * Company the turn is for, as `company` says it.
       */
      url?: unknown;
      /** The Company this turn is for, by origin, when the User chose it. */
      company?: unknown;
      message?: unknown;
      /**
       * In place of `message`: what one of the buttons under Iris's own
       * answer carries (`Choice.answer`). It names Companies by origin and
       * is never read as words.
       */
      answer?: unknown;
      provider?: unknown;
      apiKey?: unknown;
      model?: unknown;
      /** §8.10: the User's own action on a Direct Conversation; no model. */
      direct?: unknown;
      /**
       * `true` from a page that shows several Companies. Only then are the
       * User's words read for connecting or removing one: a page that shows
       * one Company could not show, or speak to, a second.
       */
      companies?: unknown;
    };
    const directActions: readonly DirectAction[] = [
      "accept",
      "decline",
      "start",
      "say",
      "close",
    ];
    if (
      body.direct !== undefined &&
      !directActions.includes(body.direct as DirectAction)
    )
      throw new UserFacingError("Unknown Direct Conversation action.");
    const direct = body.direct as DirectAction | undefined;
    const address = (value: unknown): value is string | undefined =>
      value === undefined ||
      (typeof value === "string" && value.length <= 2048);
    // A button's answer comes in place of a message, never with one, and
    // never as one of the User's own Direct Conversation actions.
    const answer = readAnswer(body.answer);
    if (
      body.answer !== undefined &&
      (!answer || body.message !== undefined || direct)
    )
      throw new UserFacingError(
        "Send a message, or the answer one of Iris's buttons carries, and not both.",
      );
    // The button of one of demo mode's scripted examples sends it as the
    // User's message. Only the demo's own words are taken so, never a
    // Company's: anything else is refused.
    if (
      answer &&
      "message" in answer &&
      !demoExamplesFor(answer.message).length &&
      !demoGuidedReply(
        labCompanies(new URL(request.url).origin).map((c) => c.id),
      ).choices.some((c) => c.message === answer.message)
    )
      throw new UserFacingError(
        "That button is for an example the demo doesn't have. Type your request instead.",
      );
    const pressed = answer && !("message" in answer) ? answer : undefined;
    const written =
      answer && "message" in answer
        ? answer.message
        : typeof body.message === "string"
          ? body.message
          : "";
    if (
      !address(body.url) ||
      !address(body.company) ||
      (!pressed && (!written.trim() || written.length > 2000))
    )
      throw new UserFacingError(
        "Enter a Company URL and a message of at most 2000 characters.",
      );
    if (
      (body.apiKey !== undefined &&
        (typeof body.apiKey !== "string" ||
          body.apiKey.length > 2048 ||
          /[\r\n]/.test(body.apiKey))) ||
      (body.model !== undefined &&
        (typeof body.model !== "string" ||
          body.model.length > 120 ||
          !/^[a-zA-Z0-9._:/-]*$/.test(body.model)))
    )
      throw new UserFacingError("Invalid model configuration");
    const localDev =
      process.env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
    if (
      body.provider &&
      body.provider !== "demo" &&
      !localDev &&
      !body.apiKey &&
      !direct
    )
      return NextResponse.json(
        { error: "Add your API key in Model settings." },
        { status: 400 },
      );
    // Public: only the offered providers, each with the visitor's own key.
    if (
      !localDev &&
      body.provider !== undefined &&
      !["demo", "openai-compatible", "anthropic"].includes(
        String(body.provider),
      )
    )
      return NextResponse.json(
        { error: "Unsupported model provider." },
        { status: 400 },
      );
    if (body.apiKey && body.provider === "ollama")
      return NextResponse.json(
        { error: "Ollama does not use an API key." },
        { status: 400 },
      );
    const store = await cookies();
    visitor = visitorOf(store, true);
    const limited = await overBudget(request, visitor, "chat");
    if (limited) return limited;
    const named = request.headers.get("x-poppy-conversation") ?? undefined;
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
    const lab = labCompanies(new URL(request.url).origin);
    const provider = typeof body.provider === "string" ? body.provider : "demo";
    const modelConfig = {
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    };
    // What follows is refused before a conversation is started, so a
    // refusal leaves none behind.
    const refuse = (refusal: object) => {
      if (held && !fresh) started.id = held.id;
      return NextResponse.json(refusal, {
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
    run = held.run;
    const conversation = run;
    // What the User said: their words, or the label of the button they
    // pressed, which the page showed as their line. The label is worked
    // out again here: nothing a button sends is ever taken as words.
    const message = pressed ? answerLabel(run, pressed, lab) : written;
    if (!pressed) run.title ??= message.trim().slice(0, 80);
    if (run.calls >= 20)
      throw new UserFacingError(
        "This run reached its 20-turn limit. Connect again to start another run.",
      );
    // What an answer says of the conversation's Companies when the User's
    // words changed them: Iris's line about it when the turn went on to a
    // Company, the Companies as they are now, and what the conversation
    // still shows after a removal.
    const companies = () => ({
      ...(did.changed ? companiesView(conversation) : {}),
      ...did.left,
    });
    // An answer of Iris's own, about the conversation and from no Company.
    // The page that shows one Company gets the first one's state with it,
    // as a reload does. Its buttons are kept with it, for a reload.
    const own = (text: string, choices: Choice[] = []) => {
      offerChoices(conversation, text, choices);
      return NextResponse.json(
        {
          text,
          ...(did.before ? { before: did.before } : {}),
          trace,
          mode: "iris",
          ...(choices.length ? { choices } : {}),
          ...turnState(conversation.connections[0]),
          company: [],
          ...companies(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    };
    const hint = body.company ?? body.url;
    // What Iris was asked before it asked which Company: this message may
    // say which, and otherwise that request is dropped.
    const waiting = run.waiting;
    delete run.waiting;
    // The removal Iris asked the User to confirm: this message or button
    // may answer it, and otherwise the question is dropped.
    const removing = run.removing;
    delete run.removing;
    // The request this turn answers, and what the User typed when that is
    // something else: a Company's name in answer to Iris's question, or
    // nothing more (`null`), when the request is the rest of a message the
    // page already shows.
    let asked = message;
    let typed: string | null | undefined;
    if (direct) {
      // §8.10: the User's own words or choice. Never worked out from them.
      const target = directConnection(run, direct, hint);
      if ("code" in target)
        return NextResponse.json(target, {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        });
      connection = target;
    } else if (pressed && "company" in pressed) {
      // The button for one of the Companies Iris asked about: the request
      // that waited is asked there. A button of a question that is no
      // longer open has nothing to ask.
      if (!waiting) {
        const say =
          "No request is waiting for a company to be chosen. Type your request again.";
        recordOwn(run, undefined, message, say, false);
        return own(say);
      }
      connection = connectionAt(run, pressed.company);
      asked = waiting;
      typed = message;
    } else {
      // The User's own words can connect a Company or remove one. They are
      // read here, before any model or rule of the demo, and nothing else
      // is ever read for it: not Company content, not a model's answer.
      // What the User answers about a removal: a button, by origin, or
      // "yes" or "no" typed while Iris's question is open.
      const decided: Exclude<Answer, { company: string }> | undefined =
        pressed && !("company" in pressed)
          ? pressed
          : removing && !pressed
            ? typedAnswer(message, removing)
            : undefined;
      if (decided && "keep" in decided) {
        const done = keepCompanies(
          run,
          decided.keep,
          removing && answers(removing, decided.keep)
            ? removing.rest
            : undefined,
        );
        recordOwn(run, done.about, message, done.say, done.told);
        run.history = run.history.slice(-10);
        return own(done.say);
      }
      // Confirmed only when it is the removal Iris asked about. A button
      // of a question that is no longer open asks again when it has to.
      const confirmed =
        !!decided &&
        "remove" in decided &&
        !!removing &&
        answers(removing, decided.remove);
      // A button's answer is carried out as the same request typed in
      // words only ever meant for it, with the Companies it names.
      const command: ConnectCommand | undefined = decided
        ? "connect" in decided
          ? {
              verb: "connect",
              sure: true,
              companies: [
                lab.find(
                  (c) => originOf(c) === originOf({ url: decided.connect }),
                ) ?? { url: decided.connect, name: decided.connect },
              ],
              rest: "",
            }
          : {
              verb: "remove",
              sure: true,
              companies: companiesAt(run, decided.remove),
              rest: (confirmed && removing?.rest) || "",
            }
        : body.companies === true
          ? connectCommand(message, {
              connected: run.connections.map((c) => nameable(c, lab)),
              lab,
            })
          : undefined;
      // What Iris did about the Companies, said as its own line. When the
      // message asks for something else as well, the turn carries on with
      // that, and the line is shown first.
      const performed = (done: Performed) => {
        if (done.ask) conversation.removing = done.ask;
        trace.push(...done.trace);
        Object.assign(did, {
          changed: done.changed,
          ...(done.left ? { left: done.left } : {}),
          kept: trace.length,
        });
        recordOwn(conversation, done.about, message, done.say, done.told);
        conversation.history = conversation.history.slice(-10);
        if (!done.rest) return own(done.say, done.choices);
        did.before = done.say;
        asked = done.rest;
        typed = null;
        connection = done.at;
        return undefined;
      };
      if (command) {
        stage = "connect";
        const answered = performed(
          await performCommand(run, command, lab, localOrigins, confirmed),
        );
        if (answered) return answered;
      }
      // A Company's name, typed in answer to Iris asking which one.
      const answered =
        waiting && !command
          ? answeredWith(
              message,
              run.connections.map((c) => nameable(c, lab)),
            )
          : [];
      if (answered.length === 1) {
        connection = connectionAt(run, answered[0]!.url);
        asked = waiting!;
        typed = message;
      } else if (answered.length > 1) {
        // The name fits several: Iris asks again, and the request goes on
        // waiting for the answer.
        const say = `Which one is this for: ${listed(
          answered.map((c) => c.name),
          "or",
        )}?`;
        run.waiting = waiting!;
        recordOwn(run, undefined, message, say, false);
        return own(
          say,
          answered.map((c) =>
            choice(conversation, { company: originOf(c) }, lab),
          ),
        );
      } else if (!connection) {
        // The Company the page had chosen may be the one just removed.
        const chose =
          hint !== undefined && connectionAt(run, hint) ? hint : undefined;
        // Demo mode runs its scripted examples and nothing else: a message
        // that is none, for no Company the User chose, is answered by Iris
        // with the examples to try, and nothing is sent.
        const keys = run.connections.flatMap((c) => {
          const listed = lab.find((l) => originOf(l) === originOf(c));
          return listed ? [listed.id] : [];
        });
        const examples =
          provider === "demo" && chose === undefined
            ? demoExamplesFor(asked)
            : [];
        // The same words can be an example at several Companies ("my
        // orders"): the connected one is meant. With several connected,
        // the example names none and the turn is worked out as any other;
        // with none, the first is connected.
        const connected = examples.filter((e) =>
          keys.some((key) => key === e.company),
        );
        const example =
          connected.length === 1
            ? connected[0]
            : connected.length
              ? undefined
              : examples[0];
        if (provider === "demo" && chose === undefined && !examples.length) {
          const guided = demoGuidedReply(keys);
          recordOwn(run, undefined, asked, guided.text, false, typed !== null);
          run.history = run.history.slice(-10);
          return own(
            guided.text,
            guided.choices.map((c) => ({
              label: c.label,
              answer: { message: c.message },
            })),
          );
        }
        const route = await turnConnection(run, asked, chose, {
          // Only a page that shows several Companies can show another.
          ...(body.companies === true ? { lab } : {}),
          ...(example ? { example: example.company } : {}),
          ...(provider !== "demo"
            ? {
                ask: (question) => askModel(provider, question, modelConfig),
              }
            : {}),
        });
        if ("connect" in route) {
          // A request clearly for one of the lab's Companies, which isn't
          // connected: Iris connects it, as "connect with" it does, and
          // asks the request there. At as many Companies as a conversation
          // works with, it says so and offers to remove one.
          stage = "connect";
          const answered = performed(
            run.connections.length >= MAX_CONNECTIONS
              ? noRoomFor(run, route.connect, lab)
              : await connectFor(run, route.connect, asked, localOrigins),
          );
          if (answered) return answered;
        } else if (!run.connections.length) {
          const say = `This conversation isn't connected to a company yet, so Iris didn't send your request to any company. Connect one first: ${listed(
            lab.map((c) => c.name),
            "or",
          )} from the lab, or another company by typing its address in the address box.`;
          recordOwn(run, undefined, asked, say, say, typed !== null);
          run.history = run.history.slice(-10);
          return own(
            say,
            lab.map((c) => choice(conversation, { connect: originOf(c) }, lab)),
          );
        } else if ("ask" in route) {
          // Nothing is sent to any Company. The request waits for the
          // answer, which a button or the User's own words can give.
          const names = route.ask.map(nameOf);
          const say = `Is this for ${listed(names, "or")}? ${
            route.why === "none"
              ? "Nothing in your message says which."
              : `${names.length > 2 ? "Each of them" : "Both"} could have what you asked about.`
          }`;
          run.waiting = asked;
          recordOwn(run, undefined, asked, say, false, typed !== null);
          return own(
            say,
            route.ask.map((c) =>
              choice(conversation, { company: originOf(c) }, lab),
            ),
          );
        } else connection = route.connection;
      }
    }
    if (!connection) throw new Error("No connection for the turn");
    knewLost = !!connection.accountUnavailable;
    proposals = new Set(Object.values(connection.operations ?? {}));
    const shown: CompanyEntry[] = [];
    stage = "pap";
    const tools = await connect(connection, trace, shown);
    // What it offers stays with the connection, for the next turn's choice.
    connection.offered = offeredTools(tools);
    // A turn counts once the Company answered; a failed discovery is free.
    run.calls++;
    let text: string;
    // Demo mode has no model to put an answer into words: it shows the
    // Company's answer as plain lines and keeps the exact JSON for "Data".
    // A model's answer keeps what each tool it called answered.
    let raw: unknown;
    const show = (value: unknown) => {
      raw = value;
      return readable(value);
    };
    // What the Company's agent said is shown above as Company content; the
    // demo's lines point to it, and "Data" keeps the exact answer.
    const fromAgent = (value: unknown) => {
      raw = value;
      return agentAnswer(value, companyName);
    };
    const lowered = asked.toLowerCase();
    const companyName = connection.company!.document.organization.name;
    // Which Company the answer and each piece of Company content came from.
    const from = companyRef(run, originOf(connection));
    const change =
      provider === "demo" ? demoChangeKind(asked, tools) : undefined;
    const aside = provider === "demo" ? demoAside(asked, tools) : undefined;
    // Use FDX on: balances and transactions through the FDX-shaped tools.
    const fdxRead = provider === "demo" ? demoFdxRead(asked, tools) : undefined;
    // Use ESPI on: usage and bills through the ESPI-shaped tools.
    const espiRead =
      provider === "demo" ? demoEspiRead(asked, tools) : undefined;
    if (direct) {
      // §8.10: the User, not the model. Their words go to the Company as
      // written; Iris adds only a line about what happened.
      const result = (await directConversation(
        connection,
        direct,
        direct === "say" || direct === "start" ? message : undefined,
        trace,
        shown,
      )) as { note?: string; error?: string };
      text =
        result.note ??
        {
          accept: `You're talking with ${companyName} directly. Iris doesn't read or answer here: what you type goes to ${companyName} as your own words.`,
          start: `You're talking with ${companyName} directly. Iris doesn't read or answer here: what you type goes to ${companyName} as your own words.`,
          say: "",
          decline: `Iris told ${companyName} you're not available to talk directly right now.`,
          close: `You've left the direct conversation with ${companyName}. Iris is back.`,
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
      const lost = lostAccess(run, connection, knewLost);
      return NextResponse.json(
        {
          text,
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
    } else if (
      provider === "demo" &&
      tools.company_agent_send &&
      /never (arrived|came)|didn'?t arrive|nothing (arrived|came)|not delivered/.test(
        lowered,
      )
    ) {
      // The demo's way into a Direct Conversation (§8.10): report an order
      // that never arrived; the Company may ask to talk with the user.
      const status = (await tools.company_agent_send.execute({
        data: { request: "order_status" },
      })) as {
        replies?: Array<{ data?: { last_delivery?: { id?: unknown } } }>;
      };
      const order = status.replies
        ?.map((r) => r.data?.last_delivery?.id)
        .find((id): id is string => typeof id === "string");
      const result = order
        ? await tools.company_agent_send.execute({
            data: { request: "order_not_delivered", order_id: order },
          })
        : status;
      text = `Protocol demo (no LLM). ${order ? `Told the Company's agent that order ${order} never arrived.` : "Asked the Company's agent for your orders first."} ${fromAgent(result)}\n\nIf the Company asks to talk with you, accept or decline with the buttons above the message box.`;
    } else if (provider === "demo" && (change || aside)) {
      // A change the demo can prepare comes first, whatever else the message
      // says: "for the quarterly report" in a payment is its memo, not
      // feedback. Short of one, words for the Company's agent or for
      // feedback decide; only then does the demo ask for what is missing.
      const plan =
        change && connection.accountToken
          ? await demoChange(asked, tools, randomId)
          : undefined;
      if (plan && "call" in plan) {
        // Another kind of Company (orders, a bank, flights): the demo read
        // the account and asks for one change with exact arguments. The
        // Company answers approval_required and holds it for the User.
        try {
          const result = await tools[plan.call]!.execute(plan.args);
          text = `Protocol demo (no LLM). ${demoChangeReply(plan, result, show)}`;
        } catch (error) {
          // The demo chose the arguments; when the Company's description
          // of the tool rejects them, the request wasn't sent. Say that, not
          // "check the Company is running".
          if (!(error instanceof InvalidToolArguments)) throw error;
          text = `Protocol demo (no LLM). The demo prepared a request for ${plan.call} that this Company's description of the tool doesn't accept, so the demo didn't send it. Ask for it in other words or with other values, or select a model.`;
        }
      } else if (aside === "agent") {
        // The demo's way into a conversation (§8): ask what the Company's
        // agent handles, or ask for a person (which needs a conversation first).
        const person = /talk to|someone/.test(lowered);
        const results: unknown[] = [];
        if (!person || !connection.conversation?.id)
          results.push(
            await tools.company_agent_send!.execute({
              data: { request: "help" },
            }),
          );
        if (person)
          results.push(await tools.company_agent_handoff!.execute({}));
        text = `Protocol demo (no LLM). Live Company Agent ${person ? "handoff" : "reply"}. ${fromAgent(results.at(-1))}\n\nThe Company's agent answers structured requests. For a real conversation with it, select a model.`;
      } else if (aside === "feedback") {
        // The demo's way into feedback (§9.3): a fixed, identifier-free report.
        const result = await tools.report_unsupported_task!.execute({
          task: "Pay with a gift card",
          description:
            "The User wanted to pay with a gift card they were given. None of the Company's APIs or its agent's requests apply a gift card.",
        });
        // Iris doesn't send a report twice in a Session, or one for a task
        // the Company already lists: the heading says which happened.
        const sent = (result as { sent?: unknown } | null)?.sent !== false;
        // An alternative the Company gave is shown above as its own entry.
        raw = result;
        text = `Protocol demo (no LLM). Feedback report ${sent ? "sent" : "not sent"} to the Company (§9.3):\n\n${feedbackAnswer(result, companyName)}\n\nWith a model, Iris reports a task only after trying the Company's tools.`;
      } else if (!connection.accountToken) {
        text =
          "Protocol demo (no LLM). Sign in first: the demo reads your account to prepare this change, and nothing changes until you approve it.";
      } else {
        text = `Protocol demo (no LLM). ${plan?.say ?? "The demo can't prepare that change here."}`;
      }
    } else if (provider === "demo" && fdxRead) {
      text = demoFdxReply(await demoFdxAnswer(fdxRead, tools), show);
    } else if (provider === "demo" && espiRead) {
      text = demoEspiReply(await demoEspiAnswer(espiRead, tools), show);
    } else if (provider === "demo") {
      const message = lowered;
      const day = ["saturday", "tuesday", "thursday"].find((day) =>
        message.includes(day),
      );
      const editingItem =
        /\b(remove|add|set|quantity)\b/.test(message) &&
        /orange|broccoli|apple|coffee/.test(message);
      const target = shoppingTarget(message, run.history);
      const selected =
        editingItem && target
          ? target === "delivery"
            ? "propose_delivery_item_quantity"
            : "propose_basket_quantity"
          : /checkout|check out|place.*order/.test(message)
            ? "propose_checkout"
            : /basket|cart/.test(message)
              ? /add|remove|quantity|set/.test(message)
                ? "propose_basket_quantity"
                : "my_basket"
              : /my.*order|order.*my/.test(message)
                ? "my_orders"
                : /move|change|reschedul/.test(message) &&
                    day &&
                    tools.propose_delivery_change
                  ? "propose_delivery_change"
                  : /my.*deliver|deliver.*my/.test(message) &&
                      tools.my_deliveries
                    ? "my_deliveries"
                    : /deliver|ship|saturday|tuesday|thursday/.test(message)
                      ? "delivery_info"
                      : "list_products";
      // Another Company's tools: never guess arguments for unknown schemas,
      // and never talk to the Company's agent unless asked (above).
      const fallback = tools[selected]
        ? selected
        : pickDemoTool(
            message,
            Object.fromEntries(
              Object.entries(tools).filter(
                ([name]) => !name.startsWith("company_agent_"),
              ),
            ),
          );
      const selectedTool = fallback ? tools[fallback] : undefined;
      const product_id = /coffee/.test(message)
        ? "coffee"
        : /broccoli/.test(message)
          ? "broccoli"
          : /apple/.test(message)
            ? "apples"
            : "oranges";
      const quantity = /remove/.test(message)
        ? 0
        : Number(message.match(/\b\d+\b/)?.[0] ?? 1);
      if (!selectedTool) {
        text =
          "Protocol demo (no LLM): every tool at this Company needs arguments the demo can't choose. Pick a model to try it, or inspect its tools in the Inspector.";
      } else if (editingItem && !target) {
        text =
          "Do you mean your shopping basket or your recurring delivery? Please name which one; no changes have been proposed.";
      } else {
        const allowed = selectedTool.schema.properties as Record<
          string,
          unknown
        >;
        const args = {
          product_id,
          quantity,
          day: day ? day[0]!.toUpperCase() + day.slice(1) : "Saturday",
        };
        const result = await selectedTool.execute(
          Object.fromEntries(
            Object.entries(args).filter(([key]) => Object.hasOwn(allowed, key)),
          ),
        );
        // Signed out, or without the permission, Iris stops before asking:
        // there is no answer of the Company's to show, only what to press.
        const hints = companyProfile(connection.company!).scopeHints;
        const unsent = notSentReply(
          result,
          companyName,
          (scope) => hints[scope]?.changes !== "none",
        );
        text = unsent
          ? `Protocol demo (no LLM). ${unsent}`
          : `Protocol demo (no LLM). The company answered:\n\n${show(result)}\n\n${tools.my_basket ? "Try “my basket”, “set apples in my basket to 2”, “checkout on Saturday”, “my orders”, or “my deliveries”. Basket edits and checkout are proposals only until you click Approve. Demo quantities are absolute totals, not increments." : `The demo called ${fallback}, a tool that needs no arguments.`} For natural-language reasoning, select a model.`;
      }
    } else {
      stage = "provider";
      // The model is sent the last turns of the whole conversation, so what
      // it read with any Company's account can be in this answer and in the
      // requests it makes: both are kept as holding those accounts.
      context = run.history.slice(-10);
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
      text = await runModel(
        provider,
        // The roles and the words, without the Company each turn was with.
        [
          ...context.map(({ role, content }) => ({ role, content })),
          { role: "user", content: asked },
        ],
        recorded,
        {
          ...modelConfig,
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
      if (answered.length) raw = answered;
    }
    const exact =
      raw !== undefined ? JSON.stringify(raw).slice(0, 20000) : undefined;
    // The model's context gets the two turns. The page's transcript also
    // keeps what this turn shows, to show it again after a reload.
    recordTurn(run, connection, asked, text, {
      company: shown,
      trace,
      demo: provider === "demo",
      data: exact,
      context,
      typed,
    });
    run.history = run.history.slice(-10);
    // The turn ended with an answer though the access went during it: what
    // the page showed with the account goes all the same, this turn too.
    const lost = lostAccess(run, connection, knewLost);
    return NextResponse.json(
      {
        text,
        ...(exact !== undefined ? { data: exact } : {}),
        trace,
        mode: provider,
        // The Company the turn was with: the answer came from there, and
        // the state that follows is that Company's.
        from,
        // Iris's own line from before it asked the Company, to show first.
        ...(did.before ? { before: did.before } : {}),
        ...turnState(connection),
        company: shown.map((entry) => ({ ...entry, from })),
        ...companies(),
        ...lost,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const recovery = accountRecovery(error);
    // The Company the turn that failed was with, when it had got to one,
    // and what the User's words had done to the Companies before it.
    const turn = {
      ...(run && connection
        ? { from: companyRef(run, originOf(connection)) }
        : {}),
      ...(did.before ? { before: did.before } : {}),
      ...(run && did.changed ? companiesView(run) : {}),
      ...did.left,
    };
    // Signed out, a token error means the Company refused the Session
    // itself: there is no account access to renew (often a different draft).
    if (
      recovery &&
      connection &&
      !connection.accountToken &&
      error instanceof ProtocolError &&
      error.code === "invalid_token"
    )
      return NextResponse.json(
        {
          error:
            "The Company refused this signed-out Poppy 1.0 Session. It may implement another version of the protocol; check its discovery in the Inspector.",
          code: "session_refused",
          stage,
          trace,
          ...turn,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    // Signed out, a plain sign-in challenge is not lost access.
    if (recovery && connection && !connection.accountToken)
      return NextResponse.json(
        {
          error:
            "This needs your account at the Company, which didn't take the request without it. Use Sign in in the chat if the Company offers it, then ask again.",
          code: "sign_in_required",
          next: "signin",
          stage,
          trace,
          ...turn,
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    if (recovery) {
      if (connection && recovery.next === "signin")
        connection.accountUnavailable = true;
      // With the message about the lost access goes what the page still
      // shows: the answers Iris read with the account are gone from it.
      const lost =
        run && connection ? lostAccess(run, connection, knewLost) : undefined;
      return NextResponse.json(
        { ...recovery, stage, trace, ...turn, ...lost },
        { status: recovery.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof ModelRequestError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          stage: "provider",
          trace,
          ...turn,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    // A Company's protocol error: its status and code are safe to show
    // (never its free text) and are what an interop report needs.
    if (error instanceof ProtocolError) {
      const code = /^[A-Za-z0-9_.:-]{1,64}$/.test(error.code ?? "")
        ? error.code
        : undefined;
      // A code of the Company's own, such as insufficient_funds, is shown
      // too; `code` below stays the protocol's.
      const shown = code ?? error.companyCode;
      // And a number it gave, in our own words (`refusalFacts`).
      const facts = refusalFacts(error.body);
      return NextResponse.json(
        {
          error: `${connection?.company?.document.organization.name ?? "The Company"} answered HTTP ${error.status}${shown ? ` ${shown}` : ""}${facts.length ? ` (${facts.join(", ")})` : ""}. Nothing was retried; see the Inspector.`,
          code: code ?? "company_error",
          stage,
          trace,
          ...turn,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const message = error instanceof Error ? error.message : "Chat failed";
    // Operator log: stage and error class only; never the request, keys or tokens.
    console.error(
      "chat_failed",
      stage,
      error instanceof Error ? `${error.name}: ${message.slice(0, 160)}` : "",
    );
    // Only messages written for the visitor are shown; discovery errors are
    // ours too (the same text the Connect step shows).
    const safe =
      error instanceof UserFacingError ||
      error instanceof PapDiscoveryError ||
      // Local provider configuration hints from the adapters, nothing else.
      (stage === "provider" &&
        /^(Set [A-Z_]+_API_KEY|Unknown model)/.test(message))
        ? message
        : "Chat request failed. Check the Company is running and the selected provider is configured; retry with Protocol demo.";
    return NextResponse.json(
      { error: safe, stage, trace, ...turn },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    // A proposal this turn left can hold what a model read with another
    // Company's account, as the turn's answer can: it is listed with the
    // same accounts, and goes when one of them is reset.
    if (run && connection && proposals)
      noteOperationAccounts(
        connection,
        proposals,
        accountsIn(run, connection, context),
      );
    // The lines stay with the conversation, for a reload and History.
    if (run && connection)
      keepLines(
        run,
        connection,
        trace.slice(did.kept),
        Date.now(),
        !!connection.accountToken,
        accountsIn(run, connection, context),
      );
    // However the turn ended: an error of another kind can follow the
    // request in which the Company refused the sign-in. After the lines
    // are kept, so those written with the account go with the rest.
    if (run && connection) forgetLostAccount(run, connection, knewLost);
    if (held && visitor)
      await releaseRun(visitor, held).catch((error: unknown) => {
        started.unsaved = error;
      });
    active--;
  }
}

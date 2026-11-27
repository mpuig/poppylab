import { askModel } from "@poppy-lab/llm-adapters/server";
import type { ChatRequest } from "./chat-body";
import { severalTurn } from "./chat-several";
import { ownAnswer, type HeldTurn } from "./chat-turn";
import { answeredWith } from "./company-names";
import {
  answers,
  choice,
  companiesAt,
  connectFor,
  keepCompanies,
  noRoomFor,
  performCommand,
  typedAnswer,
  type Answer,
  type Performed,
} from "./company-commands";
import { connectCommand, type ConnectCommand } from "./connect-command";
import {
  companyName as nameOf,
  connectionAt,
  MAX_CONNECTIONS,
  originOf,
} from "./connections";
import { demoExamplesFor, demoGuidedReply } from "./demo-examples";
import { localOrigins } from "./deployment";
import { modelProvider } from "./free-model";
import { nameable } from "./lab-companies";
import { languageOf } from "./language";
import { say } from "./lines";
import { directConnection, turnConnection } from "./routing";
import { recordOwn } from "./transcript";
import { json, type Reply } from "./web";

/**
 * Which Company the turn is for, before anything is asked of one: the
 * Direct Conversation the User acts on, the Company a button or their
 * answer to Iris's question names, or the one `turnConnection` works out.
 * The User's own words can connect a Company or remove one first. Sets
 * the turn's connection, what it asks there and the other Companies its
 * task needs; or answers in Iris's own words, sending nothing to any
 * Company.
 */
export async function chooseCompany(
  turn: HeldTurn,
  request: ChatRequest,
): Promise<Reply | undefined> {
  const { scope, conversation: run, lab, provider, message } = turn;
  const { body, direct, pressed } = request;
  const { trace, did } = scope;
  const own = (text: string, choices?: Parameters<typeof ownAnswer>[2]) =>
    ownAnswer(turn, text, choices);
  const hint = body.company ?? body.url;
  // What Iris was asked before it asked which Company: this message may
  // say which, and otherwise that request is dropped.
  const waiting = run.waiting;
  delete run.waiting;
  // The removal Iris asked the User to confirm: this message or button
  // may answer it, and otherwise the question is dropped.
  const removing = run.removing;
  delete run.removing;
  if (direct) {
    // §8.10: the User's own words or choice. Never worked out from them.
    const target = directConnection(run, direct, hint);
    if ("code" in target)
      return json(target, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    scope.connection = target;
    return undefined;
  }
  if (pressed && "company" in pressed) {
    // The button for one of the Companies Iris asked about: the request
    // that waited is asked there. A button of a question that is no
    // longer open has nothing to ask.
    if (!waiting) {
      const words = say(languageOf(run), "noRequestWaiting");
      recordOwn(run, undefined, message, words, false);
      return own(words);
    }
    scope.connection = connectionAt(run, pressed.company);
    turn.asked = waiting;
    turn.typed = message;
    return undefined;
  }
  // The User's own words can connect a Company or remove one. They are
  // read here, before any model or rule of the demo, and nothing else
  // is ever read for it: not Company content, not a model's answer.
  // What the User answers about a removal: a button, by origin, or
  // "yes" or "no" typed while Iris's question is open.
  // The agent's other questions were answered before (`chat-answers.ts`).
  const decided:
    | Extract<
        Answer,
        { connect: string } | { remove: string[] } | { keep: string[] }
      >
    | undefined =
    pressed &&
    ("connect" in pressed || "remove" in pressed || "keep" in pressed)
      ? pressed
      : removing && !pressed
        ? typedAnswer(message, removing)
        : undefined;
  if (decided && "keep" in decided) {
    const done = keepCompanies(
      run,
      decided.keep,
      removing && answers(removing, decided.keep) ? removing.rest : undefined,
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
    if (done.ask) run.removing = done.ask;
    trace.push(...done.trace);
    Object.assign(did, {
      changed: done.changed,
      ...(done.left ? { left: done.left } : {}),
      kept: trace.length,
    });
    recordOwn(run, done.about, message, done.say, done.told);
    run.history = run.history.slice(-10);
    if (!done.rest) return own(done.say, done.choices);
    // After the line about the free model, when the turn has one.
    did.before = did.before ? `${did.before} ${done.say}` : done.say;
    turn.asked = done.rest;
    turn.typed = null;
    scope.connection = done.at;
    return undefined;
  };
  if (command) {
    scope.stage = "connect";
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
    scope.connection = connectionAt(run, answered[0]!.url);
    turn.asked = waiting!;
    turn.typed = message;
    return undefined;
  }
  if (answered.length > 1) {
    // The name fits several: Iris asks again, and the request goes on
    // waiting for the answer.
    const words = say(languageOf(run), "whichIsItFor", {
      names: answered.map((c) => c.name),
    });
    run.waiting = waiting!;
    recordOwn(run, undefined, message, words, false);
    return own(
      words,
      answered.map((c) => choice(run, { company: originOf(c) }, lab)),
    );
  }
  if (scope.connection) return undefined;
  const asked = turn.asked;
  const typed = turn.typed;
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
    provider === "demo" && chose === undefined ? demoExamplesFor(asked) : [];
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
  // An example across two Companies needs both in the conversation.
  // Iris connects neither by itself: it says what is missing, with a
  // button for each to connect, or to make room for it.
  const pair = example?.with
    ? [example.with, example.company].map((id) => lab.find((c) => c.id === id)!)
    : undefined;
  if (pair?.every(Boolean)) {
    const absent = pair.filter((c) => !connectionAt(run, c.url));
    if (!absent.length)
      return await severalTurn(
        turn,
        pair.map((c) => connectionAt(run, c.url)!),
        connectionAt(run, pair[1]!.url)!,
      );
    const room = MAX_CONNECTIONS - run.connections.length;
    const others = run.connections.filter(
      (c) => !pair.some((p) => originOf(p) === originOf(c)),
    );
    const words = say(languageOf(run), "needsTwo", {
      reads: pair[0]!.name,
      pays: pair[1]!.name,
      absent: absent.map((c) => c.name),
      have: run.connections.length,
      remove: absent.length > room ? absent.length - room : 0,
    });
    recordOwn(run, undefined, asked, words, false, typed !== null);
    run.history = run.history.slice(-10);
    return own(
      words,
      absent.length > room
        ? others.map((c) => choice(run, { remove: [originOf(c)] }, lab))
        : absent.map((c) => choice(run, { connect: originOf(c) }, lab)),
    );
  }
  const route = await turnConnection(run, asked, chose, {
    // Only a page that shows several Companies can show another.
    ...(body.companies === true ? { lab } : {}),
    ...(example ? { example: example.company } : {}),
    ...(provider !== "demo"
      ? {
          ask: (question) =>
            askModel(modelProvider(provider), question, turn.modelConfig),
        }
      : {}),
  });
  if ("connect" in route) {
    // A request clearly for one of the lab's Companies, which isn't
    // connected: Iris connects it, as "connect with" it does, and
    // asks the request there. At as many Companies as a conversation
    // works with, it says so and offers to remove one.
    scope.stage = "connect";
    return performed(
      run.connections.length >= MAX_CONNECTIONS
        ? noRoomFor(run, route.connect, lab)
        : await connectFor(run, route.connect, asked, localOrigins),
    );
  }
  if (!run.connections.length) {
    const words = say(languageOf(run), "noCompanyToAsk", {
      names: lab.map((c) => c.name),
    });
    recordOwn(run, undefined, asked, words, words, typed !== null);
    run.history = run.history.slice(-10);
    return own(
      words,
      lab.map((c) => choice(run, { connect: originOf(c) }, lab)),
    );
  }
  if ("ask" in route) {
    // Nothing is sent to any Company. The request waits for the
    // answer, which a button or the User's own words can give.
    const names = route.ask.map(nameOf);
    const words = say(languageOf(run), "isItFor", {
      names,
      why: route.why === "none" ? "none" : names.length > 2 ? "each" : "both",
    });
    run.waiting = asked;
    recordOwn(run, undefined, asked, words, false, typed !== null);
    return own(
      words,
      route.ask.map((c) => choice(run, { company: originOf(c) }, lab)),
    );
  }
  scope.connection = route.connection;
  if (route.fallback) scope.fallback = true;
  turn.also = route.also ?? [];
  return undefined;
}

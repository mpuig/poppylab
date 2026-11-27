/**
 * Carries out what the User typed about the conversation's Companies
 * (`connect-command.ts`): connects the ones they named, or removes them,
 * and says what happened in Iris's words, with what the User can do next.
 *
 * Connecting is discovery and nothing else: no sign-in is started and
 * nothing is sent on the User's behalf. Removing a signed-in Company
 * revokes its grant there, as the page's own button does, and drops its
 * waiting proposals. So Iris asks before it removes one that is signed in
 * or has a proposal waiting, and before any removal the User asked for in
 * words that are also said about an order ("remove Lantern"): nothing is
 * revoked or removed until the User confirms.
 */
import { PapDiscoveryError } from "@poppy-lab/pap-core";
import type { Nameable } from "@poppy-lab/pap-agent/company-names";
import type { ConnectCommand } from "@poppy-lab/pap-agent/connect-command";
import { connectCompany } from "./connecting";
import {
  companyName,
  connectionAt,
  MAX_CONNECTIONS,
  nameFor,
  originOf,
} from "./connections";
import { keepLines } from "./inspector-log";
import { removalRefusal, removeCompany, type Removal } from "./removing";
import type { Connection, Run } from "./runtime";

/**
 * What a button of Iris's answers when it is pressed. It names Companies
 * by origin and is never words to read again: a Company's name is text
 * the Company supplies, and a name sent back as the User's message could
 * read as a request ("Disconnect from Harborline Bank").
 *
 * - `company`: the Company the request that waits is for.
 * - `connect`: connect this Company, one of the lab's.
 * - `remove`: take these Companies out of the conversation.
 * - `keep`: leave them in.
 * - `message`: one of demo mode's scripted examples, sent as the User's
 *   message. Its words are the demo's own (`demo-examples.ts`), and the
 *   chat route takes no others.
 */
export type Answer =
  | { company: string }
  | { connect: string }
  | { remove: string[] }
  | { keep: string[] }
  | { message: string };

/**
 * A reply the page offers as a button. Pressing it sends `answer` back to
 * the chat route in place of a message, and the page shows `label` as
 * what the User said. `label` is text to show and nothing else.
 */
export type Choice = { label: string; answer: Answer };

/** A removal Iris asked the User to confirm, kept until they answer. */
export type Removing = {
  /** The Companies to remove, by origin. */
  remove: string[];
  /** What else the message asked, to ask once they are removed. */
  rest?: string;
};

export type Performed = {
  /** Iris's answer as the page shows it. */
  say: string;
  /**
   * The same for the model, without a Company's own words: how its
   * discovery describes it is for the User to read, not for the model to
   * take as Iris's.
   */
  told: string;
  /** The Company the answer is about: the last one connected or removed. */
  about?: Pick<Connection, "url">;
  choices?: Choice[];
  /** The conversation's Companies are no longer what they were. */
  changed: boolean;
  /** After a removal: what the conversation still shows. */
  left?: Pick<Extract<Removal, { removed: unknown }>, "history" | "log">;
  /** The Inspector's lines, already kept with the conversation. */
  trace: string[];
  /** What else the message asks, still to be asked. */
  rest?: string;
  /** The Company to ask it of, when connecting one settled that. */
  at?: Connection;
  /** Iris asked whether to remove these: nothing was removed yet. */
  ask?: Removing;
};

/** "A", "A and B", "A, B and C". */
export const listed = (names: readonly string[], last: "and" | "or") =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1)}`;

/** A Company's own words as one short line, to quote. */
const oneLine = (words: string) => {
  const line = words.replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/** How the Company's discovery describes what it offers, if it says. */
const offer = (connection: Connection) =>
  oneLine(
    connection.company?.document.apis?.find((api) => api.description)
      ?.description ?? "",
  );

const labLine = (lab: readonly Nameable[]) =>
  `The lab's companies are ${listed(
    lab.map((c) => c.name),
    "and",
  )}. To connect another company, type its address in the address box.`;

/**
 * An answer as a request carries it: one kind, with one origin, or one to
 * three for a removal. Nothing for anything else, words included.
 */
export function readAnswer(value: unknown): Answer | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const [[kind, named] = [], ...more] = Object.entries(value);
  if (more.length) return undefined;
  const origin = (one: unknown): one is string =>
    typeof one === "string" && !!one && one.length <= 2048;
  if (kind === "message")
    return typeof named === "string" && named.trim() && named.length <= 2000
      ? { message: named }
      : undefined;
  if (kind === "company" || kind === "connect")
    return !origin(named)
      ? undefined
      : kind === "company"
        ? { company: named }
        : { connect: named };
  if (
    (kind !== "remove" && kind !== "keep") ||
    !Array.isArray(named) ||
    !named.length ||
    named.length > MAX_CONNECTIONS ||
    !named.every(origin)
  )
    return undefined;
  return kind === "remove" ? { remove: named } : { keep: named };
}

/**
 * A Company's name on a button. Two connected Companies can go by one
 * name, since each chooses its own: they are then told apart by host.
 */
function buttonName(run: Pick<Run, "connections" | "former">, origin: string) {
  const at = originOf({ url: origin });
  const name = nameFor(run, at);
  const same = run.connections.filter((c) => companyName(c) === name);
  if (same.length < 2) return name;
  try {
    return `${name} (${new URL(at).host})`;
  } catch {
    return name;
  }
}

/**
 * What the button for an answer says. The page shows it as the User's
 * line when the button is pressed, and the conversation keeps the same
 * words, worked out here again from the answer and never taken from the
 * request.
 */
export function answerLabel(
  run: Pick<Run, "connections" | "former">,
  answer: Answer,
  lab: readonly Nameable[],
) {
  if ("message" in answer) return answer.message;
  if ("company" in answer) return buttonName(run, answer.company);
  if ("connect" in answer) {
    const at = originOf({ url: answer.connect });
    return lab.find((c) => originOf(c) === at)?.name ?? buttonName(run, at);
  }
  const names = ("remove" in answer ? answer.remove : answer.keep).map(
    (origin) => buttonName(run, origin),
  );
  return `${"remove" in answer ? "Remove" : "Keep"} ${listed(names, "and")}`;
}

/** The button for an answer. */
export const choice = (
  run: Pick<Run, "connections" | "former">,
  answer: Answer,
  lab: readonly Nameable[],
): Choice => ({ label: answerLabel(run, answer, lab), answer });

/** The Companies an answer names, as a request to remove them names them. */
export const companiesAt = (
  run: Pick<Run, "connections" | "former">,
  origins: readonly string[],
): Nameable[] =>
  origins.map((origin) => ({
    url: origin,
    name: nameFor(run, originOf({ url: origin })),
  }));

/** Whether an answer names the Companies Iris asked about, all of them. */
export const answers = (asked: Removing, origins: readonly string[]) => {
  const named = new Set(origins.map((origin) => originOf({ url: origin })));
  return (
    named.size === asked.remove.length &&
    asked.remove.every((origin) => named.has(origin))
  );
};

/**
 * "yes" or "no", typed in answer to Iris asking whether to remove a
 * Company. Only these few: any other message is a message, and the
 * question is dropped.
 */
export function typedAnswer(
  message: string,
  asked: Removing,
): { remove: string[] } | { keep: string[] } | undefined {
  const said = message
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "")
    .replace(/[,’']/g, "")
    .replace(/\s+/g, " ")
    .replace(/ please$/, "");
  if (
    /^(?:yes|yes remove (?:it|them)|remove (?:it|them)|confirm|go ahead)$/.test(
      said,
    )
  )
    return { remove: asked.remove };
  if (
    /^(?:no|no thanks|no keep (?:it|them)|keep (?:it|them)|cancel|dont|never mind)$/.test(
      said,
    )
  )
    return { keep: asked.remove };
  return undefined;
}

/** The User chose to keep the Companies Iris asked about. */
export function keepCompanies(
  run: Run,
  origins: readonly string[],
  rest?: string,
): Performed {
  const kept = origins.flatMap((origin) => {
    const connection = connectionAt(run, origin);
    return connection ? [connection] : [];
  });
  const names = kept.map(companyName);
  const say = [
    ...(kept.length
      ? [
          `${listed(names, "and")} ${kept.length > 1 ? "stay" : "stays"} connected. Nothing was removed${kept.some((c) => c.accountToken) ? " or revoked" : ""}.`,
        ]
      : ["Nothing was removed."]),
    ...(rest ? ["The rest of your message wasn't asked of anyone."] : []),
  ].join(" ");
  const about = kept.at(-1);
  return {
    say,
    told: say,
    ...(about ? { about } : {}),
    changed: false,
    trace: [],
  };
}

/**
 * Carries out a request about the conversation's Companies. `confirmed`
 * says the User answered Iris's question about this very removal: without
 * it a removal that needs asking is asked, not done.
 */
export async function performCommand(
  run: Run,
  command: ConnectCommand,
  lab: readonly Nameable[],
  allowedPrivateOrigins: string[],
  confirmed = false,
): Promise<Performed> {
  const connecting = command.verb === "connect";
  if ("which" in command) {
    const names = command.which.map((c) => c.name);
    const say = `Which one do you mean: ${listed(names, "or")}?`;
    return {
      say,
      told: say,
      changed: false,
      trace: [],
      choices: command.which.map((c) =>
        choice(
          run,
          connecting ? { connect: originOf(c) } : { remove: [originOf(c)] },
          lab,
        ),
      ),
    };
  }
  if ("unknown" in command) {
    const connected = run.connections.map(companyName);
    const say = connecting
      ? `${command.unknown ? `There is no company called “${command.unknown}” among the lab's.` : "Which company?"} ${labLine(lab)}`
      : command.unknown
        ? `This conversation isn't connected to a company called “${command.unknown}”. ${connected.length ? `It is connected to ${listed(connected, "and")}.` : "It isn't connected to any company."}`
        : connected.length
          ? `Which company should be removed? This conversation is connected to ${listed(connected, "and")}.`
          : "This conversation isn't connected to any company, so there is none to remove.";
    return {
      say,
      told: say,
      changed: false,
      trace: [],
      choices: connecting
        ? lab
            .filter((c) => !connectionAt(run, c.url))
            .map((c) => choice(run, { connect: originOf(c) }, lab))
        : command.unknown
          ? []
          : run.connections.map((c) =>
              choice(run, { remove: [originOf(c)] }, lab),
            ),
    };
  }
  return connecting
    ? connect(run, command.companies, command.rest, allowedPrivateOrigins)
    : remove(
        run,
        command.companies,
        command.rest,
        command.sure,
        confirmed,
        lab,
      );
}

/** The proposals of a Company that still wait for the User. */
const waitingAt = (connection: Connection) =>
  Object.values(connection.operations ?? {}).filter(
    (op) => op.state === "proposed" && Date.parse(op.expires_at) > Date.now(),
  ).length;

/**
 * Iris's question before a removal, with what the removal takes with it:
 * the access the User gave, what was read with it, a waiting proposal.
 */
function removalQuestion(found: readonly Connection[], rest: string) {
  const one = found.length === 1;
  const signedIn = found.filter((c) => c.accountToken).map(companyName);
  const waiting = found.reduce((sum, c) => sum + waitingAt(c), 0);
  return [
    `Remove ${listed(found.map(companyName), "and")} from this conversation?`,
    ...(signedIn.length
      ? [
          `That revokes the access you gave Iris ${one ? "there" : `at ${listed(signedIn, "and")}`}, and what Iris read with your account there no longer shows.`,
        ]
      : []),
    ...(waiting
      ? [
          `${waiting > 1 ? `${waiting} proposals that wait for your approval are` : "A proposal that waits for your approval is"} dropped with ${one ? "it" : "them"}.`,
        ]
      : []),
    ...(!signedIn.length && !waiting
      ? [`You can connect ${one ? "it" : "them"} again at any time.`]
      : []),
    ...(rest ? ["Iris asks the rest of your message after that."] : []),
  ].join(" ");
}

/**
 * Connects one of the lab's Companies that a request is clearly for and
 * that the conversation isn't connected to (`turnConnection`), as typing
 * "connect with" it does, and the request is then asked there. Iris says
 * so in one line. Signed out: the request is asked without the User's
 * account until they sign in there.
 */
export async function connectFor(
  run: Run,
  company: Nameable,
  rest: string,
  allowedPrivateOrigins: string[],
): Promise<Performed> {
  const done = await connect(run, [company], rest, allowedPrivateOrigins);
  if (!done.changed || !done.at) return done;
  const say = `This is one for ${companyName(done.at)}, so Iris connected it to this conversation. It's asked without your account until you sign in there.`;
  return { ...done, say, told: say };
}

/**
 * The same at a conversation that has as many Companies as it can work
 * with: nothing is connected, and the User can remove one.
 */
export function noRoomFor(
  run: Run,
  company: Nameable,
  lab: readonly Nameable[],
): Performed {
  const say = `This is one for ${company.name}, which this conversation isn't connected to. It works with ${MAX_CONNECTIONS} companies already, as many as it can: remove one, then ask again and Iris connects ${company.name}.`;
  return {
    say,
    told: say,
    changed: false,
    trace: [],
    choices: run.connections.map((c) =>
      choice(run, { remove: [originOf(c)] }, lab),
    ),
  };
}

async function connect(
  run: Run,
  companies: readonly Nameable[],
  rest: string,
  allowedPrivateOrigins: string[],
): Promise<Performed> {
  const added: Connection[] = [];
  /** What else there is to say, each a sentence. */
  const notes: string[] = [];
  const trace: string[] = [];
  let last: Connection | undefined;
  for (const company of companies) {
    const already = connectionAt(run, company.url);
    if (already) {
      notes.push(
        `This conversation is already connected to ${companyName(already)}.`,
      );
      last = already;
      continue;
    }
    try {
      const connection = await connectCompany(
        run,
        company.url,
        allowedPrivateOrigins,
      );
      if ("code" in connection) {
        notes.push(connection.error);
        last = undefined;
        continue;
      }
      added.push(connection);
      last = connection;
      const line = `Connected to ${companyName(connection)} · discovery read at ${new URL(connection.company!.discoveryUrl).pathname}`;
      trace.push(line);
      // Discovery reads public documents: the line names no account data.
      keepLines(run, connection, [line], Date.now(), false);
    } catch (error) {
      // A discovery error's message is ours, as the Connect step shows it.
      notes.push(
        `${company.name} couldn't be connected. ${error instanceof PapDiscoveryError ? error.message : "It couldn't be reached."}`,
      );
      last = undefined;
    }
  }
  const names = added.map(companyName);
  const lead = added.length ? [`Connected to ${listed(names, "and")}.`] : [];
  const offers = added.flatMap((connection) => {
    const words = offer(connection);
    return words
      ? [
          `${added.length > 1 ? companyName(connection) : "It"} describes what it offers as “${words}”.`,
        ]
      : [];
  });
  // The rest is asked of the Company the User named last, once connected.
  const carry = !!rest && !!last;
  const next = !added.length
    ? []
    : carry
      ? [
          `Signing in is offered when a request needs your account ${added.length > 1 ? "at one of them" : "there"}.`,
        ]
      : [
          `You can ask ${added.length > 1 ? "them" : "it"} something now. Signing in is offered when a request needs your account ${added.length > 1 ? "at one of them" : "there"}.`,
        ];
  const dropped =
    rest && !last ? ["The rest of your message wasn't asked of anyone."] : [];
  const about = last ?? added.at(-1);
  return {
    say: [...lead, ...offers, ...notes, ...next, ...dropped].join(" "),
    told: [...lead, ...notes, ...next, ...dropped].join(" "),
    ...(about ? { about } : {}),
    changed: added.length > 0,
    trace,
    ...(carry ? { rest, at: last! } : {}),
  };
}

async function remove(
  run: Run,
  companies: readonly Nameable[],
  rest: string,
  sure: boolean,
  confirmed: boolean,
  lab: readonly Nameable[],
): Promise<Performed> {
  const notes: string[] = [];
  const trace: string[] = [];
  let about: Pick<Connection, "url"> | undefined;
  let left: Performed["left"];
  let withAccount = false;
  let removed = 0;
  // The ones that can be removed: connected, and with no approval out.
  const found: Connection[] = [];
  for (const company of companies) {
    const connection = connectionAt(run, company.url);
    const refusal = connection && removalRefusal(connection);
    if (!connection)
      notes.push(`This conversation isn't connected to ${company.name}.`);
    else if (refusal) notes.push(refusal.refused.error);
    else if (!found.includes(connection)) found.push(connection);
  }
  // Asked first, all of them in one question: on words that are also
  // said about an order, and whenever access would be revoked or a
  // waiting proposal dropped. Nothing is sent or removed until then.
  if (
    found.length &&
    !confirmed &&
    (!sure || found.some((c) => c.accountToken || waitingAt(c)))
  ) {
    const origins = found.map(originOf);
    const say = [...notes, removalQuestion(found, rest)].join(" ");
    return {
      say,
      told: say,
      about: { url: found.at(-1)!.url },
      changed: false,
      trace,
      choices: [
        choice(run, { remove: origins }, lab),
        choice(run, { keep: origins }, lab),
      ],
      ask: { remove: origins, ...(rest ? { rest } : {}) },
    };
  }
  for (const connection of found) {
    const name = companyName(connection);
    const removal = await removeCompany(run, connection);
    if (removal.refused) {
      notes.push(removal.refused.error);
      continue;
    }
    removed++;
    about = { url: connection.url };
    left = { history: removal.history, log: removal.log };
    trace.push(...removal.trace);
    if (removal.revoked !== undefined) withAccount = true;
    notes.push(
      removal.revoked
        ? `${name} was removed from this conversation, and the access you gave Iris there was revoked.`
        : `${name} was removed from this conversation.${removal.notice ? ` ${removal.notice}` : ""}`,
    );
  }
  if (withAccount)
    notes.push("What Iris read with your account there no longer shows.");
  if (removed)
    notes.push(
      run.connections.length
        ? `You can connect ${removed > 1 ? "them" : "it"} again at any time.`
        : "This conversation isn't connected to a company now. Connect one to go on.",
    );
  const say = notes.join(" ");
  return {
    say,
    told: say,
    ...(about ? { about } : {}),
    changed: removed > 0,
    ...(left ? { left } : {}),
    trace,
    ...(rest ? { rest } : {}),
  };
}

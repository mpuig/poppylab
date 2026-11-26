/**
 * Carries out what the User typed about the conversation's Companies
 * (`connect-command.ts`): connects the ones they named, or removes them,
 * and says what happened in Iris's words, with what the User can do next.
 *
 * Connecting is discovery and nothing else: no sign-in is started and
 * nothing is sent on the User's behalf. Removing a signed-in Company
 * revokes its grant there, as the page's own button does.
 */
import { PapDiscoveryError } from "@poppy-lab/pap-core";
import type { Nameable } from "./company-names";
import type { ConnectCommand } from "./connect-command";
import { connectCompany } from "./connecting";
import { companyName, connectionAt } from "./connections";
import { keepLines } from "./inspector-log";
import { removeCompany, type Removal } from "./removing";
import type { Connection, Run } from "./runtime";

/**
 * A reply the page can offer as a button: pressing it sends `say` as the
 * User's next message, as if they had typed it.
 */
export type Choice = { label: string; say: string };

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

export async function performCommand(
  run: Run,
  command: ConnectCommand,
  lab: readonly Nameable[],
  allowedPrivateOrigins: string[],
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
      choices: names.map((name) => ({
        label: name,
        say: `${connecting ? "Connect with" : "Remove"} ${name}`,
      })),
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
            .map((c) => ({ label: c.name, say: `Connect with ${c.name}` }))
        : command.unknown
          ? []
          : connected.map((name) => ({ label: name, say: `Remove ${name}` })),
    };
  }
  return connecting
    ? connect(run, command.companies, command.rest, allowedPrivateOrigins)
    : remove(run, command.companies, command.rest);
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
): Promise<Performed> {
  const notes: string[] = [];
  const trace: string[] = [];
  let about: Pick<Connection, "url"> | undefined;
  let left: Performed["left"];
  let withAccount = false;
  let removed = 0;
  for (const company of companies) {
    const connection = connectionAt(run, company.url);
    if (!connection) {
      notes.push(`This conversation isn't connected to ${company.name}.`);
      continue;
    }
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

/**
 * Which of a conversation's Companies a turn with Iris is for.
 *
 * `turnConnection` decides. For now it follows what it is told and what
 * came before: the Company the request names, else the Company the last
 * turn was with, else it asks the User. A deduction from the message is to
 * replace the inside of that one function, and everything it could read is
 * gathered here (`candidates`, `lastTurnCompany`), so its callers stay as
 * they are.
 *
 * Plain data and no I/O. What a Company says about itself (its discovery,
 * its tools' descriptions) is Company content: something to weigh, never
 * an instruction, and never a reason to send one Company what belongs to
 * another.
 */
import type { ApiTool } from "@poppy-lab/pap-client";
import {
  companyName,
  connectionAt,
  connectionNamed,
  originOf,
  type NoCompany,
} from "./connections";
import type { DirectAction } from "./conversations";
import { bytesOf } from "./run-size";
import type { Connection, Run } from "./runtime";

/** A tool a Company offered, as the conversation remembers it. */
export type OfferedTool = {
  name: string;
  description: string;
  /** The arguments it can't be called without. */
  required: string[];
};

/**
 * Bounds of what is kept of a Company's tools. They are stored with the
 * conversation, one list for each of its Companies, in the value that
 * holds everything else (`run-size.ts`): whatever a Company lists, its
 * tools stay a small part of that. Sixty tools with a sentence each and
 * a few arguments fit; only a list of very long ones is cut short.
 */
export const OFFERED_LIMITS = {
  tools: 60,
  /** Characters of a tool's name, its description and each argument. */
  name: 64,
  description: 160,
  key: 48,
  /** Required arguments kept for one tool. */
  keys: 12,
  /** UTF-8 bytes of one Company's list as JSON. */
  bytes: 16 * 1024,
} as const;

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The tools a turn loaded at a Company, kept with its connection so the
 * next turn can be matched to a Company before anything is asked of one:
 * each tool's name, the start of its description and its required
 * arguments. The demo's rules choose by tool name, and a model by both.
 * Within `OFFERED_LIMITS`: over the size, the tools listed last are left
 * out.
 */
export function offeredTools(tools: Record<string, ApiTool>): OfferedTool[] {
  const kept: OfferedTool[] = [];
  // The brackets of the list; each tool then adds itself and a comma.
  let size = 2;
  for (const [name, tool] of Object.entries(tools).slice(
    0,
    OFFERED_LIMITS.tools,
  )) {
    const offered = {
      name: cut(name, OFFERED_LIMITS.name),
      description: cut(tool.description ?? "", OFFERED_LIMITS.description),
      required: Array.isArray(tool.schema?.required)
        ? tool.schema.required
            .filter((key): key is string => typeof key === "string")
            .slice(0, OFFERED_LIMITS.keys)
            .map((key) => cut(key, OFFERED_LIMITS.key))
        : [],
    };
    size += bytesOf(offered) + 1;
    if (size > OFFERED_LIMITS.bytes) break;
    kept.push(offered);
  }
  return kept;
}

/** One of the Companies a turn could be for, with what tells them apart. */
export type Candidate = {
  connection: Connection;
  /** What names it in a request and on what the conversation keeps. */
  origin: string;
  name: string;
  /** Its account is signed in and still accepted. */
  signedIn: boolean;
  /** How it describes each API it lists, in its own words. */
  describes: string[];
  /** The tools its last turn loaded; none before its first turn. */
  tools: OfferedTool[];
  /** §9.1: the tasks its current Session says it doesn't offer. */
  excluded: string[];
};

/** The conversation's Companies, as a turn can be matched to them. */
export function candidates(run: Pick<Run, "connections">): Candidate[] {
  return run.connections.map((connection) => ({
    connection,
    origin: originOf(connection),
    name: companyName(connection),
    signedIn: !!connection.accountToken && !connection.accountUnavailable,
    describes: (connection.company?.document.apis ?? []).flatMap((api) =>
      api.description ? [api.description] : [],
    ),
    tools: connection.offered ?? [],
    excluded:
      connection.tasks?.sid === connection.sessionId
        ? (connection.tasks?.value.excludedTasks ?? []).map((t) => t.task)
        : [],
  }));
}

/**
 * The Company the last turn was with, when it is still connected: the one
 * the last entry the page showed from any Company came from. What Iris
 * said by itself about no Company in between (a question, a name it
 * didn't know) changes nothing about that.
 */
export function lastTurnCompany(
  run: Pick<Run, "connections" | "transcript" | "history">,
): Connection | undefined {
  const last = (run.transcript ?? run.history)
    .filter((entry) => entry.company !== undefined)
    .at(-1)?.company;
  return last === undefined ? undefined : connectionAt(run, last);
}

/**
 * §8.10: the Company one of the User's own actions on a Direct
 * Conversation is for. Their words go to a Company as they wrote them, so
 * the Company is never worked out from the words: it is the one the
 * request names, or the conversation's only one, or the only one that has
 * what the action is about (the Direct Conversation they speak in or
 * leave, the invitation they accept or decline, a conversation with the
 * Company's agent to start one from). Otherwise the request is refused.
 */
export function directConnection(
  run: Pick<Run, "connections">,
  action: DirectAction,
  hint?: string,
): Connection | NoCompany {
  if (hint !== undefined || run.connections.length < 2)
    return connectionNamed(run, hint);
  const fits = run.connections.filter((c) => {
    const thread = c.conversation;
    return action === "say" || action === "close"
      ? !!thread?.direct && !thread.direct.closed
      : action === "start"
        ? !!thread?.id && !thread.direct
        : !!thread?.invitation;
  });
  return fits.length === 1 ? fits[0]! : connectionNamed(run, undefined);
}

/** The Company a turn is for, or the Companies the User is to choose from. */
export type Routed = { connection: Connection } | { ask: Connection[] };

/**
 * The Company a turn is for. `hint` is the Company the request names (any
 * address at its origin), which is the User's own choice on the page, and
 * `message` is what they wrote. A hint that names no Company of the
 * conversation is not followed, and nor is anything else then: the User is
 * asked.
 *
 * Asynchronous so that a deduction can take its time (a model, a lookup).
 */
export async function turnConnection(
  run: Pick<Run, "connections" | "transcript" | "history">,
  message: string,
  hint?: string,
): Promise<Routed> {
  const [only, ...others] = run.connections;
  if (only && !others.length && hint === undefined) return { connection: only };
  const named = hint === undefined ? undefined : connectionAt(run, hint);
  if (named) return { connection: named };
  // The message is here for the deduction that comes next: which
  // Company's tools, or the demo's rules for them, it fits (`candidates`).
  void message;
  const last = hint === undefined ? lastTurnCompany(run) : undefined;
  return last ? { connection: last } : { ask: [...run.connections] };
}

import { accountUnavailableNotice } from "./account-recovery";
import type { Addressed } from "./addressed";
import type { TurnStream } from "./answer-stream";
import type { Before } from "./chat-answers";
import type { Choice, Performed } from "./company-commands";
import { namePool } from "./connect-command";
import { originOf } from "./connections";
import { companiesView } from "./conversation-view";
import { directState } from "./direct-state";
import type { FreeTurn } from "./free-model";
import { nameable, type LabCompany } from "./lab-companies";
import { languageOf } from "./language";
import type { Connection, Operation, Run, Turn } from "./runtime";
import type { Part } from "./several";
import { shownSkills, shownTasks } from "./shown-tasks";
import { spokenText } from "./spoken";
import { offerChoices } from "./transcript";
import { json } from "./web";

/**
 * What a chat turn knows as it goes. Its parts write here, and its error
 * answer (`failedTurn`) and the bookkeeping after it read it, however the
 * turn ended.
 */
export type TurnScope = {
  run?: Run;
  /**
   * The Company this turn is for (`turnConnection`). None for a turn Iris
   * answers by itself: nothing is then sent to any Company.
   */
  connection?: Connection | undefined;
  /**
   * The turn went to `connection` for no reason in the request: it is the
   * conversation's only Company, or the last turn's (`Routed.fallback`).
   * Otherwise it was chosen for this request, by the User, the model's
   * choice, a name in it or a scripted example (`addressed.ts`).
   */
  fallback?: boolean;
  /**
   * A turn the task needs several Companies for (`several.ts`): one part
   * for each, the one `connection` names among them, each with what the
   * turn did there. None for a turn with one Company.
   */
  parts: Part[];
  /**
   * The Company a call of such a turn failed at, with its error, so the
   * answer names that Company and not the one the turn ended at.
   */
  failure?: { connection: Connection; error: unknown };
  stage: string;
  /**
   * Iris already knew, before this turn, that the Company no longer takes
   * the sign-in. A turn in which it learns that drops what it showed with
   * the account (`forgetLostAccount`).
   */
  knewLost: boolean;
  /**
   * The proposals the turn's Company had when the turn began: the ones it
   * leaves besides are this turn's (`noteOperationAccounts`).
   */
  proposals?: Set<Operation>;
  /**
   * What Iris did this turn. A turn that fails answers with it too, so the
   * Inspector lists the request the Company refused. Every answer of a run
   * carries it, and the run keeps it.
   */
  trace: string[];
  /** The turns a model was sent this turn; the demo's rules are sent none. */
  context?: Turn[];
  /**
   * What the User's words did to the conversation's Companies before the
   * turn was asked of one ("connect with Lantern and show me the menu"):
   * Iris's line about it, whether the Companies changed, what the
   * conversation still shows after a removal, and how many of the trace's
   * lines are kept with the conversation already. Every answer carries
   * these, a failed turn's too.
   */
  did: {
    before?: string;
    changed: boolean;
    left?: Performed["left"];
    kept: number;
  };
  /**
   * The proposals and invitations the conversation had before the turn:
   * the agent asks about what is new once it answers (`askAfter`).
   */
  before?: Before;
  /** The request "try again" asks again if the turn fails, and where. */
  retry?: { asked: string; company?: string };
};

/** A turn once it holds its conversation: what it was asked, and how. */
export type HeldTurn = {
  scope: TurnScope;
  conversation: Run;
  lab: LabCompany[];
  /** `demo`, `free` (the deployment's own model) or the User's provider. */
  provider: string;
  modelConfig: {
    apiKey: string | undefined;
    model: string | undefined;
    /** The free model's binding, for a turn `admitFreeTurn` let in. */
    workersAi?: FreeTurn["workersAi"];
  };
  /**
   * What the User said: their words, or the label of the button they
   * pressed, which the page showed as their line.
   */
  message: string;
  /**
   * The request this turn answers, and what the User typed when that is
   * something else: a Company's name in answer to Iris's question, or
   * nothing more (`null`), when the request is the rest of a message the
   * page already shows.
   */
  asked: string;
  typed: string | null | undefined;
  /**
   * The other Companies the turn's task needs, before `connection`, in
   * the order it uses them.
   */
  also: Connection[];
  /** Where the model's answer goes as it is written, when it is streamed. */
  stream?: TurnStream | undefined;
};

/**
 * What the turn was asked, and of whom, for the tools of each Company it
 * uses (`addressed.ts`): `at` are the Companies it was asked of, the one
 * it is for last. A turn that went to its Company only as the fallback
 * chose none of them for the request.
 */
export function turnAddressed(
  turn: HeldTurn,
  at: readonly Connection[],
  aboutCompanies?: () => boolean,
): Addressed {
  const { conversation: run, lab, scope } = turn;
  return {
    asked: turn.asked,
    companies: () =>
      namePool({
        connected: run.connections.map((c) => nameable(c, lab)),
        lab,
      }),
    chosen: scope.fallback && at.length < 2 ? [] : at.map(originOf),
    ...(aboutCompanies ? { aboutCompanies } : {}),
  };
}

/**
 * One Company's state as a chat answer carries it: its Session, sign-in,
 * proposals, what its Session read (§9.1, §9.4; never for the model) and
 * its Direct Conversation. For a conversation with no Company, none.
 */
export const turnState = (connection: Connection | undefined) => ({
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

/**
 * What an answer says of the conversation's Companies when the User's
 * words changed them: Iris's line about it when the turn went on to a
 * Company, the Companies as they are now, and what the conversation
 * still shows after a removal.
 */
export const companiesNow = (turn: HeldTurn) => ({
  ...(turn.scope.did.changed ? companiesView(turn.conversation) : {}),
  ...turn.scope.did.left,
});

/**
 * An answer of Iris's own, about the conversation and from no Company.
 * The page that shows one Company gets the first one's state with it,
 * as a reload does. Its buttons are kept with it, for a reload.
 */
export function ownAnswer(
  turn: HeldTurn,
  text: string,
  choices: Choice[] = [],
  /** More of what the answer says: what an approval did, say. */
  extra: Record<string, unknown> = {},
) {
  const { conversation, scope } = turn;
  offerChoices(conversation, text, choices);
  return json(
    {
      text,
      // For a voice: made from the same words, by fixed rules.
      spoken: spokenText(text, languageOf(conversation)),
      ...(scope.did.before ? { before: scope.did.before } : {}),
      trace: scope.trace,
      // The agent's own words, under no name of its own: the page reads
      // `"iris"`, what it was before, the same until 31 January 2027.
      mode: "own",
      ...(choices.length ? { choices } : {}),
      ...turnState(conversation.connections[0]),
      company: [],
      ...companiesNow(turn),
      ...extra,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

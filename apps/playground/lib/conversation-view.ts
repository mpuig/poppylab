/**
 * A conversation and its Companies as the page is told of them: what
 * `GET /api/account` answers for a reload, and what an answer carries when
 * it changed which Companies the conversation works with. No token, key,
 * Session header or request body is in any of it.
 */
import { accountUnavailableNotice } from "./account-recovery";
import { companyRef, originOf, type CompanyRef } from "./connections";
import { directState } from "./direct-state";
import { shownLog } from "./inspector-log";
import {
  espiAuthorizationTarget,
  type Connection,
  type Operation,
  type Run,
} from "./runtime";
import { shownSkills, shownTasks } from "./shown-tasks";
import { shownTranscript } from "./transcript";

/**
 * What the page shows of one Company. With no connection these are the
 * values of a conversation that has none, as the page has always got them.
 */
export function connectionState(
  run: Run | undefined,
  connection: Connection | undefined,
) {
  return {
    company: connection?.company,
    // §9.1: the tasks its current Session read, for "Tasks not offered".
    excludedTasks: connection ? shownTasks(connection) : [],
    // §9.4: the skills it read, for "Skills published".
    skills: connection ? shownSkills(connection) : [],
    url: connection?.url,
    scopes: connection?.scopes,
    // Use FDX (poppylab.dev/fdx v1), a setting of this connection.
    fdx: !!connection?.fdx,
    // The FDX consent of this sign-in, for the page to show and revoke
    // with Use FDX on.
    fdxConsent:
      connection?.accountToken && !connection.accountUnavailable
        ? connection.fdxConsent
        : undefined,
    // Use ESPI (poppylab.dev/espi v1), the same setting at a utility, and
    // the id of this sign-in's authorization, to show and revoke with it.
    espi: !!connection?.espi,
    espiAuthorization: connection
      ? espiAuthorizationTarget(connection)?.id
      : undefined,
    consentVersion: connection?.consentVersion ?? 0,
    recovery: connection?.accountUnavailable
      ? accountUnavailableNotice
      : undefined,
    signedIn:
      !!run &&
      !!connection?.accountToken &&
      !connection.accountUnavailable &&
      run.expires > Date.now(),
    authPending: !!connection?.auth || !!run?.busy,
    // §8.10: a reload must not send the User's words for the Company to
    // Iris. Under its own name: `conversation` is the conversation's ID.
    directConversation: connection ? directState(connection) : undefined,
    // An ended conversation shows how its proposals ended.
    operations:
      run && connection && (run.archived || run.expires > Date.now())
        ? Object.values(connection.operations ?? {})
        : [],
  };
}

/** One of the conversation's Companies: which it is, and its state. */
export type ConnectionView = CompanyRef & ReturnType<typeof connectionState>;
export const connectionView = (
  run: Run,
  connection: Connection,
): ConnectionView => ({
  ...companyRef(run, originOf(connection)),
  ...connectionState(run, connection),
});

/**
 * A Company that was removed from the conversation: its name, for what the
 * page still shows from it, and an approval it was left with an unknown
 * outcome, which can't be retried from here.
 */
export type FormerView = CompanyRef & { url: string; operations: Operation[] };

/**
 * The conversation's Companies: the connected ones in the order they were
 * connected, each with its state, and the ones that were removed.
 */
export function companiesView(run: Run): {
  connections: ConnectionView[];
  former: FormerView[];
} {
  return {
    connections: run.connections.map((c) => connectionView(run, c)),
    former: (run.former ?? []).map((left) => ({
      origin: originOf(left),
      name: left.name,
      url: left.url,
      operations: Object.values(left.operations ?? {}),
    })),
  };
}

/**
 * What the conversation shows, each entry and line with the Company it
 * came from: the transcript, and the Inspector's "Session & API calls".
 */
export const wordsView = (run: Run) => ({
  history: shownTranscript(run),
  log: shownLog(run),
});

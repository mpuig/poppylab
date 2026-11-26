/**
 * Removing a Company from a conversation that goes on with the others, as
 * the User asked for it: with a button of the page, or in their own words
 * in the chat. Never on a model's word or a Company's.
 */
import { companyName, companyRef, originOf } from "./connections";
import { companiesView, wordsView } from "./conversation-view";
import { keepLines } from "./inspector-log";
import {
  revokeRefreshToken,
  type Connection,
  type Operation,
  type Run,
} from "./runtime";
import { removeConnection } from "./transcript";

/**
 * A connection's approvals that were sent and whose outcome isn't known.
 * Each may have been performed, and only its own approval may be sent
 * again (Operations v3 §7), which takes the connection's Session.
 */
export const unsettled = (connection: Pick<Connection, "operations">) =>
  Object.values(connection.operations ?? {}).filter(
    (op) => op.state === "uncertain",
  );

/** Why a Company can't be removed yet, in words the page can show. */
const unsettledRefusal = (name: string) =>
  `An approval sent to ${name} has an unknown outcome, so ${name} can't be removed yet. Retry that approval first: it is performed at most once. Without ${name} there would be no way to retry it, and the same change could be asked for twice.`;

/** What to say when the Company's grant couldn't be revoked on the way out. */
const notRevokedNotice = (name: string) =>
  `${name} couldn't be reached, so the access you gave Iris there wasn't revoked. You can end that access on ${name}'s own website.`;

/** How a removal went, for the route that answers it. */
export type Removal =
  | {
      /** Nothing was sent or removed: these approvals come first. */
      refused: { code: "approval_unsettled"; error: string };
      operations: Operation[];
    }
  | {
      refused?: undefined;
      removed: { origin: string; name: string };
      /** Signed in: whether the Company confirmed the revocation. */
      revoked?: boolean;
      /** It didn't: what the User should know, and can do. */
      notice?: string;
      /** The Inspector's line for it, kept with the conversation. */
      trace: string[];
      /** What the conversation shows now, before that line. */
      history: ReturnType<typeof wordsView>["history"];
      log: ReturnType<typeof wordsView>["log"];
      connections: ReturnType<typeof companiesView>["connections"];
      former: ReturnType<typeof companiesView>["former"];
    };

/**
 * Removes a Company from the conversation (`removeConnection`). Signed in,
 * its grant is revoked there first, as sign-out does (§5.5). A Company
 * that can't be reached is removed all the same, so the User is never
 * kept connected to one that is gone, and is told the grant wasn't
 * revoked.
 *
 * Not while an approval sent there has an unknown outcome (`unsettled`):
 * without the connection it could never be retried, and the same change
 * could then be asked for a second time. Nothing is sent or removed, and
 * the answer names those approvals.
 */
export async function removeCompany(
  run: Run,
  connection: Connection,
): Promise<Removal> {
  const name = companyName(connection);
  const waiting = unsettled(connection);
  if (waiting.length)
    return {
      refused: { code: "approval_unsettled", error: unsettledRefusal(name) },
      operations: waiting,
    };
  let revoked: boolean | undefined;
  if (connection.accountToken) {
    try {
      await revokeRefreshToken(connection, connection.accountToken);
      revoked = true;
    } catch {
      revoked = false;
    }
  }
  removeConnection(run, connection);
  const trace = [
    revoked === undefined
      ? `${name} removed from the conversation`
      : revoked
        ? `Account grant revoked · ${name} removed from the conversation`
        : `Account grant not revoked · the Company could not be reached · ${name} removed from the conversation`,
  ];
  const shown = { ...wordsView(run), ...companiesView(run) };
  // The line names nothing an account holds, so it is kept as one written
  // signed out is.
  keepLines(run, connection, trace, Date.now(), false);
  return {
    removed: companyRef(run, originOf(connection)),
    ...(revoked === undefined ? {} : { revoked }),
    ...(revoked === false ? { notice: notRevokedNotice(name) } : {}),
    trace,
    ...shown,
  };
}

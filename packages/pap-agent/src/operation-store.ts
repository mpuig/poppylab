import { originOf } from "./connections";
import type { Connection, Operation } from "./runtime";
import { validateOperation } from "./operation-validation";

/**
 * Validates and stores an operation from approval_required (Operations v3).
 * One whose approval was sent with an unknown outcome is returned as stored,
 * still `uncertain`: callers tell the model that with `outcomeUnknown`.
 */
export function recordOperation(
  connection: { operations?: Record<string, Operation> },
  raw: unknown,
  request: NonNullable<Operation["request"]>,
  /** The operation is the Company's answer to an approval, not to a request. */
  answersApproval = false,
) {
  const previous =
    connection.operations?.[
      (raw as { operation_id?: string } | undefined)?.operation_id ?? ""
    ];
  const clean = validateOperation(raw, previous);
  // §7: while an approval's outcome is unknown, nothing new is approved or
  // put to the User. The operation in answer to another request for the
  // action, in the same revision or a new one, doesn't say whether the
  // approval was performed. So it isn't kept: what is stored stays, with the
  // approval Retry resends. Only an answer to that approval settles it.
  if (previous?.state === "uncertain" && !answersApproval) return previous;
  if (Date.parse(clean.expires_at) <= Date.now())
    throw new Error("Invalid proposal response");
  // The same revision again (the model asked twice) keeps its approval, so
  // it goes out as first sent (§7), unless the Company declined it (§6:
  // never sent again). A new revision needs a new approval.
  const same = previous?.revision === clean.revision ? previous : undefined;
  const op: Operation = {
    ...clean,
    state: "proposed",
    request,
    changed: Date.now(),
    ...(same?.approval && same.state !== "refused"
      ? { approval: same.approval }
      : {}),
    // The same terms again: the Inspector already says why the User's
    // standing instruction left them to the User.
    ...(same?.notApplied ? { notApplied: same.notApplied } : {}),
    // §6: once the Company declined an agent approval, Iris must not
    // approve a new revision for the same action without asking the User,
    // so the decline stays with the operation whatever the revision.
    ...(previous?.agentDeclined
      ? { agentDeclined: previous.agentDeclined }
      : {}),
    // §5: the same once the Company answered an agent approval with new
    // terms, so asking for them again doesn't hand them back to the rule.
    ...(previous?.agentSuperseded
      ? { agentSuperseded: previous.agentSuperseded }
      : {}),
  };
  const ops = (connection.operations ??= {});
  ops[op.operation_id] = op;
  // Bounded, newest last.
  for (const key of Object.keys(ops).slice(
    0,
    Math.max(0, Object.keys(ops).length - 20),
  ))
    delete ops[key];
  return op;
}

/**
 * What the model is told when the operation it asked for again is still
 * `uncertain`: the terms the approval was for, never the ones offered since,
 * and that no new proposal waits.
 */
export const outcomeUnknown = (op: Operation) => ({
  status: "outcome_unknown",
  operation_id: op.operation_id,
  ...(op.summary ? { summary: op.summary } : {}),
  terms: op.terms,
  note: "An approval of these terms was already sent and its outcome is unknown: the change may have been made. Nothing new was proposed, so there is nothing to approve: what the Company answered now doesn't say whether that approval was performed. The user can press “Retry the same approval” in the chat, which the Company performs at most once, or check the Company's own records to see whether the change was made.",
});

type Proposals = Pick<Connection, "url" | "operations" | "operationAccounts">;

/**
 * The Companies whose accounts could be in one of this connection's
 * proposals, when one of them is another Company's; none otherwise.
 */
export const operationAccounts = (
  connection: Pick<Connection, "operationAccounts">,
  id: string | undefined,
): readonly string[] => connection.operationAccounts?.[id ?? ""] ?? [];

/**
 * Notes whose accounts could be in the proposals a turn left with this
 * connection: every one that isn't in `before`, the proposals it had when
 * the turn began. `accounts` are the turn's (`accountsIn`): a model is
 * sent the turns with every Company, so the request it makes of this one
 * can name what it read with another's account, and the Company's terms
 * then repeat it. A proposal is listed only when one of the accounts is
 * another Company's; this Company's own reset drops its proposals anyway.
 *
 * A Company keeps an operation under its ID, with what it was first asked
 * for, so a proposal that comes again under the same ID keeps the
 * accounts it had. What is listed for a proposal that is gone goes too.
 */
export function noteOperationAccounts(
  connection: Proposals,
  before: ReadonlySet<Operation>,
  accounts: readonly string[],
) {
  const own = originOf(connection);
  const foreign = accounts.some((origin) => origin !== own);
  const listed: Record<string, string[]> = {};
  for (const [id, op] of Object.entries(connection.operations ?? {})) {
    const had = operationAccounts(connection, id);
    const now = before.has(op) || !foreign ? [] : accounts;
    if (had.length || now.length) listed[id] = [...new Set([...had, ...now])];
  }
  if (Object.keys(listed).length) connection.operationAccounts = listed;
  else delete connection.operationAccounts;
}

/**
 * New terms that answer an approval hold what the approved ones held: the
 * Company wrote them for the same request. Under the same operation ID
 * they are listed already; under another, they are listed as the first.
 */
export function inheritOperationAccounts(
  connection: Proposals,
  from: string,
  to: string,
) {
  const had = operationAccounts(connection, from);
  if (from === to || !had.length) return;
  connection.operationAccounts = {
    ...connection.operationAccounts,
    [to]: [...new Set([...had, ...operationAccounts(connection, to)])],
  };
}

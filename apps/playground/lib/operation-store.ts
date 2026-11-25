import type { Operation } from "./runtime";
import { validateOperation } from "./operation-validation";

/** Validates and stores an operation from approval_required (Operations v3). */
export function recordOperation(
  run: { operations?: Record<string, Operation> },
  raw: unknown,
  request: NonNullable<Operation["request"]>,
) {
  const previous =
    run.operations?.[
      (raw as { operation_id?: string } | undefined)?.operation_id ?? ""
    ];
  const clean = validateOperation(raw, previous);
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
    ...(same?.approval && same.state !== "refused"
      ? { approval: same.approval }
      : {}),
    // §6: once the Company declined an agent approval, Iris must not
    // approve a new revision for the same action without asking the User,
    // so the decline stays with the operation whatever the revision.
    ...(previous?.agentDeclined
      ? { agentDeclined: previous.agentDeclined }
      : {}),
  };
  const ops = (run.operations ??= {});
  ops[op.operation_id] = op;
  // Bounded, newest last.
  for (const key of Object.keys(ops).slice(
    0,
    Math.max(0, Object.keys(ops).length - 20),
  ))
    delete ops[key];
  return op;
}

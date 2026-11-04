import type { Operation } from "./runtime";
import { validateOperation } from "./operation-validation";

/** Validates and stores an operation from approval_required (Operations v2). */
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
  const op: Operation = { ...clean, state: "proposed", request };
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

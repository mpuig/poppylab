import type { Operation } from "./runtime";
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export type RemoteOperation = Pick<
  Operation,
  "operation_id" | "revision" | "summary" | "terms" | "expires_at"
>;
/**
 * Operations v3 §3. Validates an untrusted operation from approval_required
 * and returns only its defined fields: `terms` is required, `summary`
 * optional. A revision's terms never change: the same revision with other
 * terms or expiry is refused (§3 "New terms"); a reworded summary may keep it.
 */
export function validateOperation(
  value: unknown,
  previous?: Operation,
): RemoteOperation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid operation");
  const op = value as Record<string, unknown>;
  if (
    typeof op.operation_id !== "string" ||
    !ID.test(op.operation_id) ||
    typeof op.revision !== "string" ||
    !ID.test(op.revision) ||
    (op.summary !== undefined &&
      (typeof op.summary !== "string" || op.summary.length > 10000)) ||
    !op.terms ||
    typeof op.terms !== "object" ||
    Array.isArray(op.terms) ||
    JSON.stringify(op.terms).length > 20000 ||
    typeof op.expires_at !== "string" ||
    !Number.isFinite(Date.parse(op.expires_at))
  )
    throw Error("Invalid operation");
  const clean: RemoteOperation = {
    operation_id: op.operation_id,
    revision: op.revision,
    ...(typeof op.summary === "string" && op.summary.trim()
      ? { summary: op.summary }
      : {}),
    terms: op.terms as Record<string, unknown>,
    expires_at: op.expires_at,
  };
  if (!previous) return clean;
  if (clean.operation_id !== previous.operation_id)
    throw Error("Operation identity mismatch");
  const fixed = (o: RemoteOperation) => ({
    terms: o.terms,
    expires_at: o.expires_at,
  });
  if (
    clean.revision === previous.revision &&
    canonical(fixed(clean)) !== canonical(fixed(previous))
  )
    throw Error("Company changed immutable revision");
  if (previous.state === "succeeded" && clean.revision !== previous.revision)
    throw Error("Performed operation changed");
  return clean;
}

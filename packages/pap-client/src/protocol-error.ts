const codes = new Set([
  "account_mismatch",
  "invalid_request",
  "invalid_target",
  "use_dpop_nonce",
  "invalid_session",
  "invalid_scope",
  "invalid_grant",
  "invalid_client",
  "invalid_dpop_proof",
  "invalid_token",
  "sign_in_required",
  "insufficient_scope",
  "extension_required",
  "rate_limited",
  "terms_changed",
  "user_approval_required",
  "operation_not_found",
  "unsupported_grant_type",
  "approval_required",
]);
export class ProtocolError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    public retryAt?: number,
    public nonce?: string,
    /** Operations v2: the raw, untrusted operation of an approval_required error. */
    public operation?: unknown,
  ) {
    super(
      `Remote server returned HTTP ${status}${code ? ` (${code})` : ""}${retryAt ? " — retry after " + new Date(Math.min(retryAt, 8640000000000000)).toISOString() : ""}`,
    );
  }
}
export function errorCode(value: unknown) {
  return typeof value === "string" && codes.has(value) ? value : undefined;
}
const cooldowns = new Map<string, number>();
let globalUntil = 0;
export type RetryState = { until: number; entries: Array<[string, number]> };
let retryStore: { value: RetryState; save: () => void } | undefined;
// Hosts opt in to their own single-writer durable store. No credentials or paths.
export function configureRetryStore(store: {
  value: RetryState;
  save: () => void;
}) {
  globalUntil = Math.max(globalUntil, store.value.until);
  for (const [origin, time] of store.value.entries) {
    if (time > Date.now())
      cooldowns.set(origin, Math.max(cooldowns.get(origin) ?? 0, time));
  }
  retryStore = store;
}
export function checkCooldown(origin: string, now = Date.now()) {
  for (const [key, time] of cooldowns) if (time <= now) cooldowns.delete(key);
  const until = Math.max(globalUntil, cooldowns.get(origin) ?? 0);
  if (until > now) throw new ProtocolError(429, "rate_limited", until);
}
export function recordCooldown(
  origin: string,
  header: string | null,
  now = Date.now(),
) {
  if (!header) return;
  const value = header.trim();
  const until = /^\d+$/.test(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, now + Number(value) * 1000)
    : /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
          value,
        )
      ? Date.parse(value)
      : NaN;
  if (!Number.isFinite(until) || until <= now) return;
  if (cooldowns.size >= 1000 && !cooldowns.has(origin))
    globalUntil = Math.max(globalUntil, until);
  else cooldowns.set(origin, Math.max(cooldowns.get(origin) ?? 0, until));
  if (retryStore) {
    retryStore.value.until = globalUntil;
    retryStore.value.entries = [...cooldowns].filter(([, time]) => time > now);
    retryStore.save();
  }
  return Math.max(globalUntil, cooldowns.get(origin) ?? until);
}

/** RFC 9651 Dictionary with String members, as Operations v2 §6 requires. */
export function approvalHeader(approval: {
  operation_id: string;
  revision: string;
}) {
  const id = /^[A-Za-z0-9_-]{1,128}$/;
  if (!id.test(approval.operation_id) || !id.test(approval.revision))
    throw new Error("Invalid approval");
  return `operation_id="${approval.operation_id}", revision="${approval.revision}"`;
}
/** Parses the Poppy-Approval dictionary, ignoring unknown members. */
export function parseApprovalHeader(value: unknown) {
  if (typeof value !== "string" || value.length > 1024) return undefined;
  const members: Record<string, string> = {};
  for (const part of value.split(",")) {
    const match = part.trim().match(/^([a-z*][a-z0-9_.*-]*)(?:=(.*))?$/);
    if (!match) return undefined;
    const raw = match[2];
    if (raw && /^"(?:[^"\\]|\\.)*"$/.test(raw))
      members[match[1]!] = raw.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  const { operation_id, revision } = members;
  return operation_id && revision ? { operation_id, revision } : undefined;
}

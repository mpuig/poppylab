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
  "approval_declined",
  // Sessions and versions (1.0 §5, §3.4).
  "session_ended",
  "version_unsupported",
  // Conversations (1.0 §8.13).
  "conversation_not_found",
  "conversation_closed",
  "direct_conversation_open",
  "request_id_conflict",
  "invalid_cursor",
  "cursor_expired",
  "version_mismatch",
]);
export class ProtocolError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    public retryAt?: number,
    public nonce?: string,
    /** Operations v3: the raw, untrusted operation of an approval_required error. */
    public operation?: unknown,
    /** Operations v3: an approval_declined body (Company content). */
    public declined?: { reason?: string },
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

/** Operations v3 §6: an approval of one revision, and who approved it. */
export type Approval = {
  operation_id: string;
  revision: string;
  approver: "user" | "agent";
  /** Unix seconds: when the User (or, for `agent`, the agent) approved. */
  approved_at?: number;
  /** How the User answered, only with `user`: `tap`, `typed`, `voice`… */
  input_type?: string;
  /** The Personal Agent's own record of the approval, never shared across Companies. */
  reference?: string;
};
const APPROVAL_ID = /^[A-Za-z0-9_-]{1,256}$/;
const INPUT_TYPE = /^[a-z][a-z0-9_-]{0,31}$/;

/** `Poppy-Approval`: an RFC 9651 Dictionary (Strings, and an Integer time). */
export function approvalHeader(approval: Approval) {
  if (
    !APPROVAL_ID.test(approval.operation_id) ||
    !APPROVAL_ID.test(approval.revision) ||
    (approval.approver !== "user" && approval.approver !== "agent") ||
    (approval.reference !== undefined &&
      !APPROVAL_ID.test(approval.reference)) ||
    (approval.input_type !== undefined &&
      (approval.approver !== "user" ||
        !INPUT_TYPE.test(approval.input_type))) ||
    (approval.approved_at !== undefined &&
      !(Number.isSafeInteger(approval.approved_at) && approval.approved_at > 0))
  )
    throw new Error("Invalid approval");
  return [
    `operation_id="${approval.operation_id}"`,
    `revision="${approval.revision}"`,
    `approver="${approval.approver}"`,
    ...(approval.approved_at !== undefined
      ? [`approved_at=${approval.approved_at}`]
      : []),
    ...(approval.input_type ? [`input_type="${approval.input_type}"`] : []),
    ...(approval.reference ? [`reference="${approval.reference}"`] : []),
  ].join(", ");
}

/** A minimal RFC 9651 Dictionary parser: Strings, Integers, Tokens, Booleans. */
function parseDictionary(input: string) {
  const out: Record<string, string | number | boolean> = {};
  let i = 0;
  const ows = () => {
    while (input[i] === " " || input[i] === "\t") i++;
  };
  const key = () => {
    const m = /^[a-z*][a-z0-9_.*-]*/.exec(input.slice(i));
    if (!m) throw Error();
    i += m[0].length;
    return m[0];
  };
  const bare = (): string | number | boolean => {
    if (input[i] === '"') {
      let v = "";
      for (i++; i < input.length; i++) {
        const ch = input[i]!;
        if (ch === "\\") {
          const next = input[++i];
          if (next !== '"' && next !== "\\") throw Error();
          v += next;
        } else if (ch === '"') {
          i++;
          return v;
        } else if (ch < " " || ch > "~") throw Error();
        else v += ch;
      }
      throw Error();
    }
    if (input[i] === "?") {
      const b = input[i + 1];
      if (b !== "0" && b !== "1") throw Error();
      i += 2;
      return b === "1";
    }
    const num = /^-?\d{1,15}(?![.\d])/.exec(input.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const token = /^[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*/.exec(
      input.slice(i),
    );
    if (!token) throw Error();
    i += token[0].length;
    return token[0];
  };
  const params = () => {
    while (input[i] === ";") {
      i++;
      ows();
      key();
      if (input[i] === "=") {
        i++;
        bare();
      }
    }
  };
  ows();
  while (i < input.length) {
    const k = key();
    let value: string | number | boolean = true;
    if (input[i] === "=") {
      i++;
      if (input[i] === "(") throw Error(); // Inner Lists aren't used here.
      value = bare();
    }
    params();
    out[k] = value;
    ows();
    if (i >= input.length) break;
    if (input[i] !== ",") throw Error();
    i++;
    ows();
    if (i >= input.length) throw Error();
  }
  return out;
}

/**
 * Parses `Poppy-Approval` (Operations v3 §6), ignoring unknown members. An
 * approval without a valid `approver` isn't one.
 */
export function parseApprovalHeader(value: unknown): Approval | undefined {
  if (typeof value !== "string" || value.length > 1024) return undefined;
  let m: Record<string, string | number | boolean>;
  try {
    m = parseDictionary(value);
  } catch {
    return undefined;
  }
  return approvalFrom(m);
}
/** The same members as a JSON object, from a conversation or MCP `_meta`. */
export function approvalFrom(value: unknown): Approval | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const m = value as Record<string, unknown>;
  if (
    typeof m.operation_id !== "string" ||
    !APPROVAL_ID.test(m.operation_id) ||
    typeof m.revision !== "string" ||
    !APPROVAL_ID.test(m.revision) ||
    (m.approver !== "user" && m.approver !== "agent")
  )
    return undefined;
  return {
    operation_id: m.operation_id,
    revision: m.revision,
    approver: m.approver,
    ...(typeof m.approved_at === "number" && Number.isSafeInteger(m.approved_at)
      ? { approved_at: m.approved_at }
      : {}),
    // input_type comes only with a user approval; others are ignored.
    ...(m.approver === "user" &&
    typeof m.input_type === "string" &&
    m.input_type.length <= 32
      ? { input_type: m.input_type }
      : {}),
    ...(typeof m.reference === "string" && APPROVAL_ID.test(m.reference)
      ? { reference: m.reference }
      : {}),
  };
}

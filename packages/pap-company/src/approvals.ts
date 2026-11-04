/**
 * Operations extension version 2 (PAP 0.3), runtime-portable. A request that
 * needs approval is refused with the operation (§4). The same request with
 * `Poppy-Approval` naming a returned, unexpired revision whose terms equal
 * what the request asks now is performed once (§6–7); retries get the first
 * response.
 */
import { createHash } from "node:crypto";
import { parseApprovalHeader, randomId } from "@poppy-lab/pap-client/core";

export type Revision = {
  revision: string;
  summary: string;
  terms: Record<string, unknown>;
  expires_at: string;
};
export type OperationRecord = {
  client: string;
  user: string;
  account: string;
  key: string;
  revisions: Revision[];
  performed?: {
    revision: string;
    at: string;
    until: number;
    body: { operation_id: string; summary: string; data?: unknown };
  };
};
export type Owner = { client: string; user: string; account: string };
export type Action = {
  /** What the request is for: the same action keeps its operation_id. */
  key: string;
  terms: Record<string, unknown>;
  summary: string;
  /** Runs only after approval; returns what the API responds with. */
  perform: (terms: Record<string, unknown>) => {
    summary: string;
    data?: unknown;
  };
  /** Extra guard against approved-but-now-impossible actions. */
  stale?: (terms: Record<string, unknown>) => boolean;
  /** Fields left out when comparing approved and requested terms. */
  ignore?: string[];
};
export type Outcome = {
  status: 200 | 403 | 409 | 429;
  body: unknown;
  /** The operation was performed before: this is its first response (§7). */
  replayed?: boolean;
};
/** An approval from `Poppy-Approval` or from a conversation message. */
export type Approval = { operation_id: string; revision: string };

const same = (a: Owner, r: OperationRecord) =>
  r.client === a.client && r.user === a.user && r.account === a.account;

export function approvals(
  records: Record<string, OperationRecord>,
  options: { revisionMs?: number; now?: () => number } = {},
) {
  const revisionMs = options.revisionMs ?? 10 * 60000;
  const now = options.now ?? (() => Date.now());
  function prune(at: number) {
    for (const [id, r] of Object.entries(records)) {
      r.revisions = r.revisions.filter((v) => Date.parse(v.expires_at) > at);
      if (!r.revisions.length && (!r.performed || r.performed.until < at))
        delete records[id];
    }
  }
  return {
    /** §7: the first response for a retry of a performed operation. */
    replay(owner: Owner, approvalHeader: string | undefined) {
      const approval = parseApprovalHeader(approvalHeader);
      const r = approval && records[approval.operation_id];
      return r?.performed && same(owner, r) ? r.performed.body : undefined;
    },
    gate(
      owner: Owner,
      approvalIn: string | Approval | undefined,
      action: Action,
    ): Outcome {
      const at = now();
      const comparable = (t: Record<string, unknown>) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(t).filter(([k]) => !action.ignore?.includes(k)),
          ),
        );
      prune(at);
      const id = `op_${createHash("sha256")
        .update(
          [owner.client, owner.user, owner.account, action.key].join("\n"),
        )
        .digest("base64url")
        .slice(0, 24)}`;
      let r = records[id];
      if (r && !same(owner, r)) r = undefined;
      const approval =
        typeof approvalIn === "string" || approvalIn === undefined
          ? parseApprovalHeader(approvalIn)
          : approvalIn;
      // 1. Only this account's Sessions can approve it; otherwise ignore it.
      if (approval?.operation_id === id && r) {
        // 2. Already performed: the first response, never a second action.
        if (r.performed)
          return { status: 200, body: r.performed.body, replayed: true };
        // 3. A returned, unexpired revision describing exactly this request.
        const approved = r.revisions.find(
          (v) =>
            v.revision === approval.revision &&
            Date.parse(v.expires_at) > at &&
            comparable(v.terms) === comparable(action.terms),
        );
        if (approved) {
          if (action.stale?.(approved.terms))
            return { status: 409, body: { error: "account_changed" } };
          const result = action.perform(approved.terms);
          r.performed = {
            revision: approved.revision,
            at: new Date(at).toISOString(),
            until: Date.parse(approved.expires_at),
            body: { operation_id: id, ...result },
          };
          return { status: 200, body: r.performed.body };
        }
      }
      if (!r) {
        if (Object.keys(records).length >= 2000)
          return { status: 429, body: { error: "too_many_operations" } };
        r = records[id] = { ...owner, key: action.key, revisions: [] };
      }
      if (r.performed)
        return { status: 200, body: r.performed.body, replayed: true };
      // Same terms → same unexpired revision; never the revision just refused.
      let revision = r.revisions.find(
        (v) =>
          comparable(v.terms) === comparable(action.terms) &&
          v.revision !== approval?.revision &&
          Date.parse(v.expires_at) > at + 60000,
      );
      if (!revision) {
        if (r.revisions.length >= 20)
          return { status: 429, body: { error: "too_many_revisions" } };
        revision = {
          revision: `${Math.floor(at / 1000)}-${randomId().slice(0, 16)}`,
          summary: action.summary,
          terms: action.terms,
          expires_at: new Date(at + revisionMs).toISOString(),
        };
        r.revisions.push(revision);
      }
      return {
        status: 403,
        body: {
          error: "approval_required",
          operation: { operation_id: id, ...revision },
        },
      };
    },
  };
}

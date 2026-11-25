/**
 * Operations extension version 3 (PAP 1.0), runtime-portable. A request that
 * needs approval is refused with the operation and its terms (§3–4). The
 * same request with an approval (`Poppy-Approval`, or a conversation
 * message) naming a returned, unexpired revision whose terms equal what the
 * request asks now is performed once (§6–7); retries get the first response.
 * Both user and agent approvals are accepted, and recorded with their
 * `approver` and `reference` (§6, §8.1). An action may decline an approval
 * that passed every check, for its own reasons (§6, "Declining"): nothing
 * is performed and no new operation is returned.
 */
import { createHash } from "node:crypto";
import {
  parseApprovalHeader,
  randomId,
  type Approval,
} from "@poppy-lab/pap-client/core";
export type { Approval } from "@poppy-lab/pap-client/core";

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
    /** Who approved it, as the Personal Agent stated (§6, §8.1). */
    approver: "user" | "agent";
    reference?: string;
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
  /**
   * §6: decline an approval that passed the checks, such as an agent
   * approval of something the Company wants the User to approve. A short
   * reason for the User, with no codes, and optionally an alternative.
   */
  decline?: (
    approval: Approval,
    terms: Record<string, unknown>,
  ) => { reason?: string; alternative?: Record<string, unknown> } | undefined;
};
export type Outcome = {
  status: 200 | 403 | 409 | 429;
  body: unknown;
  /** The operation was performed before: this is its first response (§7). */
  replayed?: boolean;
};

/**
 * Bounds: operations per tenant, and per account of it, so one account
 * asking with fresh keys can't use up what the tenant's other customers
 * need. An operation lasts about ten minutes: 100 is far more than a person
 * approving by hand, or an agent approving for them, opens in that time,
 * and twenty accounts would have to fill theirs at once to fill the tenant.
 */
const PER_ACCOUNT = 100,
  PER_TENANT = 2000;

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
          const declined = action.decline?.(approval, approved.terms);
          if (declined)
            return {
              status: 403,
              body: {
                error: "approval_declined",
                operation_id: id,
                revision: approved.revision,
                ...(declined.reason
                  ? { reason: declined.reason.slice(0, 300) }
                  : {}),
                ...(declined.alternative
                  ? { alternative: declined.alternative }
                  : {}),
              },
            };
          const result = action.perform(approved.terms);
          r.performed = {
            revision: approved.revision,
            at: new Date(at).toISOString(),
            until: Date.parse(approved.expires_at),
            body: { operation_id: id, ...result },
            approver: approval.approver,
            ...(approval.reference ? { reference: approval.reference } : {}),
          };
          return { status: 200, body: r.performed.body };
        }
      }
      if (!r) {
        // Counted by account, not by client or User ID: a client picks
        // those itself, and an account takes a sign-in.
        const held = Object.values(records);
        if (
          held.length >= PER_TENANT ||
          held.filter((v) => v.account === owner.account).length >= PER_ACCOUNT
        )
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

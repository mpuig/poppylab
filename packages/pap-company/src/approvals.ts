/**
 * Operations extension version 3 (PAP 1.0), runtime-portable. A request that
 * needs approval is refused with the operation and its terms (§3–4). The
 * same request with an approval (`Poppy-Approval`, or a conversation
 * message) naming a returned, unexpired revision whose terms equal what the
 * request asks now is performed once (§6–7); retries get the first response.
 * Both user and agent approvals are accepted, and recorded with their
 * `approver` and `reference` (§6, §8.1). An action may decline an approval
 * that passed every check, for its own reasons (§6, "Declining"): nothing
 * is performed and no new operation is returned. A Company that refuses an
 * approved request before asking the gate, because of something the terms
 * don't hold, tells the gate (`refused`) so the attempt is on record.
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
/**
 * An approval the gate answered for good: the action was performed, the
 * Company declined the approval (§6), or the account had changed since the
 * proposal, so nothing was done. Told once to `finished`, for a record that
 * outlasts the operation (§8.1). The gate never reads it back.
 */
export type Finished = {
  id: string;
  account: string;
  outcome: "succeeded" | "declined" | "refused";
  /** The approved revision's summary. */
  summary: string;
  /** What the action answered, or why the Company declined. */
  result?: string;
  /** Who approved it, as the Personal Agent stated (§6, §8.1). */
  approver: "user" | "agent";
  at: string;
};
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
/** An approved request the Company refused itself, for `refused`. */
export type Refusal = {
  /** The action's `key`. */
  key: string;
  /** What the request asks, in the names its terms use. */
  terms: Record<string, unknown>;
  /** Why, for the User: a short sentence with no codes. */
  reason: string;
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
const idOf = (owner: Owner, key: string) =>
  `op_${createHash("sha256")
    .update([owner.client, owner.user, owner.account, key].join("\n"))
    .digest("base64url")
    .slice(0, 24)}`;
const approvalOf = (approval: string | Approval | undefined) =>
  typeof approval === "string" || approval === undefined
    ? parseApprovalHeader(approval)
    : approval;

export function approvals(
  records: Record<string, OperationRecord>,
  options: {
    revisionMs?: number;
    now?: () => number;
    finished?: (entry: Finished) => void;
  } = {},
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
      const id = idOf(owner, action.key);
      let r = records[id];
      if (r && !same(owner, r)) r = undefined;
      const approval = approvalOf(approvalIn);
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
          const finish = (outcome: Finished["outcome"], result?: string) =>
            options.finished?.({
              id,
              account: owner.account,
              outcome,
              summary: approved.summary,
              ...(result ? { result } : {}),
              approver: approval.approver,
              at: new Date(at).toISOString(),
            });
          if (action.stale?.(approved.terms)) {
            finish("refused");
            return { status: 409, body: { error: "account_changed" } };
          }
          const declined = action.decline?.(approval, approved.terms);
          if (declined) {
            finish("declined", declined.reason);
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
          }
          const result = action.perform(approved.terms);
          r.performed = {
            revision: approved.revision,
            at: new Date(at).toISOString(),
            until: Date.parse(approved.expires_at),
            body: { operation_id: id, ...result },
            approver: approval.approver,
            ...(approval.reference ? { reference: approval.reference } : {}),
          };
          finish("succeeded", result.summary);
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
    /**
     * Records an approved request the Company refused itself, before the
     * gate, for a reason of its own (say, the balance has since fallen
     * below the payment). Told to `finished` only when the approval names
     * a revision of this owner's operation that still waits and holds what
     * the request asks. The operation is left as it is: the revision can
     * be approved until it expires, and is performed once.
     */
    refused(
      owner: Owner,
      approvalIn: string | Approval | undefined,
      refusal: Refusal,
    ) {
      const at = now();
      const id = idOf(owner, refusal.key);
      const r = records[id];
      const approval = approvalOf(approvalIn);
      if (!r || !same(owner, r) || r.performed) return;
      if (approval?.operation_id !== id) return;
      const approved = r.revisions.find(
        (v) =>
          v.revision === approval.revision &&
          Date.parse(v.expires_at) > at &&
          Object.entries(refusal.terms).every(
            ([k, asked]) =>
              JSON.stringify(v.terms[k]) === JSON.stringify(asked),
          ),
      );
      if (!approved) return;
      options.finished?.({
        id,
        account: owner.account,
        outcome: "refused",
        summary: approved.summary,
        result: refusal.reason,
        approver: approval.approver,
        at: new Date(at).toISOString(),
      });
    },
  };
}

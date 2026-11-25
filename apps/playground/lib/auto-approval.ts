import type { ReviewOperation } from "./operation-presentation";
import {
  coveredBy,
  formatLimit,
  notCovered,
  type Approval,
  type Instruction,
} from "./standing-instructions";

/** At most this many automatic approvals an hour per Company. */
export const MAX_PER_HOUR = 5;
/** And no more than this many times the limit in total over that hour. */
export const BUDGET_FACTOR = 3;
const HOUR = 3_600_000;

/**
 * What a standing instruction may do now. Each revision is looked at once
 * (`decided` remembers it), only while signed in and idle. It approves an
 * operation only when the fixed check covers its exact terms and the hour's
 * count and total allow it; when only the hour's allowance is the obstacle
 * it says so, once, and leaves the operation for the User. Anything else
 * stays for the User, as does an operation whose agent approval the Company
 * declined or answered with new terms; `leftToUser` says why.
 */
export type AutoDecision =
  | { kind: "approve"; op: ReviewOperation; covered: string; cents: number }
  | { kind: "limit"; op: ReviewOperation; reason: string };

export function nextAutoApproval(input: {
  operations: ReviewOperation[];
  instruction: Instruction | undefined;
  signedIn: boolean;
  busy: boolean;
  decided: Set<string>;
  /** Approvals this rule made recently, for the hour's allowance. */
  recent?: Approval[];
  now?: number;
}): AutoDecision | null {
  const { operations, instruction, signedIn, busy, decided } = input;
  if (!signedIn || busy || !instruction) return null;
  const now = input.now ?? Date.now();
  const live = (input.recent ?? []).filter((a) => a.at > now - HOUR);
  for (const op of operations) {
    const key = `${op.operation_id}:${op.revision}`;
    if (decided.has(key)) continue;
    // The Company declined an agent approval for it, or answered one with
    // new terms (§5): the User decides now. `decided` is lost on a reload;
    // this is not.
    if (op.agentDeclined || op.agentSuperseded) continue;
    const covered = coveredBy(op, instruction, now);
    if (!covered) continue;
    decided.add(key);
    const spent = live.reduce((sum, a) => sum + a.cents, 0);
    if (live.length >= MAX_PER_HOUR)
      return {
        kind: "limit",
        op,
        reason: `it already approved ${MAX_PER_HOUR} changes in the last hour`,
      };
    if (spent + covered.cents > instruction.maxCents * BUDGET_FACTOR)
      return {
        kind: "limit",
        op,
        reason: `with this change it would approve more than ${BUDGET_FACTOR} times your limit (${formatLimit({ ...instruction, maxCents: instruction.maxCents * BUDGET_FACTOR })}) within an hour`,
      };
    return { kind: "approve", op, covered: covered.text, cents: covered.cents };
  }
  return null;
}

/**
 * Why a waiting operation was left to the User although they wrote a
 * standing instruction, as the end of a sentence that begins "Your standing
 * instruction did not apply:". In the order `nextAutoApproval` decides: the
 * Company declined Iris's approval for it or answered it with new terms,
 * the terms are not covered, or the hour's allowance was used up (`held`,
 * the reason `nextAutoApproval` gave for this revision). Null when there is
 * nothing to explain: no instruction, an operation that no longer waits, or
 * one the instruction is about to approve.
 */
export function leftToUser(
  op: ReviewOperation,
  instruction: Instruction | undefined,
  company: string,
  held?: string,
  now = Date.now(),
): string | null {
  if (
    !instruction ||
    op.state !== "proposed" ||
    !(Date.parse(op.expires_at) > now)
  )
    return null;
  if (op.agentDeclined)
    return `${company} declined the approval Iris sent on it`;
  if (op.agentSuperseded)
    return `${company} answered the approval Iris sent on it with new terms`;
  return notCovered(op, instruction, now) ?? held ?? null;
}

/**
 * How the account route answered an approval sent on a standing
 * instruction: its status and the operation it returned, or `lost` when no
 * answer came back (the approval may still have reached the Company).
 */
export type ApprovalAnswer =
  { status: number; operation?: ReviewOperation | undefined } | "lost";

/**
 * Whether that approval uses up the hour's allowance. One the Company
 * performed on Iris's approval does. So does one whose outcome is unknown,
 * because it may have been performed and the allowance bounds what is: no
 * answer, the route's 502 for a lost Company response, or its 429 while the
 * Company is still performing (the page can't tell that from Poppy's own
 * rate limit). An answer that says nothing was performed doesn't: not
 * covered, declined or refused by the Company, new terms, expired.
 */
export function usesAllowance(answer: ApprovalAnswer) {
  if (answer === "lost") return true;
  if (answer.operation?.state === "succeeded")
    return answer.operation.approvedBy?.approver === "agent";
  return answer.status === 429 || answer.status >= 500;
}

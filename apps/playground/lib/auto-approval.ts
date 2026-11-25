import type { ReviewOperation } from "./operation-presentation";
import { coveredBy, type Instruction } from "./standing-instructions";

/**
 * The one operation a standing instruction may approve now, if any. Each
 * revision is offered once (`decided` remembers it), only while signed in
 * and idle, and only when the fixed check covers its exact terms. Anything
 * else stays for the User.
 */
export function nextAutoApproval(input: {
  operations: ReviewOperation[];
  instruction: Instruction | undefined;
  signedIn: boolean;
  busy: boolean;
  decided: Set<string>;
  now?: number;
}): { op: ReviewOperation; covered: string } | null {
  const { operations, instruction, signedIn, busy, decided } = input;
  if (!signedIn || busy || !instruction) return null;
  for (const op of operations) {
    const key = `${op.operation_id}:${op.revision}`;
    if (decided.has(key)) continue;
    const covered = coveredBy(op, instruction, input.now);
    if (!covered) continue;
    decided.add(key);
    return { op, covered };
  }
  return null;
}

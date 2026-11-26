/**
 * The skill Fernwick publishes for Personal Agents (PAP 1.0 §9.4): how to
 * switch a meter's rate plan through its own API. Company content, written
 * from what `fernwick.ts` and `plans.ts` do; it grants nothing and approves
 * nothing.
 */
import type { SkillDefinition } from "@poppy-lab/pap-company";

export const skills: SkillDefinition[] = [
  {
    name: "switch-rate-plan",
    description:
      "Switch one of a customer's Fernwick Power & Light meters between the flat and the time-of-use rate plan through Fernwick's API, from the next bill cycle. Use it when the customer asks to change a meter's rate plan, or asks which plan would have cost less.",
    body: `
# Switch a meter's rate plan

Fernwick has two rate plans, flat and time-of-use. A customer's agent can propose switching one meter from one to the other. The switch takes effect on the first day of the next bill cycle; nothing changes before then.

## Before you start

- The customer is signed in to Fernwick in this Session.
- Permissions: \`account:read\` and \`plan:write\`. The switch needs both.
- Requests declare the Operations extension, version 3.

## Steps

1. Read \`account\`. It lists the meters the customer shared at sign-in, each with its \`usage_point_id\`, its \`plan\` now and any \`scheduled_change\`, and both plans' prices by local hour.
2. Read \`bills\` if the customer wants to see what the meter was billed. Fernwick works out the estimate itself, in the next step.
3. Call \`change_plan\` with the meter's \`usage_point_id\`, the \`plan\` to switch to (\`flat\` or \`time-of-use\`) and an \`idempotency_key\` you make up for this one switch (8 to 80 letters, digits, \`_\` or \`-\`). Keep the key: every retry of this switch uses it.
4. Fernwick changes nothing yet. It answers 403 \`approval_required\` with an operation: a \`summary\`, the exact \`terms\` (the meter, the plan it leaves and the plan it takes, the effective date, and what the last closed bill came to and would have come to on the new plan), a \`revision\` and \`expires_at\`.
5. Show those terms to the customer in their agent. The difference is an estimate from one past month, not a promise, and the customer sees it as that. Only the customer's approval there counts.
6. Once the customer approves, send the same request again, with the same key and the approval of that \`operation_id\` and \`revision\`. Fernwick answers 200 with the scheduled change and its effective date.

## Outcomes

- **New terms.** If the meter changed after the proposal, or a new bill cycle began, the approved request gets another \`approval_required\` with new terms, or 409 \`account_changed\`. The earlier approval doesn't cover them: show the customer the new terms.
- **Refused.** 409 \`plan_unchanged\` means the meter is already on that plan. 409 \`change_already_scheduled\` means a switch is waiting for the next bill cycle; another can be proposed once it has taken effect. 404 \`meter_not_found\` means the meter isn't this customer's, or the customer didn't share it. 409 \`idempotency_conflict\` means the key already stands for a different switch: a new switch takes a new key. 400 \`invalid_plan_change\` means a field is missing or isn't in the form above. Nothing changed; tell the customer which it was.
- **Expired.** A proposal lasts 10 minutes, until \`expires_at\`. After that, send the request again with the same key and no approval to get a new proposal, and ask the customer again.
- **Sent twice.** The same request with the same key returns the first answer. The switch isn't scheduled twice.

Fernwick is fictional: no electricity is billed.
`,
  },
];

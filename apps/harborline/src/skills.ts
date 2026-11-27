/**
 * The skill Harborline publishes for Personal Agents (PAP 1.0 §9.4): how to
 * pay a saved recipient through its own API. Company content, written from
 * what `harborline.ts` does; it grants nothing and approves nothing.
 */
import type { SkillDefinition } from "@poppy-lab/pap-company";

export const skills: SkillDefinition[] = [
  {
    name: "pay-saved-recipient",
    description:
      "Send a payment from one of a customer's Harborline Bank accounts to a recipient they have already saved, through Harborline's API. Use it when the customer asks to pay or send money to a saved recipient. A new recipient can't be added through the protocol.",
    body: `
# Pay a saved recipient

Harborline lets a customer's agent propose one outgoing payment from an account the customer shared to a recipient already saved on their profile. Harborline moves money only when the customer approves the exact payment themselves.

## Before you start

- The customer is signed in to Harborline in this Session.
- Permissions: \`accounts:read\`, \`recipients:read\` and \`payments:request\`. The payment needs all three.
- Requests declare the Operations extension, version 3.

## Steps

1. Read \`accounts\`. It lists the accounts the customer shared at sign-in. The source account has to be \`active\` and its \`available_cents\` has to cover the payment.
2. Read \`recipients\`. The recipient has to be in this list and \`active\`. Each has its own limit, \`payment_limit_cents\`, the most one payment to them can be. A biller, such as a utility, has a \`reference_format\`: its \`description\`, a \`pattern\` and an \`example\`.
3. Call \`request_payment\` with \`source_account_id\`, \`recipient_id\`, \`amount_cents\` (whole US cents), a \`memo\` (at most 120 characters) and an \`idempotency_key\` you make up for this one payment (8 to 80 letters, digits, \`_\` or \`-\`). Keep the key: every retry of this payment uses it. To pay a biller, add \`reference\`: the reference printed on the bill, in the shape of its \`pattern\`. Send no \`reference\` to any other recipient.
4. Harborline moves nothing yet. It answers 403 \`approval_required\` with an operation: a \`summary\`, the exact \`terms\` (the recipient's name and the last four digits of their account, the amount, the memo, the reference when there is one, the fee, and the source balance before and after), a \`revision\` and \`expires_at\`.
5. Show those terms to the customer in their agent. Only the customer's own approval there counts.
6. Once the customer approves, send the same request again, with the same key and the approval of that \`operation_id\` and \`revision\`. Harborline answers 200 with the payment and the account's new balance.

## Outcomes

- **New terms.** The terms state the balance as it is. If the account or the recipient changed after the proposal, the approved request gets another \`approval_required\` with new terms, or 409 \`account_changed\`. The earlier approval doesn't cover them: show the customer the new terms.
- **Refused, with the reason.** 400 \`invalid_payment\` means a field is missing or isn't in the form above. 422 \`recipient_limit_exceeded\` gives the recipient's \`limit_cents\`. 422 \`invalid_reference\` means the reference is missing or not in the biller's \`reference_format\`, which the answer repeats, or was sent to a recipient that takes none. 409 \`insufficient_funds\` gives the account's \`available_cents\`. 409 \`account_inactive\` or \`recipient_inactive\` names which one can't be used. 404 \`account_not_found\` or \`recipient_not_found\` means it isn't this customer's, or the customer didn't share that account. 409 \`idempotency_conflict\` means the key already stands for a different payment: a new payment takes a new key. Nothing moved in any of these; tell the customer the reason.
- **Declined.** 403 \`approval_declined\` with a \`reason\` means Harborline didn't accept the approval. It declines one an agent gives on a standing instruction: the customer approves this exact payment themselves.
- **Expired.** A proposal lasts 10 minutes, until \`expires_at\`. After that, send the request again with the same key and no approval to get a new proposal, and ask the customer again.
- **Sent twice.** The same request with the same key returns the first payment. Harborline doesn't pay twice.

Harborline is fictional: no real money moves.
`,
  },
];

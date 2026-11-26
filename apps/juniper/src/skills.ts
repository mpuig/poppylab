/**
 * The skills Juniper publishes for Personal Agents (PAP 1.0 §9.4): how to
 * move the recurring delivery and how to open a support case through its
 * API. Company content, written from what `operations.ts` and
 * `customer-services.ts` do; it grants nothing and approves nothing.
 */
import type { SkillDefinition } from "@poppy-lab/pap-company";

export const skills: SkillDefinition[] = [
  {
    name: "move-recurring-delivery",
    description:
      "Move a customer's weekly recurring delivery at Juniper Market to another delivery day through Juniper's API. Use it when the customer asks to change the day their recurring delivery arrives.",
    body: `
# Move the recurring delivery

A Juniper customer has one recurring weekly delivery. Their agent can move it to another delivery day. Moving it costs nothing and doesn't change the basket or orders already placed.

## Before you start

- The customer is signed in to Juniper in this Session.
- Permissions: \`poppy:read\` to read the delivery and \`poppy:write\` to propose the change.
- Requests declare the Operations extension, version 3.

## Steps

1. Read the delivery with \`my_deliveries\`. Note its \`day\`. If it is already on the day the customer wants, say so; there is nothing to change.
2. Juniper delivers on Tuesday, Thursday and Saturday; \`delivery_info\` lists the days.
3. Call \`propose_delivery_change\` with the new \`day\`.
4. Juniper changes nothing yet. It answers 403 \`approval_required\` with an operation: a \`summary\`, the exact \`terms\` (the delivery, the day it moves from and to, and a fee of USD 0.00), a \`revision\` and \`expires_at\`.
5. Show those terms to the customer in their agent. Only the customer's approval there counts.
6. Once the customer approves, send the same request again with the approval of that \`operation_id\` and \`revision\`. Juniper answers 200 and the delivery repeats on the new day.

## Outcomes

- **New terms.** If the delivery changed after the proposal, for example on Juniper's website, the approved request gets another \`approval_required\` with new terms. The earlier approval doesn't cover them: show the customer the new terms.
- **Refused.** 400 \`invalid_day\` means the day isn't one Juniper delivers on. Nothing changed; offer the customer the days it does.
- **Expired.** A proposal lasts 10 minutes, until \`expires_at\`. After that, send the request again without an approval to get a new proposal, and ask the customer again.
- **Sent twice.** Repeating an approved request returns the first answer. The delivery isn't moved twice.

To change what is in the delivery, use \`propose_delivery_item_quantity\` in the same way. Juniper is fictional: no real shipment is affected.
`,
  },
  {
    name: "open-support-case",
    description:
      "Open a support case with Juniper Market's staff through Juniper's API, for a problem with a delivery, a bill or the profile, or for a request Juniper's API, agent and website don't cover. Use it when the customer wants Juniper's staff to look at something.",
    body: `
# Open a support case

A support case puts a customer's request in front of Juniper's staff. It is the way to ask for what Juniper's API, agent and website can't do, such as a refund, which a person reviews. Opening a case changes no order, delivery or amount.

## Before you start

- The customer is signed in to Juniper in this Session.
- Permissions: \`poppy:read\` to read orders and cases and \`poppy:write\` to propose the case.
- Requests declare the Operations extension, version 3.

## Steps

1. Check \`search_help\` first: the public FAQs may already answer the question.
2. If the case is about an order, find the order's ID with \`my_orders\`.
3. Call \`propose_support_case\` with a \`subject\` (at most 120 characters), a \`topic\` (\`delivery\`, \`billing\`, \`profile\` or \`other\`), a \`message\` in the customer's words (at most 1,000 characters) and, for an order, its \`order_id\`.
4. Juniper opens nothing yet. It answers 403 \`approval_required\` with an operation: a \`summary\`, the exact \`terms\` (the subject, topic, message and order), a \`revision\` and \`expires_at\`.
5. Show those terms to the customer in their agent, so they see the exact words that will be sent. Only the customer's approval there counts.
6. Once the customer approves, send the same request again with the approval of that \`operation_id\` and \`revision\`. Juniper answers 200 with the case and its ID.
7. Read the case and its replies with \`my_support_cases\` and \`support_case_details\`. The customer also sees it on Juniper's website under Help and support.

## Outcomes

- **New terms.** A request with a different subject, topic, message or order is a different case, with its own proposal and its own approval.
- **Refused.** 400 \`invalid_case_or_order\` means a field is missing or too long, the topic isn't one of the four, or the order isn't this customer's. 409 \`account_changed\` means the account changed after the proposal. Nothing was opened either way.
- **Expired.** A proposal lasts 10 minutes, until \`expires_at\`. After that, send the request again without an approval to get a new proposal, and ask the customer again.
- **Sent twice.** Repeating an approved request returns the same case. A second case isn't opened.

Juniper is fictional: the first reply to a case is an automatic test reply, and no refund is paid.
`,
  },
];

/**
 * The skill Lantern publishes for Personal Agents (PAP 1.0 §9.4): how to
 * change a scheduled order through its API. Company content, written from
 * what `lantern.ts` does; it grants nothing and approves nothing.
 */
import type { SkillDefinition } from "@poppy-lab/pap-company";

export const skills: SkillDefinition[] = [
  {
    name: "change-scheduled-order",
    description:
      "Change a customer's scheduled Lantern Noodle Bar order through Lantern's API: move it to another delivery slot, add dishes or remove dishes. Use it when the customer asks to move an order that hasn't been delivered yet, or to change what is in it.",
    body: `
# Change a scheduled order

Lantern lets a customer's agent move a scheduled order to another delivery slot and add or remove dishes. An order can't be cancelled through the protocol, and its delivery address can't be changed.

## Before you start

- The customer is signed in to Lantern in this Session.
- Permissions: \`orders:read\` to read the order and \`orders:write\` to propose the change. The change permission doesn't include reading.
- Requests declare the Operations extension, version 3.

## Steps

1. Read the order with \`my_orders\`, or with \`order_details\` when you have its ID. Note its \`id\`, its slot and its dishes.
2. Read \`delivery_slots\` for the slots an order can move to, and \`menu\` for dish IDs and prices in US cents.
3. Call \`change_order\` for that order with only what changes: \`slot_id\` to move it, \`add\` (each entry a \`dish_id\` and a \`quantity\` from 1 to 5) and \`remove\` (IDs of dishes that are in the order). One request can do all three.
4. Lantern changes nothing yet. It answers 403 \`approval_required\` with an operation: a \`summary\`, the exact \`terms\` (the slot before and after, the dishes, the total before and after, and the price difference), a \`revision\` and \`expires_at\`.
5. Show those terms to the customer in their agent. A higher total is charged and a lower one refunded, so the customer sees the new total before deciding. Only the customer's approval there counts.
6. Once the customer approves, send the same request again with the approval of that \`operation_id\` and \`revision\`. Lantern answers 200 with the changed order.

## Outcomes

- **New terms.** If the order changed after the proposal, for example on Lantern's website, the approved request gets another \`approval_required\` with new terms. The earlier approval doesn't cover them: show the customer the new terms.
- **Refused.** 400 \`invalid_change\` means the request can't be made as asked: an unknown slot or dish, a dish to remove that isn't in the order, a quantity outside 1 to 5, a change that would leave the order empty, or one that changes nothing. 404 \`order_not_found\` means the order isn't this customer's. Nothing changed; tell the customer which it was.
- **Expired.** A proposal lasts 10 minutes, until \`expires_at\`. After that, send the request again without an approval to get a new proposal, and ask the customer again.
- **Sent twice.** Repeating an approved request returns the first answer. The order isn't changed twice.

Lantern is fictional: no real food, charge or delivery.
`,
  },
];

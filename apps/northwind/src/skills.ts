/**
 * The skills Northwind publishes for Personal Agents (PAP 1.0 §9.4): how to
 * add checked bags and how to accept an upgrade offer through its API.
 * Company content, written from what `northwind.ts` does; it grants nothing
 * and approves nothing.
 */
import type { SkillDefinition } from "@poppy-lab/pap-company";

export const skills: SkillDefinition[] = [
  {
    name: "add-checked-bags",
    description:
      "Add one or two checked bags to a flight of a customer's Northwind Air booking through Northwind's API, for a stated price. Use it when the customer asks to add a bag or to check more luggage on a trip they have booked.",
    body: `
# Add checked bags

Northwind lets a passenger's agent add one or two checked bags to one flight of a confirmed booking. Each bag costs USD 45.00, and the passenger approves the exact amount first.

## Before you start

- The customer is signed in to Northwind in this Session.
- Permissions: \`bookings:read\` to read the booking and \`bookings:change\` to propose the bags.
- Requests declare the Operations extension, version 3.

## Steps

1. Read the booking with \`upcoming_trips\`, or with \`booking_details\` when you have its six-character reference. In its \`itinerary\`, note the \`id\` of the flight the bags are for and its \`checked_bags\` now. The booking's \`status\` has to be \`confirmed\`.
2. \`travel_information\` with the topic \`baggage\` says how many bags each fare includes, if the customer asks.
3. Call \`add_baggage\` for that booking with the \`flight_id\` and \`additional_pieces\`, 1 or 2.
4. Northwind changes nothing yet. It answers 403 \`approval_required\` with an operation: a \`summary\`, the exact \`terms\` (the flight, the bags now and after, the amount due and the refund terms), a \`revision\` and \`expires_at\`.
5. Show those terms to the customer in their agent, with the amount due and the refund terms. Only the customer's approval there counts.
6. Once the customer approves, send the same request again with the approval of that \`operation_id\` and \`revision\`. Northwind answers 200 with the booking and its new bag count.

## Outcomes

- **New terms.** If the booking changed after the proposal, the approved request gets another \`approval_required\` with new terms, or 409 \`account_changed\`. The earlier approval doesn't cover them: show the customer the new terms.
- **Refused.** 400 \`invalid_baggage_request\` means the flight isn't in this booking or the number of bags isn't 1 or 2. 404 \`booking_not_found\` means the booking isn't this customer's. 409 \`booking_not_active\` means the booking was cancelled. Nothing changed; tell the customer which it was.
- **Expired.** A proposal lasts 10 minutes, until \`expires_at\`. After that, send the request again without an approval to get a new proposal, and ask the customer again.
- **Sent twice.** Repeating an approved request returns the first answer. The bags aren't added twice.

Northwind is fictional: no real payment is taken.
`,
  },
  {
    name: "accept-upgrade-offer",
    description:
      "Accept the business-cabin upgrade Northwind Air is offering on a flight of a customer's booking, through Northwind's API, for the offer's price. Use it when the customer asks to upgrade a flight they have booked, or asks what an upgrade would cost.",
    body: `
# Accept an upgrade offer

A Northwind booking can carry one upgrade offer: a move to Business on one of its flights for a stated price. A passenger's agent can accept that offer. It can't ask for an upgrade Northwind isn't offering.

## Before you start

- The customer is signed in to Northwind in this Session.
- Permissions: \`bookings:read\` to read the booking and its offer, and \`bookings:change\` to accept it.
- Requests declare the Operations extension, version 3.

## Steps

1. Read the booking with \`booking_details\`, or find it with \`upcoming_trips\`. Its \`upgrade_offer\` is either \`null\` or an offer with an \`id\`, the \`flight_id\` it is for, a \`price_cents\` in US cents and its terms. With no offer, tell the customer there is none on this booking.
2. Tell the customer the flight, the price and the terms, and ask whether they want it.
3. Call \`accept_upgrade\` for that booking with the offer's \`id\` as \`offer_id\`.
4. Northwind changes nothing yet. It answers 403 \`approval_required\` with an operation: a \`summary\`, the exact \`terms\` (the flight, the cabin before and after, the amount due and the refund terms), a \`revision\` and \`expires_at\`.
5. Show those terms to the customer in their agent. An upgrade is refundable only if Northwind cancels that flight, so the customer sees that before deciding. Only the customer's approval there counts.
6. Once the customer approves, send the same request again with the approval of that \`operation_id\` and \`revision\`. Northwind answers 200 with the booking, now in Business on that flight.

## Outcomes

- **New terms.** If the booking, the offer's price or the seats left changed after the proposal, the approved request gets another \`approval_required\` with new terms, or 409 \`account_changed\`. The earlier approval doesn't cover them: show the customer the new terms.
- **Refused.** 404 \`upgrade_offer_not_found\` means the booking has no such offer, for example after it was accepted or after its flight was changed. 409 \`upgrade_unavailable\` means no Business seat is left on that flight. 404 \`booking_not_found\` and 409 \`booking_not_active\` mean the booking isn't this customer's or was cancelled. Nothing changed; tell the customer which it was.
- **Expired.** A proposal lasts 10 minutes, until \`expires_at\`. After that, send the request again without an approval to get a new proposal, and ask the customer again.
- **Sent twice.** Repeating an approved request returns the first answer. The upgrade isn't charged twice.

Northwind is fictional: no real payment is taken.
`,
  },
];

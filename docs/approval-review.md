# Structured order and booking approvals

Juniper keeps its existing quantity/day/checkout review. Sandbox Companies now get structured order/booking reviews in addition to their **unaltered Company summary and exact terms**:

- Food/Flowers: delivery slot/date, changed/added/removed lines and unit prices, card message.
- Stays: check-in/out, room changes, rate plan, known breakfast rate and declared cancellation window/penalty.
- All: proposed total and price difference. Prior total is computed as `new_total − price_difference` only when both are valid cent-exact decimal amounts in the same currency. The UI labels it derived and explains the formula; it is not presented as an independently version-verified account read.

Unknown rate plans and conditions remain literal rather than receiving invented descriptions. Missing old values say Not provided. Calendar dates are formatted without timezone shifts; naive delivery-slot times remain Company time. Complete original JSON remains available under All exact terms.

## Before-state provenance

Before sending a recognized trusted Sandbox proposal, the runtime may read its fixed `/poppy/orders` or `/poppy/bookings` endpoint using the same scoped DPoP Session. This happens only when read permission was granted. No model-provided URL, headers or approval authority is accepted.

`operation-context.ts` selects exactly one matching account entity, rejects ambiguous/conflicting identifiers and bounds the retained review fields/size. It does not copy arbitrary top-level account fields into the review. This is local presentation evidence, not a replacement operation or user-supplied terms.

The server stores an application-owned `review_context`, separately from Company terms. It binds operation ID, revision, entity ID and proposal base version. When a read includes a version, it must match the proposal base version; a mismatch suppresses the comparison. The public examples currently omit account versions, so observations are explicitly marked **unversioned, potentially stale**, with source and observation time. They must not be described as a compare-and-swap guarantee. Company confirmation/precondition enforcement remains authoritative.

Company-supplied `review_context` is discarded both on proposals and on status/confirmation responses. A previously server-owned context survives a status update only while its binding still matches. New revisions do not inherit old before values. Snapshot JSON is disclosed under a separate heading, not merged into the exact proposal terms. Failure to capture a baseline does not fabricate one: review falls back to the summary, available terms and explicit missing values.

## Human authority

All writes still require a separate browser-controlled Approve action covering the exact server-owned ID/revision. The Company flag `user_approval_required: false` does not disable Poppy's stricter human-approval policy. Models cannot confirm, cancel, revoke or check operation-control endpoints. No snapshot, computed amount or formatted label changes what the confirmation route sends.

## Verification

Real configured-model Flowers and Stays sessions exercised Direct Sign-In, account reads, proposals and status recovery. Repeating an identical proposal reused the same Company operation ID/revision; review evidence remained separate from immutable terms. Subsequent Company reads confirmed that neither order nor booking was changed.

Unit tests cover baseline selection, duplicate/conflicting IDs, version/revision/entity binding, unversioned observations, missing values, dates, bouquet/card changes, declared booking conditions, cross-currency total refusal, Company-context injection and mandatory human approval despite the optional Company flag. Desktop/mobile reviews found no horizontal overflow. Remote confirmation remains intentionally untested pending explicit human approval.

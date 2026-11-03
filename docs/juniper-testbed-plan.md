# Juniper as a comprehensive PAP testbed

Status: product direction approved; implementation in progress. This is not a claim of current feature completeness or conformance certification.

First delivered slice: [customer service foundation](juniper-services.md)—public FAQs, shared case creation/messages and approval-gated closure, versioned profile editing/proposals and order-derived simulated billing. Profile changes bind future checkouts without rewriting existing orders. [Website basket/recurring editors](juniper-shopping-web.md) now exercise shared state and bidirectional stale-proposal protection, including day-change ABA. [Independent personas and website grant revocation](juniper-personas.md) are also implemented, with token-account binding and cross-account regressions. Website checkout/order management, richer billing, reproducible scenario/fault tooling and the additional channel milestones below remain pending.

## Objective

Build a coherent fictional Company that exercises PAP draft 0.2 across services, authorization, interaction channels and failure conditions. Keep 0.1 interoperability explicitly versioned. A complete-looking customer website alone is not protocol completeness.

Juniper has two separate surfaces:

1. **Customer website:** a believable Spanish-language grocery/service account, preserving warm paper/forest-green branding. Customers shop and manage their account here.
2. **Local test console:** developers select fictional scenarios, inspect sanitized events and verify invariants. Never mix debugging controls with the customer navigation, expose them through the public identity relay, or make them model tools.

One Company identity/issuer and shared domain state underpin both. Public help, customer data and administrative controls have separate authority boundaries.

## Service model

- Catalogue, basket and checkout.
- Orders, recurring deliveries and delivery incidents.
- Fictional invoices, line-item billing questions and credit/refund proposals; no real cards or charges.
- Customer profile, contact/address changes and notification preferences.
- Public FAQs and policies, scoped account-specific help.
- Cases linked to a particular order, delivery or invoice, with messages, status and an auditable resolution.

Each service needs realistic seeded records, public versus account visibility, allowed reads/proposals, explicit human decisions for consequential actions, applicable scopes and negative tests. Do not claim fine-grained scopes already exist: current grants primarily use poppy:read/write; new service permissions require an explicit migration/consent plan without expanding existing grants.

## Protocol coverage

The evidence-backed [coverage matrix](pap-coverage.md) now separates Company/client implementation, automated tests, historical live checks and known deviations. A08 now rejects `account_mismatch` and Poppy opens a new candidate Session for consent. Operations negotiation, specific errors/challenges, durable Retry-After and a real post-commit socket-loss test are implemented in the [protocol corrections](protocol-corrections.md). Nonce challenges, a CLI scenario runner and Poppy's optional terms/new-revision handling now have [isolated evidence](scenario-lab.md). Juniper now supports [checkout renegotiation and continuation from a new Session](checkout-revisions.md). [Read-first consent, explicit permission expansion and recovery](permission-consent.md) now have isolated evidence. Remaining scope includes broader channels, custom/service scopes and renegotiation for other proposal types. The matrix and regression runner do not constitute official conformance certification.

Maintain a matrix with separate Company-side and Personal-Agent-side status, specification reference/version, scenario, automated evidence and remaining gaps:

- Discovery and issuer/domain binding; optional capability/extension negotiation.
- Persistent agent identity, signed-out Sessions, assertions, DPoP, replay/expiry and nonce handling.
- Direct, Device and Mediated Sign-In as separately testable advertised capabilities. Mediated credentials must remain outside model context. Account Token renewal and revocation, reduced permissions, multiple fictional customers and account isolation.
- OpenAPI and MCP over the same domain services, without granting tools arbitrary writes.
- PAP conversations: events/streaming, lifecycle, errors, sign-in during a conversation, direct-conversation boundaries and explicit human handoff. A simulated responder must not pretend to be a real human.
- Browser Session joining with correct scoped state, expiry and logout. Never let a joined model/browser session inherit the separate human customer's unrestricted website session or bypass human approval.
- Operations v1 across proposal sources: immutable revisions, owner/scope checks, expiry, stale-state rejection, cancellation, status recovery, idempotent confirmation and asynchronous outcomes where appropriate.
- Feedback with bounded data and authorization.

Read the applicable current normative specification and extension documents before implementing each channel. Supporting one channel on the Company does not count as a passed end-to-end scenario until a compatible Personal Agent exercises it.

## Reference journeys

1. Discover Juniper, ask a public FAQ, read catalogue and sign in only when account data is required.
2. Adjust basket, review checkout and approve one fictional order; verify it on the customer site.
3. Edit delivery on the website while an agent proposal is pending; old confirmation must fail without overwriting newer state.
4. Question an invoice, open an authorized case, inspect supporting order data and propose a credit; no credit before explicit human approval.
5. Update a profile/address without exposing another fictional customer's data or silently changing an existing order's destination.
6. Start an account-specific conversation, complete sign-in, request human assistance and observe labeled handoff/events.
7. Retry after an uncertain confirmation: status recovery proves whether one action occurred; never blindly repeat the business change.
8. Revoke a grant from the customer website and verify agent access stops across all supported channels.

## Repeatability and faults

Provide named fictional scenarios rather than global destructive reset buttons: clean customer, empty basket, existing orders, overdue fictional invoice, open incident, read-only grant and revoked access. Prefer isolated scenario/account IDs so parallel tests cannot corrupt each other.

A separate local operator console may inject expiry, slow responses, temporary failures, asynchronous completion and competing edits. It must not allow live credentials to be exported or scenario controls to become discoverable model tools. Resets require explicit operator action and must not wipe existing user-created state by default.

Security fixtures should include untrusted Company text attempting to obtain secrets or authorize itself, cross-account requests, duplicate/replayed messages and stale approvals. Never send real secrets to a model just to see whether it leaks them.

## Delivery sequence

### A. Service foundation and customer portal

Define shared entities and invariants, independent fictional accounts and explicit migrations. Build navigable Compra, Pedidos y entregas, Facturación, Ayuda e incidencias, and Perfil. Implement one complete path per service, with actual shared-state mutations and safe customer controls; do not fill the portal with nonfunctional sections.

Initial vertical slice: delivery problem → account-specific case → response → proposed resolution → human decision → visible shared result. Preserve the already working shopping paths and existing local data.

### B. Reproducible lab and authorization lifecycle

Add isolated scenario seeding, local operator diagnostics, scope/account isolation tests, renewal/revocation and concurrency/failure recovery. Track coverage as automated, live-verified, partial or missing; do not treat a green design or a mock as protocol proof.

### C. Interaction-channel coverage

Add MCP, PAP conversations/handoff, browser Session joining and feedback as separate gated milestones. Expose the same business capabilities and approval rules through each, not duplicated simulations.

### D. Protocol and adversarial regression suite

Make the coverage matrix executable, covering supported discovery/auth/channel/Operations combinations and explicit unsupported responses. Run existing external Sandbox regressions without making CI depend on external writes. Publish exact gaps, version assumptions and verification evidence.

## Acceptance bar

A service is complete only when its website, authorized API, agent workflow, approval/result behavior, persistence and negative/edge-case tests agree on the same state. A protocol capability is complete only when its Company/client coverage and required failure cases have evidence. Simulated finance/shipping remain visibly fictional.

Public deployment, real payments/shipping, production identity/recovery, distributed durability and an independent security audit remain separate work. A comprehensive local testbed is not a production-ready commerce platform or an official PAP certification.

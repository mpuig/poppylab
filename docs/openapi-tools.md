# OpenAPI-generated tools and approval presentation

The runtime now generates Juniper’s account tools from its actual `/openapi.json`. It no longer defines a separate per-endpoint shopping tool list. Changes to supported operation IDs, parameters and schemas are discovered on the next chat connection. The no-LLM demo still has an explicitly Juniper-specific natural-language router; this is not generic model reasoning.

## Supported subset

`packages/pap-client/src/openapi.ts` supports:

- Up to 24 uniquely named GET/proposal POST tools, scanning at most 64 paths.
- Scalar string/number/integer/boolean path and query parameters, with percent encoding and bound path placeholders.
- Bounded object/array JSON request bodies, explicit properties/required fields, no undeclared keys, a depth limit of four and a maximum of twenty array items.
- Enums, calendar-valid date strings and numeric/string bounds; runtime validation before any request, not just model-side JSON schemas.
- Same-origin absolute OpenAPI servers. Public GET discovery can work beyond the examples; account sign-in is limited to Juniper and the three Sandbox examples from the development playground.

Request-schema refs, compositions, multipart input, header/cookie parameters, parameter serialization variants, relative servers and per-operation server overrides are intentionally unsupported. Unsupported operations are omitted with sanitized Inspector trace entries. Duplicate operation IDs are removed rather than allowed to replace an existing tool. Schema strings and payload sizes are bounded. This is a conservative subset, not full OpenAPI conformance.

## Authority boundary

Juniper uses two **local experimental OpenAPI annotations**, not standardized PAP fields:

- `x-poppy-scopes` declares required account scopes for a tool.
- `x-poppy-proposal: true` plus a declared HTTP 202 response identifies an endpoint that only proposes an operation.

Metadata alone never authorizes POST. The runtime independently allows proposal POSTs only for trusted local Juniper and the three exact PAP Sandbox example origins; other Companies’ POST tools are omitted even if their schemas claim proposal support. The Sandbox’s singular scope annotation/DPoP security scopes and HTTP 202 Operations response declaration are also recognized. See pap-sandbox.md for that compatibility profile and public-identity setup. A trusted Company must actually enforce its proposal-only contract. Checking a response after an unsafe write would not undo it; the adapter is not a sandbox for arbitrary Company writes.

OAuth, agent/control endpoints, and Operations endpoints are excluded, including when hidden in the server base path. Model input cannot provide a destination URL, headers, token, approval mode or confirmation endpoint. Existing SSRF/DNS pinning, redirect refusal, DPoP and same-origin server policies still apply.

Poppy owns tokens/proofs and enforces declared account scopes before calling the Company; Juniper independently enforces scopes again. Proposal responses must have a valid ID, revision, state, summary, terms and expiry before entering the approval UI. Confirm, cancel, status recovery, sign-in and revocation remain outside the generated model tool set.

## Human approval

`operation-review.tsx` expands active proposals and collapses completed/declined/failed/expired records. It shows Company identity, the exact Company summary, known before→after day/quantity changes, readable line items and formatted currency amounts. New basket/recurring proposals include Company-owned product names and prior quantities. Old saved records without a prior value say “Not provided” rather than inventing it.

Complete structured terms remain available under **All exact terms**, without replacing Company truth with model-generated copy. Confirmation still covers the server-owned operation ID and exact revision. Expiry locally disables approval and preserves status recovery; Company expiry enforcement remains authoritative. No UI rendering or natural-language message confirms a proposal.

## Verification

Tests cover generated path/query/body tools, unknown/invalid input, cross-origin/control endpoints, server-base bypasses, unsupported schemas, duplicate IDs, tool limits, the actual Juniper contract, currency presentation, missing historical values, collapsed final states and expired approvals.

A real configured-model browser pass read the basket and invoked the generated basket proposal tool; another retrieved an order through its path ID. A no-LLM pass exercised the generated delivery-day proposal. Test proposals were declined without applying account changes. Desktop/mobile inspection showed open pending proposals, folded final results and no horizontal page overflow.

General cross-Company OAuth, all-schema OpenAPI support, arbitrary writes and public deployment remain out of scope.

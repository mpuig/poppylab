# OpenAPI-generated tools and approval presentation

The runtime now generates Juniper’s account tools from its actual `/openapi.json`. It no longer defines a separate per-endpoint shopping tool list. Changes to supported operation IDs, parameters and schemas are discovered on the next chat connection. The no-LLM demo still has an explicitly Juniper-specific natural-language router; this is not generic model reasoning.

## Supported subset

`packages/pap-client/src/openapi.ts` supports:

- Up to 24 uniquely named GET/proposal POST tools, scanning at most 64 paths.
- Scalar string/number/integer/boolean path and query parameters, with percent encoding and bound path placeholders.
- Bounded object/array JSON request bodies, explicit properties/required fields, no undeclared keys, a depth limit of four and a maximum of twenty array items.
- Enums, calendar-valid date strings and numeric/string bounds; runtime validation before any request, not just model-side JSON schemas.
- Same-origin absolute OpenAPI servers. Public GET discovery can work beyond the examples; account sign-in is limited to the exact configured example-Company origins and the three Sandbox examples.

Request-schema refs, compositions, multipart input, header/cookie parameters, parameter serialization variants, relative servers and per-operation server overrides are intentionally unsupported. Unsupported operations are omitted with sanitized Inspector trace entries. Duplicate operation IDs are removed rather than allowed to replace an existing tool. Schema strings and payload sizes are bounded. This is a conservative subset, not full OpenAPI conformance.

## FDX-shaped APIs: a native adapter

`packages/pap-client/src/fdx.ts` builds five read tools for the `poppylab.dev/fdx` v1 extension instead of passing an FDX-shaped OpenAPI description through `openapi.ts`. The adapter is FDX-shaped, not FDX-conformant: it uses a hand-picked set of FDX resource paths and field names, and its descriptions are our own. No FDX text or schema is in the repository, because the FDX licence forbids copying it. The extension is described in [`poppylab.dev/fdx` v1](extensions/fdx.md).

The generic adapter isn't a good fit for two reasons:

- **Limits.** `openapi.ts` stops at 24 tools and 64 paths. A full FDX-style description has far more operations, so the generic adapter would keep an arbitrary first slice of them.
- **`$ref`.** FDX-style schemas are built from shared `$ref` components, which `openapi.ts` deliberately doesn't follow (it resolves only one level of `#/components/parameters`). It doesn't validate responses either, and FDX responses carry personal data from a Company.

| Tool                    | Request (under the entry's URLs)                                                             | Scopes                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `fdx_list_accounts`     | `GET {base_url}/accounts`                                                                    | `fdx:ACCOUNT_BASIC`, plus `fdx:ACCOUNT_DETAILED` with `balances` |
| `fdx_get_account`       | `GET {base_url}/accounts/{accountId}`                                                        | The same                                                         |
| `fdx_list_transactions` | `GET {base_url}/accounts/{accountId}/transactions?startTime&endTime&offset&limit`, paginated | `fdx:TRANSACTIONS`                                               |
| `fdx_get_customer`      | `GET {base_url}/customers/current`                                                           | `fdx:CUSTOMER_CONTACT`                                           |
| `fdx_consent_status`    | `GET {consent_endpoint}/{consentId}`                                                         | None (the grant's own token)                                     |

- **Input.** Closed schemas checked by the same code as `openapi.ts` (`boundedToolInput`), before any request. Ids are printable ASCII without `/`, `\`, `%`, `?` or `#`, at most 128 characters, and go percent-encoded into one path segment. Dates are calendar-valid `YYYY-MM-DD`, with the start no later than the end. Model input never supplies a URL, header, token or paging offset.
- **URLs.** Only from the entry that discovery validated against the Company's origin (§3, §3.3). The adapter refuses an entry whose two URLs are on different origins or carry credentials, a query or a fragment.
- **Paging.** Transactions follow `page.nextOffset`, a decimal string (or a non-negative integer) that is absent on the last page. They read 50 per page, for at most 4 pages and 100 transactions per call, and stop on a repeated or malformed offset. The first page's `page.totalElements` is passed on, and `truncated: true` tells the model to narrow the dates.
- **Responses** are Company content (§10.1). The expected shapes: `{ accounts: [...], note }` for the list, `{ ...account, note }` for one account, `{ transactions: [...], page, note }`, `{ customerId, name: { first, middle?, last }, email: [...], note }`, and a consent with `parties` as `{ name, type }`. `accountNumberDisplay` is the last four digits, and `note` is Harborline's fiction notice. Each response is reduced to the fields the adapter knows, with bounded strings (control and line-separator characters replaced) and at most 50 accounts. Balances are kept only when the call asked for them. A response for another account or consent than the one asked for is `invalid_response`.
- **Errors.** An FDX error body (`code`, `message`, `debugMessage`) comes back as `{ error: "fdx_error", status, code, message, debugMessage }`, each bounded; any other error body is reduced to its status.
- **Transport.** The caller injects `request(url, scopes)`. It adds the Session header, DPoP and the token, and returns the status and parsed body, or an outcome of its own, such as "sign in first", which goes to the model as it is.

The playground doesn't use these tools yet.

## Authority boundary

The Poppy Lab Companies use two **local experimental OpenAPI annotations**, not standardized Poppy fields:

- `x-poppy-scopes` declares required account scopes for a tool.
- `x-poppy-proposal: true` plus a declared HTTP 202 response identifies an endpoint that only proposes an operation.

Metadata alone never authorizes POST. The runtime independently allows proposal POSTs only for the exact configured Juniper, Lantern, Harborline and Northwind origins and the three exact PAP Sandbox example origins; other Companies’ POST tools are omitted even if their schemas claim proposal support. The Sandbox’s singular scope annotation/DPoP security scopes and HTTP 202 Operations response declaration are also recognized. See pap-sandbox.md for that compatibility profile and public-identity setup. A trusted Company must actually enforce its proposal-only contract. Checking a response after an unsafe write would not undo it; the adapter is not a sandbox for arbitrary Company writes.

OAuth, agent/control endpoints, and Operations endpoints are excluded, including when hidden in the server base path. Model input cannot provide a destination URL, headers, token, approval mode or confirmation endpoint. Existing SSRF/DNS pinning, redirect refusal, DPoP and same-origin server policies still apply.

Poppy owns tokens/proofs and enforces declared account scopes before calling the Company; each Poppy Lab Company independently enforces scopes again. Proposal responses must have a valid ID, revision, state, summary, terms and expiry before entering the approval UI. Confirm, cancel, status recovery, sign-in and revocation remain outside the generated model tool set.

## Human approval

`operation-review.tsx` expands active proposals and collapses completed/declined/failed/expired records. It shows Company identity, the exact Company summary, known before→after day/quantity changes, readable line items and formatted currency amounts. New basket/recurring proposals include Company-owned product names and prior quantities. Old saved records without a prior value say “Not provided” rather than inventing it.

Complete structured terms remain available under **All exact terms**, without replacing Company truth with model-generated copy. Confirmation still covers the server-owned operation ID and exact revision. Expiry locally disables approval and preserves status recovery; Company expiry enforcement remains authoritative. No UI rendering or natural-language message confirms a proposal.

## Verification

Tests cover generated path/query/body tools, unknown/invalid input, cross-origin/control endpoints, server-base bypasses, unsupported schemas, duplicate IDs, tool limits, the actual Juniper and Northwind contracts, currency presentation, missing historical values, collapsed final states and expired approvals.

A real configured-model browser pass read the basket and invoked the generated basket proposal tool; another retrieved an order through its path ID. A no-LLM pass exercised the generated delivery-day proposal. Test proposals were declined without applying account changes. Desktop/mobile inspection showed open pending proposals, folded final results and no horizontal page overflow.

General cross-Company OAuth, all-schema OpenAPI support, arbitrary writes and public deployment remain out of scope.

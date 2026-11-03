# PAP draft 0.3

Poppy and Juniper implement **only** PAP draft 0.3. Compatibility with 0.1/0.2 was removed on request: documents with another `protocol_version` are rejected with "Unsupported PAP version", and runs or Juniper state saved by the 0.2 implementation (Session Tokens, Session-bound grants) are discarded on load rather than reinterpreted.

Reference: [0.3 draft](https://personalagentprotocol.org/docs/0.3/spec) and [repository](https://github.com/personal-agent-protocol/personal-agent-protocol), read on 30 October 2026. Local copy `/tmp/pap03-spec.md` (SHA256 `7880e5a0408c14b7c1999e56ec72b7dbb4e21631f7d7cf7b59d95f690610505e`). It is a download hash, not a release: the draft changes daily (issue #60).

## 1. Discovery (§3, §3.2, §4.7, §9)

- A redirect of `poppy.json` may change host but must end exactly at `/.well-known/poppy.json`, without query.
- The issuer comes from the domain's protected resource metadata (RFC 9728), fetched without redirects; `resource` must be the domain. Only an explicit 404 (or metadata without `authorization_servers`) means "no issuer"; any other failure stops discovery. With several servers, `auth.issuer` must choose one of them.
- The issuer's metadata must match exactly and list the domain in `protected_resources`. `grant_types_supported` is required, includes `refresh_token`, and says which sign-in types exist (`authorization_code` → Direct, `device_code` → Device) and which endpoints are therefore required.
- Scopes are the Company's (`scopes_supported`, else `auth.scopes`). `scope_hints` are validated entry by entry: an entry missing a field is dropped; an unknown `changes` becomes `irreversible`.
- Excluded tasks (§9.1–9.2) are fetched without a token and without redirects. API references must name an API in the same `poppy.json`; web references must be HTTPS on the Company's domain or subdomains (conservative while upstream issue #52 is open); unknown types are skipped.

Every client component uses a normalized `CompanyProfile` (identifier, issuer, sign-in types, scopes, descriptions, hints, excluded tasks).

## 2. Sessions and OAuth (§4, §5)

**Session header.** Every request to a Company API or protocol endpoint carries `Poppy-Session`: a `poppy-session+jwt` signed for that one request (`htm`/`htu`, `iat`, `jti`, `ath` when there is an access token). It is signed by a **delegated key**; the `jwks_uri` key signs only `poppy-delegation+jwt` delegations (`cnf.jwk`, ≤24 h, nothing about the User or Company) and client assertions. Poppy creates a delegated key per run, so one key serves one User ID. `sid` is random and chosen by Poppy. The User ID is per Company identifier. The library lives in `packages/pap-client/src/session-header.ts` (`createSessionKey`, `signSessionHeader`, `verifySessionHeader`) and Juniper uses the same verifier.

**Account access is plain OAuth.** Direct Sign-In: authorization code with PKCE S256, `private_key_jwt`, `iss` check, **no `session_id`**. The access token goes in `Authorization` (DPoP-bound when the issuer lists ES256 in `dpop_signing_alg_values_supported`, as Juniper and the Sandbox do; otherwise Bearer). Refresh uses `refresh_token` with the current scopes; a response without `refresh_token` keeps the old one, and `scope` omitted means exactly what was requested. Any widening is rejected without touching current authority.

- **Least privilege from hints:** "read" requests only scopes hinted as `none`; "change permission" requests all advertised scopes, and only if one of them can change something. Scopes without hints are never treated as read-only.
- **One account per Session:** each successful sign-in starts a new `sid`. The refresh token that sign-in replaced is revoked (best effort). The pre-account conversation is kept; private turns and proposals are not.
- **`invalid_session`:** Poppy starts a new Session once and retries the same request; if that fails too, it stops. Nothing else is retried. A lost response is never repeated.
- **Sign-out** revokes the refresh token, and the Session continues signed out.

**Juniper (Company).** Publishes a 0.3 `poppy.json` with its own scopes, descriptions and hints (`poppy:read` = `none`, `poppy:write` = `irreversible`), protected resource metadata, and `grant_types_supported: [authorization_code, refresh_token]`. It removed the JWT-bearer grant, `session_id`, `account_mismatch` and the custom `rate_limited` body (429 + `Retry-After` only).

- **Session verification:** verifies the Session header on every `/api/` request: client metadata fetched without redirects, delegation, signature, `aud`, `htm`/`htu`, a 60-second `iat` window and `ath`.
- **Session store:** Sessions are keyed by client and `sid`. A `sid` must keep its User ID and Agent ID, and the first account used in a Session is fixed; another account gets `invalid_session`.
- **Tokens:** tokens reference grants, never Sessions. Grants know no User ID.
- **Missing token:** an account API returns a 401 challenge with `scope` and no error code (RFC 6750 §3.1).
- **Revocation:** revoking a refresh token ends its access tokens (RFC 7009 §2.1).
- **Ownership:** Operation ownership is still client + User ID + account, now taken from the verified Session header.

## 3. Operations v2 (extension `operations` version "2")

No Operations endpoint, no confirm/cancel, no stored state for the agent. Both sides list `operations: { version: "2" }`; otherwise Juniper refuses proposals with `extension_required`.

**Juniper (Company).** A proposal request without approval is refused: **403** `{ "error": "approval_required", "operation": { operation_id, revision, summary, terms, expires_at } }`. Nothing is performed.

- **Identity of an action:** `operation_id` is derived from client, User ID, account and the action (for example `checkout` + basket version). Asking again for the same action returns the same id. Different terms (another delivery day) get a new opaque `revision`; the same terms reuse the unexpired revision. Revisions last 10 minutes, with at most 20 per operation.
- **Approval:** the agent repeats the exact request with `Poppy-Approval: operation_id="…", revision="…"` (RFC 9651 Dictionary; unknown members ignored). Juniper performs the action only if the owner matches (same client, User ID and account) and the revision is one it returned and hasn't expired. The terms recomputed from the request and current account must equal that revision's terms. Any returned revision can be approved, not only the latest.
- **Failed approval:** otherwise nothing is performed and the operation comes back with a revision for what the request asks, **never the revision the approval named** (no loops). A stale account (basket changed) therefore yields a new operation.
- **At most once:** the first response is stored with the operation until the approved revision expires. Every retry gets that response, even when the request would now be refused (for example, an empty basket after checkout).
- **Removed:** `checkout-revision` and the `/operations` routes. To renegotiate, call the proposal again.

**Poppy (Personal Agent).** A model tool's POST that gets `approval_required` stores the validated operation together with the exact request to resend. The model receives only `status: approval_required`, the summary and a note that nothing was done.

- **Approve** resends the request with `Poppy-Approval`, the Session header and the access token. It needs a granted scope whose hint is not `none`.
- **New terms (403 with another revision):** shown for a separate approval. Poppy never approves them itself.
- **Lost response, 5xx or 503:** the outcome becomes **unknown**. The only action offered is **Retry the same approval**, which is safe because of at-most-once; a new approval is refused locally.
- **Decline** is purely local: nothing is sent, and the stored request is forgotten.
- **Validation:** an operation keeps only the fields v2 defines. A revision with different content than before is rejected, and a performed operation can't change.

The PAP Sandbox still advertises Operations **v1**, so Poppy offers it no proposal tools.

## Not yet done

- Feedback with an alternative, browser join, conversations (and their `operation`/`approval` message fields), approvals over MCP `_meta`, Device Sign-In, signed-in MCP resource tokens, per-service tokens for APIs on other origins, Web Bot Auth, blind signing (PS384).
- Excluded tasks reach the model through a read-only `excluded_tasks` tool, explicitly marked untrusted.

## Second local Company

[Lantern Noodle Bar](lantern-noodles.md) reuses the same gateway and Operations v2 engine with its own issuer, scopes (`orders:read`/`orders:write`), OpenAPI contract and excluded tasks, and was verified live with GPT-6 Luna end to end.

## Removed

- 0.1/0.2 discovery, Session Tokens and the JWT-bearer Session grant.
- `account_mismatch`.
- The Ample integration: `ample.computer` publishes 0.1 and is rejected until it moves to 0.3. Its read-only allowlist and relay issuer were deleted. Generic signed-out MCP with a local read-only allowlist remains.

## Evidence

Live, local, fictional data only:

1. Discovery of Juniper 0.3, including profile and excluded tasks.
2. A signed-out read with a delegated Session header.
3. Direct Sign-In requesting `poppy:read` (from hints), followed by a signed-in basket read.
4. A write attempt refused locally for insufficient scope.
5. Explicit expansion to `poppy:read poppy:write` (consent counter 2, new Session).
6. A delivery proposal, declined, so it changed no business data.
7. Sign-out with revocation.
8. Operations v2, signed in with write access: "move my delivery to Saturday" returned `approval_required` (opaque revision, request stored). Approving resent it with `Poppy-Approval` and Juniper performed it (Thursday → Saturday). A second v2 approval moved it back to Thursday, leaving the fictional account as found. Then sign-out.

**PAP Sandbox:** Food, Flowers and Stays publish 0.3 discovery (scopes, hints, excluded tasks) but their metadata and OpenAPI still show the 0.2 model: the JWT-bearer grant, DPoP "Session Tokens" on every API, and Operations v1. Their APIs are therefore not expected to interoperate with a strict 0.3 Session-header client until they finish migrating. They were not called with account access; the public identity tunnel is down and was not recreated.

**Tests:** 350 pass (adapters 13, core 15, client 118, Juniper 74, playground 130). The v1 confirm tests were replaced by `operations-v2.test.ts` (11) and `juniper-approval.test.ts` (model tool → real Juniper 403 → human approval → one order). Older business tests run through `test-approval.ts`, a test-only adapter that turns their "confirm" into the real v2 retry against the real handlers. New suites cover delegations and Session JWTs (12), 0.3 discovery and excluded tasks (22), the 0.3 runtime transport (16), callback exchange (9), signed-out MCP (6) and Juniper's Session-header gateway (3). Run them with `pnpm scenarios pap-0.3`. TypeScript, lint, build and formatting pass; 12 deployment traces have no secret references. Reviewed in-thread, with no independent reviewer.

## Text update, 3 November 2026

The published draft changed after our 30 October copy. `pnpm spec:drift` now compares the pinned text (`spec/upstream.json`, `spec/draft-0.3/`) with the site.

- **Wire change, both sides updated:** the delegation travels in the `poppy_dlg` JWT header (was `pap_dlg`) with `typ` `poppy-delegation+jwt` (was `pap-delegation+jwt`).
- **`auth.disabled`** (§3.2): Poppy starts no sign-in with a Company that sets it; the identifier stays the issuer.
- Clarifications we already met: re-consent requests every scope still needed; a Company may grant fewer scopes; the first request with a new `sid` starts a Session; the Session JWT goes only to destinations from `poppy.json`.
- **Transition:** Cliffside Retail (and agents pinned before 3 November) still use `pap_dlg`/`pap-delegation+jwt`. Poppy signs with the current form and falls back to the earlier one once per Company after a repeated `invalid_session`; Juniper and Lantern accept either form, never mixed.
- Not yet adopted: `organization.logo_uri`, `skill_index` (§9.4), conversation content under `extensions.operations`.

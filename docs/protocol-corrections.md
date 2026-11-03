# PAP corrections: Session, negotiation and recovery

> **Historical.** This records work done against draft 0.2 and Operations v1. The project now implements 0.3 only; see [PAP 0.3](pap-03.md) and the [coverage matrix](pap-coverage.md).

Reference: PAP draft 0.2 §§3.3, 4.2–4.4, 4.8–4.9, 6 and Operations v1 §2, using the same reference copies as the matrix at the time. This is not a complete certification and not a live revalidation of the Sandbox.

## One account per Session (A08)

Juniper rejects `account_mismatch` before issuing tokens or changing a Session already bound to another account. This applies to both the code exchange and refresh. A signed-out renewal keeps the binding; revoking doesn't remove it. Old tokens keep their own account, scopes and grant.

Poppy prepares a candidate Session without the previous credentials. It keeps it in the transient OAuth state, bound to the state, cookie, issuer and PKCE. Only a valid callback replaces the Session, DPoP key, User ID, tokens, history and approvals. An error keeps the previous access and context. An `account_mismatch` explains that you need to sign in again for a new Session; there's no automatic retry and no consent loop. Polling doesn't treat the previous access as success while a consent is pending.

The known historical binding is kept; the history of Sessions that changed account before this fix can't be rebuilt retroactively. No purchases, cases or profiles are deleted.

## Operations and errors (D05, A15)

The capability `extensions.operations.version === "1"` comes from the client's authenticated metadata and is fixed to the token. Without it, proposals, confirmations and cancellations, and reading Operations fail with HTTP 403 `extension_required`, including the name `operations` in the JSON and the challenge. Business reads don't need the extension. Legacy tokens without evidence of the capability fail closed until they're renewed; no announcement is invented retroactively.

The token endpoint distinguishes `invalid_client`, `invalid_dpop_proof`, `invalid_session`, `invalid_scope`, `account_mismatch` and `rate_limited`. An unsupported `resource` is rejected as `invalid_target`, not ignored. At the APIs, the token and its proof are validated first; account, scope and extension errors carry `WWW-Authenticate`, including the required scope. Invalid proofs are no longer labelled as invalid tokens.

The client keeps the HTTP status, an allowlisted code and the wait time in a `ProtocolError`; it never shows arbitrary descriptions, remote bodies, tokens or full challenges. Errors for missing channels remain outside the implemented profile. The `use_dpop_nonce` cycle was added later: see [nonces and scenarios](scenario-lab.md). No claim is made about covering all of OAuth.

## Retry-After (A14)

Juniper's 429 responses carry `Retry-After`. The transport understands seconds and HTTP dates, shares a cooldown per origin, and blocks requests before opening a connection until the stated time. It doesn't put a model request to sleep or repeat a POST automatically. A later deadline is never shortened by an earlier one. The table is bounded; when full, a conservative global deadline prevents getting around the wait through other origins.

Poppy configures an encrypted `retry-after.enc` store; the deadline is saved when the response arrives and restored at startup. A test uses the real vault and a fresh load of the module to check this. The human route returns HTTP 429, Retry-After and an explanation. The library without a configured store keeps the cooldown only for the life of the process. There's no distributed coordination: the project's single-writer restriction still holds.

## Lost response after commit (O07)

A regression test creates a checkout with authorization and DPoP, sends the confirmation over a real HTTP socket and destroys the response **after the save**. The server is closed, rebuilt from the real encrypted vault in a temporary directory, and its state read: `succeeded`, exactly one order. Confirming the same operation and revision again returns the same result and doesn't create another order.

A second test in Poppy's route simulates an uncertain response: a single confirmation call, the operation kept, and later recovery through a status GET. An uncertain failure returns 502 with an instruction to check the status, not to propose another purchase. These are local guarantees with one writer, not distributed exactly-once delivery.

## Evidence and limits

- [Authority, negotiation, errors, rate limit and socket loss](../apps/example-company/src/authority-regression.test.ts).
- [Candidate consent and human recovery](../apps/playground/app/api/account/route.test.ts).
- [Callback and mismatch](../apps/playground/app/api/account/callback/route.test.ts).
- [Transport errors and cooldown](../packages/pap-client/src/protocol-error.test.ts).
- [Encrypted cooldown and restart](../packages/pap-client/src/retry-persistence.test.ts).

Validation of this delivery at the time: **199 tests** passed, along with TypeScript, lint, production build and formatting. A scan of 11 deployment traces found no references to secret files.

The tests are isolated: they don't confirm or cancel Sandbox operations, don't reset the existing personas and don't change the configured model. The review was done in-thread, with no independent reviewer. Scopes, channels and the model's authority weren't widened.

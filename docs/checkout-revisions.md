# Revising a checkout and continuing from another Session

> **Historical.** This describes the Operations v1 design under draft 0.2 (`checkout-revision` endpoint, numeric revisions). Under Operations v2 a Company returns a new opaque revision whenever the terms of the same request change, and the `/checkout-revision` route was removed. See [PAP 0.3](pap-03.md).

Juniper supported renegotiating a **pending checkout**. It wasn't a generic revision of every proposal: profile, support, basket and recurring delivery kept their own flows.

## Contract

`POST /api/account/checkout-revision`, published as the tool `revise_checkout_proposal`:

```json
{
  "operation_id": "op_identifier",
  "revision": 1,
  "day": "Saturday"
}
```

It required a valid signed and DPoP-bound token, an account, the write scope and Operations v1 support. The tool contract required read and write. It accepted only those three fields; it never accepted prices, destination, approval or terms supplied by the agent.

- It identified the owner by client, User ID and account, not by Session.
- It required a proposed, unexpired checkout and the current revision. An old revision returned 409 `terms_changed`; another owner got 404.
- It recalculated all the terms from the **current basket and profile**: items, quantities, amount, address, recipient and versions. The requested day was included in the summary and the terms.
- It returned the same Operation with an incremented revision, a new five-minute expiry, no confirmation and human approval required. It didn't change the basket, profile or orders.
- It kept an immutable snapshot of the previous revision in the vault. At most twenty changes per Operation; the limit returned 429. The history was internal, not a new public endpoint.
- A request that didn't change the terms returned the current revision without extending the expiry. Repeating a request with an old revision didn't create another revision; it required checking the status.
- Concurrent revisions used compare-and-swap: at most one request starting from the same revision could create the next one.

Approving revision 1 didn't authorize revision 2. Confirming 1 returned `terms_changed`. Checking the status showed 2, and Poppy required another explicit human action. Confirming 2 twice returned the same result and kept a single order.

## Continuing a Session

When a renewal received exactly HTTP 400 `invalid_session`, Poppy could renew once more **with the same Account Token and without a session_id**, with fresh assertions and proof. After validating the response it replaced the Session and kept the conversation and pending proposals, because it was still the same account and grant. It didn't do this recovery on `account_mismatch`, `invalid_grant`, HTTP 5xx or an uncertain network failure, and it never repeated a purchase as a result.

Juniper allowed reading, revising and confirming the Operation from the owner's new Session. Another account, client or User ID couldn't. The Operation's expiry still applied; a new Session didn't revive it. Poppy also kept its run duration limit: this recovery didn't reopen expired runs or skip the context cleanup when switching accounts through consent.

## Isolated evidence

```sh
pnpm scenarios revisions
```

- `revisions.test.ts`: immutability, recalculation, disallowed fields, status and expiry, limits, concurrency and ownership.
- `authority-regression.test.ts`: creates a checkout in the last minute of a Session, lets that Session expire, gets another with the Account Token, rejects Maya and read-only access, creates revision 2, rejects the old approval, restarts from a real temporary vault and confirms once.
- A cross-app test: generated OpenAPI tools → real Juniper handlers → Poppy's approval route → one order, with an authenticated Session injected and an in-memory transport; business responses weren't simulated.
- `runtime.test.ts`: bounded Session recovery without losing context and without retrying uncertain errors.

No model ran and no live browser was used in these tests. Saved accounts weren't changed and no Sandbox operations were confirmed. The review was done in-thread, with no independent reviewer.

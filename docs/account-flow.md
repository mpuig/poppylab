# Local shopping, accounts, and persistence

The playground implements a local PAP 0.2 Direct Sign-In and Operations v1 experiment for `http://localhost:3000` and `http://juniper.localhost:4100`. All purchases, payments, addresses and shipments are fictional. This is not a complete protocol implementation or a production identity system.

## Shopping

Signed-in tools read the basket, orders (with full line items and status), and deliveries. The Company also offers order lookup by ID. Basket quantities, recurring-delivery item quantities/removal (quantity zero), delivery-day changes and checkout are proposals only. Basket and recurring-delivery items are separate; removing an item from one never edits the other or an existing order. Delivery-item proposals show the complete resulting weekly items and price/fee total and are guarded by a separate delivery version. Models cannot confirm, cancel, or revoke account access.

Checkout shows exact line items, subtotal, delivery fee, zero simulated tax, total/currency, recipient, fictional destination, delivery day, and simulated payment terms. It creates a fictional order and clears the basket only after the user approves that exact revision. Basket version and delivery preconditions prevent stale proposals from acting on changed data. Repeated confirmation returns the same final operation and order, including after state is reopened from disk. There are no real payments or stock reservations.

Shopping tools are now generated from the published OpenAPI, including scalar path/query parameters and bounded JSON proposal schemas. Proposal POSTs are authorized only for trusted local Juniper and the three exact PAP Sandbox example origins; other Companies remain GET-only. Remote sign-in uses discovered endpoints and requires the public identity setup in pap-sandbox.md. The model cannot supply URLs, headers or confirmation requests. See openapi-tools.md for the bounded subset and experimental annotations. Demo mode supports absolute basket quantities (for example, “set apples in my basket to 2”), checkout, basket and order reads. Use an LLM for contextual quantity increments.

## Sign-in and scopes

By default, Juniper presents a clearly labeled fictional Alex persona selector. It does not verify a real identity. To require a dedicated local account password, run:

```sh
node apps/example-company/scripts/set-password.mjs
```

The interactive script hides password input and creates `apps/example-company/.env.local` containing only a salted scrypt hash, with mode 0600. It refuses to overwrite an existing configuration file. Restart the Company after configuring it. Use a dedicated local password, never a password from another service. The Company rate-limits incorrect attempts to ten per minute (single-process). The playground/model never sees the password. The password protects the entire local demo, which now has three selectable fictional accounts. It is not per-person authentication, registration, recovery, MFA or a hosted identity provider. See [persona isolation and website revocation](juniper-personas.md).

Poppy requests read-only access initially. **Request change permission** opens a separate read/write consent without revoking the old grant. Juniper only offers requested permissions; when both are requested, the user can disable **Allow change proposals** and keep reading alone. Scopes are enforced at the Company, not just in the UI. Read-only grants cannot issue mutation proposals or confirm them. The model directs the user to the permission control, never initiates consent itself. First sign-in preserves the pre-account conversation (up to 10 messages). Later consent retains only that public prefix, clearing private account turns and proposals because it can select a different account; request the change again afterwards. See [permissions and recovery](permission-consent.md).

OAuth uses S256 PKCE, random state, exact pre-registered redirects, issuer validation, browser-cookie-bound consent, one-minute one-time codes, private-key client authentication and DPoP-bound Session Tokens. Account Tokens are opaque, hashed on Juniper, and valid for seven days. The Company checks the token's original grant revocation and Session state on each account request. Tokens carry immutable scope/grant snapshots; GET account reads require `poppy:read`, and account POSTs require `poppy:write`. Renewal cannot expand previously issued tokens. Refresh grants cannot escalate scopes or move between agent/User identities. Poppy renews account Session Tokens before expiry when connecting or making account requests; signed-out Sessions can also renew with fresh assertions. Revocation takes effect immediately.

OAuth, status checks and approvals remain deterministic code, never model tools. Browser chat text, including “yes”, cannot authorize a change. A same-origin approval request identifies a server-owned operation and exact revision; supplied replacement terms or approval modes are ignored. The Company also checks ownership, revision, expiry, scope and current account data.

## Durable local storage

- Juniper snapshots Sessions, token hashes, grants, replay cache, baskets, orders, deliveries and operation records together.
- Poppy snapshots bounded run history, Company connection metadata, operation reviews, Session/Account Tokens and DPoP keys. Refreshing the page restores a still-valid run through its HttpOnly cookie. OAuth attempts are deliberately not restored across a process restart.
- Snapshots use AES-256-GCM with authenticated names and atomic rename, file and directory fsync. A local 0600 key is created under each application's ignored `.poppy/` directory; files are 0600 and directories 0700. Corrupt snapshots fail closed rather than silently resetting account state.
- This is single-writer local snapshot storage, not a distributed database. Keep one Company process and one playground process per storage directory. Do not share storage across replicas. Disk-write failure latches a 503 degraded state, blocks further requests and prevents later commits of dirty memory until restart/recovery. Identical snapshots skip encryption, writes and fsync. This is not a transactional external payment system. See [review fixes and recovery procedure](review-fixes.md).
- Back up each application's `.poppy/` directory and matching key together. Encryption does not protect against an attacker who can read both the data and adjacent key; production needs external key management and encrypted backups.
- Run access still expires after 30 minutes, with a 20-turn budget and bounded history. Company state and orders persist independently of run expiry. Reconnecting starts a fresh run; sign out first if an abandoned grant should be revoked. Saved run snapshots are pruned on creating/saving runs; this is not an archival history browser.

## Pending / production blockers

General OAuth sign-in to arbitrary PAP Companies is **not implemented**: the local client/redirect and shopping endpoint mappings remain deliberately pinned. Account signup/recovery, a real hosted identity provider, real multi-user authentication, shared rate limits, a run-history browser, distributed storage and real payments/shipping are also absent. Do not add real customer data to Juniper.

Account routes are development-only, even if `CHAT_ENABLED=true`. HTTPS, external access control, stronger CSP, proxy-log redaction, external secret management, distributed transaction design and independent security review are required before public account integrations. Next incoming-request and Juniper request logging are disabled because OAuth URLs contain one-time credentials. Browser redirect history still contains OAuth codes, as expected for the authorization-code flow.

Unit/integration tests cover scoped refresh, revocation, approval gating, stale checkouts, idempotency, snapshot rehydration, ciphertext integrity, and permissions. Local browser testing covers sign-in, basket reads/edits, checkout approval and page-refresh restoration; this is not an independent security audit.

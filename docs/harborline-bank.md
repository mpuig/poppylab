# Harborline Bank

Harborline Bank (`apps/harborline`) is a standalone, deployable, fully fictional Personal Agent Protocol 1.0 Company. It exercises a banking-shaped capability set without connecting to a bank, moving money, validating identities, or accepting real financial data.

> **Safety notice:** no account, balance, transaction, card, recipient, payment or transfer is real. Never enter a real bank password, account number, routing number, card number, personal financial record or other credential.

## Run it

```sh
pnpm dev:harborline
# http://harbor.localhost:4300
# customer portal: http://harbor.localhost:4300/account
```

The package also has `dev:worker`, `build`, `test`, `typecheck` and `deploy` scripts. `wrangler.toml` deploys `HarborlineCompany` to `bank-demo.poppylab.dev` with visitor isolation and SQLite-backed Durable Object storage.

## Fictional personas and shared state

- **Elena Maren**: operating checking, reserve savings, posted transactions, one active and one inactive card, active and inactive recipients, and two budgets.
- **Robin Ito**: everyday checking, rainy-day savings, posted and pending transactions, a frozen card, one active recipient and one budget.

The account portal and Poppy APIs use the same tenant state. Approved agent changes appear in the portal's next two-second refresh. Pending proposals appear only as activity and never as committed account state.

## Scopes

Read scopes are separate by resource and marked as personal data:

- `accounts:read`
- `transactions:read`
- `cards:read`
- `recipients:read`
- `budgets:read`

Reversible changes are separate:

- `cards:write`
- `transactions:write`
- `budgets:write`

Consequential requests are marked irreversible in scope hints:

- `payments:request`
- `transfers:request`

`offline_access` is optional and off by default on Harborline's consent page. It changes no data and only permits refresh of the fictional grant.

## APIs and approvals

Useful reads list accounts/balances, transactions, cards, recipients and budgets. Mutations are:

- request a payment from an owned account to an existing active recipient;
- transfer between two owned active accounts;
- freeze or unfreeze an active card;
- edit a posted transaction category;
- create or update a monthly budget.

Every mutation requires the request to declare Operations version 3. The first request returns `403 approval_required` with exact terms. Only a retry with a valid `Poppy-Approval` for the same unexpired revision can perform it. Replayed approvals return the first result.

Payment, transfer and budget creation requests require stable caller-generated idempotency keys. A key stands for one request: reuse with different terms returns `idempotency_conflict` while the key's operation can still be approved, and for good once it was performed. Harborline keeps nothing for a key beyond its operation, so a key whose operation expired unapproved is free again, and a different request under it is a new proposal. A payment or transfer is proposed on the accounts as they are at each request, so a key reused after the account changed gets a new revision. Approving a revision whose balances or versions are gone performs nothing and returns `approval_required` with the new revision. A key that has already moved money is never performed again: approving it returns `account_changed`.

Modeled business errors include:

- `insufficient_funds`;
- `recipient_limit_exceeded` and `transfer_limit_exceeded`;
- `recipient_inactive`, `card_inactive` and `account_inactive`;
- `card_changed`, `transaction_changed`, `budget_changed` and Operations `account_changed`;
- `transaction_pending`;
- `idempotency_conflict` and safe replay of performed operations.

## Conversations and tasks

`/poppy/conversations` exposes a deterministic Company Agent. Structured `data.request` values cover help, cash position, spending summary, card status, and approval-gated card freezing. Handoff returns an explicit fictional-demo response; no banker can join.

`/poppy/tasks` excludes account opening/closure, recipient creation or verification, deposits, disputes, statements/tax documents, and payment to a new recipient. Where useful, alternatives point back to the OpenAPI operations.

## Tests and scenarios

```sh
pnpm --filter @poppy-lab/harborline test
pnpm scenarios banking
```

Coverage includes discovery and scope hints, consent subsets and offline access, route-specific scope enforcement, persona reads, exact payment terms, idempotent replay/conflicts, insufficient funds and limits, stale transfers, card state, transaction categories, budget create/update, Operations extension enforcement, conversations, and portal/API state parity.

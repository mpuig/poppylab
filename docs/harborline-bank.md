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

The FDX-shaped API has its own read-only scopes, one per data cluster (see [below](#fdx-shaped-api)): `fdx:ACCOUNT_BASIC`, `fdx:ACCOUNT_DETAILED`, `fdx:TRANSACTIONS` and `fdx:CUSTOMER_CONTACT`.

## APIs and approvals

Useful reads list accounts/balances, transactions, cards, recipients and budgets. Mutations are:

- request a payment from an owned account to an existing active recipient;
- transfer between two owned active accounts;
- freeze or unfreeze an active card;
- edit a posted transaction category;
- create or update a monthly budget.

Every mutation requires the request to declare Operations version 3. The first request returns `403 approval_required` with exact terms. Only a retry with a valid `Poppy-Approval` for the same unexpired revision can perform it. Replayed approvals return the first result.

Payment, transfer and budget creation requests require stable caller-generated idempotency keys. A key stands for one request: reuse with different terms returns `idempotency_conflict` while the key's operation can still be approved, and for good once it was performed. Harborline keeps nothing for a key beyond its operation, so a key whose operation expired unapproved is free again, and a different request under it is a new proposal. A payment or transfer is proposed on the accounts as they are at each request, so a key reused after the account changed gets a new revision. Approving a revision whose balances or versions are gone performs nothing and returns `approval_required` with the new revision. A key that was performed is never performed again. Repeating its request returns the first result built from the payment, transfer or budget it made, with the accounts or budget as they are now, even after the gateway has forgotten the operation (the result then carries no `operation_id`) and whatever the balance is by then; no new operation is proposed. A budget changed since it was created is matched on its category and month only.

Modeled business errors include:

- `insufficient_funds`;
- `recipient_limit_exceeded` and `transfer_limit_exceeded`;
- `recipient_inactive`, `card_inactive` and `account_inactive`;
- `card_changed`, `transaction_changed`, `budget_changed` and Operations `account_changed`;
- `transaction_pending`;
- `idempotency_conflict` and safe replay of performed operations.

## FDX-shaped API

Harborline also serves a read-only API shaped after FDX 6.4 over the same fictional state. It is **FDX-shaped, not FDX-conformant or certified**: paths and field names follow the shape that public implementers use, and every rule, description and error text is Harborline's own. No FDX specification text or schema is in this repository, and Harborline uses no FDX branding. It exists to show a domain standard used through a Poppy extension, the way `ucp` does for commerce. The extension itself is described in [`poppylab.dev/fdx` v1](extensions/fdx.md).

Discovery lists it twice. `extensions["poppylab.dev/fdx"]` has one entry, version `1`, with `fdx_version: "6.4"`, `base_url` (`/fdx/v6`), `resources` (`customer`, `accounts`, `transactions`) and `consent_endpoint` (`/fdx/v6/consents`). `apis` adds a second OpenAPI document, `/openapi/fdx.json`, public and served signed out, after Harborline's own `/openapi.json`. Every route under `/fdx/` needs the request to declare `Poppy-Extensions: "poppylab.dev/fdx";v="1"`; without it the gateway answers `403 extension_required` before looking at the token (§3.3). Operations v3 stays listed for Harborline's own API, where payments and transfers still go.

| Route                                           | Scope                     | Answers                                  |
| ----------------------------------------------- | ------------------------- | ---------------------------------------- |
| `GET /fdx/v6/accounts`                          | `fdx:ACCOUNT_BASIC`       | The accounts chosen at consent           |
| `GET /fdx/v6/accounts/{accountId}`              | `fdx:ACCOUNT_BASIC`       | One chosen account                       |
| `GET /fdx/v6/accounts/{accountId}/transactions` | `fdx:TRANSACTIONS`        | A page of its transactions, newest first |
| `GET /fdx/v6/customers/current`                 | `fdx:CUSTOMER_CONTACT`    | Name and email                           |
| `GET /fdx/v6/consents/{consentId}`              | any token of that consent | The consent record                       |
| `PUT /fdx/v6/consents/{consentId}/revocation`   | any token of that consent | 204; revokes the grant                   |

- **Accounts** are deposit accounts: `accountId`, `accountCategory: "DEPOSIT_ACCOUNT"`, `accountType` (`CHECKING`, `SAVINGS`), `productName`, `nickname`, `accountNumberDisplay` (four digits derived from the account ID, since no real number exists), `status` (`OPEN`, `CLOSED`) and `currency.currencyCode`. `currentBalance`, `availableBalance` and `balanceAsOf` appear only when the token carries `fdx:ACCOUNT_DETAILED`. Treating `ACCOUNT_BASIC` as descriptors without balances is Harborline's reading, as published by implementing banks, not an FDX rule.
- **Transactions** carry `amount` as an absolute decimal number with `debitCreditMemo` (`DEBIT`, `CREDIT`), `status` (`POSTED`, `PENDING`), `transactionTimestamp`, `postedTimestamp` only when posted, and Harborline's own `category` names. Amounts are built from the cents' digits, so they are exact. `startTime` and `endTime` are inclusive `YYYY-MM-DD` UTC days; `offset` and `limit` page the results (default 25, a larger `limit` is cut to 100), and `page` has `totalElements` and, unless it's the last page, `nextOffset` as a string.
- **Consent with account selection.** When a sign-in asks for any `fdx:*` scope, the consent page adds a list of accounts per test customer, all ticked by default. CSS `:has()` shows only the chosen customer's accounts and hides "Allow" while none is ticked, with no script (the consent page's CSP allows none); a browser without `:has()` shows all of them. The server keeps only the chosen customer's accounts. Approving FDX scopes with no account is turned down with a message (`400 invalid_request`) rather than granted empty. The choice limits the FDX-shaped routes only; Harborline's own API scopes, if granted in the same sign-in, see every account as before.
- **The consent is the grant.** Its ID is the Poppy grant's, returned as `consent_id` in every token response of a grant with `fdx:*` scopes, including refreshes. The record has `id`, `status`, `parties` (Harborline as `DATA_PROVIDER`, the agent's verified host as `DATA_RECIPIENT`), `createdTime`, `expirationTime`, `durationType` (`TIME_BOUND` with `offline_access` and `durationPeriod` in days, otherwise `ONE_TIME`) and `resources` (each chosen account with its clusters). Only a live grant's tokens reach it, so its status reads `ACTIVE`. Revoking it through `PUT …/revocation` (`{ "reason": "USER_ACTION", "initiator": "INDIVIDUAL" }`) ends the grant, its access tokens and its refresh token, on both APIs. Disconnecting the agent in the customer portal ends FDX access the same way.
- **Errors** on FDX routes are `{ code, message, debugMessage?, note }` with `code` a string: `404 701` for an account that doesn't exist or wasn't chosen (Harborline never says which), `400 703` for a malformed or inverted date range, and `401 602` if a token somehow has no grant. Harborline's own lowercase codes cover the rest: `invalid_parameter` (paging, revocation body), `consent_not_found` (another grant's consent, never revealed) and `not_found`. Session and token errors stay Poppy and OAuth errors from the gateway (`invalid_session`, `extension_required`, `WWW-Authenticate` challenges, `insufficient_scope`).
- **Security** is Harborline's usual profile: Direct Sign-In with PAR offered, PKCE, `private_key_jwt` and DPoP-bound tokens. It resembles the FAPI 2.0 style FDX describes, but hasn't been checked against FDX.
- **In the playground**, Iris uses this API only with **Use FDX** on, in the chat's account row. It then declares the extension, asks for the `fdx:` clusters at sign-in and reads through its native FDX-shaped tools. With it off, Iris uses Harborline's own API as before and never loads `/openapi/fdx.json` as generic tools ([Use FDX](openapi-tools.md#in-the-playground-use-fdx)). Signed in with Use FDX on, the account row also shows the consent and **Revoke FDX consent**, confirmed in the page, which sends the `PUT …/revocation` above and signs the conversation out on `204` ([Revoking the consent](openapi-tools.md#in-the-playground-use-fdx)).

Every JSON body carries the fiction notice in `note`. Statements and tax documents stay excluded.

## Conversations and tasks

`/poppy/conversations` exposes a deterministic Company Agent. Structured `data.request` values cover help, cash position, spending summary, card status, and approval-gated card freezing. Handoff returns an explicit fictional-demo response; no banker can join.

`/poppy/tasks` excludes account opening/closure, recipient creation or verification, deposits, disputes, statements/tax documents, and payment to a new recipient. Where useful, alternatives point back to the OpenAPI operations.

## Tests and scenarios

```sh
pnpm --filter @poppy-lab/harborline test
pnpm scenarios banking
```

Coverage includes discovery and scope hints, consent subsets and offline access, route-specific scope enforcement, persona reads, exact payment terms, idempotent replay/conflicts, insufficient funds and limits, stale transfers, card state, transaction categories, budget create/update, Operations extension enforcement, conversations, and portal/API state parity.

`src/fdx.test.ts` (`pnpm scenarios fdx`, also in `banking`) covers the FDX-shaped API: discovery, `extension_required`, scopes per cluster and balances only with `fdx:ACCOUNT_DETAILED`, unchosen and other customers' accounts as `701`, the account choice on the consent page and an empty choice turned down, paging and limits, dates and `703`, `consent_id` at sign-in and refresh, the consent record, revocation through FDX and through the portal, visitor isolation, parity with Harborline's own API after an approved transfer and category change, and an agent without the extension using Harborline as before.

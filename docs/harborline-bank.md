# Harborline Bank

Harborline Bank (`apps/harborline`) is a standalone, deployable, fully fictional Personal Agent Protocol 1.0 Company. It exercises a banking-shaped capability set without connecting to a bank, moving money, validating identities, or accepting real financial data.

> **Safety notice:** no account, balance, transaction, card, recipient, payment or transfer is real. Never enter a real bank password, account number, routing number, card number, personal financial record or other credential.

## Run it

```sh
pnpm dev:harborline
# http://harbor.localhost:4300
# customer portal: http://harbor.localhost:4300/account
# how it works, for a visitor: http://harbor.localhost:4300/how-it-works
```

`/how-it-works` shows a visitor the three steps with a personal agent: the discovery document as served (its sixteen permissions said in words, with a link to the whole file), the API's operations as a ledger, and Elena's $500 transfer waiting for approval. It is built from the same objects the endpoints serve, and a test holds it to them.

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

`offline_access` is optional and off by default on Harborline's consent page. It changes no data; it decides how long the fictional grant lasts (the gateway's `grantLifetime`):

| Granted                  | The grant ends                                    | Refresh before the end                                             | Refresh after it |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------ | ---------------- |
| Without `offline_access` | With its first access token, 1 hour after sign-in | A new access token that ends with the grant                        | `invalid_grant`  |
| With `offline_access`    | 7 days after sign-in                              | A new 1-hour access token, cut to the grant's end in its last hour | `invalid_grant`  |

Sign-in returns a refresh token either way (§4.4, §4.8). Past the end, the agent asks the User to sign in again, as after any expired or revoked grant (Iris: "Sign in again to reconnect"). Grants approved before Harborline enforced this keep the end they were stored with, 7 days.

The FDX-shaped API has its own read-only scopes, one per data cluster (see [below](#fdx-shaped-api)): `fdx:ACCOUNT_BASIC`, `fdx:ACCOUNT_DETAILED`, `fdx:TRANSACTIONS`, `fdx:STATEMENTS` and `fdx:CUSTOMER_CONTACT`.

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

- `insufficient_funds` (when it answers an approval of a payment or transfer proposed before the balance fell, the portal's agent activity lists the attempt as "Not applied", with the available balance and who approved it, and the proposal goes on waiting until it expires);
- `recipient_limit_exceeded` (each recipient's `payment_limit_cents`) and `transfer_limit_exceeded` (USD 2,500.00 in one transfer; the handler and the `maximum` of the transfer's `amount_cents` in the OpenAPI description read one constant);
- `recipient_inactive`, `card_inactive` and `account_inactive`;
- `card_changed`, `transaction_changed`, `budget_changed` and Operations `account_changed`;
- `transaction_pending`;
- `idempotency_conflict` and safe replay of performed operations.

A refusal that carries an amount says its currency: `insufficient_funds` answers `{ error, available_cents, currency }`, and `recipient_limit_exceeded` and `transfer_limit_exceeded` answer `{ error, limit_cents, currency }`. `currency` is `"USD"`, from the constant the terms of the same operation and the account views take theirs from (`CURRENCY` in `src/data.ts`), so an agent can show the number as money without guessing.

## FDX-shaped API

Harborline also serves a read-only API shaped after FDX 6.4 over the same fictional state. It is **FDX-shaped, not FDX-conformant or certified**: paths and field names follow the shape that public implementers use, and every rule, description and error text is Harborline's own. No FDX specification text or schema is in this repository, and Harborline uses no FDX branding. It exists to show a domain standard used through a Poppy extension, the way `ucp` does for commerce. The extension itself is described in [`poppylab.dev/fdx` v1](extensions/fdx.md).

Discovery lists it twice. `extensions["poppylab.dev/fdx"]` has one entry, version `1`, with `fdx_version: "6.4"`, `base_url` (`/fdx/v6`), `resources` (`customer`, `accounts`, `transactions`, `statements`) and `consent_endpoint` (`/fdx/v6/consents`). `apis` adds a second OpenAPI document, `/openapi/fdx.json`, public and served signed out, after Harborline's own `/openapi.json`. Every route under `/fdx/` needs the request to declare `Poppy-Extensions: "poppylab.dev/fdx";v="1"`; without it the gateway answers `403 extension_required` before looking at the token (§3.3). Operations v3 stays listed for Harborline's own API, where payments and transfers still go.

| Route                                                       | Scope                     | Answers                                  |
| ----------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| `GET /fdx/v6/accounts`                                      | `fdx:ACCOUNT_BASIC`       | The accounts chosen at consent           |
| `GET /fdx/v6/accounts/{accountId}`                          | `fdx:ACCOUNT_BASIC`       | One chosen account                       |
| `GET /fdx/v6/accounts/{accountId}/transactions`             | `fdx:TRANSACTIONS`        | A page of its transactions, newest first |
| `GET /fdx/v6/accounts/{accountId}/statements`               | `fdx:STATEMENTS`          | A page of its statements, newest first   |
| `GET /fdx/v6/accounts/{accountId}/statements/{statementId}` | `fdx:STATEMENTS`          | One statement as a PDF                   |
| `GET /fdx/v6/customers/current`                             | `fdx:CUSTOMER_CONTACT`    | Name and email                           |
| `GET /fdx/v6/consents/{consentId}`                          | any token of that consent | The consent record                       |
| `PUT /fdx/v6/consents/{consentId}/revocation`               | any token of that consent | 204; revokes the grant                   |

- **Accounts** are deposit accounts: `accountId`, `accountCategory: "DEPOSIT_ACCOUNT"`, `accountType` (`CHECKING`, `SAVINGS`), `productName`, `nickname`, `accountNumberDisplay` (four digits derived from the account ID, since no real number exists), `status` (`OPEN`, `CLOSED`) and `currency.currencyCode`. `currentBalance`, `availableBalance` and `balanceAsOf` appear only when the token carries `fdx:ACCOUNT_DETAILED`. Treating `ACCOUNT_BASIC` as descriptors without balances is Harborline's reading, as published by implementing banks, not an FDX rule.
- **Transactions** carry `amount` as an absolute decimal number with `debitCreditMemo` (`DEBIT`, `CREDIT`), `status` (`POSTED`, `PENDING`), `transactionTimestamp`, `postedTimestamp` only when posted, and Harborline's own `category` names. Amounts are built from the cents' digits, so they are exact. `startTime` and `endTime` are inclusive `YYYY-MM-DD` UTC days; `offset` and `limit` page the results (default 25, a larger `limit` is cut to 100), and `page` has `totalElements` and, unless it's the last page, `nextOffset` as a string.
- **Statements** are monthly and derived from each account's own records, never stored or invented. A cycle runs from the 21st of one month through the 20th of the next, in UTC days; the fictional accounts opened on 21 August 2026, so the first cycle ends on 20 September 2026. A cycle's statement is issued the day after it closes, and the newest twelve are listed. On 25 November 2026 that is three per account: the cycles ending 20 September and 20 October, with no activity, and the one ending 20 November, with the seed transactions of 15–19 November. Balances work back from the current one: a cycle closes at `balance_cents` less everything posted after it, and opens at that less its own posted transactions. `balance_cents` is the posted balance, so pending transactions are in neither the balances nor a statement. A transfer or payment approved today posts today, so it changes the current balance and no closed statement. List items have `statementId` (`stmt_{accountId}_{YYYYMMDD}` of the closing day), `accountId`, `statementDate` (the closing day), `description`, `status: "AVAILABLE"` and Harborline's own `startDate` and `endDate`. `startTime` and `endTime` select statement dates, and paging works as for transactions.
- **The statement PDF** is written by hand in `statement-pdf.ts`, with no dependency: PDF 1.4, Letter pages, the standard Helvetica and Helvetica-Bold fonts with WinAnsi encoding, uncompressed content streams and a cross-reference table with exact byte offsets. It has no dates of creation and no random ID, so the same statement is always the same bytes. Page 1 starts with "Harborline Bank — fictional statement" and a boxed "No real account exists." notice with the fiction notice, then the account's name and last four digits, the customer, the period, the statement ID, the opening balance, credits, debits and closing balance, and a table of the posted transactions with a running balance. At most 100 transactions are printed, about 31 on the first page and 44 on each next one; a longer cycle says "Showing the first 100 of N". Every page repeats that no real account exists, with its page number and "FDX-shaped, not FDX-conformant or certified". A statement with the seed data is about 2.7 KB; a cut one stays under 32 KB. The response has `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="harborline-{statementId}.pdf"`, `Content-Length` and `Cache-Control: no-store`. `Accept` must take a PDF (`application/pdf`, `application/*`, `*/*`, or no `Accept`); otherwise `406 not_acceptable` with a JSON body. A statement that isn't one of the account's listed ones is `404 statement_not_found`, Harborline's own code, since no FDX code for it is verified.
- **Consent with account selection.** When a sign-in asks for any `fdx:*` scope, the consent page adds "Accounts to share" under the test customers, with each customer's accounts ticked by default. CSS `:has()` shows only the chosen customer's accounts and hides "Allow" while none is ticked, with no script (the consent page's CSP allows none); a browser without `:has()` shows all of them. The server keeps only the chosen customer's accounts. Approving FDX scopes with no account is turned down with a message (`400 invalid_request`) rather than granted empty. The choice limits the whole grant, and the page says so: the chosen accounts are the only ones the agent can see or act on, through either API (see [The account choice](#the-account-choice)).
- **The consent is the grant.** Its ID is the Poppy grant's, returned as `consent_id` in every token response of a grant with `fdx:*` scopes, including refreshes. The record has `id`, `status`, `parties` (Harborline as `DATA_PROVIDER`, the agent's verified host as `DATA_RECIPIENT`), `createdTime`, `expirationTime`, `durationType`, `durationPeriod` when `TIME_BOUND`, and `resources` (each chosen account with its clusters). `expirationTime` is the grant's end. With `offline_access` the record is `TIME_BOUND`, with `durationPeriod` 7 and an end 7 days after `createdTime`. Without it, it is `ONE_TIME`, with an end 1 hour after `createdTime`, when the grant's one access token ends too (see [Scopes](#scopes)). Grants approved before Harborline enforced this keep their stored 7-day end, so their records still say `ONE_TIME` with that end. Only a live grant's tokens reach it, so its status reads `ACTIVE`. Revoking it through `PUT …/revocation` (`{ "reason": "USER_ACTION", "initiator": "INDIVIDUAL" }`) ends the grant, its access tokens and its refresh token, on both APIs. Disconnecting the agent in the customer portal ends FDX access the same way.
- **Errors** on FDX routes are `{ code, message, debugMessage?, note }` with `code` a string: `404 701` for an account that doesn't exist or wasn't chosen (Harborline never says which), `400 703` for a malformed or inverted date range, and `401 602` if a token somehow has no grant. Harborline's own lowercase codes cover the rest: `invalid_parameter` (paging, revocation body), `consent_not_found` (another grant's consent, never revealed) and `not_found`. Session and token errors stay Poppy and OAuth errors from the gateway (`invalid_session`, `extension_required`, `WWW-Authenticate` challenges, `insufficient_scope`).
- **Security** is Harborline's usual profile: Direct Sign-In with PAR offered, PKCE, `private_key_jwt` and DPoP-bound tokens. It resembles the FAPI 2.0 style FDX describes, but hasn't been checked against FDX.
- **In the playground**, Iris uses this API only with **Use FDX** on, in the chat's account row. It then declares the extension, asks for the `fdx:` clusters at sign-in and reads through its native FDX-shaped tools. With it off, Iris uses Harborline's own API as before and never loads `/openapi/fdx.json` as generic tools ([Use FDX](openapi-tools.md#in-the-playground-use-fdx-and-use-espi)). Signed in with Use FDX on, the account row also shows the consent and **Revoke FDX consent**, confirmed in the page, which sends the `PUT …/revocation` above and signs the conversation out on `204` ([Revoking the consent](openapi-tools.md#in-the-playground-use-fdx-and-use-espi)).

Every JSON body carries the fiction notice in `note`, and every statement PDF on every page. Tax documents stay excluded.

## The account choice

When a sign-in asks for any `fdx:*` scope, the User picks accounts on the consent page and the grant keeps them as its `resources`. They limit everything the grant reaches, not only the FDX-shaped routes. A User who shares only checking expects the agent never to see savings, whichever API it calls. Before this, the choice limited only the FDX-shaped routes, and in a test with a real model, the model read Harborline's own API and told the User the balance of the savings account they hadn't shared.

- **Reads.** `GET /api/account/accounts` lists only the chosen accounts, `/api/account/transactions` only their transactions, and `/api/account/cards` only the cards linked to them.
- **Changes.** A payment whose source isn't chosen, and a transfer whose source or destination isn't, get `404 account_not_found`, the answer for an account that doesn't exist. A card status change for a card on another account gets `404 card_not_found`, and a category change for a transaction of another account `404 transaction_not_found`. These come before any Operations v3 proposal, so nothing is proposed for an account outside the choice, and an approval sent through such a grant performs nothing, even for an operation another grant proposed.
- **The Company Agent** sees the same: `cash_position` sums only the chosen accounts, `spending_summary` counts only their transactions, `card_status` lists only their cards, and `freeze_card` finds no other card. The gateway puts the grant's resources on the conversation turn (`ConversationTurn.resources`).
- **Recipients and budgets** aren't tied to an account and are shown in full. A budget's spend is a stored, simulated figure for the customer's category, not added up from any account's transactions, so the choice doesn't change it. A bank whose budgets add up account transactions should add up only the chosen accounts'.
- **Grants without a choice** see every account, as before: a sign-in that asked for no FDX scope, and a grant approved before accounts were chosen.
- **The customer portal** (`/account`) is the account holder signed in directly, not an agent, and always shows everything.

## Conversations and tasks

`/poppy/conversations` exposes a deterministic Company Agent. Structured `data.request` values cover help, cash position, spending summary, card status, and approval-gated card freezing. Handoff returns an explicit fictional-demo response; no banker can join.

`/poppy/tasks` excludes account opening/closure, recipient creation or verification, deposits, disputes, tax documents, and payment to a new recipient. Statements are no longer excluded: the FDX-shaped API serves them. Where useful, alternatives point back to the OpenAPI operations.

## Tests and scenarios

```sh
pnpm --filter @poppy-lab/harborline test
pnpm scenarios banking
```

`src/statements.test.ts` (also in both groups) covers which cycles exist (the day after closing, across a year end, at most twelve), the balance arithmetic (posted only, later postings, other accounts), and the PDF: byte-identical output, header, objects at their cross-reference offsets, stream lengths, trailer, page tree and count, the fiction notice on every page, the 100-row cut over three pages, size bounds and WinAnsi escaping.

Coverage includes discovery and scope hints, consent subsets and offline access (a grant without `offline_access` refreshes only within its hour; with it, for 7 days), route-specific scope enforcement, persona reads, exact payment terms, idempotent replay/conflicts, insufficient funds and limits, stale transfers, card state, transaction categories, budget create/update, Operations extension enforcement, conversations, and portal/API state parity.

`src/account-choice.test.ts` (in `fdx` and `banking`) covers [the account choice](#the-account-choice) on Harborline's own API with Elena sharing one of her two accounts: the reads, a transfer to the unchosen account and a payment from it refused with no operation proposed, an approval through a grant that didn't choose the account, a card and a transaction of another account not found, the Company Agent's cash position, spending summary, cards and card freeze, and grants without a choice unchanged.

`src/fdx.test.ts` (`pnpm scenarios fdx`, also in `banking`) covers the FDX-shaped API: discovery, `extension_required`, scopes per cluster and balances only with `fdx:ACCOUNT_DETAILED`, unchosen and other customers' accounts as `701` (statements too), statement lists with paging and dates, the PDF's headers, its bytes the same on every request and after a transfer posted today, `Accept` and `406`, `statement_not_found`, the account choice on the consent page and an empty choice turned down, paging and limits, dates and `703`, `consent_id` at sign-in and refresh, the consent record, revocation through FDX and through the portal, visitor isolation, parity with Harborline's own API after an approved transfer and category change, and an agent without the extension using Harborline as before.

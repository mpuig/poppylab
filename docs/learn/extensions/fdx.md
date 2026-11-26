# FDX: bank data through Poppy

Elena Maren is a customer of [Harborline Bank](https://bank-demo.poppylab.dev),
one of Poppy Lab's fictional Companies. She asks Iris, a Personal Agent, for her
balance, recent transactions and latest statement, and shares her operating
checking account and not her savings. Harborline answers through an API shaped
like the Financial Data Exchange (FDX) API, listed as the experimental
extension `poppylab.dev/fdx` v1 that Poppy Lab defined.

The traffic is from 25 November 2026. The discovery document comes from the live
site, and the signed-in steps from the same Harborline code run in-process,
because they need a fictional customer's consent. Tokens and long responses are
trimmed.

> **FDX-shaped, not FDX-conformant or certified.** The FDX licence forbids
> copying or publishing its specification, so Harborline reuses the resource
> paths and field names that public implementers document and writes every
> description, rule and error text itself.

## Who does what

| Who                     | What they do in this process                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Elena, the user         | Signs in, chooses which accounts to share, downloads a statement and revokes the consent.          |
| Iris, the agent         | Declares the extension, reads accounts, transactions and statements, keeps the consent ID.         |
| Harborline, the Company | Lists the extension, asks which accounts to share, serves those only, ends the consent on request. |

![The bank lists the extension poppylab.dev/fdx in its poppy.json. The Personal Agent declares the extension on every request, and a request that does not is refused with extension_required. The user signs in on the bank's page and picks the accounts to share, and the agent receives a token with a consent ID. The agent reads accounts and transactions and gets only the shared account; asking for an account that was not shared gets a 404, as if it did not exist. The user downloads a statement, and the PDF goes from the bank to the user, not to the model. The user revokes the consent in the agent, and the agent revokes it at the bank.](../../../apps/playground/public/learn-media/diagrams/fdx-sequence.svg "Seven steps of one request for bank data, and the three things only the user does.")

## Which request carries what

The model sees none of the credentials.

| Request                                    | Session header | Access token | Who decides                 |
| ------------------------------------------ | -------------- | ------------ | --------------------------- |
| `GET /.well-known/poppy.json`              | no             | no           |                             |
| `POST /oauth/par`, consent, token          | no             | no           | **the user**, at Harborline |
| any `/fdx/v6/...` request, declared or not | yes            | yes          |                             |
| a statement's PDF                          | yes            | yes          | **the user** downloads      |
| `PUT /fdx/v6/consents/{id}/revocation`     | yes            | yes          | **the user**, in the agent  |

## 1. The bank lists the extension

```http
GET https://bank-demo.poppylab.dev/.well-known/poppy.json
```

```json
{
  "auth": {
    "scopes": { // (1)
      "fdx:ACCOUNT_BASIC": "…",
      "fdx:ACCOUNT_DETAILED": "…",
      "fdx:TRANSACTIONS": "…",
      "fdx:STATEMENTS": "…",
      "fdx:CUSTOMER_CONTACT": "…"
    }
  },
  "apis": [
    { "type": "openapi", "url": "https://bank-demo.poppylab.dev/openapi.json" },
    {
      "type": "openapi",
      "url": "https://bank-demo.poppylab.dev/openapi/fdx.json" // (2)
    }
  ],
  "extensions": {
    "operations": [{ "version": "3" }],
    "poppylab.dev/fdx": [ // (3)
      {
        "version": "1",
        "fdx_version": "6.4",
        "base_url": "https://bank-demo.poppylab.dev/fdx/v6", // (4)
        "resources": ["customer", "accounts", "transactions", "statements"],
        "consent_endpoint": "https://bank-demo.poppylab.dev/fdx/v6/consents"
      }
    ]
  }
}
```

1. **Each scope has hints.** All five are
   `{ "changes": "none", "personal_data": true }`: they read personal data
   ([§4.7](https://personalagentprotocol.org/docs/1.0/spec#scopes)).
2. **`apis` lists the FDX-shaped API too**, in Harborline's second OpenAPI
   description, so an agent without the extension can still call it.
3. **The name carries a domain**, because names without one are reserved for the
   protocol's own extensions
   ([§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions)).
4. **The agent checks the entry before using it.** `base_url` and
   `consent_endpoint` must be HTTPS URLs on `organization.domain`, with no
   credentials, query or fragment. A failing entry counts as not listed, and the
   Inspector says why. Otherwise a bank's document could send the agent, its
   Session header and its token elsewhere.

## 2. Declaring it, or being refused

The agent declares the extension on every request of the Session, next to
Operations
([§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)):

```http
GET https://bank-demo.poppylab.dev/fdx/v6/accounts
Poppy-Session: eyJ0eXAiOiJwb3BweS1zZXNzaW9uK2p3dCIs…
Poppy-Version: 1.0
Poppy-Extensions: "operations";v="3", "poppylab.dev/fdx";v="1"
Authorization: DPoP …
DPoP: …
```

Without the declaration, the bank refuses before it looks at the token:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{ "error": "extension_required", "extension": "poppylab.dev/fdx" }
```

Only a new Session that declares the extension fixes this, so a refresh, a DPoP
nonce retry or a fresh sign-in first would be wasted, and a refused request
touches no grant or Session.

## 3. Signing in: clusters and accounts

The sign-in is Poppy's usual Direct Sign-In with PAR, PKCE and DPoP
([§4.2](https://personalagentprotocol.org/docs/1.0/spec#direct-sign-in)). Only
the scopes and the consent page change: the agent requests the clusters the task
needs, and Harborline's page adds a list of the customer's accounts, all ticked
by default. Elena unticks the savings account. Approving with no account is
turned down.

The token response names the consent:

```json
{
  "access_token": "…",
  "token_type": "DPoP",
  "expires_in": 3600,
  "refresh_token": "…",
  "scope": "fdx:ACCOUNT_BASIC fdx:ACCOUNT_DETAILED fdx:TRANSACTIONS fdx:STATEMENTS",
  "consent_id": "m0_EuxBp4yVB49MEHfMWLM3ATJ7rVgyN"
}
```

`consent_id` is the grant's ID, and other agents ignore a field they don't know
(RFC 6749 §5.1). Iris keeps it, on refresh too, so the model never names it.

## 4. Reading

```http
GET https://bank-demo.poppylab.dev/fdx/v6/accounts
```

```json
{
  "accounts": [
    {
      "accountId": "acc_HLB_A100",
      "accountCategory": "DEPOSIT_ACCOUNT",
      "accountType": "CHECKING",
      "productName": "Operating checking",
      "accountNumberDisplay": "0479",
      "status": "OPEN",
      "currency": { "currencyCode": "USD" },
      "currentBalance": 12845,
      "availableBalance": 12845,
      "balanceAsOf": "2026-11-25T12:00:00.000Z"
    }
  ],
  "note": "Fictional Harborline Bank data. No real money moves; …"
}
```

Only the shared account comes back, here and from Harborline's own
`/api/account/accounts`. The balances are there because the token carries
`fdx:ACCOUNT_DETAILED`, and a token refreshed without it loses them. Reading
`ACCOUNT_BASIC` as descriptors without balances follows how implementing banks
describe it, not FDX's own text.

Transactions page with `offset` and `limit`. Amounts are absolute, and
`debitCreditMemo` says which way they went:

```http
GET https://bank-demo.poppylab.dev/fdx/v6/accounts/acc_HLB_A100/transactions?limit=2
```

```json
{
  "page": { "nextOffset": "2", "totalElements": 3 },
  "transactions": [
    {
      "transactionId": "txn_HLB_A301",
      "description": "North Pier Grocer",
      "amount": 86.42,
      "debitCreditMemo": "DEBIT",
      "status": "POSTED",
      "transactionTimestamp": "2026-11-18T15:42:00.000Z",
      "category": "groceries"
    }
  ]
}
```

The agent's adapter follows `nextOffset` itself, within bounds: 50 per page, 4
pages, 100 transactions per call, and tells the model `truncated: true` rather
than reading on.

## 5. Two kinds of error

The savings account wasn't shared:

```http
GET https://bank-demo.poppylab.dev/fdx/v6/accounts/acc_HLB_A200
```

```http
HTTP/1.1 404 Not Found

{ "code": "701", "message": "Account not found", "note": "…" }
```

The bank doesn't say whether the account exists. A date range the wrong way
round gets `400` with `{ "code": "703", "message": "Invalid date range" }`.

Domain errors like these go to the model, bounded, as
`{ "error": "fdx_error", "status": 404, "code": "701", … }`. Protocol errors
never reach it as FDX ones: `invalid_session`, `session_ended`,
`extension_required` and token challenges in `WWW-Authenticate`, which lead to a
refresh or a new sign-in.

## 6. Statements: documents the model doesn't read

```http
GET https://bank-demo.poppylab.dev/fdx/v6/accounts/acc_HLB_A100/statements
```

```json
{
  "statements": [
    {
      "statementId": "stmt_acc_HLB_A100_20261120",
      "statementDate": "2026-11-20",
      "description": "Monthly statement, 2026-10-21 to 2026-11-20",
      "status": "AVAILABLE"
    }
  ],
  "page": { "totalElements": 3 }
}
```

`GET …/statements/{statementId}` with `Accept: application/pdf` returns the
document, a small deterministic PDF. A model can't read a PDF, so the agent's
tool returns the size, the type and a SHA-256. Elena downloads the file from the
chat's account row, so the bytes never enter the model's context.

## 7. Revoking

Revocation is Elena's action, not a tool the model has. Iris shows the consent
in the account row (ID, status, shared accounts, expiry) with a **Revoke FDX
consent** button that asks again in the page.

```http
PUT https://bank-demo.poppylab.dev/fdx/v6/consents/m0_EuxBp4yVB49MEHfMWLM3ATJ7rVgyN/revocation
Content-Type: application/json

{ "reason": "USER_ACTION", "initiator": "INDIVIDUAL" }
```

```http
HTTP/1.1 204 No Content
```

That ends the grant, its access tokens and its refresh token: the next request
gets `401 invalid_token`, on the FDX-shaped API and the bank's own API alike.
Revoking the refresh token
([§4.6](https://personalagentprotocol.org/docs/1.0/spec#revocation)), or
disconnecting the agent on the bank's website, ends the consent the same way.

## What the bank controls

- It decides which consent clusters exist and what each unlocks, runs the
  sign-in and the choice of accounts on its own page, and applies the choice to
  the whole grant: the FDX-shaped API, its own API and its Company Agent.
- The consent record and the grant share one ID and one end. A grant without
  `offline_access` ends with its first access token, and a refresh after it gets
  `invalid_grant`. With it, the grant refreshes for 7 days.
- It keeps money movement on its own API, with Operations v3.

## For the technical reader

[Domain extensions](README.md) explains why the extension exists, and
[ESPI: energy data through Poppy](espi.md) follows the same pattern with XML.
[Write a domain extension](../write-an-extension.md) shows how to define one. The contract is [`poppylab.dev/fdx` v1](../../extensions/fdx.md), and
Harborline's side is in [its design note](../../harborline-bank.md#fdx-shaped-api).

To run it, pick **Harborline Bank** in the
[playground](https://poppylab.dev/playground), turn **Use FDX** on, sign in,
share one account and ask for your balance.

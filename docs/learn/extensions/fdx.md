# FDX: bank data through Poppy

Elena Maren is a customer of [Harborline Bank](https://bank-demo.poppylab.dev),
one of Poppy Lab's fictional Companies. She asks Iris, a Personal Agent, for her
balance, her recent transactions and her latest statement, and she shares her
operating checking account and not her savings. Harborline answers through an
API shaped like the Financial Data Exchange (FDX) API, which it lists as
`poppylab.dev/fdx` v1, an experimental extension that Poppy Lab defined.

This page follows that request, one request at a time, for implementers.
[Domain extensions](README.md) explains why the extension exists, and
[ESPI: energy data through Poppy](espi.md) follows the same pattern with XML.

The traffic is from 25 November 2026. The discovery document comes from the
live site. The signed-in steps come from the same Harborline code run
in-process, because they need a fictional customer's consent. Tokens are
redacted and long responses trimmed.

> **FDX-shaped, not FDX-conformant or certified.** The FDX licence forbids
> copying or publishing its specification. Harborline reuses the resource paths
> and field names that public implementers document, and every description,
> rule and error text here is Poppy Lab's own.

## Who does what

| Who                     | What they do in this process                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Elena, the user         | Signs in on Harborline's page, chooses which accounts to share, downloads a statement and revokes the consent from the agent.     |
| Iris, the agent         | Declares the extension, reads accounts, transactions and statements, and keeps the consent ID so the model never has to name it.  |
| Harborline, the Company | Lists the extension, asks Elena which accounts to share, serves those accounts and no others, and ends the consent when she asks. |

## Which request carries what

The model sees none of the credentials. Each request below carries a different
mix:

| Step | Request                                | Session header | Access token | Who decides                 |
| ---- | -------------------------------------- | -------------- | ------------ | --------------------------- |
| 1    | `GET /.well-known/poppy.json`          | no             | no           |                             |
| 2    | any `/fdx/v6/...`, undeclared          | yes            | yes          |                             |
| 3    | `POST /oauth/par`, consent, token      | no             | no           | **the user**, at Harborline |
| 4    | `GET /fdx/v6/accounts`, transactions   | yes            | yes          |                             |
| 5    | an account the user didn't share       | yes            | yes          |                             |
| 6    | statements and their PDF               | yes            | yes          | **the user** downloads      |
| 7    | `PUT /fdx/v6/consents/{id}/revocation` | yes            | yes          | **the user**, in the agent  |

## 1. The bank lists the extension

```http
GET https://bank-demo.poppylab.dev/.well-known/poppy.json
```

```json
{
  "auth": {
    "scopes": {
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
      "url": "https://bank-demo.poppylab.dev/openapi/fdx.json"
    }
  ],
  "extensions": {
    "operations": [{ "version": "3" }],
    "poppylab.dev/fdx": [
      {
        "version": "1",
        "fdx_version": "6.4",
        "base_url": "https://bank-demo.poppylab.dev/fdx/v6",
        "resources": ["customer", "accounts", "transactions", "statements"],
        "consent_endpoint": "https://bank-demo.poppylab.dev/fdx/v6/consents"
      }
    ]
  }
}
```

- **The name carries a domain.** Names without one are reserved for extensions
  defined with the protocol, so anyone else's extension starts with a domain
  they control
  ([§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions)).
- **The agent checks the entry before using it.** `base_url` and
  `consent_endpoint` must be HTTPS URLs on `organization.domain`, with no
  credentials, query or fragment. An entry that fails counts as not listed, and
  the Inspector says why. Otherwise a bank's document could send the agent, its
  Session header and its token somewhere else.
- **Each scope has hints.** All five are
  `{ "changes": "none", "personal_data": true }`: they read, and what they read
  is personal
  ([§4.7](https://personalagentprotocol.org/docs/1.0/spec#scopes)).
- **`apis` lists the FDX-shaped API too.** Harborline's second OpenAPI
  description covers it, so an agent without the extension can still call it.

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

The order matters. Only a new Session that declares the extension can fix this,
so a refresh, a DPoP nonce retry or a fresh sign-in in front of it would be
wasted, and a refused request shouldn't touch any grant or Session. In Iris,
turning **Use FDX** on or off starts a new Session for the same reason.

## 3. Signing in: clusters and accounts

The sign-in is Poppy's usual Direct Sign-In with PAR, PKCE and DPoP
([§4.2](https://personalagentprotocol.org/docs/1.0/spec#direct-sign-in)). Only
the scopes and the consent page change. The agent requests the clusters the
task needs, and Harborline's page adds a list of the chosen customer's accounts,
all ticked by default. Elena unticks the savings account.

Approving FDX scopes with no account at all is turned down rather than granted
empty. The choice holds for the whole grant: if the same sign-in also grants
Harborline's own read scopes, that API sees only the checking account too.

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

`consent_id` is the grant's ID. Other agents ignore a field they don't know
(RFC 6749 §5.1). Iris keeps it, on refresh too, so the model never has to name
it.

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
pages, 100 transactions per call. It tells the model `truncated: true` rather
than reading on. The model never picks an offset, a URL or a header.

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

These are domain errors, and they go to the model, bounded, as
`{ "error": "fdx_error", "status": 404, "code": "701", … }` so it can say
something useful. Protocol errors keep their own handling and never reach the
model as FDX ones: `invalid_session`, `session_ended`, `extension_required`, and
token challenges in `WWW-Authenticate`, which lead to a refresh or a new
sign-in. The transport tells them apart by the known Poppy and OAuth codes and
by the challenge header. An error body with neither is the API's own.

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
document: a small deterministic PDF with the opening and closing balances, the
posted transactions and the fiction notice on every page. A model can't read a
PDF, so the agent's tool returns only what it can use: the size, the type and a
SHA-256. Elena downloads the file from the chat's account row. The bytes go
from the bank to her and never into the model's context.

## 7. Revoking

Revocation is Elena's action, not a tool the model has. Iris shows the consent
in the account row (its ID, status, shared accounts and expiry) with a **Revoke
FDX consent** button that asks again in the page.

```http
PUT https://bank-demo.poppylab.dev/fdx/v6/consents/m0_EuxBp4yVB49MEHfMWLM3ATJ7rVgyN/revocation
Content-Type: application/json

{ "reason": "USER_ACTION", "initiator": "INDIVIDUAL" }
```

```http
HTTP/1.1 204 No Content
```

That ends the grant, its access tokens and its refresh token. The next request
gets `401 invalid_token`, on the FDX-shaped API and the bank's own API alike.
Revoking the refresh token
([§4.6](https://personalagentprotocol.org/docs/1.0/spec#revocation)), or
disconnecting the agent on the bank's website, ends the consent the same way.

## What the bank controls

Harborline stays in charge of its own business throughout.

- It decides which consent clusters exist and what each unlocks. All five
  `fdx:` scopes only read.
- The sign-in and the choice of accounts happen on its own page. An approval
  with no account is turned down.
- It applies the choice to the whole grant: the FDX-shaped API, its own API and
  its Company Agent. An account outside the choice is answered as one that
  doesn't exist.
- The consent record and the grant are one record, with one ID and one end. A
  grant without `offline_access` ends with its first access token, and a refresh
  after it gets `invalid_grant`. With it, the grant refreshes for 7 days.
- It keeps money movement out of this API. Payments and transfers stay on its
  own API, with Operations v3.

## For the technical reader

[Domain extensions](README.md) explains why an extension exists and what stays
with Poppy. [Write a domain extension](../write-an-extension.md) gives the steps
to define one. The contract is [`poppylab.dev/fdx` v1](../../extensions/fdx.md),
and Harborline's side is in
[its design note](../../harborline-bank.md#fdx-shaped-api).

To run it yourself, open the [playground](https://poppylab.dev/playground), pick
**Harborline Bank**, turn **Use FDX** on and sign in. Share one account, then
ask for your balance, your transactions or your statements. The Inspector shows
each request with the scopes it used.

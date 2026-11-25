# Domain extensions: bank data through Poppy

Poppy answers the questions every Company asks an agent: who is this, whose
User is it acting for, and what did that User allow. It deliberately leaves the
domain to someone else. For shopping, the
[UCP extension](https://personalagentprotocol.org/docs/1.0/extensions/ucp)
hands catalog, cart and checkout to the Universal Commerce Protocol. This page
shows the same pattern for banking: `poppylab.dev/fdx` v1, an experimental
extension that Poppy Lab defined, which carries an API shaped like the
Financial Data Exchange (FDX) API. It works end to end between Iris and
[Harborline Bank](https://bank-demo.poppylab.dev), our fictional bank.

> **FDX-shaped, not FDX-conformant or certified.** The FDX licence forbids
> copying or publishing its specification. Harborline reuses the resource paths
> and field names that public implementers document, and every description,
> rule and error text here is our own. The extension itself is written up in
> [`poppylab.dev/fdx` v1](../extensions/fdx.md).

The discovery document comes from the live site. The signed-in steps come from
the same Harborline code run in-process, because they need a fictional
customer's consent. Tokens are redacted and long responses trimmed.

| Step | Request                                | Session header | Access token | Who decides                   |
| ---- | -------------------------------------- | -------------- | ------------ | ----------------------------- |
| 1    | `GET /.well-known/poppy.json`          | no             | no           |                               |
| 2    | any `/fdx/v6/...`, undeclared          | yes            | yes          |                               |
| 3    | `POST /oauth/par`, consent, token      | no             | no           | **the User**, at Harborline   |
| 4    | `GET /fdx/v6/accounts`, transactions   | yes            | yes          |                               |
| 5    | an account the User didn't share       | yes            | yes          |                               |
| 6    | statements and their PDF               | yes            | yes          | **the User** downloads        |
| 7    | `PUT /fdx/v6/consents/{id}/revocation` | yes            | yes          | **the User**, in the agent UI |

## Why an extension, and not just an OpenAPI

A bank can already list an FDX-shaped OpenAPI description in `apis`, and a
Personal Agent can call it with its usual adapter
([§7](https://personalagentprotocol.org/docs/1.0/spec)). Harborline does list
one, so agents without the extension aren't shut out. The extension adds what an
OpenAPI description can't say:

- **The API follows a known shape.** An agent that knows it uses a native client
  instead of reading the description. Our generic adapter stops at 24 tools and
  64 paths and doesn't follow `$ref`, and an FDX-style description goes well past
  both.
- **Scopes mean the same at every bank.** They are FDX's consent data clusters
  (`fdx:ACCOUNT_BASIC`, `fdx:TRANSACTIONS`…), not names each bank invents.
- **The User chooses accounts.** The grant records which ones, and everything
  that grant reaches sees only those: the FDX-shaped routes, the bank's own API
  and its Company Agent.
- **The consent is the grant.** The bank's consent record and the Poppy grant
  begin and end together.

What stays with Poppy, and what moves to the extension:

| Concern                                    | Who handles it                           |
| ------------------------------------------ | ---------------------------------------- |
| Finding the bank, its issuer and its URLs  | Poppy discovery (§3)                     |
| Who the agent and the User are             | Client metadata and the Session (§4, §5) |
| Signing in, scopes, refresh, revocation    | Poppy's OAuth profile (§4)               |
| Moving money                               | The bank's own API, with Operations v3   |
| Accounts, transactions, statements         | The FDX-shaped API                       |
| Which accounts are shared, consent records | The extension, tied to the grant         |

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
  they control (§3.3).
- **The agent checks the entry before using it.** `base_url` and
  `consent_endpoint` must be HTTPS URLs on `organization.domain`, with no
  credentials, query or fragment. An entry that fails counts as not listed, and
  the Inspector says why. Otherwise a bank's document could send the agent, its
  Session header and its token somewhere else.
- **Each scope has hints.** All five are `{ "changes": "none", "personal_data": true }`: they read, and what they read is personal (§4.7).

## 2. Declaring it, or being refused

The agent declares the extension on every request of the Session, next to
Operations (§3.4):

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

The sign-in is Poppy's usual Direct Sign-In with PAR, PKCE and DPoP. Only the
scopes and the consent page change. The agent requests the clusters the task
needs, and Harborline's page adds a list of the chosen customer's accounts, all
ticked by default. The User unticks the savings account. Approving FDX scopes
with no account at all is turned down rather than granted empty. The choice
holds for the whole grant: if the same sign-in also grants Harborline's own
read scopes, that API sees only the checking account too.

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
`/api/account/accounts`. The balances are there because the token
carries `fdx:ACCOUNT_DETAILED`, and a token refreshed without it loses them.
Treating `ACCOUNT_BASIC` as descriptors without balances is how implementing
banks describe it, not something we could check in FDX's own text.

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
model as FDX ones: `invalid_session`, `session_ended`, `extension_required`,
and token challenges in `WWW-Authenticate`, which lead to a refresh or a new
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
SHA-256. The User downloads the file from the chat's account row. The bytes go
from the bank to the User and never into the model's context.

## 7. Revoking

Revocation is the User's action, not a tool the model has. Iris shows the
consent in the account row (its ID, status, shared accounts and expiry) with a
**Revoke FDX consent** button that asks again in the page.

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
Revoking the refresh token (§4.6), or disconnecting the agent on the bank's
website, ends the consent the same way.

## What each side has to get right

**The Company:**

- Refuse undeclared requests with `extension_required` (`403`, JSON body),
  before the token.
- Put the extension's routes behind the Session middleware too. Ours guarded
  only `/api/*` at first, so `/fdx/v6/...` would have run with no Session check
  at all.
- Make each scope one consent cluster, with hints, and check the token's scopes,
  not the grant's.
- Store the User's choice of accounts in the grant, and answer an unshared
  account as if it didn't exist. Apply the choice to every interface the grant
  reaches, not only the extension's routes.
- Keep the domain consent and the Poppy grant one record: same ID, same end.
- Keep writes on Operations. This extension only reads.

**The Personal Agent:**

- Validate the entry's URLs against the Company's origin before sending anything
  there.
- Declare the extension only when it's in use, and start a new Session to change
  that.
- Don't feed the domain API to the generic OpenAPI adapter as well. Recognise it
  by where its server and paths point, because its own URL can be anywhere.
- Build URLs from the entry and validated IDs, never from model input; bound
  paging, sizes and fields.
- Pass domain error bodies to the model, and keep protocol errors on their own
  path.
- Keep documents, consent IDs and revocation out of the model's hands.

## Pitfalls we hit

- **One consent in 32 vanished.** Grant IDs are base64url, and about one in 32
  starts with `-` or `_`. Our ID check wanted a letter or digit first, so for
  those Users the consent was simply "unknown". It looked like a flaky test until we did the arithmetic. We fixed
  it in two places, the adapter and the token response, and then found a third
  copy in the revocation path. Now there is one ID rule, in the adapter, and
  everything uses it.
- **The generic adapter took the wrong API.** Iris used the first OpenAPI entry
  it found. With two listed, the FDX-shaped description could have ended up in
  front of the model as ordinary tools.
- **`Accept` headers merged.** Our transport's default `Accept: application/json` was combined with the caller's `application/pdf`, so the
  statement request asked for both. The defaults are now replaced, not merged.
- **Error bodies were thrown away.** The transport turned every non-2xx response
  into an error with a code and dropped the body, which is right for Poppy errors
  and wrong for `701`.
- **The account choice was bypassable.** At first the choice limited only the
  FDX-shaped routes, and the consent page said so in small print. The same
  sign-in also granted Harborline's own read scopes, and in a test with a real
  model the model preferred that API and told the User the balance of the
  savings account they hadn't shared. From the User's side the choice meant
  nothing. Now the bank applies it to the whole grant, both APIs and the Company
  Agent, and Iris, with Use FDX on, steers the model to the FDX-shaped tools for
  account data.
- **The specification can't be copied.** Check a domain standard's licence
  before you vendor its schemas. FDX's forbids it, so our shapes are written by
  hand from public implementers' documentation.

## Writing your own domain extension

1. **Pick a standard companies already expose**, preferably one built on OAuth.
   The extension's job is to put Poppy's identity and consent in front of it, not
   to invent a domain model.
2. **Name it with your domain** and version it by major version (§3.3).
3. **Define the entry**: the URLs the agent needs, all on the Company's origin.
4. **Map the domain's consent vocabulary to scopes**, with hints, and say what
   each one unlocks.
5. **Tie the domain's consent to the grant**: one ID, one lifecycle, revocable
   from both sides.
6. **Leave changes to Operations**, so the User approves exact terms.
7. **Write down what it doesn't cover.** For us that's money movement, tax
   documents and data-recipient registration, plus open questions about field
   names we couldn't verify.

Other domains where this pattern seems promising are health records (HL7 FHIR
with SMART on FHIR, which already uses OAuth scopes), energy usage (Green
Button), and telecom accounts (TM Forum Open APIs).

## Try it

Open the [playground](https://poppylab.dev/playground), pick **Harborline
Bank**, turn **Use FDX** on and sign in. Share one account, then ask for your
balance, your transactions or your statements. The Inspector shows each
request with the scopes it used. The full contract is in
[the extension](../extensions/fdx.md), and Harborline's side is in
[its design note](../harborline-bank.md#fdx-shaped-api).

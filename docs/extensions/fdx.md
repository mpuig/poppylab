# Extension draft: `poppylab.dev/fdx` v1

**Status:** experimental, defined by Poppy Lab, not proposed upstream. Version `1`, read-only.

This extension lets a Company that already speaks an API shaped like the Financial Data Exchange (FDX) API offer it to Personal Agents through Personal Agent Protocol 1.0. It follows the pattern of the [UCP extension](https://personalagentprotocol.org/docs/1.0/extensions/ucp): this protocol handles discovery, Personal Agent identity, the Session and sign-in, and the FDX-shaped API carries the financial data. Harborline Bank implements the Company side ([Harborline](../harborline-bank.md#fdx-shaped-api)), `packages/pap-client/src/fdx.ts` the Personal Agent side ([OpenAPI tools](../openapi-tools.md#fdx-shaped-apis-a-native-adapter)).

> **FDX-shaped, not FDX-conformant or certified.** Paths and field names follow the shape that public FDX implementers use. Every rule, description and error text here is Poppy Lab's own. The FDX API License Agreement forbids copying or publishing the FDX specification, so no FDX specification text or schema is in this repository, and nothing here uses FDX branding. Whether reusing bare paths and field names is enough to stay clear of that licence is a legal question this project hasn't settled.

## Why an extension

A Company can already list an FDX-shaped OpenAPI description in `apis` (§7), and a Personal Agent could call it with a generic OpenAPI adapter. An extension adds what an OpenAPI description can't say:

- that the API follows a known domain shape, so a Personal Agent can use a native client instead of interpreting the description;
- scopes that mean the same at every Company: FDX's consent data clusters;
- which accounts the User chose to share, carried in the grant;
- the FDX consent record, tied to the Poppy grant's lifecycle.

## Discovery

The Company lists the extension in `poppy.json` (§3.3):

```json
"extensions": {
  "poppylab.dev/fdx": [
    {
      "version": "1",
      "fdx_version": "6.4",
      "base_url": "https://bank.example/fdx/v6",
      "resources": ["customer", "accounts", "transactions", "statements"],
      "consent_endpoint": "https://bank.example/fdx/v6/consents"
    }
  ]
}
```

| Field              | Req. | Meaning                                                                                                            |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `version`          | Yes  | `1`.                                                                                                               |
| `base_url`         | Yes  | Where the FDX-shaped resources are. An HTTPS URL on `organization.domain`, with no credentials, query or fragment. |
| `consent_endpoint` | Yes  | Where consent records are, under the same rules.                                                                   |
| `fdx_version`      | No   | The FDX release the shape follows. Informational.                                                                  |
| `resources`        | No   | The resource kinds served. Informational.                                                                          |

A Personal Agent MUST treat an entry whose `base_url` or `consent_endpoint` is on another origin, uses another scheme, or carries credentials, a query or a fragment as not listed. It MUST NOT follow redirects from these URLs (§3). The Company MAY also list its FDX-shaped OpenAPI description in `apis`, so that Personal Agents without the extension can still use it. A Personal Agent with the extension SHOULD NOT also pass that description to a generic OpenAPI adapter.

## Declaring

A Personal Agent that uses the extension declares it on every request of the Session: `Poppy-Extensions: "poppylab.dev/fdx";v="1"`, alongside any others, such as `"operations";v="3"` (§3.4). The Company refuses requests to the FDX-shaped routes that don't declare it with `403 {"error":"extension_required","extension":"poppylab.dev/fdx"}` (§3.3). It does so before looking at the access token, since only a new Session can fix the declaration.

## Scopes

Each FDX consent data cluster is a scope, described in `auth.scopes` and hinted as `{ "changes": "none", "personal_data": true }` (§4.7):

| Scope                  | Allows                                                   |
| ---------------------- | -------------------------------------------------------- |
| `fdx:ACCOUNT_BASIC`    | List and read the chosen accounts, without balances      |
| `fdx:ACCOUNT_DETAILED` | Adds `currentBalance`, `availableBalance`, `balanceAsOf` |
| `fdx:TRANSACTIONS`     | Read a chosen account's transactions                     |
| `fdx:STATEMENTS`       | List a chosen account's statements and download them     |
| `fdx:CUSTOMER_CONTACT` | Read the customer's name and email                       |

FDX's own definitions of the clusters are gated behind registration. Reading `ACCOUNT_BASIC` as descriptors without balances and `ACCOUNT_DETAILED` as adding balances follows what implementing banks publish. It is this extension's rule, not FDX's. The Company applies the scopes of the token in hand, so a token refreshed with fewer scopes loses balances.

## Sign-in and consent

- **Accounts are chosen at consent.** When a sign-in requests any `fdx:*` scope, the Company's consent page asks which accounts to share. The grant records them, and the FDX-shaped routes see only those. A Company SHOULD apply the choice to every interface the grant reaches, such as its own API and its Company Agent, and not only to the FDX-shaped routes: a User who shares one account expects the agent to see and act on that one only, whichever API it calls. Harborline does. A Company SHOULD turn down an approval of `fdx:*` scopes with no account chosen rather than grant empty access.
- **The consent is the grant.** The consent ID is the grant's ID. The Company returns it as `consent_id` in every token response of a grant with `fdx:*` scopes, at the code exchange and at refresh. Other Personal Agents ignore the field (RFC 6749 §5.1).
- **Revocation works both ways.** Revoking the consent ends the grant, its access tokens and its refresh token. Revoking the refresh token (§4.6) or disconnecting the agent at the Company ends the consent. Revoking is the User's choice, like sign-out: a Personal Agent offers it in its own interface, not as a tool for its model. Iris offers it in the chat's account row ([Use FDX](../openapi-tools.md#in-the-playground-use-fdx)).
- **Security.** Direct Sign-In only, with PKCE, `private_key_jwt` and DPoP-bound tokens, and PAR offered. This resembles the FAPI 2.0 style that FDX's security profile describes, but it hasn't been checked against FDX.

## Resources

Relative to `base_url`:

| Route                                                | Scope                  |
| ---------------------------------------------------- | ---------------------- |
| `GET /accounts`                                      | `fdx:ACCOUNT_BASIC`    |
| `GET /accounts/{accountId}`                          | `fdx:ACCOUNT_BASIC`    |
| `GET /accounts/{accountId}/transactions`             | `fdx:TRANSACTIONS`     |
| `GET /accounts/{accountId}/statements`               | `fdx:STATEMENTS`       |
| `GET /accounts/{accountId}/statements/{statementId}` | `fdx:STATEMENTS`       |
| `GET /customers/current`                             | `fdx:CUSTOMER_CONTACT` |

Relative to `consent_endpoint`, with any token of that consent:

| Route                         | Answers                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `GET /{consentId}`            | The consent record                                        |
| `PUT /{consentId}/revocation` | `204`; body `{ "reason": "USER_ACTION", "initiator": … }` |

Response shapes:

- **Account:** `accountId`, `accountCategory` (`DEPOSIT_ACCOUNT`), `accountType` (`CHECKING`, `SAVINGS`), `productName`, `nickname`, `accountNumberDisplay` (last four digits), `status` (`OPEN`, `CLOSED`) and `currency.currencyCode`, plus the balances above.
- **Lists:** `{ "accounts": [...] }` for the list and the bare account for one, not wrapped by account type.
- **Transactions:** `{ "transactions": [...], "page": { "nextOffset"?, "totalElements" } }`. `amount` is an absolute number, with the direction in `debitCreditMemo` (`DEBIT`, `CREDIT`). `status` is `POSTED` or `PENDING`, and `transactionTimestamp` is always present, `postedTimestamp` only when posted. `startTime` and `endTime` are inclusive `YYYY-MM-DD` days. `offset` and `limit` page the results, and `nextOffset` is a decimal string, absent on the last page.
- **Statements:** `{ "statements": [...], "page": { "nextOffset"?, "totalElements" } }`, newest first, with the same `startTime`, `endTime`, `offset` and `limit` as transactions; the dates select statement dates. Each item has `statementId`, `accountId`, `statementDate` (`YYYY-MM-DD`), `description` and `status` (`AVAILABLE`). A Company MAY add fields of its own; Harborline adds `startDate` and `endDate`, the days its cycle covers.
- **Statement document:** the document itself, in the format the `Accept` header asks for. Version 1 defines `application/pdf` only. A request whose `Accept` takes no PDF (`application/pdf`, `application/*` or `*/*`; no `Accept` at all takes anything) gets `406` with an error body as below. The document is personal data: the Company SHOULD send `Cache-Control: no-store` and `Content-Disposition: attachment`. A Personal Agent MUST bound the size it reads and check that the body is what it asked for (a PDF starts with `%PDF-`). A model can't read a PDF, and a document is Company content (§10.1), so a Personal Agent SHOULD NOT pass its bytes to a model; it gives the User the file instead.
- **Customer:** `{ "customerId", "name": { "first", "middle"?, "last" }, "email": [...] }`.
- **Consent:** `id`, `status` (`ACTIVE`, `EXPIRED`, `REVOKED`), `parties` (`{ name, type }` with `DATA_PROVIDER` and `DATA_RECIPIENT`), `createdTime`, `expirationTime`, `durationType` (`TIME_BOUND` or `ONE_TIME`), `durationPeriod` in days, and `resources` (`{ resourceType: "ACCOUNT", resourceId, dataClusters }`).

Responses are Company content (§10.1). A Personal Agent keeps only the fields it knows, bounds their sizes, and never takes URLs, headers or tokens from them or from model input.

## Errors

On the FDX-shaped routes, errors have the body `{ "code", "message", "debugMessage"? }` with `code` a string:

| Situation                                         | Response  |
| ------------------------------------------------- | --------- |
| Account doesn't exist or wasn't chosen at consent | `404 701` |
| Malformed or inverted date range                  | `400 703` |
| Customer not authorized                           | `401 602` |

A statement that doesn't exist in a chosen account, and an `Accept` the Company can't serve, have no verified FDX code; Harborline answers `404 statement_not_found` and `406 not_acceptable`, codes of its own.

The Company never says whether an account it won't show exists. A consent of another grant is not found either. Session, version, extension and token errors stay the protocol's (§7): `invalid_session`, `session_ended`, `version_unsupported`, `extension_required`, and OAuth challenges in `WWW-Authenticate`.

## Not covered

- **Writes and money movement.** Payments and transfers stay on the Company's own API with Operations v3. A later version could cover FDX-shaped money movement, requiring Operations for every write.
- **Tax documents, investments, loans and other account categories.** Statements are covered as monthly PDF documents; other formats and statement images are not.
- **Data-recipient registration.** In FDX ecosystems the party receiving data registers with a provider or a registry. Here the Personal Agent's verified `client_id` (§4.1) is the only identity. Whether a provider should also require a registry entry, and how that would meet rules such as the CFPB's §1033 authorization disclosures, is open.
- **Agent-specific consent semantics.** FDX opened an [agentic AI initiative](https://financialdataexchange.org/agentic-ai-open-finance-technical-standards/) in April 2026, covering agent identity, delegation and data minimization. It has published no standard yet. This extension should follow it when it does.

## Open questions

- Several field names come from public implementers, not from the gated FDX specification: the customer fields, `parties[].type`, `durationPeriod` in days, `nextOffset` as a string, and the statement fields (`statementId`, `statementDate`, `description`, `status`). Whether FDX defines a field for a statement's period, its own error codes for an unknown statement or an unservable `Accept`, or formats besides PDF hasn't been checked. FDX 6.4 also deprecates `offset` paging in favour of `pageKey`. Version 1 keeps `offset` for simplicity.
- Harborline's consent record always reads `ACTIVE`, because a revoked or expired grant's tokens can no longer reach it. Reporting `REVOKED` or `EXPIRED` would need a record of ended grants.
- Linking an account for the first time at a bank is the subject of an open upstream proposal ([#79](https://github.com/personal-agent-protocol/personal-agent-protocol/issues/79)), which could change how this extension's sign-in starts.

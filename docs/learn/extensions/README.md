# Domain extensions

How does a domain standard such as FDX or ESPI reach an agent through Poppy?

A Company that already serves its data in a domain's standard lists that API in
`poppy.json` as an extension. Poppy keeps who the agent is, which user it acts
for and what that user allowed. The extension points at the standard's own API
for the data and ties the domain's consent to the Poppy grant, so the two begin
and end together.

## What a domain extension is

Poppy leaves the domain to someone else. For shopping, the
[UCP extension](https://personalagentprotocol.org/docs/1.0/extensions/ucp)
hands catalog, cart and checkout to the Universal Commerce Protocol. A domain
extension does the same for another domain. It is an entry under `extensions` in
the discovery document
([§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions)), named
with a domain its author controls, such as `poppylab.dev/fdx`. The entry says
where the domain's API is. The agent declares the extension on every request
that uses it, and the Company refuses a request that doesn't.

At Harborline, the work divides like this:

| Concern                                    | Who handles it                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finding the bank, its issuer and its URLs  | Poppy discovery ([§3](https://personalagentprotocol.org/docs/1.0/spec#discovery))                                                                             |
| Who the agent and the user are             | Client metadata and the Session ([§4](https://personalagentprotocol.org/docs/1.0/spec#oauth), [§5](https://personalagentprotocol.org/docs/1.0/spec#sessions)) |
| Signing in, scopes, refresh, revocation    | Poppy's OAuth profile (§4)                                                                                                                                    |
| Moving money                               | The bank's own API, with [Operations v3](https://personalagentprotocol.org/docs/1.0/extensions/operations)                                                    |
| Accounts, transactions, statements         | The FDX-shaped API                                                                                                                                            |
| Which accounts are shared, consent records | The extension, tied to the grant                                                                                                                              |

## The lab's two examples

Poppy Lab has built two. Both are experimental extensions that the lab defined,
and both only read. `poppylab.dev/fdx` v1 carries bank data as JSON in the
shape of FDX 6.4, at [Harborline Bank](https://bank-demo.poppylab.dev), a
fictional bank. `poppylab.dev/espi` v1 carries hourly meter readings and bills
as Atom XML in the shape of NAESB REQ.21 ESPI, at
[Fernwick Power & Light](https://energy-demo.poppylab.dev), a fictional
electricity utility.

> **FDX-shaped, not FDX-conformant or certified. ESPI-shaped (modelled on NAESB
> REQ.21 ESPI), not certified.** The FDX licence forbids copying or publishing
> its specification. Harborline reuses the resource paths and field names that
> public implementers document, and every description, rule and error text is
> Poppy Lab's own. The ESPI schemas are Apache-2.0, so Fernwick reuses their
> element names and codes. The REQ.21 text is NAESB's, and none of it is here.

## Why an extension, and not just an OpenAPI description

A bank can already list an FDX-shaped OpenAPI description in `apis`, and a
Personal Agent can call it with its usual adapter
([§7](https://personalagentprotocol.org/docs/1.0/spec#apis)). Harborline lists
one, so agents without the extension aren't shut out. For an API that is the
Company's own, with its own scopes, that is the right choice: Lantern's menu and
orders need no extension. It stops being enough when a standard already defines
the API and its consent. The extension adds what an OpenAPI description can't
say:

- **The API follows a known shape.** An agent that knows it uses a native client
  instead of reading the description. Iris's generic adapter stops at 24 tools
  and 64 paths and doesn't follow `$ref`, and an FDX-style description goes well
  past both.
- **Scopes mean the same at every bank.** They are FDX's consent data clusters
  (`fdx:ACCOUNT_BASIC`, `fdx:TRANSACTIONS`…), not names each bank invents.
- **The user chooses accounts.** The grant records which ones, and everything
  that grant reaches sees only those: the FDX-shaped routes, the bank's own API
  and its Company Agent.
- **The consent is the grant.** The bank's consent record and the Poppy grant
  begin and end together.

## How the pattern held across two domains

Energy data followed the bank's pattern. Discovery lists the extension, the
agent declares it on every request, sign-in carries the domain's scopes, a
choice made at consent holds for the whole grant, the domain's consent is the
grant, and writes stay with Operations. What changed is the shape of the data,
and that moves work between the Company, the agent and the model.

| Question                 | Bank data (FDX-shaped)                              | Energy data (ESPI-shaped)                                  |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| Format                   | JSON, with an OpenAPI description in `apis`         | Atom XML, with no OpenAPI description                      |
| What the user chooses    | Accounts                                            | Meters                                                     |
| What carries the consent | `consent_id` in the token response                  | `resourceURI` and `authorizationURI` in the token response |
| What the model sees      | Accounts, transactions, a statement's size and hash | Totals per day in kWh and dollars, never an interval       |
| How the user revokes     | `PUT` to the consent's `revocation`                 | `DELETE` of the authorization                              |

XML is the largest change. ESPI has no JSON and no OpenAPI description, so
there is nothing for the generic adapter to read and the agent needs a parser.
The parser is strict, because a Company's XML is untrusted input. It refuses
document type declarations, any entity beyond the five predefined ones and
processing instructions, and it bounds size, depth and element count.

The second change is volume. A meter reports an interval an hour, which is 2,208
per reading over the longest window, and a model can't use that. The agent adds
the intervals up before the model sees anything, in kWh and dollars per day in
the utility's local time.

The consent differs because the standards do. ESPI has a subscription, which a
third party reads, and an authorization, which it manages. Here both are the
Poppy grant, and they arrive with the token. ESPI speaks of updating or deleting
the authorization without settling the method, so the extension chose `DELETE`.

## Other domains that look promising

The pattern suits a domain where a standard exists and already builds on OAuth.
Two candidates are health records, where HL7 FHIR with SMART on FHIR already
uses OAuth scopes, and telecom accounts, where TM Forum Open APIs define the
interfaces. The lab has built neither.

## Go deeper

- [FDX: bank data through Poppy](fdx.md) follows Harborline, request by request.
- [ESPI: energy data through Poppy](espi.md) does the same for Fernwick.
- [Write a domain extension](../write-an-extension.md) gives the steps to define
  one.
- The contracts are [`poppylab.dev/fdx` v1](../../extensions/fdx.md) and
  [`poppylab.dev/espi` v1](../../extensions/espi.md).
- The specification defines extensions in
  [§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions).

# Domain extensions

How does a domain standard such as FDX or ESPI reach an agent through Poppy?

A Company that already serves its data in a domain's standard lists that API in
`poppy.json` ([§3](https://personalagentprotocol.org/docs/1.0/spec#discovery))
as an extension. Poppy keeps who the agent is, which user it acts for
([§5](https://personalagentprotocol.org/docs/1.0/spec#sessions)) and what that
user allowed ([§4](https://personalagentprotocol.org/docs/1.0/spec#oauth)). The
extension ties the domain's consent to that grant, so the two begin and end
together.

## What a domain extension is

Poppy leaves the domain to someone else: the
[UCP extension](https://personalagentprotocol.org/docs/1.0/extensions/ucp)
hands shopping to the Universal Commerce Protocol, and a domain extension does
the same for another domain. It is an entry under `extensions` in the discovery
document ([§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions)),
named with a domain its author controls, such as `poppylab.dev/fdx`. The agent
declares it on every request that uses it, and the Company refuses a request
that doesn't.

![Three columns say who handles each concern when bank data reaches an agent through an FDX-shaped extension at Harborline. Poppy handles discovery of the bank, its issuer and its URLs, who the agent and user are through client metadata and the Session, and signing in with scopes, refresh and revocation. The extension adds FDX's consent clusters as scopes, which accounts are shared, and a consent record tied to the grant, and it points at the bank's API. That API, the FDX-shaped one for accounts, transactions and statements, stays with the bank, as does moving money, through the bank's own API with Operations v3.](../../../apps/playground/public/learn-media/diagrams/extension-split.svg "Poppy handles who the agent is and how it signs in, the extension ties the domain's consent to the grant, and the bank keeps its own API and the moving of money.")

## The lab's two examples

Poppy Lab has built two experimental, read-only extensions. `poppylab.dev/fdx`
v1 carries bank data shaped like FDX 6.4, at
[Harborline Bank](https://bank-demo.poppylab.dev), a fictional bank.
`poppylab.dev/espi` v1 carries hourly meter readings and bills shaped like
NAESB REQ.21 ESPI, at
[Fernwick Power & Light](https://energy-demo.poppylab.dev), a fictional
electricity utility.

> **FDX-shaped, not FDX-conformant or certified. ESPI-shaped (modelled on NAESB
> REQ.21 ESPI), not certified.** The FDX licence forbids copying or publishing
> its specification, so Harborline reuses the resource paths and field names
> that public implementers document and writes every description, rule and error
> text itself. The ESPI schemas are Apache-2.0, so Fernwick reuses their element
> names and codes. The REQ.21 text is NAESB's, and none of it is here.

## Why an extension, and not just an OpenAPI description

A bank can list an FDX-shaped OpenAPI description in `apis`, which a
Personal Agent calls with its usual adapter
([§7](https://personalagentprotocol.org/docs/1.0/spec#apis)). For the Company's
own API that is the right choice: Lantern's menu and orders need no extension.
When a standard already defines the API and its consent, the extension adds what
an OpenAPI description can't say:

- **The API follows a known shape.** An agent that knows it uses a native client
  instead of reading the description. Iris's generic adapter stops at 24 tools
  and 64 paths and doesn't follow `$ref`, and an FDX-style description exceeds
  both.
- **Scopes mean the same at every bank.** They are FDX's consent data clusters
  (`fdx:ACCOUNT_BASIC`, `fdx:TRANSACTIONS`…), not names each bank invents.
- **The user chooses accounts.** The choice holds for everything the grant
  reaches: the FDX-shaped routes, the bank's own API and its Company Agent.

## How the pattern held across two domains

Energy data followed the bank's pattern, with writes left to
[Operations v3](https://personalagentprotocol.org/docs/1.0/extensions/operations).
The data's shape moves work between the Company, the agent and the model.

| Question                      | Bank data (FDX-shaped)                              | Energy data (ESPI-shaped)                            |
| ----------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Format                        | JSON, with an OpenAPI description in `apis`         | Atom XML, with no OpenAPI description                |
| Consent in the token response | `consent_id`                                        | `resourceURI` and `authorizationURI`                 |
| What the model sees           | Accounts, transactions, a statement's size and hash | Totals per day in kWh and dollars, never an interval |
| How the user revokes          | `PUT` to the consent's `revocation`                 | `DELETE` of the authorization                        |

XML needs a strict parser, because a Company's XML is untrusted input. Volume is
the second change. A meter reports an interval an hour, 2,208 over the longest
window, and a model can't use that.

ESPI has a subscription, which a third party reads, and an authorization, which
it manages. Here both are the Poppy grant. ESPI leaves the method for updating
or deleting the authorization open, so the extension chose `DELETE`.

## Other domains that look promising

The pattern suits a domain whose standard already builds on OAuth. Two
candidates are health records (HL7 FHIR with SMART on FHIR) and telecom accounts
(TM Forum Open APIs). The lab has built neither.

## Go deeper

- [FDX: bank data through Poppy](fdx.md) and
  [ESPI: energy data through Poppy](espi.md) follow each request.
- [Write a domain extension](../write-an-extension.md) gives the steps.
- The contracts are [`poppylab.dev/fdx` v1](../../extensions/fdx.md) and
  [`poppylab.dev/espi` v1](../../extensions/espi.md).

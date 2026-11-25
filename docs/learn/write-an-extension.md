# Write a domain extension

This guide shows how to carry a domain standard through a Poppy extension. It
is for the author of a Company that serves the standard's API and, in its last
part, for the author of a Personal Agent that uses the extension. It assumes you
have read [Domain extensions](extensions/README.md) for the reasoning.

## Before you start

- **Pick a standard that companies already expose, preferably one built on
  OAuth.** The extension puts Poppy's identity and consent in front of a domain
  API. It doesn't invent a domain model.
- **Check the standard's licence before you vendor its schemas or text.** The
  FDX licence forbids copying or publishing its specification, so Harborline
  writes its shapes by hand from what public implementers document. The ESPI
  schemas are Apache-2.0, so Fernwick reuses their element names and codes.
- **Choose a domain you control.** It becomes the start of the extension's name.
- **Have a Company that supports Poppy.** The extension builds on discovery, the
  Session and sign-in. [Build a Company](build-a-company.md) shows how.

## Define the extension

1. **Name the extension with your domain and version it by major version.**
   Names without a domain are reserved for extensions defined with the protocol
   ([§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions)). The
   agent declares the name and the version on every request that uses it:

   ```http
   Poppy-Extensions: "operations";v="3", "example.com/acme";v="1"
   ```

2. **Define the entry with the URLs the agent needs, all on the Company's
   origin.** Make each an HTTPS URL on `organization.domain`, with no
   credentials, query or fragment. Otherwise your document could send the agent,
   its Session header and its token somewhere else. FDX's entry has `base_url`
   and `consent_endpoint`, and ESPI's has `resource_endpoint`. Fields such as the
   standard's release are informational.

   ```json
   "extensions": {
     "operations": [{ "version": "3" }],
     "example.com/acme": [
       { "version": "1", "resource_endpoint": "https://company.example/acme/v1" }
     ]
   }
   ```

   You know it works when Iris's Inspector shows the extension as listed for
   your Company. If an entry fails the checks above, the Inspector says why.

3. **Map the domain's consent vocabulary to scopes, one scope for each consent
   cluster.** Scopes that mean the same at every Company let an agent ask for
   the same thing everywhere. Describe each scope for the person approving, say
   what it unlocks and give it hints
   ([§4.7](https://personalagentprotocol.org/docs/1.0/spec#scopes)). FDX's
   clusters become `fdx:ACCOUNT_BASIC`, `fdx:TRANSACTIONS` and so on. Fernwick
   names three scopes for ESPI's function blocks, such as `espi:usage`.

   ```json
   "scope_hints": {
     "espi:usage": { "changes": "none", "personal_data": true }
   }
   ```

   You know it works when a token with one of your scopes gets
   `403 insufficient_scope` on the routes of another.

4. **Tie the domain's consent to the grant: one ID, one lifecycle, revocable
   from both sides.** Return the domain's consent ID in every token response of
   a grant with the extension's scopes, at the code exchange and at every
   refresh. FDX returns `consent_id`, and ESPI returns `resourceURI` and
   `authorizationURI`. Agents ignore a field they don't know (RFC 6749 §5.1),
   and one that knows it keeps it, so the model never names it. Revoking the
   domain consent, revoking the refresh token
   ([§4.6](https://personalagentprotocol.org/docs/1.0/spec#revocation)) or
   disconnecting the agent each ends the grant, its access tokens and its
   refresh token.

   You know it works when, after the domain's revocation call, the next request
   gets `401 invalid_token` on every API the grant reaches.

5. **Leave changes to Operations, so the user approves exact terms.** Keep the
   extension read-only, as both of the lab's are. [Approvals](operations.md)
   explains what Operations adds.

6. **Write down what the extension doesn't cover.** A reader can't see the
   boundary from the API. FDX's contract lists money movement, tax documents and
   data-recipient registration, with open questions about field names that
   couldn't be verified. Say once that the API is shaped like the standard and
   isn't certified, and leave out the standard's branding.

## What the Company must do

- Refuse undeclared requests with `extension_required` (`403`, JSON body),
  before you look at the token. Only a new Session that declares the extension
  can fix the request, so nothing else should be tried or touched.
- Put the extension's routes behind the Session check too. A check on your own
  API's prefix alone leaves the extension's routes running with no Session.
- Make each scope one consent cluster, with hints, and check the token's scopes,
  not the grant's. A token refreshed without a scope loses what it unlocked.
- Store the user's choice of accounts or meters in the grant, and answer a
  resource outside it as if it didn't exist. Turn down an approval with nothing
  chosen rather than grant empty access.
- Apply the choice to every interface the grant reaches: the extension's routes,
  your own API and your Company Agent. A user who shares one account expects the
  agent to see and act on that one only, whichever API it calls.
- Keep the domain consent and the Poppy grant one record, with the same ID and
  the same end. A record that says `ONE_TIME` ends with the first access token.
  A grant without `offline_access` ends there, and a refresh after it gets
  `invalid_grant`.
- Keep protocol errors in their own codes: `invalid_session`, `session_ended`,
  `extension_required`, `insufficient_scope` and token challenges in
  `WWW-Authenticate`. Give the domain's own errors bodies without those codes,
  because the agent tells the two apart by them.
- Send `Cache-Control: no-store` with documents that carry personal data; both
  contracts ask for it.
- Keep writes on Operations. The extension only reads.

## What the Personal Agent must do

- Validate the entry's URLs against the Company's origin before you send
  anything there. Treat a failing entry as not listed, and don't follow
  redirects from it.
- Declare the extension only while it is in use, and start a new Session to
  change that. The Company refuses undeclared requests, and only a new Session
  fixes that.
- Keep the domain API out of the generic OpenAPI adapter. Recognise it by where
  its server and paths point, because its own URL can be anywhere. Otherwise
  the domain API's description can reach the model as ordinary tools.
- Build URLs from the entry and validated IDs, never from model input. Bound
  paging, sizes and fields.
- Validate every ID with one rule, used wherever you read, store or build a URL
  from one. Grant IDs are base64url, so one can start with `-` or `_`, and a
  check that wants a letter or digit first rejects about one in 32.
- Replace default headers with the caller's, never merge them. A request that
  asks for `application/pdf` sends only that `Accept`, not `application/json`
  as well.
- Keep the body of an error that isn't the protocol's. Drop bodies only for
  known Poppy and OAuth errors. Pass a domain error such as FDX `701` to the
  model, bounded, so it can say something useful, and keep protocol errors on
  their own path to a refresh, a new Session or a new sign-in.
- Treat the Company's responses as untrusted content
  ([§10.1](https://personalagentprotocol.org/docs/1.0/spec#untrusted-content)).
  Parse XML with a strict parser that refuses document type declarations,
  entities beyond the five predefined and processing instructions, and bound
  size, depth and element count.
- Add up high-volume data before the model sees it. One ESPI meter reports 2,208
  intervals over the longest window, so Iris returns kWh and dollars per local
  day and never a raw interval.
- Keep documents, consent IDs and revocation out of the model's hands. Give the
  user the file, keep the ID yourself and offer revocation in your own
  interface.
- Steer the model to the extension's tools for the domain's data when the
  Company's own API offers it too. Make it a preference, not a block: the
  Company applies the user's choice to both APIs.

## Check your work

- A request under the extension's URL without the declaration gets
  `403 extension_required`, and the token is never read.
- A token without a cluster's scope gets `403 insufficient_scope` on that
  cluster's routes.
- A resource outside the user's choice gets `404` on the extension's routes and
  on your own API.
- Every token response of the grant carries the domain's consent ID, at the code
  exchange and at every refresh.
- A grant without `offline_access` can't refresh after its first access token.
- Revoking the domain consent ends the grant: the next request, on every API,
  gets `401 invalid_token`.
- A Personal Agent that doesn't know the extension still works with your
  Company as before.

## Go deeper

- [Domain extensions](extensions/README.md) explains why a domain extension is
  built this way.
- [FDX: bank data through Poppy](extensions/fdx.md) and
  [ESPI: energy data through Poppy](extensions/espi.md) follow each example,
  request by request.
- The contracts, [`poppylab.dev/fdx` v1](../extensions/fdx.md) and
  [`poppylab.dev/espi` v1](../extensions/espi.md), are models for your own.
- [Build a Company](build-a-company.md) and
  [Build a Personal Agent](build-an-agent.md) cover the rest of each side.
- The specification defines extensions in
  [§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions).

# Write a domain extension

This guide shows how to carry a domain standard through a Poppy extension. It is
for the author of a Company that serves the standard's API and, in its last
part, of a Personal Agent that uses the extension. It assumes you have read
[Domain extensions](extensions/README.md) for the reasoning.

## Before you start

- **Pick a standard that companies already expose, preferably one built on
  OAuth.** The extension puts Poppy's identity and consent in front of it; it
  doesn't invent a domain model.
- **Check the standard's licence before you vendor its schemas or text.** The
  FDX licence forbids copying or publishing its specification, so Harborline
  writes its shapes by hand.
- **Choose a domain you control.** It starts the extension's name.
- **Have a Company that supports Poppy**, with discovery, the Session and
  sign-in. [Build a Company](build-a-company.md) shows how.

## Define the extension

1. **Name the extension with your domain and version it by major version.**
   Names without a domain are reserved for the protocol's own extensions
   ([§3.3](https://personalagentprotocol.org/docs/1.0/spec#extensions)). The
   agent declares the name and the version on every request that uses it and no
   other:

   ```http
   Poppy-Extensions: "operations";v="3", "example.com/acme";v="1"
   ```

2. **Define the entry with the URLs the agent needs, all on the Company's
   origin.** Make each an HTTPS URL on `organization.domain`, with no
   credentials, query or fragment, or your document could send the agent, its
   Session header and its token somewhere else. Other fields, such as the
   standard's release, are informational.

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
   cluster,** so that an agent asks for the same thing at every Company.
   Describe each scope for the person approving, say what it unlocks and give it
   hints ([§4.7](https://personalagentprotocol.org/docs/1.0/spec#scopes)).

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
   `authorizationURI`. Agents ignore a field they don't know (RFC 6749 §5.1).
   Revoking the domain consent, revoking the refresh token
   ([§4.6](https://personalagentprotocol.org/docs/1.0/spec#revocation)) or
   disconnecting the agent each ends the grant, its access tokens and its
   refresh token.

   You know it works when, after the domain's revocation call, the next request
   gets `401 invalid_token` on every API the grant reaches.

5. **Keep the extension read-only and leave changes to Operations, so the user
   approves exact terms.** [Approvals](operations.md) explains what Operations
   adds.

6. **Write down what the extension doesn't cover,** because a reader can't see
   the boundary from the API. FDX's contract lists money movement, tax documents
   and data-recipient registration. Say once that the API is shaped like the
   standard and isn't certified, and leave out the standard's branding.

## What the Company must do

- Refuse undeclared requests with `extension_required` (`403`, JSON body),
  before you look at the token. Only a new Session that declares the extension
  fixes the request, so try and touch nothing else.
- Put the extension's routes behind the Session check too. A check on your own
  API's prefix alone leaves them running with no Session.
- Check the token's scopes, not the grant's. A token refreshed without a scope
  loses what it unlocked.
- Store the user's choice of accounts or meters in the grant, and apply it to
  every interface the grant reaches: the extension's routes, your own API and
  your Company Agent. Answer a resource outside it with `404`, as if it didn't
  exist, and turn down an approval with nothing chosen.
- Keep protocol errors in their own codes: `invalid_session`, `session_ended`,
  `extension_required`, `insufficient_scope` and token challenges in
  `WWW-Authenticate`. Give the domain's own errors bodies without those codes,
  because the agent tells the two apart by them.
- End a `ONE_TIME` consent record with the first access token. A grant without
  `offline_access` ends there too, and a refresh after it gets `invalid_grant`.
- Send `Cache-Control: no-store` with documents that carry personal data.

## What the Personal Agent must do

- Validate the entry's URLs against the Company's origin before you send
  anything there. Treat a failing entry as not listed, and don't follow
  redirects from it.
- Start a new Session when you turn the extension on or off.
- Keep the domain API out of the generic OpenAPI adapter, or its description
  reaches the model as ordinary tools. Recognise it by where its server and
  paths point, because its own URL can be anywhere.
- Build URLs from the entry and from IDs, never from model input, and bound
  paging, sizes and fields. Validate every ID with one rule, wherever you read,
  store or build a URL from one. Grant IDs are base64url, so one can start with
  `-` or `_`, and a check that wants a letter or digit first rejects about one
  in 32.
- Replace default headers with the caller's, never merge them. A request that
  asks for `application/pdf` sends only that `Accept`, not `application/json`
  as well.
- Keep protocol errors on their own path to a refresh, a new Session or a new
  sign-in, and pass the body of any other error, such as FDX `701`, to the
  model, bounded.
- Treat the Company's responses as untrusted content
  ([§10.1](https://personalagentprotocol.org/docs/1.0/spec#untrusted-content)).
  Parse XML with a strict parser that refuses document type declarations,
  entities beyond the five predefined and processing instructions, and bound
  size, depth and element count.
- Add up high-volume data before the model sees it, as Iris does with an ESPI
  meter's 2,208 hourly intervals.
- Keep documents, consent IDs and revocation out of the model's hands: give the
  user the file, keep the ID yourself and offer revocation in your own
  interface.
- Steer the model to the extension's tools when the Company's own API offers the
  same data, as a preference and not a block: the Company applies the user's
  choice to both APIs.

## Check your work

- A request under the extension's URL without the declaration gets
  `403 extension_required`, and the token is never read.
- A resource outside the user's choice gets `404` on the extension's routes and
  on your own API.
- A Personal Agent that doesn't know the extension still works with your
  Company as before.

## Go deeper

- [FDX: bank data through Poppy](extensions/fdx.md) and
  [ESPI: energy data through Poppy](extensions/espi.md) follow each example.
- The contracts, [`poppylab.dev/fdx` v1](../extensions/fdx.md) and
  [`poppylab.dev/espi` v1](../extensions/espi.md), are models for your own.
- [Build a Company](build-a-company.md) and
  [Build a Personal Agent](build-an-agent.md) cover the rest of each side.

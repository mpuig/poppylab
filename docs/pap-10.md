# Personal Agent Protocol 1.0

Iris, Juniper, Lantern, Harborline and Northwind implement **only** PAP 1.0, published 14 November 2026, and version 3 of the Operations extension. There is no compatibility with 0.1–0.4: a document of another version is refused ("Unsupported PAP version"), and runs saved by the 0.3 implementation are discarded, not migrated. The text is pinned in `spec/1.0/` (spec, Operations extension, guides); `pnpm spec:drift` reports when the published text changes.

1.0 is 0.4 with the fixes implementers needed. Coming from 0.3, both releases changed what's on the wire. What Poppy Lab does now, section by section:

## Discovery and versions (§3)

- `poppy.json` has `protocol_version: "1.0"`. Iris takes the newest compatible document (any 1.x) among `protocol_version` and `supported_versions`. A linked document must be on the host that served `poppy.json`, is fetched without redirects, has the version it's listed under and no `supported_versions` of its own.
- `organization.domain` is the served host **with its port when it isn't 443**. Locally that includes `juniper.localhost:4100`, `noodles.localhost:4200`, `harbor.localhost:4300` and `northwind.localhost:4400`. Iris uses another port only for these exact local Companies, in development.
- Every request with the Session header carries `Poppy-Version: 1.0`. The Companies refuse a missing or incompatible version with `version_unsupported`; Iris then stops, because it implements 1.0 only.
- Extensions are listed per version (`"operations": [{ "version": "3" }]`) and declared per request: `Poppy-Extensions: "operations";v="3"`. Iris declares only what the Company lists. Client metadata no longer has `extensions`.
- Every `agent.protocols` entry has a `description` of what the agent there helps with. A document without one fails discovery.
- Scopes come from the issuer's `scopes_supported` or the resource metadata's, or both. The Companies list theirs in both.
- Excluded tasks moved behind `tasks.endpoint` (§9): Iris reads it early in each Session, with the Session header and no access token, and uses it only in that Session. The Companies serve the same response to everyone, so they don't verify the header there and let it be cached. They take no feedback and publish no skills.

## Sign-in (§4)

- **`prompt=consent`** on every Direct Sign-In, since the redirect can come back on another device. The Companies always show consent with every requested scope anyway.
- **Pushed Authorization Requests** (RFC 9126). The Companies offer `/oauth/par` (`require_pushed_authorization_requests: false`). Iris uses it whenever offered: it pushes the request with its client assertion and a DPoP proof, so the code is bound to that key, then opens the authorization endpoint with only `client_id` and `request_uri`. A `request_uri` lasts 90 seconds and works once.
- **Algorithms:** the Companies accept client assertions and delegations signed with `ES256` or `PS384` (RSA keys of 2048 to 4096 bits). The key's type chooses the algorithm; nothing in the JWT can.
- **Assertion lifetime:** at most 5 minutes from `iat` to `exp`. The Companies used to refuse any assertion older than 65 seconds, which 1.0 forbids; now the lifetime decides.
- **Refresh with the same DPoP key:** the Companies bind each refresh token to the DPoP key it was issued with and refuse a refresh with another key (`invalid_grant`). Iris keeps the key until the User signs in again.
- **One sign-in for every resource:** a token request naming `resource` = the domain gets the default token; any other `resource` gets `invalid_target`.

## Sessions (§5)

- The Session JWT is unchanged from late 0.3: `poppy_dlg` carries a `poppy-delegation+jwt`. The earlier `pap_dlg` form, which Poppy Lab accepted during the 0.3 transition, is refused.
- A Session is named by `client_id`, `sid` **and User ID**: a known `sid` with another User ID is another Session, not an error.
- An ended Session gets **`session_ended`**, and so does a second account in one Session. Iris then starts a new Session and resends once. `invalid_session` is no longer retried, because a new Session would fail the same way.
- Sessions slide: each request keeps one going for another hour.

## Operations, version 3

- An operation has **required `terms`** and an optional `summary`. Iris shows the summary as text (Markdown, links and images never render), and when there is none it opens the exact terms.
- An approval says who approved it. Iris sends **user approvals only**: `approver="user"`, `approved_at`, `input_type="tap"`, and a `reference` to its own record, unique per approval and never shared across Companies. A retry after an unknown outcome sends the very same approval. At APIs it goes in `Poppy-Approval` (an RFC 9651 Dictionary); in a conversation, in `extensions.operations.approval`.
- The Companies record `approver` and `reference` with a performed operation. They accept both user and agent approvals and decline none.
- **`approval_declined`:** Iris marks the card "Declined by the Company", shows the reason as Company content, and never sends that approval again.
- Not implemented: operations on websites, and agent approvals in Iris.

## Conversations (§8)

See [conversations](conversations.md). In short: every `POST` has a request `id`, a reused ID with another path or body gets `request_id_conflict`, and a `POST` without `wait` returns only `conversation_id`. State is four fields: `working`, `handoff`, `responder` and `closed`. A handoff can be withdrawn at `handoff/cancel`, and a close returns 202.

## Not yet done

Direct Conversations, streaming, browser join (`poppy:browser-sign-in`, `web.*`), operations on websites, Device and Mediated Sign-In, signed-in MCP, approvals over MCP `_meta`, agent approvals, feedback reports, skills, and Agent IDs.

## Closed gaps (25 November 2026)

- **Per-service tokens (§4.5).** Before its first signed-in call to an API or conversation endpoint, Iris reads that service's protected resource metadata (RFC 9728 §3.1) and uses it only if its `resource` is the service URL. A `resource` other than the domain's gets its own token from the refresh token, with `resource` and the same DPoP key; `invalid_target` means the service is used signed out. Our Companies need no separate tokens, so they get the default one.
- **Choosing again (§3.4).** After `version_unsupported`, Iris fetches `poppy.json` again without a cached copy. If the chosen version changed, it starts a new Session and resends once; otherwise it stops.
- **The domain with the name (§10.3).** Discovery proves which domain published the document, not who owns it, so the approval card and the Company profile show the domain next to the name.
- **Operator signatures (§5.3).** Every request with the Session header also carries a Web Bot Auth signature (RFC 9421, `draft-ietf-webbotauth-httpsig-protocol-01`): `Signature-Agent` in its dictionary form, covering `@authority`, `@method`, `@path`, the `Signature-Agent` member, `poppy-session` and, when signed in, `authorization`, with `created`, `expires` (5 minutes), `keyid` (the JWK thumbprint), `alg="ed25519"`, a `nonce` and `tag="web-bot-auth"`. The Ed25519 key is derived from the identity secret (HKDF), apart from the `jwks_uri` and delegated keys, and published at `/.well-known/http-message-signatures-directory` with a possession signature over `@authority` and `Content-Digest`. The signer reproduces the RFC 9421 Ed25519 test vector byte for byte. The Companies don't verify it; the spec doesn't require them to.

## Evidence

Live on the local stack, 25 November 2026, fictional data only:

1. Discovery of Lantern and Juniper 1.0: domain with port, tasks endpoint, Operations v3, PAR offered.
2. Keyless demo: the tasks response read once per Session; a conversation with Lantern's agent and a handoff (`pending` → `none`, phone number).
3. Iris with GPT-6 Luna at Lantern: an `authorization` event, read-only sign-in **through PAR** (the browser opened only `client_id` and `request_uri`), change permission, a refund proposal in a conversation ("Review refund", USD 29.00), approved with a v3 user approval. Lantern's account page shows the refund and the activity. Iris correctly reported a refund from an earlier test instead of filing it twice.
4. Iris at Juniper: sign-in through PAR, a recurring delivery moved Thursday → Saturday with a `Poppy-Approval` v3 header at the API, then back to Thursday, then sign-out with revocation.
5. From production (`poppylab.dev`), against Cliffside Retail 1.0: discovery, `whoami` and a conversation with its Company agent, signed out. See [community demos](community-demos.md).
6. The Poppy Demo Agent validator, checking 1.0: Juniper, Lantern and Iris's client metadata are valid with 0 errors, 0 warnings and 0 info.

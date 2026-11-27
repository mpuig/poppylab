# MCP at the Companies

Every Company on the gateway (`packages/pap-company`) runs an MCP server at `/mcp` on its own origin: Streamable HTTP, MCP 2025-06-18, verifying the Session header (§7). Its tools are the Company's OpenAPI operations, one each, and a call goes to the same route of the same tenant as the API request, after the same checks. There is no second implementation of anything. Iris still prefers OpenAPI when a Company offers both; how Iris reads an MCP server is in [MCP: first read-only block](mcp-readonly.md).

The code is `packages/pap-company/src/gateway/mcp.ts`. A Company turns it on by listing it in `poppy.json`; nothing else is configured.

## Discovery

- **`poppy.json`.** Each Company lists the server in `apis` after its OpenAPI description: `{"type": "mcp", "url": "https://{domain}/mcp", "description": …}`. The gateway mounts the server only when the document lists that exact URL (`MCP_PATH`).
- **The issuer's metadata.** `protected_resources` is `["https://{domain}", "https://{domain}/mcp"]` (§3.2).
- **Protected resource metadata** at `/.well-known/oauth-protected-resource/mcp` (RFC 9728 §3.1): `resource` is the server's URL, `authorization_servers` the Company's issuer, `scopes_supported` the scopes its tools use, `bearer_methods_supported: ["header"]` and `dpop_signing_alg_values_supported: ["ES256"]`. It doesn't say `dpop_bound_access_tokens_required`, because the server also takes Bearer tokens. The domain's own metadata is unchanged.
- **For agents.** Every Company's page lists the endpoint in its table of endpoints and each tool with its description and scopes (`mcpToolRowsHtml`, next to `skillRowsHtml`).

## Tokens

- **Its own token (§4.5, §7).** A token request with `resource` set to `https://{domain}/mcp` (RFC 8707), at the code exchange, a Device Sign-In poll or a refresh, gets a token for the MCP server. A sign-in names no resource, so every grant covers both services; the token has the refresh token's scopes, or the ones the request asks for.
- **DPoP or Bearer.** With a DPoP proof the token is DPoP-bound (`token_type: "DPoP"`), like every other. Without one it is a Bearer token (`token_type: "Bearer"`), so MCP clients that don't do DPoP can sign in. A grant issued with a proof refreshes only with that key (`invalid_grant` otherwise). One issued without a proof gets Bearer tokens for the server at refresh, with or without a proof. Bearer tokens are only ever for the server: every other token still needs a proof (`invalid_dpop_proof` without one).
- **Binding a Bearer grant.** A sign-in names no resource, so a grant issued without a proof still gets a token for every service at refresh (§4.5): a refresh with a DPoP proof for the domain (or no `resource`) gets a DPoP-bound token. That refresh binds the grant to the proof's key, as if it had been issued with it (§4.4): from then on every refresh, the server's included, needs that key and gets DPoP-bound tokens, and one without it or with another key gets `invalid_grant`. A Bearer token issued before still works at the server until it expires.
- **A Bearer token is bound by the Session header.** The server takes one only with a Session header whose `ath` covers it, and verifies that header in full, as for a DPoP token: the delegation, `iss` the `client_id` the token was issued to, `htm`, `htu`, `iat`. Without the header the token gets 401 `invalid_token`, as an invented or unknown token does. A Session header whose `ath` is for another token fails its check and gets 400 `invalid_session` (§5.3), as with a DPoP token. The Session JWT stands in for the DPoP proof, so its `jti` is taken once only: a copied request sent again gets 400 `invalid_session`, whatever its body. So a stolen Bearer token is useless alone: using it takes a fresh Session JWT signed with a delegated key that the Personal Agent's `jwks_uri` vouches for. Each token is taken only in its own scheme: a DPoP-bound token sent as `Bearer`, or a Bearer token sent as `DPoP`, gets `invalid_token` (RFC 9449 §7.1).
- **Only there.** The server refuses the default token, and every other service (the API, conversations, browser authorization) refuses its tokens, DPoP-bound or Bearer, with 401 `invalid_token` and `resource_metadata` in the challenge: the server's own metadata at `/mcp`, the domain's elsewhere. Any other `resource` still gets `invalid_target`.
- **Challenges.** The server's token challenges name both schemes it takes (§7), each with `resource_metadata="https://{domain}/.well-known/oauth-protected-resource/mcp"`: `DPoP error="invalid_token", resource_metadata="…", Bearer error="invalid_token", resource_metadata="…"`, and the same pair with `scope="…"` for a call that needs sign-in or with `error="insufficient_scope", scope="…"` for one that needs more scopes. Errors of a DPoP proof (`use_dpop_nonce`, `invalid_dpop_proof`) name `DPoP` only. The API's challenges are unchanged: `DPoP` only.

## Sessions

- **Verified as at the API.** A request with the Session header has it checked by the same function as the API's (`verify` in `sessions.ts`): `Poppy-Version`, the Session JWT with `htu` `https://{domain}/mcp` and method `POST`, `Poppy-Extensions`, the token and its DPoP proof (with the nonce challenge where the Company asks for nonces), one account per Session, and the grant's agent user. Its errors are the API's: `invalid_session`, `version_unsupported`, `session_ended`, `invalid_token`, `use_dpop_nonce`, 429 past the Session cap.
- **Without the header.** `initialize`, `notifications/initialized`, `ping` and `tools/list` work without it, as `/openapi.json` does: they read only what the server offers, and change nothing (they cost no storage write). A tool call without it, or any request with one of the server's DPoP-bound tokens and no Session header, gets 400 `invalid_session`; any other token without the header (a Bearer token, the default token, an invented one) gets 401 `invalid_token`.
- **No MCP session.** The server sends no `Mcp-Session-Id` and has nothing to end: the Poppy Session is the only one (§7). `GET` and `DELETE` at `/mcp` get 405.
- **Visitors stay apart.** A call runs in the tenant of the Session's agent user, the copy its API calls use, so a change approved over MCP shows at the API and on the website of that copy, and nowhere else.

## Tools

- **One per operation.** The name is the `operationId`, the description the `summary` (and `description`), the input schema an object of the path and query parameters and the JSON body's properties, with their schemas and `required`, and `additionalProperties: false`. Protocol headers documented as parameters are left out. The gateway refuses to start a Company with an operation it can't offer as a tool, such as one without a unique `operationId`, so the server never offers less than the API.
- **Annotations.** `readOnlyHint: true` on `GET`, `false` otherwise. A proposal's description ends "Returns an operation for the User to approve; nothing changes until they approve it." Like every description, these are the Company's claims (§10.1).
- **Paging.** Up to 50 tools a page, with a `nextCursor`; every Company here has fewer (Juniper has the most, 19).

## Calls

A `tools/call` becomes the operation's request: the path with each path argument encoded, the query, and a JSON body of the body arguments, with the request's `Poppy-Version` and `Poppy-Extensions`. Before it is sent to the tenant's routes, the server checks what the API checks before the handler (`route` in `sessions.ts`), in the same order, and answers:

| The API answers                                                                | The tool call answers                                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 200 with JSON                                                                  | A result: the JSON as text, and as `structuredContent` when it is an object                                             |
| 401 `DPoP scope="…"` (no token)                                                | HTTP 401, `DPoP scope="…", resource_metadata="…"` and the same `Bearer` challenge                                       |
| 403 `insufficient_scope`                                                       | HTTP 403, the same body, and the challenge in both schemes, with `resource_metadata`                                    |
| 403 `extension_required` (the route's own, §3.3, or Operations v3 on a change) | A tool error (`isError`) with `{error, extension}` in `structuredContent`: the server refuses that tool, never itself   |
| 403 `approval_required`                                                        | A tool error: "Not done yet. This needs approval: {summary}", with `{operation}` in `structuredContent` (Operations §4) |
| 403 `approval_declined`                                                        | A tool error that says the approval was declined, with the API's members in `structuredContent`                         |
| 429, 503                                                                       | The same status and body, with `Retry-After`                                                                            |
| Any other error                                                                | A tool error with the status and the body                                                                               |

- **Approvals.** The same tool called again with the same arguments and the approval in `_meta` under `personalagentprotocol.org/approval` (Operations §6) is the API request with that approval in `Poppy-Approval`. The gate checks it as at the API, performs the operation once and answers the result; a retry gets the first response. An operation proposed at the API can be approved over MCP and the other way round: both are the same action of the same tenant. An `input_type` the header can't carry is dropped, not the approval.
- **Arguments.** An unknown tool, an argument the tool doesn't take, a missing required one, a path argument that isn't a single segment, or one that isn't a string, number or boolean, gets JSON-RPC `-32602` and reaches no route. Everything else, the values included, is the route's to check, as at the API.

## Transport

- One JSON-RPC message per `POST`. A request gets one JSON response (`application/json`), or one SSE event when the client's `Accept` names only `text/event-stream`. A notification or a response from the client gets 202 with no body.
- `MCP-Protocol-Version` other than `2025-06-18` gets 400 with a JSON-RPC error (`-32600`, `data.supported`); without the header the server assumes 2025-06-18. `initialize` always answers `2025-06-18` with `capabilities.tools`. Batches, a body that isn't JSON and an invalid message get 400. Other methods get `-32601`.
- **Limits.** The gateway's 16 KB request bound, the Session caps (2,000 Sessions, a fifth per client), the operation bounds of the gate (100 per account, 2,000 per tenant) and the token caps all apply as at the API. Calls are synchronous: no route waits on another system.

## Not done

- No resources, prompts, sampling, elicitation, subscriptions or notifications from the server; no `listChanged`.
- MCP 2026-07-28 (`server/discover`, per-request metadata): the server answers 400 with `data.supported: ["2025-06-18"]`.
- MCP's own authorization for clients that don't implement Poppy: they can list the tools, and call none without a Session header. A Bearer token spares a client DPoP, not the Session header: signing in still takes a client assertion (§4.1), and every signed-in call a Session JWT.
- The domain extensions' APIs (Harborline's FDX-shaped API, Fernwick's ESPI-shaped one) aren't tools: only each Company's own OpenAPI operations are.
- Iris doesn't request a token for the server, so it uses MCP signed out and only where a Company offers no OpenAPI ([MCP](mcp-readonly.md#current-authorization-limit)).

## Evidence

- `packages/pap-company/src/gateway/mcp.test.ts`: discovery and metadata, the transport, Sessions and tokens (an invented token, the default token at the server, the server's token at the API, `invalid_target`), Bearer tokens (issued without a proof and kept Bearer at the server's refreshes, the grant bound by a refresh with a proof for the domain, taken only with a Session header whose `ath` covers them and only once per Session JWT, refused in the other scheme and at the API, conversations and browser authorization), a read signed out and signed in, sign-in and scope challenges beside the API's, a proposal returning the API's operation and performed once only with the approval in `_meta`, an approval of other terms, a route's extension, arguments, and visitor isolation.
- `mcpMismatches` (`@poppy-lab/pap-company/testing`), run in each Company's `src/mcp.test.ts`: every OpenAPI operation has its tool, and each tool called signed out gets what the API gets for the same request, the same sign-in challenge and scopes or the same answer from the same handler.
- The official validator from the Company kit, run against Juniper from this tree served over HTTPS at `juniper.localhost:5610`: `mcp.no-token`, `mcp.invalid-token`, `mcp.metadata` and `mcp.authorization-servers` pass (before Bearer tokens, `mcp.invalid-token` failed, wanting a `Bearer` challenge).
- `apps/juniper/src/mcp.test.ts` serves Juniper on a local socket and runs `pap-client`'s own MCP reader (`mcpTools`, `mcpRequest`, `mcpResourcePolicy`) against it: it reads the metadata (DPoP), initializes, lists, keeps only the allowed read tools, and calls them with a Session header the gateway verifies.

# Architecture

## Working request path

```text
Browser → /api/discover → validated Company + issuer metadata
Browser → /api/chat → server-owned run
                      ├─ agent identity + Session assertions
                      ├─ DPoP-bound Company Session
                      ├─ OpenAPI GET tool discovery
                      └─ deterministic demo OR model/tool loop
                          └─ Company protected API → sanitized response
```

The browser holds only an opaque HttpOnly run cookie. Signing keys persist in the playground's ignored `.poppy/identity.json`, created with restrictive filesystem permissions. Session Tokens, DPoP keys, history, and call budgets stay in the server's run map. No protocol secret is passed to the model. New runs use a stable opaque User ID per verified issuer from the encrypted `company-users.enc` registry, separate from the run ID. Existing legacy Sessions are not relabeled in place; see [migration and review fixes](review-fixes.md).

The Company stores hashed opaque tokens, Session ownership, DPoP bindings, expiration times, and replay identifiers. The example is single-process; persistence and replay protection are not distributed.

## Runtime boundaries

- `pap-core`: draft 0.2 discovery and issuer schema validation.
- `pap-client`: pinned-DNS HTTPS transport, byte/time limits, discovery, ES256 assertions, DPoP creation/verification, replay cache.
- `llm-adapters`: browser-safe provider metadata at its root export; actual model execution at the separate `./server` export.
- `apps/playground/lib/runtime.ts`: identity lifecycle, bounded encrypted-snapshot-backed runs, Session negotiation, and a restricted OpenAPI-to-tool adapter.
- `apps/example-company/src/pap.ts`: signed-out token issuance, Session-bound protected APIs, and the example OpenAPI description.

## Supported OpenAPI subset

The adapter generates up to 24 tools from OpenAPI, including scalar path/query parameters and bounded object/array JSON proposal bodies. It validates arguments before sending, rejects unsupported schemas and control endpoints, and never accepts model-provided destinations or headers. Proposal POSTs require an independent trusted-example policy (local Juniper or three exact Sandbox origins) as well as explicit proposal/Operations declarations; arbitrary Companies cannot grant themselves write authority through metadata. See pap-sandbox.md for the scoped 0.1 compatibility profile and remaining live verification. Confirmation remains outside the model. See [openapi-tools.md](openapi-tools.md) for the exact subset and security boundary.

## Model execution

OpenAI-compatible, Anthropic, Google, and Ollama models run through the AI SDK, with five-step maximum tool loops, bounded history/output, no retries, and a request deadline. Configuration is server-side. The model sees only the user conversation, untrusted tool descriptions, and bounded API results. Tool authority is limited to generated public/account reads and schema-declared, trusted-local fictional proposals. Confirm/cancel/status endpoints are not model tools. A separate same-origin browser route accepts only server-owned operation IDs and exact revisions; this is not a claim that models cannot be injected.

Protocol demo is not a model. It deterministically selects a catalogue, delivery, or policy tool and displays the actual response, exercising the same Session and DPoP transport.

## Local development versus deployment

The local example deliberately uses HTTP at `http://juniper.localhost:4100`. The discovery schema permits that exact origin only when both development mode and the explicit private-network flag are active. The example Company likewise permits its local agent metadata origin. This is a development transport exception, not HTTPS conformance.

Deployed Companies and agent identities require HTTPS. Production chat is off by default. Enabling it requires access control and deployment-level abuse protections beyond the in-process budgets provided here.

## Not implemented

Local Juniper now supports Direct Sign-In with PKCE, one-time codes, issuer/state validation, DPoP account Sessions, opaque hashed Account Tokens, immediate grant revocation, and approval-gated fictional delivery changes. Account Tokens and DPoP keys are saved in authenticated encrypted local snapshots; Company snapshots also persist grants, commerce data, operation records and replay protection. Scoped refresh and optional local password authentication are now implemented. General cross-Company OAuth sign-in, hosted identity providers, generic OAuth registration, arbitrary mutation tools, MCP, Company Agent conversations, browser Session joining, DPoP nonce challenge handling, and distributed Session persistence remain future work. See account-flow.md for the current local storage and shopping architecture. A fresh Discover clears the current run cookie so the next message creates a new Session.

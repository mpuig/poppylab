# MCP: first read-only block

Poppy can select MCP when a Company doesn't offer OpenAPI. This block implements **Streamable HTTP MCP 2025-06-18**, not the older SSE transport with separate endpoints. When a Company offers both OpenAPI and MCP, Poppy still prefers OpenAPI.

## Implemented

- `initialize`, `notifications/initialized`, `tools/list` and `tools/call`, with checked JSON-RPC IDs, a fixed version and Session headers.
- JSON responses, or a finite or incremental SSE stream, to a single POST. The reader cancels the stream once it has the result; it doesn't wait for it to close.
- A transport with pinned DNS, private IPs rejected except for the development exception, redirects blocked, byte limits, a timeout, Retry-After, and a single retry for an explicit nonce challenge. Nothing is retried after an uncertain response.
- RFC 9728 metadata at `/.well-known/oauth-protected-resource<endpoint path>`: `resource` must match the MCP endpoint exactly and `authorization_servers` must include the discovered issuer.
- Tools are exposed only if they're on a local allowlist for the exact origin **and** advertise `readOnlyHint: true`. The remote annotation alone grants no authority. Control, deployment and credential names are excluded as well.
- Local validation of a bounded subset of input schemas and text results. Resource links and images aren't followed. Server instructions, sampling and elicitation aren't passed to the model as authority.

## Local policy

No remote tools are enabled automatically. An operator must inspect the contract and configure exact names, for example for a test server:

```dotenv
PAP_MCP_READ_TOOLS={"https://mcp.example":["get_catalog"]}
```

The allowlist must contain tools actually verified as read-only. A malicious remote server can lie about its behaviour: filtering by name and annotation isn't an infrastructure sandbox and doesn't guarantee that the server has no side effects.

Limits: 4 pages, 100 tools inspected, 24 exposed, schemas 4 levels deep, 512 KB per HTTP response, 15 seconds per exchange, 40 text parts and 32 KB of result content. The SSE reader doesn't implement subscriptions, reconnection, resumability or persistent notifications. JSON-RPC batching, resources, prompts, rich content and write tools aren't implemented. The MCP Session is transient per connection; there's no resumption and no closing DELETE, so the server's expiry is relied on.

## Current authorization limit

MCP Companies are limited to **signed-out reads** with the local policy. There's no signed-in MCP and no write tools; the proposal allowlist isn't widened. (An earlier read-only consent integration for Ample was removed with the move to 0.3; see [Ample, historical](ample-readonly.md).)

The resource metadata is looked up at the well-known location derived from the endpoint; arbitrary URLs from challenges aren't followed. The MCP endpoint must be on the same origin as the issuer; delegating MCP to another host isn't supported.

## Evidence

```sh
pnpm scenarios mcp
```

The MCP suites cover client and transport, and the runtime: real JSON and SSE over local sockets, sessions, arguments, the read policy, resource metadata, DPoP and Bearer, isolation of the general token, nonces, lost connections, redirects and limits. These tests don't certify full MCP or PAP conformance.

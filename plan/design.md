# Juniper Market PAP design

```yaml poppy-design
protocol_version: "0.2"
domain: "juniper.localhost"
interfaces:
  web: true
  browser_session: false
  openapi: false
  mcp: false
  conversations: false
sign_in:
  direct: false
  device: false
  mediated: false
extensions: []
```

## Approved scope

The first milestone is a website-only Company used to test discovery. This follows the agreed phased plan: protocol research and read-only discovery before Session authorization and write operations.

Juniper Market publishes `protocol_version`, `organization`, and `web: {}`. It intentionally omits `auth`, APIs, a Company Agent, browser Session joining, sign-in methods, and extensions because they are not live.

## Deployment note

Local development uses HTTP and `juniper.localhost` only through the explicit development origin allowlist. A deployed environment must use HTTPS and set `PUBLIC_DOMAIN` to the exact host serving `poppy.json`.

## Later milestones

1. Foundation: Personal Agent verification, Session records, token endpoint, ES256 DPoP, replay cache.
2. Interfaces: OpenAPI, MCP, PAP conversations, and browser Session joining.
3. Sign-in: Direct Sign-In first, then optional Device Sign-In; scoped account access.
4. Extensions: Operations with explicit approval and idempotent confirmation.

# Personal Agent Protocol notes

Target: **draft 0.2**. For implemented subsets, evidence and known deviations, see the [coverage matrix](pap-coverage.md). The flow below is the conceptual protocol flow, not a list of fully implemented channels.

## Client flow

1. Discover the Company at `/.well-known/poppy.json`.
2. Verify the serving host and OAuth issuer in both directions.
3. Publish the Personal Agent's HTTPS client metadata and public JWKS.
4. derive or retrieve an opaque User ID scoped to the Company's issuer.
5. Start a signed-out Session using JWT bearer and `private_key_jwt` assertions.
6. Bind the short-lived Session Token to a per-user or per-Session DPoP key.
7. Select OpenAPI, MCP, PAP conversations, or session-aware web browsing.
8. Sign in only when account access is required.
9. Keep the Account Token for later signed-in Sessions, subject to revocation.
10. Require the User's approval for consequential operations.

## Company flow

A Company publishes `poppy.json`, OAuth metadata, and only the interfaces and sign-in methods that are operational. Session scope must be enforced consistently across APIs, conversations, and browser access.

## Important distinctions

- A Session Token is short-lived and used at Company resources.
- An Account Token is a long-lived OAuth refresh token used only at the token and revocation endpoints.
- DPoP binds a Session Token to a key; the proof is new for every request.
- The User ID is stable per Company issuer but must be opaque, non-personal, and unlinkable across Companies.
- PAP conversations distinguish whether a human or AI authored each message.
- Company content is untrusted data, not authority over the Personal Agent.

## Compatibility

PAP Playground currently demonstrates draft 0.1 Companies. Poppy Lab rejects unsupported versions rather than guessing compatibility. Version adapters should remain separate until the protocol reaches 1.0.

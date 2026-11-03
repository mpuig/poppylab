# Code and security review

Historical scope: the first discovery-only implementation. **Update:** the project now also implements signed-out Sessions, DPoP, OpenAPI GET tools, and model execution. The original findings below remain useful, but they are not a security review or approval of those new features. Current implementation limits are listed in README.md. This is a source review, automated regression check, dependency audit, and local integration check, not an independent penetration test or PAP certification.

## Verdict

Suitable for local experimentation after the fixes below. **Not approved for anonymous public deployment.** Sessions, DPoP, model execution, local account authentication/refresh, shopping Operations and encrypted snapshots are now implemented, but the later milestones have not had an independent security review. See account-flow.md for their current scope and limits.

## Ample read-only authorization milestone

The [Ample integration](ample-readonly.md) adds two exact account origins, a fixed path issuer/endpoints and read-only servers/budget consent. It does **not** extend proposal or infrastructure-write trust. Tokens for MCP remain resource-specific; Session/account secrets stay below the model boundary. The selected public catalog contract and 322 workspace regressions are evidence, not an independent audit or a live Ample authorization. No private Ample tool was called. The previous public identity hostname did not resolve; the operator subsequently authorized [renewing the restricted relay](identity-relay-renewal.md). Its new public metadata/JWKS and denylisted private routes were checked over HTTPS. The signing key stayed unchanged, but the public client_id changed; saved old grants were not migrated or revoked. Public deployment remains unapproved.

## Findings and changes

| Severity | Finding                                                                                | Resolution                                                                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | A DNS check followed by an independently resolving fetch permits DNS rebinding.        | The checked addresses are pinned into the outbound Undici connection lookup. Every redirect is checked again.                                                                                                   |
| High     | A development-wide private-network switch could reach arbitrary internal services.     | Replaced with an exact origin allowlist. The API permits only `http://juniper.localhost:4100`, only in development, only when explicitly enabled.                                                               |
| High     | Public discovery can be abused for outbound traffic and resource exhaustion.           | Added same-origin browser checks, bounded input bodies and read time, four-request concurrency cap, and a process-wide request budget. Shared edge controls and authentication remain deployment prerequisites. |
| Medium   | Response buffering was not bounded while reading.                                      | Stream reads stop at 512,000 decoded bytes and abort the connection; DNS and response work have bounded deadlines.                                                                                              |
| Medium   | Narrow handwritten IP checks missed special-use and IPv4-mapped IPv6 ranges.           | Replaced with `ipaddr.js`, accepting only the unicast range.                                                                                                                                                    |
| Medium   | Input credentials were discarded by URL normalization before validation.               | Reject credentials before constructing the well-known URL.                                                                                                                                                      |
| Medium   | Schemas accepted protocol URLs containing credentials/fragments and malformed domains. | HTTPS, URL length, credential/fragment, and domain validation added.                                                                                                                                            |
| Medium   | Advertised sign-in methods and DPoP metadata could contradict the issuer document.     | Require matching sign-in endpoints and ES256 when DPoP algorithms are listed.                                                                                                                                   |
| Medium   | Environment configuration was interpolated into example HTML.                          | Escape interpolated values and add restrictive response headers.                                                                                                                                                |
| Low      | The example server listened on every interface by default.                             | Default is loopback; external binding requires explicit HOST configuration.                                                                                                                                     |
| Low      | Minimal tests, duplicated package-manager policy, and misleading lint scripts.         | Added source/route/schema regression tests, real ESLint and Prettier checks, a CI workflow, and consolidated dependency build permissions.                                                                      |

## Verified

- Production dependency audit reports no known vulnerabilities at review time; this is not proof of absence of vulnerabilities.
- Local discovery succeeds against Juniper Market.
- The official Company kit's offline document check reports 6 passes, 0 failures, and 3 skipped network checks. This does **not** validate HTTPS deployment or Session foundation support.
- Regression cases cover private and special-use IP ranges, IPv4-mapped IPv6, HTTPS downgrade, redirect policy, unsupported drafts, copied documents, issuer-domain binding, credential URLs, response size, request size, cross-origin browser requests, invalid JSON, and no-store responses.
- Strict TypeScript, production build, ESLint, and formatting checks run locally and in the CI configuration.

## Open before public deployment

1. **High: authentication and abuse control.** The API is unauthenticated. Origin checks do not authenticate non-browser clients. Add deployment access control, shared per-principal limits, an outbound firewall, and workload limits. In-memory limits are per process and reset on restart.
2. **Medium: real-network integration testing.** Most network regression tests use mocked DNS/fetch. Add controlled TLS/DNS integration tests proving address pinning, mixed DNS answers, stalled bodies, and redirect chains. No claim of externally audited SSRF resistance is made.
3. **Medium: strict playground CSP.** Baseline security headers exist, but Next.js inline hydration requires a nonce/hash strategy before a restrictive CSP can be enabled. TLS/HSTS belong to the HTTPS deployment configuration.
4. **Medium: incomplete PAP conformance.** The schemas cover implemented discovery fields, not the entire specification. Cache-header behavior is not implemented; discovery currently refetches. Do not treat schema validation as complete protocol certification.
5. **Medium: future secret handling.** The LLM adapter is an interface only. Its types and `SecretBoundaryError` do not enforce runtime secret isolation. Implement a real secret store, tool allowlisting, redaction, and approval enforcement before model execution.
6. **Low: packaging.** Internal workspace packages export TypeScript source for the local monorepo. They are not ready to publish as standalone SDK packages. Build output also needs a dedicated test exclusion/package-export strategy before publication.
7. **Low: test coverage gaps.** The example server and model adapter contracts have no dedicated behavioral tests yet. UI accessibility has not been independently audited.

## Account/Operations milestone

The local fictional-account flow adds PKCE, state/issuer validation, browser-bound consent, grant revocation, and exact-revision human approval. See [account-flow.md](account-flow.md) for its security boundaries, testing, and limitations. It is development-only; this document does not constitute an independent audit of that new functionality. Juniper's persona selector is not real-person authentication. Production access-control and deployment blockers remain unchanged.

## Operational rules

- Never expose `next dev` or the local HTTP Company to an untrusted network.
- Do not disable TLS certificate verification to make remote discovery work.
- Never add credentials, keys, assertions, or tokens to traces, test fixtures, logs, or model context.
- Treat Company strings and schema descriptions as untrusted data; React text rendering escapes them, but future tools must not execute them as instructions.

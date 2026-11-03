# Nonces, isolated scenarios and revisions

## Run

```sh
pnpm scenarios --list
pnpm scenarios                  # every group
pnpm scenarios nonce operations # a selection
pnpm scenarios permissions      # read first, widening and recovery
pnpm scenarios mcp              # transport, reads and resource tokens
```

The runner (`scripts/scenarios.mjs`) runs deterministic regression tests, not models or live purchases. Each run creates a `poppy-scenarios-*` directory in the system temp folder with Vitest reports and a `summary.json`. Test state lives in memory or in real vaults under temporary directories; it doesn't reset `.poppy` or change saved accounts. It inherits only PATH, HOME, TMPDIR, SYSTEMROOT and LANG, forces NODE_ENV=test, and doesn't inherit model keys, the Juniper password or tunnel configuration. It's not an operating-system sandbox or an official conformance suite.

| Group      | Scenarios                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| authority  | Consent, PKCE, scopes, account and Session, revocation, expired proposal, approval and isolation                                             |
| nonce      | Token and API challenges; invalid, expired, other-key or other-server nonces; bounded retry; missing or oversized header; uncertain response |
| operations | Omitted terms, rendering without invented data, mutated revisions, a new revision and a new approval                                         |
| recovery   | Retry-After, vault and restart, a response lost after commit with a real socket and writer                                                   |
| pap-0.3    | Discovery, Session header, delegated keys, plain OAuth and Operations v2                                                                     |
| noodles    | Lantern Noodle Bar end to end on the portable gateway                                                                                        |

The `mcp` group covers client and transport tests and the runtime: reads with the local policy, metadata, DPoP and Bearer resource tokens, SSE, nonces and the absence of uncertain retries. See [MCP read-only](mcp-readonly.md).

The `permissions` group covers initial read access, widened consent, an independent earlier grant, rejected over-broad grants, an expired proposal and an uncertain status. See [least-privilege permissions](permission-consent.md).

Some tests repeat across groups: report counts aren't unique normative requirements. A failure or a missing report exits with code 1; an unknown group name exits with 2. Workers are capped at two per suite.

## DPoP nonce

Juniper can turn the challenge on explicitly, without changing the existing server automatically:

```sh
JUNIPER_DPOP_NONCE=required pnpm dev:company
```

Don't run another instance against the same vault while the first is running. Without the variable, the previous behaviour is kept; the nonce tests turn it on in their isolated environment.

The nonce is an HMAC bound to the DPoP key and to the token or API scope, valid for 60 seconds. Each instance has a random secret; a restart invalidates old nonces and causes another challenge. No unbounded table is kept. Cryptographic verification comes before the challenge, and the token challenge happens before any assertion or OAuth code is consumed. Normal replay protection still applies after the nonce is accepted.

Poppy accepts `use_dpop_nonce` with HTTP 400 or 401 and a bounded DPoP-Nonce header. It builds a new proof and, at the token endpoint, new assertions. It resends **once to the same URL**, with no redirects and without passing the nonce to another server. It doesn't retry on a timeout, an uncertain response, another error code, a missing or oversized nonce, or a second challenge. Retry-After still applies. Nonces from successful responses aren't cached, so a request can take one extra round trip.

## Operations

`terms` is optional. When it's missing, Poppy keeps and shows the Company's summary, says there are no structured terms, and doesn't make up prices or differences. Approval is still a human button.

A new revision needs a new approval. The client rejects changes to the summary or terms under the same revision and changes after completion. The route test checks that an approval of one revision can't confirm another.

## Validation

The full suite and every scenario group pass on each change; see the [coverage matrix](pap-coverage.md) for the current count. The UI for summary-only proposals is checked by server rendering and the absence of invented facts. The review was done in-thread, with no independent reviewer.

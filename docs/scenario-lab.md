# Nonces, isolated scenarios and revisions

## Run

```sh
pnpm scenarios --list
pnpm scenarios                  # every group
pnpm scenarios nonce operations # a selection
pnpm scenarios permissions      # read first, widening and recovery
pnpm scenarios mcp              # transport, reads and resource tokens
pnpm scenarios banking          # Harborline reads, approvals and portal parity
pnpm scenarios fdx              # Harborline's FDX-shaped API and its gateway options
pnpm scenarios airline          # Northwind search, scopes, portal and changes
pnpm scenarios energy           # Fernwick's ESPI-shaped API, bills and plan change; Iris with Use ESPI
```

The runner (`scripts/scenarios.mjs`) runs deterministic regression tests, not models or live purchases. Each run creates a `poppy-scenarios-*` directory in the system temp folder with Vitest reports and a `summary.json`. Test state lives in memory or in real vaults under temporary directories; it doesn't reset `.poppy` or change saved accounts. It inherits only PATH, HOME, TMPDIR, SYSTEMROOT and LANG, forces NODE_ENV=test, and doesn't inherit model keys, the Juniper password or tunnel configuration. It's not an operating-system sandbox or an official conformance suite.

| Group      | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| authority  | Consent, PKCE, scopes, account and Session, revocation, expired proposal, approval and isolation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| nonce      | Token and API challenges; invalid, expired, other-key or other-server nonces; bounded retry; missing or oversized header; uncertain response                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| operations | Omitted terms, rendering without invented data, mutated revisions, a new revision and a new approval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| recovery   | Retry-After, vault and restart, a response lost after commit with a real socket and writer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| pap-1.0    | Discovery and versions, Poppy-Version and Poppy-Extensions, Session header, delegated keys (ES256, PS384), PAR, Operations v3 approvals                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| noodles    | Lantern Noodle Bar end to end on the portable gateway                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| banking    | Harborline Bank scopes, reads, payment/transfer idempotency, limits, stale state, reversible changes, conversations and portal parity; its FDX-shaped API and statements                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| fdx        | Gateway account prefixes, token fields and refused consent; Harborline's FDX-shaped API: extension, clusters, accounts, consent, revocation, statements and their PDF; the native tools and the binary transport; Iris with Use FDX against the real Harborline app, its demo mode and the statements in the account row                                                                                                                                                                                                                                                                                  |
| airline    | Northwind Air public tools, differentiated scopes, portal state, exact terms, stale prices and idempotent execution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| energy     | Fernwick Power & Light: the DST bitmap, deterministic curves and bill arithmetic; its ESPI-shaped API (extension, scopes per route, meters chosen at consent, Atom XML, window and paging, 404s, token fields, Authorization and revocation); the plan change through Operations v3; the Company Agent, portal and How it works page; the gateway's token fields; the strict XML parser and the native ESPI-shaped tools, checked against the real Fernwick's own hours and bills; Iris with Use ESPI against the real Fernwick app (token fields, transport, demo mode, revocation from the account row) |

The `mcp` group covers client and transport tests and the runtime: reads with the local policy, metadata, DPoP and Bearer resource tokens, SSE, nonces and the absence of uncertain retries. See [MCP read-only](mcp-readonly.md).

The `permissions` group covers initial read access, widened consent, an independent earlier grant, rejected over-broad grants, an expired proposal and an uncertain status. See [least-privilege permissions](permission-consent.md).

Some tests repeat across groups: report counts aren't unique normative requirements. A failure or a missing report exits with code 1; an unknown group name exits with 2. Workers are capped at two per suite.

## DPoP nonce

Juniper can turn the challenge on explicitly, without changing the existing server automatically:

```sh
JUNIPER_DPOP_NONCE=required pnpm dev:juniper
```

Don't run another instance against the same vault while the first is running. Without the variable, the previous behaviour is kept; the nonce tests turn it on in their isolated environment.

The nonce is an HMAC bound to the DPoP key and to the token or API scope, valid for 60 seconds. Each instance has a random secret; a restart invalidates old nonces and causes another challenge. No unbounded table is kept. Cryptographic verification comes before the challenge, and the token challenge happens before any assertion or OAuth code is consumed. Normal replay protection still applies after the nonce is accepted.

Poppy accepts `use_dpop_nonce` with HTTP 400 or 401 and a bounded DPoP-Nonce header. It builds a new proof and, at the token endpoint, new assertions. It resends **once to the same URL**, with no redirects and without passing the nonce to another server. It doesn't retry on a timeout, an uncertain response, another error code, a missing or oversized nonce, or a second challenge. Retry-After still applies. Nonces from successful responses aren't cached, so a request can take one extra round trip.

## Operations

`terms` is optional. When it's missing, Poppy keeps and shows the Company's summary, says there are no structured terms, and doesn't make up prices or differences. Approval is still a human button.

A new revision needs a new approval. The client rejects changes to the summary or terms under the same revision and changes after completion. The route test checks that an approval of one revision can't confirm another.

## Validation

The full suite and every scenario group pass on each change; see the [coverage matrix](coverage.md) for the current count. The UI for summary-only proposals is checked by server rendering and the absence of invented facts. The review was done in-thread, with no independent reviewer.

## The browser scenario

```sh
pnpm --filter @poppy-lab/playground exec playwright install chromium   # once
pnpm e2e
```

`pnpm e2e` runs one test, not a suite: a long conversation in the real playground page, in Chromium (Playwright), against Fernwick Power & Light and Lantern Noodle Bar running locally and a scripted model. It is not part of `pnpm test`. It takes about 20 seconds locally once the playground has been compiled, and under a minute on a first run.

What it does, in one conversation, mostly in Spanish (`apps/playground/e2e/scenario.e2e.ts`):

1. "¿Qué tarifas tiene Fernwick?" connects Fernwick; sign in as Elena on Fernwick's consent page, read only, then give change permission from the guide's suggestion; "Cambia el cargador del coche a la tarifa plana." brings the proposal's card; "sí" approves it.
2. "¿Qué hay en el menú de Lantern?" connects Lantern; "Enséñame el menú de Lantern." asks it; sign in read only; "Añade un helado de matcha a mi pedido de Lantern." stops for change permission, given from Iris's question on Lantern's consent page; "sí" goes on; the card is approved from the keyboard.
3. The page is reloaded.

After each step, and after the reload, it checks the whole transcript in order (every message, proposal card, sign-in and change-permission ask, and Iris's questions where they arose, with nothing after the newest message that didn't arise there), that decided cards are folded in place, that no turn is lost after a sign-in or a change permission, the "N waiting" count, the Company that "Talk to … yourself" names, and that the message box has the focus after every send and after the keyboard approval. It waits on what the page shows, never for a fixed time.

**The model** is `apps/playground/e2e/fake-model.ts`: an OpenAI-compatible `/v1/chat/completions`, streamed or not, which the playground reaches as its `openai-compatible` provider through `OPENAI_BASE_URL`, with a placeholder key. It answers Iris's routing question with the Company the message names, and each turn by a fixed rule chosen by the message's words: the tool calls to make, one after each result, then the answer. A Company the message names that isn't connected is connected with Iris's own `connect_company` tool. Everything else in a turn is the real code: routing, sign-in, Sessions, proposals and approvals. No network, no key, and no Turnstile: the free model is never offered locally.

**The servers** are started for the test and stopped after it (`apps/playground/e2e/servers.ts`), on the usual ports plus 20000 (`E2E_PORT_OFFSET` changes it): the playground in development mode on 23000, Lantern on 24200 and Fernwick on 24500, so they run beside a developer's `pnpm dev`. `POPPY_LOCAL_PORT_OFFSET` moves every local address of the lab together (`packages/pap-core/src/local.ts`): the Companies' local origins, the agent they accept as their client and the playground's own. Each server keeps its state in a new temporary folder (`POPPY_STATE_DIR` for the playground), the playground builds into `.next/e2e` (`POPPY_NEXT_DIST_DIR`), and the servers inherit only PATH, HOME, TMPDIR, LANG and CI. `next dev` still reads `apps/playground/.env.local`, so the variables the scenario depends on are set over it. `next dev` rewrites `next-env.d.ts`, which is put back on stop. A retry gets new servers, so the fictional accounts are as they were. `node apps/playground/e2e/servers.ts` starts the same servers and keeps them up until Ctrl-C, to try the page by hand.

**Bugs it found that aren't fixed yet** are checked as they should behave and marked expected to fail (`expectedToFail`, with the bug named in the test). Such a check that passes fails the test, so the mark goes with the fix.

**In CI** it is the `e2e` job in `.github/workflows/check.yml`, on pull requests and on main, not a required check. It caches Chromium by Playwright's version, retries once, and on a failure keeps `apps/playground/test-results/` (trace, screenshot, HTML report and each server's log) as the `e2e-results` artifact.

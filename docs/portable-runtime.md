# Portable runtime: Cloudflare Workers and Node

Goal: run the same code on **Cloudflare Workers + Durable Objects** (`poppylab.dev`) and on **Node** (local development or a VPS).

## Pattern

The gateway (`packages/pap-company/src/gateway.ts`) is a 50-line composition of modules under `src/gateway/`: `types` (state, definition and deployment types), `context` (the shared state, replay cache, dirty flag, cookie and client-metadata helpers, DPoP helpers, per-request carriers), `persistence` (body limit, save-when-dirty, security headers), `discovery`, `signin` (Direct Sign-In), `tokens` (token and revocation endpoints), `sessions` (the `Poppy-Session` middleware for `/api/*`) and `tenancy` (one business app per tenant, the Operations v2 gate, grant access, website dispatch). Middleware order is fixed in `createCompany`: body limit and persistence first, the Session middleware before the business dispatch.

- **`@poppy-lab/pap-client/core`** is the runtime-portable subset of the client library: Session header and delegations, DPoP proofs and assertions, the `Poppy-Approval` header. It uses Web APIs, `jose` and the parts of `node:crypto` that Workers provides with `nodejs_compat`. The DNS-pinned network client (undici) stays in the Node entry point.
- **`@poppy-lab/pap-company`** is a PAP 0.3 Company gateway on **Hono**:
  - discovery metadata (RFC 8414/9728), Direct Sign-In and DPoP access tokens, refresh and RFC 7009 revocation;
  - verification of the delegated `Poppy-Session` header and one account per Session;
  - Operations v2 through a pure engine (`approvals.ts`).

  A Company supplies a `CompanyDefinition`: its scopes, consent page, test customers, `poppy.json`, excluded tasks, OpenAPI contract and Hono routes.

- **Adapters per runtime:**

  |                       | Node / VPS                                                                      | Cloudflare                                                                                   |
  | --------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
  | HTTP                  | `@hono/node-server`                                                             | Worker `fetch` → one Durable Object                                                          |
  | State (single writer) | encrypted vault file                                                            | Durable Object SQLite storage (`state` key)                                                  |
  | Outbound HTTPS        | `protocolRequest`: pinned DNS, private addresses blocked, no redirects, bounded | `fetch` with `redirect: "manual"`, HTTPS only, bounded; Workers can't reach private networks |

  The whole Company runs inside a single Durable Object, so the single-writer model holds as it did on Node.

- **Clients (CIMD):** the gateway now accepts any Personal Agent by its client metadata. The `client_id` must be an HTTPS URL; plain HTTP is allowed only for an explicit development allowlist. `redirect_uri` must match exactly one of the client's own `redirect_uris`, and the consent page names the client. This is what a public deployment needs. Before, only the local Poppy was accepted.
- **Consent cookie:** `__Host-` on HTTPS. OAuth pending consents and codes live in memory (5 and 1 minutes); if a Durable Object restarts mid-sign-in, the user signs in again.

## Status

**Lantern Noodle Bar** is migrated (`apps/lantern`). It no longer lives in `example-company`.

- `pnpm dev` or `pnpm dev:lantern` runs it on Node at `http://noodles.localhost:4200`.
- `pnpm --filter @poppy-lab/lantern dev:worker` runs it in `workerd` (the Workers runtime) through Wrangler.
- `wrangler.toml`: `nodejs_compat`, SQLite-backed Durable Object `LanternCompany`, vars `PUBLIC_ORIGIN=https://noodles.poppylab.dev`, custom domain `noodles.poppylab.dev`, `workers_dev = false`.
- **Deployed** to `https://noodles.poppylab.dev` (version `e2ff8ca8`). Discovery, metadata, excluded tasks and OpenAPI return 200; the API without a Session header returns 400; authorize with a plain-HTTP client returns 400; security headers are present.

**Verified:**

- **Node, live with GPT-6 Luna.** Slots read signed out. Write consent as Robin; the consent page named "Poppy Lab" from its metadata. "Add a matcha ice cream to my order and move it to Sunday lunchtime" was proposed (+$6.00), approved, and changed the order to Sunday and $22.50. Then sign-out.
- **workerd locally (Wrangler dev), with a script signing as the local Poppy identity:**
  1. Signed-out menu read; 401 challenge `DPoP scope="orders:read"` for orders.
  2. Consent, token and order read.
  3. Change refused with `approval_required` (+$5.00), approved with `Poppy-Approval`, and the retry returned the first response.
  4. After restarting Wrangler, the Durable Object storage kept the changed order (version 2).

  The `DEV_HTTP_CLIENT` var allows the local plain-HTTP Poppy only when the Company itself runs on a `localhost` origin.

- **Tests:** `lantern.test.ts` (14) covers the full flow on the portable gateway via Hono `app.request`: redirect URIs from client metadata, refusal of HTTP clients, persistence after each request and failing closed on storage errors. `approvals.test.ts` (3) covers the pure engine. Total: 356 tests.

**Juniper Market** is migrated too (`apps/example-company`). Fastify is gone from the repository.

- `src/juniper.ts` is its `CompanyDefinition`. The business modules (shopping, customer services, profiles, shopping edits, website/portal, Operations v2) are unchanged. They are written against `src/router.ts`, a small `(req, reply)` facade over Hono.
- `src/node.ts` (vault `juniper`, `protocolRequest`) and `src/worker.ts` (Durable Object `JuniperCompany`) are the entry points. `wrangler.toml` targets `juniper.poppylab.dev`.
- The gateway gained what Juniper needed: optional RFC 9449 DPoP nonces (`deploy.dpopNonces`; the token endpoint challenges before the client assertion or grant is consumed, the API answers 401 `use_dpop_nonce`), grant listing/revocation for the website, and a 16 KiB body limit.
- The browser portal (`/site/*`, `/account`) only runs on the local origin. On Workers it answers 403 `local_demo_only`: all visitors would share the same fictional personas, so it waits for per-visitor isolation.
- **Tests:** `src/test-app.ts` gives tests a Fastify-like `inject`/`listen` over the Hono apps. The account tests were rewritten as HTTP tests against the gateway (consent subsets, Origin and cookie binding, PKCE, one-time codes, password, refresh without widening, revocation). The socket-loss test drops the response after the commit at the network layer. Total: 357 tests.
- **Verified live on Node with GPT-6 Luna:** read-only consent as Alex, read of orders and recurring delivery, **Request change permission**, then Thursday→Saturday proposed, approved and completed, and back to Thursday. Also on workerd (Wrangler dev): discovery, OpenAPI and health return 200, the API without a Session returns 400, and the portal returns 403.

## Per-visitor isolation

With `isolation: "visitor"` (both Workers), the gateway gives every agent user its own copy of the Company's business data:

- **Tenant** = SHA-256 of `client_id` + user id from the signed `Poppy-Session` header. It is verified before routing.
- Each tenant gets its own mounted business app, seeded with the same fictional customers, and its own Operations v2 records (their terms and first responses contain business data).
- **Grant holder:** a grant serves only the (client, user) that first used it. Another user of the same client gets `invalid_token`.
- Eviction: at most `maxTenants` (500), least recently used first, and a tenant idle for `tenantIdleMs` (24 h) starts again from the seed data.
- Non-API routes (landing, discovery, consent) use the `shared` tenant. The Company website lists only grants held by the tenant itself.
- **Storage:** `splitStore` (Durable Objects) keeps the protocol state under `state` and each tenant under `tenant:<hash>`, writing only what the request touched and deleting evicted tenants. Previous single-copy state is moved to `shared` on load.
- Node defaults to `shared`, so the local Juniper portal shows the agent's changes; `COMPANY_ISOLATION=visitor` turns isolation on for a public VPS (one vault file, rewritten per request).

Verified by tests (Lantern: separate copies, stolen token, eviction and split persistence; Juniper: support-case text from one visitor is invisible to another) and on workerd: a second visitor saw the untouched order ($37.00) while the first visitor's change ($42.00) survived a restart.

Deployed: `https://noodles.poppylab.dev` (`334aa256`) and `https://juniper.poppylab.dev` (`7a5a276d`). Both serve discovery, metadata, excluded tasks and OpenAPI. The API without a Session header and plain-HTTP clients at authorize return 400; Juniper's portal returns 403.

**Still open for the public Companies:** global caps (2000 Sessions, 2000 tokens, 1000 grants) are shared by all clients; an edge rate-limit rule should go in front before Poppy is public.

## Poppy Lab on Workers (`https://poppylab.dev`)

The same Next.js app runs with `next dev`/`next start` on Node and on Cloudflare Workers through OpenNext (`@opennextjs/cloudflare` 1.20).

- **Per-visitor state** (`lib/runs.ts`): an unguessable `HttpOnly` visitor cookie (`__Host-poppy_visitor` over HTTPS, SameSite=Lax so the Company's redirect to the callback still identifies the visitor). Storage only sees its SHA-256.
  - Runs (tokens, keys, conversation) are keyed by visitor: at most five per visitor, 30 minutes each.
  - Locking is compare-and-set on a version, with a two-minute lapse for a crashed request.
  - Backends: Node keeps memory plus the encrypted vault `visitor-runs`. Workers use one Durable Object `PoppyVisitor` per visitor (`worker/visitor.ts`), deleted by an alarm after eight idle days.
- **User IDs:** HMAC of visitor and Company identifier, keyed from the agent identity. They are stable per visitor, unlinkable across visitors and Companies, and stored nowhere. `lib/user-identities.ts` is gone.
- **Identity:** the `POPPY_IDENTITY` Worker secret. It was generated and piped into `wrangler secret put` without being printed or written. Node still creates `.poppy/identity.json`.
- **Network** (`pap-client`): on Workers only public HTTPS hostnames or public IP literals are allowed, with no credentials, no `localhost`/`.local`/`.internal`/single-label names, and no redirects. `global_fetch_strictly_public` is on for all three Workers. Node still pins checked DNS answers; `node:dns` and `undici` are loaded lazily.
- **Public mode** (`lib/deployment.ts`): `POPPY_PUBLIC=true` with an HTTPS `AGENT_PUBLIC_ORIGIN`.
  - Chat accepts only Protocol demo, OpenAI-compatible and Anthropic, each with the visitor's own key. The server keys are used only on localhost in development.
  - Sign-in and proposals are allowed only for `PAP_ACCOUNT_ORIGINS` (Juniper and Lantern on poppylab.dev) and the PAP Sandbox. `client.json` always names the public origin.
- **Budgets** (`lib/limits.ts`, public mode):
  - chat: 8/min and 150/day per visitor, 20/min per IP, 600/min global;
  - account: 20/min per visitor, 40/min per IP;
  - discovery: 20/min per visitor, 40/min per IP.
    Counters are Durable Objects on Workers.
- **Build:** `pnpm --filter @poppy-lab/playground build:worker` (`scripts/build-worker.mjs`).
  - OpenNext copies `.env*` values into `next-env.mjs`; the first build contained the local model keys and was deleted before any deployment.
  - The script now empties that file and scans the whole bundle for every local secret-like value and the local identity. If it finds one, it deletes the artifact and fails, printing names only.
  - `NEXT_PUBLIC_JUNIPER_URL`/`NEXT_PUBLIC_LANTERN_URL` point the suggestions to poppylab.dev.
- **Verified in production** (version deployed 2 Nov 2026):
  - JWKS without a private part; `client.json` with `https://poppylab.dev` and Operations v2.
  - Discovery of Juniper and Lantern; private, HTTP and metadata URLs refused.
  - Protocol demo signed out: Juniper fetched `client.json` across Workers and verified the Session header.
  - Browser: read-only sign-in as Alex, read of deliveries, **Request change permission**, Thursday→Saturday proposed, approved and `succeeded`.
  - The 21st discovery in a minute returned 429; a cross-origin chat returned 403; a provider without a key returned 400.
- **Consent cookies:** each consent page has its own cookie (`pap_consent_<id>`), so a second tab or reload can't break another consent. This came up in the production run.

**Review fixes (3 November 2026):** per-visitor state on Workers is sealed with AES-256-GCM under the `POPPY_STATE_KEY` secret, bound to its row (`lib/sealed.ts`; records from before the key read as absent); a lost run lock merges the request's operations into the newer copy and logs `run_lock_lost`; the gateway saves only when state can change (non-GET, Session header, or an explicit mark) so website polls and discovery reads write nothing; the 16 KiB body limit is counted on the stream; no client may hold more than a fifth of the Session, token, grant or consent caps; the client-metadata cache evicts one entry instead of clearing; a turn counts only after discovery succeeds; a locked run is never evicted; only `UserFacingError` and discovery messages reach the browser; the Workers `fetchJson` bounds responses before reading.

**Open before calling it robust:** no CSP on Poppy pages yet (Next inline scripts need nonces); an edge rate-limit rule per IP in front of the Companies; the replaced-refresh-token revocation after sign-in is best effort and may be cut when the Worker response ends; and no live model run in production yet (it needs a visitor's own key in the browser).

## Deployment notes (when ready)

1. `wrangler login` on the operator machine, or a scoped API token.
2. Routes are set in each `wrangler.toml` (`custom_domain = true`); Wrangler creates the DNS record in the zone.
3. `pnpm --filter @poppy-lab/lantern deploy` / `pnpm --filter @poppy-lab/example-company deploy`; Poppy: `pnpm --filter @poppy-lab/playground build:worker` then `deploy:worker`.
4. Optional secrets: `wrangler secret put JUNIPER_PASSWORD_HASH` (or `LANTERN_PASSWORD_HASH`).

Lantern can go live on its own, as a public PAP 0.3 test Company that any agent with an HTTPS `client_id` can use. Poppy still needs its own port before `poppylab.dev` hosts the playground.

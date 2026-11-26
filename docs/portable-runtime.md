# Portable runtime: Cloudflare Workers and Node

Goal: run the same code on **Cloudflare Workers + Durable Objects** (`poppylab.dev`) and on **Node** (local development or a VPS).

## Pattern

The gateway (`packages/pap-company/src/gateway.ts`) is a 50-line composition of modules under `src/gateway/`: `types` (state, definition and deployment types), `context` (the shared state, replay cache, dirty flag, cookie and client-metadata helpers, DPoP helpers, per-request carriers), `persistence` (body limit, save-when-dirty, security headers), `discovery`, `signin` (Direct Sign-In), `tokens` (token and revocation endpoints), `sessions` (the `Poppy-Session` middleware for `/api/*`, the account prefixes and the conversation routes, with `extension_required`), `tenancy` (one business app per tenant, the Operations v3 gate, grant access, website dispatch) and `browser-session` (§6: the page, the authorization and the form that join a Personal Agent's browser to a Session, signed out). Middleware order is fixed in `createCompany`: body limit and persistence first, the Session middleware before the business dispatch.

- **`@poppy-lab/pap-client/core`** is the runtime-portable subset of the client library: Session header and delegations, DPoP proofs and assertions, the `Poppy-Approval` header. It uses Web APIs, `jose` and the parts of `node:crypto` that Workers provides with `nodejs_compat`. The DNS-pinned network client (undici) stays in the Node entry point.
- **`@poppy-lab/pap-company`** is a Poppy 1.0 Company gateway on **Hono**:
  - discovery metadata (RFC 8414/9728), Direct Sign-In and DPoP access tokens, refresh and RFC 7009 revocation;
  - verification of the delegated `Poppy-Session` header and one account per Session;
  - the extensions each request declares in `Poppy-Extensions` (`sessionFor(c).extensions`, name → version), and `extension_required` (HTTP 403, JSON body, §3.3) for a route the Company handles only with one;
  - Operations v3 through a pure engine (`approvals.ts`).

  A Company supplies a `CompanyDefinition`: its scopes, consent page, test customers, `poppy.json`, excluded tasks, OpenAPI contract and Hono routes. Its `consentExpired()` is the page a browser gets when it answers a consent page after that page's five minutes: it says the page ran out, that nothing was allowed, and to start the sign-in again from the agent. The gateway serves it only to the sheet's own form post, which carries the Company's `Origin` and asks for `text/html`; every other caller gets `invalid_request` as JSON, and so does a browser at a Company without the hook. Optional hooks serve domain extensions:
  - `requiredExtension({ path, method })` names the extension and version a route needs. The gateway checks it after `Poppy-Version` and the Session header and before the access token, since only a new Session that declares the extension can fix it. Operations v3 on account POSTs stays built in, checked after the scopes as before.
  - `selectResources({ persona, body, scopes })` picks what else an approved consent grants, such as accounts, from the consent form; `scopes` are the scopes the approval grants. The code and then the grant keep the list, and refreshes don't change it. Returning `{ refuse: "message" }` turns the approval down (400 `invalid_request` with that `error_description`), keeps the consent pending and issues nothing. In `mount`, `grantFor(c)` returns the grant behind the request's token (`id`, `scopes`, `resources`, `created_at`, `expires_at`), or nothing when signed out, on the website or in another tenant. Grants approved before `resources` or `created_at` existed lack them; each route decides what that means. A Company Agent's turn carries the same `resources` (`ConversationTurn.resources`), absent signed out and for a grant without them.
  - `accountPrefixes` (default `["/api/account"]`) lists the path prefixes of the account routes. Each gets the Session middleware, a token challenge (401 with `DPoP scope="…"`), the scopes of `requiredScopes` and, on POST only, Operations v3 and the replay of performed operations; other methods are the route's own business. Prefixes are matched as strings and may not cover `/oauth/`, `/.well-known/` or `/poppy/`. Paths outside every prefix (and outside `/api/*`) stay public, which is how a Company serves a second OpenAPI document signed out. `requiredScopes` may return an empty list for a route that needs a token of any scope and checks the rest itself; the challenge is then a bare `DPoP`.
  - `tokenFields(grant)` adds string fields to every token response of a grant, at the code exchange and at each refresh. Standard and error field names are never replaced; other agents ignore unknown fields (RFC 6749 §5.1). Harborline returns `consent_id` this way.
  - `grantLifetime(scopes)` returns how long a grant lasts, in milliseconds from the code exchange, from the scopes its consent granted. Without it every grant lasts `GRANT_MS` (7 days), as before. The end is stored with the grant: a refresh after it is `invalid_grant` (RFC 6749 §5.2), and no access token outlives it, so a refresh before it gets a token cut to the grant's end (`expires_in` says so). Sign-in still returns a refresh token (§4.4). A value that isn't a positive number fails the code exchange with `invalid_grant`. Harborline returns `TOKEN_MS` (1 hour) without `offline_access` and `GRANT_MS` with it, so a grant without it ends with its first access token; a Company such as a utility with an `offline_access`-style consent can do the same. Grants stored before a Company sets it keep their stored end. Juniper, Lantern and Northwind don't set it.

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

**Lantern Noodle Bar** is migrated (`apps/lantern`). It no longer lives in Juniper's directory.

- `pnpm dev` or `pnpm dev:lantern` runs it on Node at `http://noodles.localhost:4200`.
- `pnpm --filter @poppy-lab/lantern dev:worker` runs it in `workerd` (the Workers runtime) through Wrangler.
- `wrangler.toml`: `nodejs_compat`, SQLite-backed Durable Object `LanternCompany`, vars `PUBLIC_ORIGIN=https://food-demo.poppylab.dev`, custom domain `food-demo.poppylab.dev`, `workers_dev = false`.
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

**Juniper Market** is migrated too (`apps/juniper`). Fastify is gone from the repository.

- `src/juniper.ts` is its `CompanyDefinition`. The business modules (shopping, customer services, profiles, shopping edits, website/portal, Operations v3) are unchanged. They are written against `src/router.ts`, a small `(req, reply)` facade over Hono.
- `src/node.ts` (vault `juniper`, `protocolRequest`) and `src/worker.ts` (Durable Object `JuniperCompany`) are the entry points. `wrangler.toml` targets `grocery-demo.poppylab.dev`.
- The gateway gained what Juniper needed: optional RFC 9449 DPoP nonces (`deploy.dpopNonces`; the token endpoint challenges before the client assertion or grant is consumed, the API answers 401 `use_dpop_nonce`), grant listing/revocation for the website, and a 16 KiB body limit.
- The browser portal (`/site/*`, `/account`) only runs on the local origin. On Workers it answers 403 `local_demo_only`: all visitors would share the same fictional personas, so it waits for per-visitor isolation.
- **Tests:** `src/test-app.ts` gives tests a Fastify-like `inject`/`listen` over the Hono apps. The account tests were rewritten as HTTP tests against the gateway (consent subsets, Origin and cookie binding, PKCE, one-time codes, password, refresh without widening, revocation). The socket-loss test drops the response after the commit at the network layer. Total: 357 tests.
- **Verified live on Node with GPT-6 Luna:** read-only consent as Elena, read of orders and recurring delivery, **Request change permission**, then Thursday→Saturday proposed, approved and completed, and back to Thursday. Also on workerd (Wrangler dev): discovery, OpenAPI and health return 200, the API without a Session returns 400, and the portal returns 403.

## Harborline Bank

**Harborline Bank** is a third portable Company (`apps/harborline`) using the same `CompanyDefinition` and gateway.

- `pnpm dev:harborline` runs it at `http://harbor.localhost:4300`; the matching fictional customer portal is `/account`.
- `pnpm --filter @poppy-lab/harborline dev:worker` runs it under Wrangler. `wrangler.toml` targets `bank-demo.poppylab.dev`, binds the SQLite-backed `HarborlineCompany` Durable Object, and enables visitor isolation in the Worker entry point.
- The gateway now accepts an optional complete scope list, route-specific required scopes and Company-owned consent selection. Existing two-scope Companies keep their previous defaults. Harborline uses this to separate five read scopes, three reversible change scopes, irreversible payment/transfer scopes and optional `offline_access` without weakening Session, DPoP or Operations checks.
- All data is fictional. Payments and transfers only mutate the tenant's in-memory/persisted demo ledger after exact Operations v3 approval; stable idempotency keys reject conflicting reuse and repeated approvals return the first result.
- Tests cover discovery, consent subsets, DPoP-bound signed calls through the shared harness, reads, all mutations, limits, insufficient funds, inactive resources, stale state, replay, conversations and portal/API parity. Run `pnpm scenarios banking`.

Harborline has deployment configuration but is not claimed as deployed by this document.

## Northwind Air

**Northwind Air** is a fourth portable Company (`apps/northwind`) using the shared `CompanyDefinition` and gateway.

- `pnpm dev:northwind` runs it at `http://northwind.localhost:4400`; the matching fictional passenger portal is `/account`.
- `pnpm --filter @poppy-lab/northwind dev:worker` runs it under Wrangler. `wrangler.toml` targets `airline-demo.poppylab.dev`, binds the SQLite-backed `NorthwindCompany` Durable Object, and enables visitor isolation.
- Public tools cover flight search, cheapest dates, status, fare and baggage information, and fictional booking lookup. Signed-in tools cover trips, loyalty, preferences and approval-gated seat, baggage, cancellation, upgrade and flight changes.
- Tests cover Poppy 1.0 discovery, differentiated scopes, public and account tools, exact Operations v3 terms, stale fare/inventory revisions, idempotent execution, conversations and portal/API parity. Run `pnpm scenarios airline`.

Northwind has deployment configuration but is not claimed as deployed by this document.

## Per-visitor isolation

With `isolation: "visitor"` (the isolated Company Workers), the gateway gives every agent user its own copy of the Company's business data:

- **Tenant** = SHA-256 of `client_id` + user id from the signed `Poppy-Session` header. It is verified before routing.
- Each tenant gets its own mounted business app, seeded with the same fictional customers, and its own Operations v3 records (their terms and first responses contain business data).
- **Agent activity:** the gate forgets an operation once its approved revision expires (about ten minutes), while the change it made stays. So each tenant also keeps what the gate finished (`activity`, in `src/gateway/activity.ts`): the request's summary, whether it was applied, declined by the Company or refused because the account had changed, the result, who approved it and when; never the terms or the first response. A Company that refuses an approved request itself before the gate, for a reason the terms don't hold (Harborline's `insufficient_funds`), puts the attempt there with `ctx.refused(c, { key, terms, reason })`: it is kept as refused, with the reason as its result, only when the request's `Poppy-Approval` names a revision of that action that still waits and holds the `terms` given, and the operation is left as it is, so the revision can still be approved and is performed once. It holds the newest 20 per account (at most 5 of them requests that changed nothing) for 90 days, and 200 per tenant. A Company's website reads it with the waiting proposals through `ctx.activity(account)`. A waiting proposal whose agent can no longer reach the account, because the customer disconnected it, it revoked its own grant or the grant ended, is listed as `disconnected`, not as `proposed`, with a result that says so. Nothing is kept for that: each read looks for a grant of the proposal's agent and User for the account. An operation belongs to the agent, the User and the account (Operations §3), so a new consent by the same agent makes it `proposed` again, and it can be approved until it expires. The gate never reads the kept activity, so it doesn't count toward the gate's caps, answer a retry or make an old approval work again. A visitor's tenant that idles for 24 h starts again without it, like its other data.
- **Grant holder:** a grant serves only the (client, user) that first used it. Another user of the same client gets `invalid_token`.
- Eviction: at most `maxTenants` (500), least recently used first, and a tenant idle for `tenantIdleMs` (24 h) starts again from the seed data.
- Non-API routes (landing, discovery, consent) use the `shared` tenant. The Company website lists only grants held by the tenant itself, and one more kind: a grant has no holder until the agent first uses it, so until then the browser that approved its consent, and no other, has it in its list and can disconnect it there (the gateway keeps the request's browser while the tenant's routes answer it: `viewer` in `src/gateway/tenancy.ts`). The customer sees the agent they allowed, with a second consent's new permissions, without waiting for the agent's next request; before the first consent's first use the page still shows the browser's own copy of the data. `ctx.grants.list(account)` gives each one with the agent's `name` (its `client_name` when the grant was issued, kept with the grant; absent on grants from before that), the `host` of its verified address and `expires` as "Dec 2, 22:07 UTC", so a website can name a connected agent as the consent page did. Each Company sends the list with its `/site/state`, with the permission in the consent sheet's words (`consentWords` in `pap-core`), so the account page shows it without a button and keeps it current.
- **Website:** a browser on the Company website (`/account`, `/site/*`) gets its own copy until it approves an agent's consent; from that agent's first signed-in request it sees the agent user's copy. Its website logins (`webSessions` in the Company's state) move with it, so connecting an agent doesn't log the customer out, and the browser's own copy, which nothing leads to any more, is dropped. The login form keeps nothing on the server (`src/site-login.ts`: a token in a cookie and in the form), so a form opened before the move, or before the Durable Object was dropped from memory, still works.
- **Joined browsers (§6):** a browser that a Personal Agent joined to a Session (`src/gateway/browser-session.ts`) carries the Session's cookie, `poppy_session`. While that cookie works, the website dispatch gives the browser the copy of the Session's agent user, ahead of `pap_browser` and any link, and gives it no `pap_browser` cookie for that. Nothing is linked, so when the Session ends, after an hour without a request from the agent, the browser sees again what it saw before. The join copies the browser's own website logins to the Session's copy and moves none: they are the entries of `webSessions` that the hashes of the request's cookies name, in the copy the browser saw until then. The protocol state keeps the codes that were authorized or submitted (`joins`) and the joined browsers (`browsers`), each by a hash, and the key the codes and join cookies are made with (`joinKey`). Loading the page writes nothing.
- **Storage:** `splitStore` (Durable Objects) keeps the protocol state under `state` and each tenant under `tenant:<hash>`, writing only what the request touched and deleting evicted tenants. Previous single-copy state is moved to `shared` on load.
- Node defaults to `shared`, so the local Juniper portal shows the agent's changes; `COMPANY_ISOLATION=visitor` turns isolation on for a public VPS (one vault file, rewritten per request).

Verified by tests (Lantern: separate copies, stolen token, eviction and split persistence; Juniper: support-case text from one visitor is invisible to another) and on workerd: a second visitor saw the untouched order ($37.00) while the first visitor's change ($42.00) survived a restart.

Deployed: `https://noodles.poppylab.dev` (`334aa256`) and `https://juniper.poppylab.dev` (`7a5a276d`). Both serve discovery, metadata, excluded tasks and OpenAPI. The API without a Session header and plain-HTTP clients at authorize return 400; Juniper's portal returns 403.

**Still open for the public Companies:** global caps (2000 Sessions, 2000 tokens, 1000 grants) are shared by all clients; an edge rate-limit rule should go in front before Poppy is public.

## Poppy Lab on Workers (`https://poppylab.dev`)

The same Next.js app runs with `next dev`/`next start` on Node and on Cloudflare Workers through OpenNext (`@opennextjs/cloudflare` 1.20).

- **Per-visitor state** (`lib/runs.ts`): an unguessable `HttpOnly` visitor cookie (`__Host-poppy_visitor` over HTTPS, SameSite=Lax so the Company's redirect to the callback still identifies the visitor). Storage only sees its SHA-256.
  - Runs (tokens, keys, conversation) are keyed by visitor: at most five running per visitor, 30 minutes each. Ended ones stay as read-only transcripts without tokens or keys for seven days, up to 20 per visitor (see [conversation continuity](chat-continuity.md)).
  - Locking is compare-and-set on a version, with a two-minute lapse for a crashed request.
  - Backends: Node keeps memory plus the encrypted vault `visitor-runs`. Workers use one Durable Object `PoppyVisitor` per visitor (`worker/visitor.ts`), deleted by an alarm after eight idle days.
- **User IDs:** HMAC of visitor and Company identifier, keyed from the agent identity. They are stable per visitor, unlinkable across visitors and Companies, and stored nowhere. `lib/user-identities.ts` is gone.
- **Identity:** the `POPPY_IDENTITY` Worker secret. It was generated and piped into `wrangler secret put` without being printed or written. Node still creates `.poppy/identity.json`.
- **Network** (`pap-client`): on Workers only public HTTPS hostnames or public IP literals are allowed, with no credentials, no `localhost`/`.local`/`.internal`/single-label names, and no redirects. `global_fetch_strictly_public` is enabled on the deployed Workers. Node still pins checked DNS answers; `node:dns` and `undici` are loaded lazily.
- **Public mode** (`lib/deployment.ts`): `POPPY_PUBLIC=true` with an HTTPS `AGENT_PUBLIC_ORIGIN`.
  - Chat accepts only Protocol demo, OpenAI-compatible and Anthropic, each with the visitor's own key. The server keys are used only on localhost in development.
  - Sign-in and proposals are allowed only for `PAP_ACCOUNT_ORIGINS` (Juniper, Lantern, Harborline, Northwind and Fernwick on poppylab.dev; Fernwick's once it is deployed) and the PAP Sandbox. `client.json` always names the public origin.
- **Budgets** (`lib/limits.ts`, public mode):
  - chat: 8/min and 150/day per visitor, 20/min per IP, 600/min global;
  - account: 20/min per visitor, 40/min per IP;
  - discovery: 20/min per visitor, 40/min per IP.
    Counters are Durable Objects on Workers.
- **Build:** `pnpm --filter @poppy-lab/playground build:worker` (`scripts/build-worker.mjs`).
  - OpenNext copies `.env*` values into `next-env.mjs`; the first build contained the local model keys and was deleted before any deployment.
  - The script now empties that file and scans the whole bundle for every local secret-like value and the local identity. If it finds one, it deletes the artifact and fails, printing names only.
  - `NEXT_PUBLIC_JUNIPER_URL`, `NEXT_PUBLIC_LANTERN_URL`, `NEXT_PUBLIC_HARBORLINE_URL`, `NEXT_PUBLIC_NORTHWIND_URL` and `NEXT_PUBLIC_FERNWICK_URL` point the suggestions to poppylab.dev.
  - **Prerendered pages.** The Learn pages are prerendered (`generateStaticParams`), and OpenNext serves such pages only through an incremental cache; without one every `/learn` page was a 404 in production. `open-next.config.ts` uses the read-only static-assets cache, and the script copies `.open-next/cache` into `.open-next/assets/cdn-cgi/_next_cache` after the secret check, so the pages ship as Workers static assets. The build ends with "Prerendered pages copied to static assets." Dynamic routes are unaffected. A new Learn page needs nothing more than a build and a deploy.
- **Verified in production** (version deployed 2 Nov 2026):
  - JWKS without a private part; `client.json` with `https://poppylab.dev` and Operations v3.
  - Discovery of Juniper and Lantern; private, HTTP and metadata URLs refused.
  - Protocol demo signed out: Juniper fetched `client.json` across Workers and verified the Session header.
  - Browser: read-only sign-in as Elena, read of deliveries, **Request change permission**, Thursday→Saturday proposed, approved and `succeeded`.
  - The 21st discovery in a minute returned 429; a cross-origin chat returned 403; a provider without a key returned 400.
- **Consent cookies:** each consent page has its own cookie (`pap_consent_<id>`), so a second tab or reload can't break another consent. This came up in the production run.

**Review fixes (3 November 2026):** per-visitor state on Workers is sealed with AES-256-GCM under the `POPPY_STATE_KEY` secret, bound to its row (`lib/sealed.ts`; records from before the key read as absent); a lost run lock merges the request's operations into the newer copy and logs `run_lock_lost`; the gateway saves only when state can change (non-GET, Session header, or an explicit mark) so website polls and discovery reads write nothing; the 16 KiB body limit is counted on the stream; no client may hold more than a fifth of the Session, token, grant or consent caps; the client-metadata cache evicts one entry instead of clearing; a turn counts only after discovery succeeds; a locked run is never evicted; only `UserFacingError` and discovery messages reach the browser; the Workers `fetchJson` bounds responses before reading.

**Open before calling it robust:** no CSP on Poppy pages yet (Next inline scripts need nonces); an edge rate-limit rule per IP in front of the Companies; the replaced-refresh-token revocation after sign-in is best effort and may be cut when the Worker response ends; and no live model run in production yet (it needs a visitor's own key in the browser).

## Hostnames

The demo Companies are named by what they are: `grocery-demo.poppylab.dev` (Juniper Market), `food-demo.poppylab.dev` (Lantern Noodle Bar), `bank-demo.poppylab.dev` (Harborline Bank) and `airline-demo.poppylab.dev` (Northwind Air). They were `juniper`, `noodles`, `harborline` and `northwind` before; the dated deployment records below keep the names of their day. A Company's origin is its identifier, so the rename is a new identity: signed-in sessions and consents made at the old hosts do not carry over, and the old hosts are not redirected. Local development hosts (`juniper.localhost` and the others) are unchanged.

## Deployment notes (when ready)

1. `wrangler login` on the operator machine, or a scoped API token.
2. Routes are set in each `wrangler.toml` (`custom_domain = true`); Wrangler creates the DNS record in the zone.
3. Deploy the Companies with `pnpm --filter @poppy-lab/lantern run deploy`, `pnpm --filter @poppy-lab/juniper run deploy`, `pnpm --filter @poppy-lab/harborline run deploy`, and `pnpm --filter @poppy-lab/northwind run deploy`; deploy Poppy with `pnpm --filter @poppy-lab/playground build:worker` then `deploy:worker`.
4. Optional secrets: `wrangler secret put JUNIPER_PASSWORD_HASH`, `LANTERN_PASSWORD_HASH`, `HARBORLINE_PASSWORD_HASH` or `NORTHWIND_PASSWORD_HASH` in the corresponding workspace.

Lantern can go live on its own, as a public Poppy 1.0 test Company that any agent with an HTTPS `client_id` can use. Poppy still needs its own port before `poppylab.dev` hosts the playground.

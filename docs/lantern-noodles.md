# Lantern Noodle Bar — local PAP 0.3 sandbox

A second **fictional** example Company, so Poppy can be tested against more than one PAP 0.3 Company without depending on third-party services. It replaces the role the public PAP Sandbox played, which still uses 0.2 Sessions and Operations v1 (and is an independent project, not affiliated with the protocol's authors). Lantern Noodle Bar is also independent and unaffiliated; "Personal Agent Protocol" and "Poppy" are the authors' names. Nothing is sold, charged or delivered.

> **Update:** Lantern now lives in `apps/lantern` on the portable Hono gateway (`@poppy-lab/pap-company`) and runs on Node and on Cloudflare Workers + Durable Objects. See [portable runtime](portable-runtime.md). The Fastify notes below describe the first version.

## Run

`pnpm dev` now starts Poppy (3000), Juniper (4100) and Lantern (4200). On its own: `pnpm --filter @poppy-lab/example-company dev:noodles`. In Poppy, choose **Lantern Noodle Bar** under the Company URL, or enter `http://noodles.localhost:4200`. As with Juniper, the private-network exception applies only to these exact local origins, in development, with `PAP_ALLOW_PRIVATE_NETWORK=true`.

## What it is

|                     |                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Issuer / identifier | `http://noodles.localhost:4200` (own issuer, own User IDs)                                                                                    |
| Scopes              | `orders:read` (hint `none`, personal data), `orders:write` (hint `irreversible`: a change can cost more). `orders:write` alone doesn't read.  |
| Test customers      | Sam Rivera (order `ord_LNB1001`, Friday 18:30, 2 × shoyu ramen + edamame) and Robin Ito (order `ord_LNB2001`, Saturday 12:30, 1 × miso ramen) |
| Public API          | `GET /api/menu`, `GET /api/delivery-slots`                                                                                                    |
| Account API         | `GET /api/account/orders`, `GET /api/account/orders/{id}` (orders:read)                                                                       |
| Change              | `POST /api/account/orders/{id}/changes` `{ slot_id?, add?: [{dish_id, quantity}], remove?: [dish_id] }` (orders:write), Operations v2         |
| Excluded tasks      | Cancel an order (alternative: move it, with an `openapi` reference to `change_order`); change the delivery address                            |
| State               | Encrypted vault `noodles`, separate from Juniper's                                                                                            |

It reuses the same PAP 0.3 gateway as Juniper, parameterized by a `CompanyDefinition` in `pap.ts`. That gateway provides:

- discovery metadata (RFC 8414/9728);
- OAuth with PKCE and `private_key_jwt`;
- DPoP access tokens and verification of the delegated `Poppy-Session` header;
- one account per Session;
- refresh and revocation.

The shared Operations v2 engine now lives in `approvals.ts`, and Juniper uses it too.

**Changes.** A change re-prices the whole order (with USD 3.00 delivery) and returns 403 `approval_required`. The terms carry the before and after slot, the new dishes, the old and new totals and the price difference. The summary states the exact amount.

- **Operation identity:** the key is `order:{id}:{version}`. Asking for different changes to the same order version gives the same `operation_id` and new revisions.
- **At most once:** once one revision is performed, any other revision of that operation gets the first response, and nothing else is applied. A new request after that is a new action on the new version.
- **Validation:** strict. Unknown fields, dishes or slots, quantities outside 1–5, no-op changes and removing every dish are rejected with 400.

## Evidence

Live, with **GPT-6 Luna**, against the running Company:

1. Signed-out menu read through the Session header (5 tools generated from its OpenAPI).
2. Write consent requested `orders:read orders:write` (from hints) for Sam.
3. "Move my scheduled order to Saturday 19:00 and add one portion of pork gyoza." The model called `change_order`, explained the pending terms ($45.00, $8.00 more than $37.00) and didn't claim it was done.
4. Approval in Poppy resent the request with `Poppy-Approval`, and the order changed.
5. "Show my order now" confirmed Saturday 19:00–19:30 and $45.00.
6. Sign-out.

This is fictional data in Lantern's own new vault.

`apps/lantern/src/lantern.test.ts` (14 tests, `pnpm scenarios noodles`) covers, against the real gateway with signed Session headers and DPoP:

- metadata and the OpenAPI contract, with Juniper's routes absent;
- a signed-out menu read and a 401 challenge with `scope="orders:read"`;
- approve-once with replay;
- refusal of another customer's approval and of read-only tokens;
- revision semantics;
- invalid changes.

The full suite has 362 tests.

## Website (3 November 2026)

`noodles.poppylab.dev` is now a read-only restaurant site: a home page with the menu, delivery slots, how ordering works and hours; `/for-agents` with the endpoints, scopes and test customers; and the consent page in the same style. It is server-rendered with no JavaScript and takes its menu, slots and customers from `src/data.ts`, the same module the API uses. The gateway gained `pages`, `pageHeaders` and `fontSources` on `CompanyDefinition` for this.

### Customer account area

`/site/login`, `/account` and `/site/*` (`src/portal.ts`, browser script `src/site/app.js`) give Lantern the same capabilities as Juniper's portal, in Lantern's terms: sign in as Sam or Robin; a live view (2 s polling) of the scheduled orders the agent reads; **Edit order** (slot and dish quantities), which moves the order's version on so a pending agent proposal becomes stale; the agent's activity from the tenant's Operations v2 records (exposed read-only to `mount` as `operations()`); connected agents with revocation; logout. POSTs need the session cookie, the Company's Origin and an `X-Lantern-Account` header naming the account the page was opened for. The gateway routes each browser to its own tenant, or to the agent user's tenant once that browser approved the agent's consent.

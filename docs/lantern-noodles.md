# Lantern Noodle Bar — local Poppy 1.0 sandbox

A second **fictional** example Company, so Poppy can be tested against more than one Poppy 1.0 Company without depending on third-party services. It replaces the role the public PAP Sandbox played, which still uses 0.2 Sessions and Operations v1 (and is an independent project, not affiliated with the protocol's authors). Lantern Noodle Bar is also independent and unaffiliated; "Personal Agent Protocol" and "Poppy" are the authors' names. Nothing is sold, charged or delivered.

> **Update:** Lantern now lives in `apps/lantern` on the portable Hono gateway (`@poppy-lab/pap-company`) and runs on Node and on Cloudflare Workers + Durable Objects. See [portable runtime](portable-runtime.md). The Fastify notes below describe the first version.

## Run

`pnpm dev` now starts Poppy (3000), Juniper (4100) and Lantern (4200). On its own: `pnpm --filter @poppy-lab/lantern dev`. In Poppy, choose **Lantern Noodle Bar** under the Company URL, or enter `http://noodles.localhost:4200`. As with Juniper, the private-network exception applies only to these exact local origins, in development, with `PAP_ALLOW_PRIVATE_NETWORK=true`.

## What it is

|                     |                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issuer / identifier | `http://noodles.localhost:4200` (own issuer, own User IDs)                                                                                         |
| Scopes              | `orders:read` (hint `none`, personal data), `orders:write` (hint `irreversible`: a change can cost more). `orders:write` alone doesn't read.       |
| Test customers      | Elena Maren (order `ord_LNB1001`, Friday 18:30, 2 × shoyu ramen + edamame) and Robin Ito (order `ord_LNB2001`, Saturday 12:30, 1 × miso ramen)     |
| Public API          | `GET /api/menu` (each dish has an `image` URL, see [product photos](product-photos.md)), `GET /api/delivery-slots`                                 |
| Account API         | `GET /api/account/orders`, `GET /api/account/orders/{id}` (orders:read)                                                                            |
| Change              | `POST /api/account/orders/{id}/changes` `{ slot_id?, add?: [{dish_id, quantity}], remove?: [dish_id] }` (orders:read, orders:write), Operations v3 |
| Excluded tasks      | Cancel an order (alternative: move it, with an `openapi` reference to `change_order`); change the delivery address                                 |
| Skills              | `change-scheduled-order`, a `SKILL.md` at `/poppy/skills/change-scheduled-order/SKILL.md`, listed in the tasks response's `skill_index` (§9.4)     |
| State               | Encrypted vault `noodles`, separate from Juniper's                                                                                                 |

It reuses the same Poppy 1.0 gateway as Juniper, parameterized by a `CompanyDefinition` in `src/lantern.ts`. That gateway provides:

- discovery metadata (RFC 8414/9728);
- OAuth with PKCE and `private_key_jwt`;
- DPoP access tokens and verification of the delegated `Poppy-Session` header;
- one account per Session;
- refresh and revocation.

The shared Operations v3 engine now lives in `approvals.ts`, and Juniper uses it too.

**Changes.** A change re-prices the whole order (with USD 3.00 delivery) and returns 403 `approval_required`. The terms carry the before and after slot, the new dishes, the old and new totals and the price difference. The summary states the exact amount.

- **Operation identity:** the key is `order-change:{id}:{n}`, where `n` counts the changes an approval has applied to the order. The operation is the next change to that order: asking for different changes gives the same `operation_id` and new revisions, and so does asking again after the order was edited on the website, because the terms are built from the order as it is at each request.
- **Stale approvals:** the terms carry the order's version. An approval of terms the order no longer matches performs nothing and returns `approval_required` with the same `operation_id` and a new revision for the order as it is now.
- **At most once:** once one revision is performed, any other revision of that operation gets the first response, and nothing else is applied. A new request after that is a new operation.
- **Validation:** strict. Unknown fields, dishes or slots, quantities outside 1–5, no-op changes and removing every dish are rejected with 400.

## Evidence

Live, with **GPT-6 Luna**, against the running Company:

1. Signed-out menu read through the Session header (5 tools generated from its OpenAPI).
2. Write consent requested `orders:read orders:write` (from hints) for Elena.
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

`food-demo.poppylab.dev` is now a read-only restaurant site: a home page with the menu, delivery slots, how ordering works and hours; `/how-it-works`, which shows a visitor the three steps with a personal agent (the discovery document as served, the API's operations, and the ticket a change waits on) built from the same objects the endpoints serve; `/for-agents` with the endpoints, scopes, skills and test customers; and the consent page in the same style. It is server-rendered with no JavaScript and takes its menu, slots and customers from `src/data.ts`, the same module the API uses. The gateway gained `pages`, `pageHeaders` and `fontSources` on `CompanyDefinition` for this.

### Customer account area

`/site/login`, `/account` and `/site/*` (`src/portal.ts`, browser script `src/site/app.js`) give Lantern the same capabilities as Juniper's portal, in Lantern's terms: sign in as Elena or Robin; a live view (2 s polling) of the scheduled orders the agent reads; **Edit order** (slot and dish quantities), which moves the order's version on so a pending agent proposal becomes stale; the agent's activity, from the tenant's waiting Operations v3 proposals and its kept record of the requests that were applied or not (given to `mount` as `activity(account)`; see [portable runtime](portable-runtime.md)); connected agents with revocation; logout. POSTs need the session cookie, the Company's Origin and an `X-Lantern-Account` header naming the account the page was opened for. The gateway routes each browser to its own tenant, or, once it approved an agent's consent, to the agent user's tenant from that agent's first signed-in request on.

### An agent's browser

An agent's own browser can be joined to the agent's Session at `/poppy/browser-session` ([Poppy 1.0, Web browsing](poppy-1.0.md#web-browsing-6)). Joined with an access token that has `poppy:browser-sign-in`, it is signed in to the token's account on `/account`, in place of any login it had, and the page tells it so: "This browser belongs to an agent's session. It is signed in through the agent and shows what you allowed the agent to read. Nothing can be changed here: changes are made through the agent and wait for your approval there." A part it has no scope for is left out and named with the scope to ask for.

| On the account page                                                                       | A joined browser                                                                          |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Scheduled orders, last delivery with its refunds                                          | Sees them with `orders:read`                                                              |
| The customer's name, the menu and the delivery slots                                      | Sees them signed in                                                                       |
| Agent activity, feedback from agents, connected agents                                    | Never sees them: they are the customer's own                                              |
| The customer's own controls: edit an order, disconnect an agent, switch customer, log out | Not rendered, and every request that isn't a read is refused with 403 `read_only_browser` |

Without a token the joined browser is signed out: `/account` sends it to `/site/login`, which shows it no form. A customer's own browser, logged in on the website, keeps every control, whether or not an agent's browser is joined to the same copy. `src/browser-session.test.ts` runs the suite every Company shares (`browserJoinSuite` in `@poppy-lab/pap-company/testing`): the scope and its consent line, the signed-in join end to end, each part with and without its scope, every writing route refused, and the customer's browser unaffected.

## Company Agent (4 November 2026)

Lantern lists `agent.protocols` with a `poppy` endpoint at `/poppy/conversations`. Its agent answers structured requests: `opening_hours`, `delivery_info`, `order_status` and `report_missing_item`. A missing dish from the last delivery (`ord_LNB0907` for Elena, `ord_LNB1907` for Robin) gets a refund proposal, performed once after approval. The account page shows it under "Last delivery" and in the agent's activity. A handoff says nobody can join and gives +1 555-0142, a fictional number. Details in [conversations](conversations.md).

# Juniper customer website

Open **http://juniper.localhost:4100/account** or use **Sign in to your account** on the Company homepage. The site shares the selected persisted fictional account used by the Poppy APIs (Elena or Robin), not a duplicate frontend dataset. Customers can now [edit the basket and recurring delivery](juniper-shopping-web.md), edit a versioned fictional profile and submit/follow up on support cases. Billing remains read-only; website shopping edits do not create orders. [Profile changes](juniper-profile.md) affect only future purchases and invalidate older checkout proposals, without rewriting existing orders. See the [service foundation and its limits](juniper-services.md).

The public page **http://juniper.localhost:4100/how-it-works** shows a visitor the three steps with a personal agent: the discovery document as served, the API's operations grouped by what each needs from the customer, and Elena's recurring delivery moving from Thursday to Saturday, waiting for approval. It is built from the same objects the endpoints serve, and a test holds it to them.

## Flow

1. Enter as Elena in demo mode, or supply the dedicated local password if configured with `node apps/juniper/scripts/set-password.mjs`.
2. Keep Juniper open beside Poppy Lab.
3. Ask the agent for a basket, recurring-delivery, or checkout proposal.
4. Juniper shows the proposal as pending, without changing the account's basket/delivery/order data.
5. Approve in Poppy. Juniper automatically shows the committed update within roughly two seconds while the tab is visible.

The home page shows a generated photo for each product, and `GET /api/products` gives its address as `image`; see [product photos](product-photos.md). The customer page shows basket line items/totals, recurring delivery products/day/totals, expandable order details, and the agent's activity: the proposals that wait, then each request that was applied or not, with who approved it and when. A finished request stays listed after the gateway has forgotten its operation (the newest 20 per account, for 90 days). Expired proposals are labeled expired, not pending. A waiting proposal says until when it can be approved, and that nothing changes if the customer declines it in the agent or lets it run out: the agent sends an approval or nothing (Operations §5), so a proposal declined there reads as awaiting until it expires. Once the agent that proposed it is no longer connected to the account (the customer pressed Disconnect, the agent signed out, or its access ended), the proposal reads "Agent disconnected" in place of "Awaiting approval": it can't be approved now, and it can still be approved if the same agent is connected again before the proposal expires. Original Company summaries may be in English; the surrounding customer interface is Spanish.

## Browser security

The website uses its own 30-minute session, with an opaque HttpOnly SameSite=Strict cookie and a hashed server-side session record persisted in the Company's encrypted snapshot. The login form carries a five-minute token that must match a cookie of the same browser, and its Origin is checked; nothing about an open form is kept on the server, so a form opened before a restart still works, and an expired one gets a page with a link back to the login. Password attempts are process-rate-limited. The configured local scrypt password is the same as the OAuth consent flow's password and never enters Poppy or model context. Without a password, the explicit fictional-persona demo does not verify a real identity.

The `/site/state` projection contains customer data, operation summaries and the account's connected agents (each grant's public ID, the agent's name, host and address, its permission and when it ends) only: no access or refresh tokens, DPoP proofs, private keys or agent credentials. State and account pages use no-store headers. Customer login and state accept same-origin requests from Juniper's own website only. Browser logout invalidates the website cookie/server record; it does **not** revoke an agent's Poppy grant. Sign out in Poppy to revoke its current grant, or use **Connected agents** on Juniper to revoke a selected authorization belonging to the current account. See [personas and revocation](juniper-personas.md).

This is normal website login, **not Poppy browser Session joining**. Agent DPoP APIs remain protected independently. The website does not confirm agent operations, place orders, or share its cookie with Poppy. Basket/recurring edits, case submission/follow-up and profile saves are explicit browser actions protected by the website session and exact Origin, not by a Poppy token.

## An agent's browser

An agent's own browser can be joined to the agent's Session at `/poppy/browser-session` ([Poppy 1.0, Web browsing](poppy-1.0.md#web-browsing-6)). Joined with an access token that has `poppy:browser-sign-in`, it is signed in to the token's account on `/account`, in place of any login it had, and the page tells it so: "This browser belongs to an agent's session. It is signed in through the agent and shows what you allowed the agent to read. Nothing can be changed here: changes are made through the agent and wait for your approval there." A part it has no scope for is left out and named with the scope to ask for.

| On the account page                                                                                                                                    | A joined browser                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Basket, recurring delivery, orders, billing documents, support cases, profile                                                                          | Sees them with `poppy:read`, Juniper's one read scope; without it the page shows only who is signed in, and runs no script |
| Agent activity, feedback from agents, connected agents                                                                                                 | Never sees them: they are the customer's own                                                                               |
| The customer's own controls: the basket, delivery and profile editors, the support forms and follow-ups, disconnect an agent, switch customer, log out | Not rendered, and every request that isn't a read is refused with 403 `read_only_browser`                                  |

Without a token the joined browser is signed out: `/account` sends it to `/site/login`, which shows it no form. A customer's own browser, logged in on the website, keeps every control, whether or not an agent's browser is joined to the same copy. `src/browser-session.test.ts` runs the suite every Company shares (`browserJoinSuite` in `@poppy-lab/pap-company/testing`): the scope and its consent line, the signed-in join end to end, each part with and without its scope, every writing route refused, and the customer's browser unaffected.

## Live updates

A same-origin, CSP-restricted external script polls every two seconds while visible, with a six-second timeout, no overlapping requests, and immediate refresh on returning to the tab. Manual refresh is available. Unchanged snapshots do not rebuild the DOM. Failures keep the last successful view and show a retry message; expired sessions return to login. Screen-reader status text is not reannounced on every successful poll. Dynamic Company content is inserted with textContent, never interpreted as HTML.

There are no model calls for polling. The Company still uses single-writer local snapshots; this is not a public multi-user deployment. All orders, customer information, payments and shipments remain fictional.

## Verification

Tests cover browser-bound login, cross-origin rejection, password enforcement, expiry, logout, no secret fields, and shared before/proposal/after account state. A two-window browser test also confirmed that approved recurring-orange removal appeared automatically in the customer website, leaving the basket unchanged. Desktop and 390px mobile captures showed no horizontal page overflow. Public deployment and independent security-audit requirements remain unchanged.

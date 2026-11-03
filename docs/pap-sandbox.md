# PAP Playground example Companies

## Implemented and verified boundaries

Poppy now discovers the three public example Companies used by papplayground.com:

- https://food.papsandbox.com — Kettle Street Noodles
- https://flowers.papsandbox.com — Northlight Flowers
- https://stays.papsandbox.com — Harbour Row Stays

Live discovery returned PAP **0.1** for all three, with issuer/domain binding validated by the existing safe transport. The schema now retains either supported version (0.1 or 0.2) instead of relabeling 0.1 as 0.2. Unknown versions remain rejected. This is compatibility for implemented discovery/Session/API/Operations flows, not complete support for every interface in either draft.

Captured public OpenAPI contracts are regression fixtures under `packages/pap-client/src/fixtures`. Tests generate all four tools per Company: public searches/dates/rates, account reads, and order/booking proposals. Supported bounded arrays/objects handle Food/Flowers add/replace/remove lists; validated date strings handle Stays. Scope annotations `x-poppy-scope` and DPoP security scopes are recognized alongside Juniper’s plural annotation.

Proposal POST authority is independently restricted to these **three exact HTTPS origins** and local Juniper. A response declaration for HTTP 202 containing an Operations reference identifies a Sandbox proposal; merely declaring it at another Company does not enable POST. Operations and OAuth control routes remain excluded from model tools. No wildcard `*.papsandbox.com` trust is granted.

Account sign-in, refresh, revocation and Operations transport use the validated Company endpoints. Pending OAuth state binds the issuer. Confirmation remains an exact-revision same-origin browser action, never a model tool. Juniper retains its fixed localhost client registration even when a separate public Sandbox identity is configured.

## Live verification

With explicit user approval, a Cloudflare quick tunnel was started against the restricted relay (port 4101), not the playground. Its HTTPS origin was added to the ignored local environment without changing model configuration. Next picked up the change without terminating user services.

Real configured-model tests passed against all three Companies:

- **Food:** ES256/private-key-authenticated signed-out Session, DPoP menu and delivery-slot reads, Company-hosted Direct Sign-In, scoped account Session, order read, generated nested proposal POST, and human-interface Check status.
- **Flowers:** signed-out catalogue/dates, Company-hosted Direct Sign-In, scoped order read, bouquet replacement/card proposal and status recovery. A subsequent order read still showed the original Spring Tulips, no card and USD 30.00 rather than the pending peonies/card/USD 51.00.
- **Stays:** signed-out availability/rates, Company-hosted Direct Sign-In, scoped booking read, proposal to shift both dates seven days and add breakfast for two, and status recovery. A subsequent booking read still showed October 23–25 on Flexible rather than the pending October 30–November 1 on Flexible with breakfast.

Food proposed moving a Friday delivery to Saturday and adding pork gyoza, changing the proposed total from USD 39.49 to USD 47.49. A subsequent authoritative order read still showed Friday, no gyoza and USD 39.49. The proposal was **not confirmed**. All three account flows have now been verified through pending proposal and status recovery. Remote confirmation, revocation and token refresh are not yet live-verified; no remote business change has been confirmed.

External HTTPS checks confirmed public client metadata/JWKS availability and HTTP 404 for chat/account APIs, environment files and private identity storage. The relay does not publish the whole application. Its process and tunnel are temporary; the current origin lives only in the ignored local environment. Owned service PIDs and the public URL are tracked in `/tmp/poppy-identity-{relay,tunnel}.pid` and `/tmp/poppy-identity-tunnel-url.txt`.

The live proposal also exposed a presentation issue: readable formatting could omit nested technical fields. **All exact terms** now retains complete lossless JSON under its disclosure; the initial review remains readable. A regression test verifies retained line IDs, variants and raw prices. Desktop/mobile inspection and an exact JSON comparison passed.

## Structured approval review

Sandbox approvals now show observed before→proposed after dates, changed/added/removed lines, card text, rate plan, prices and declared cancellation conditions. Original Company summaries and complete exact terms remain unchanged. See [approval-review.md](approval-review.md) for snapshot provenance, unversioned data warnings and derived-total rules.

## Safe local setup: publish only identity and callback relay

Do **not** tunnel port 3000: that would expose the unprotected playground and model APIs.

The development-only relay serves exactly:

- GET `/agent/client.json`: public client metadata.
- GET `/agent/jwks.json`: public EC keys only; private fields fail closed.
- GET `/api/account/callback`: a bounded OAuth callback for the three exact Sandbox issuers and `https://api.ample.computer/poppy` only, redirected to the fixed `http://localhost:3000/api/account/callback` in your browser. The local application still validates cookie/state/issuer/PKCE and exchanges the code itself.

All other routes and methods are refused. The relay never forwards cookies, tokens, arbitrary headers or arbitrary destination URLs. It has response bounds, timeouts, connection and request-rate limits; it does not log request URLs or callback values. A tunnel provider still terminates public HTTPS, so use a provider you trust. OAuth codes are one-time and PKCE-bound; Account Tokens and signing keys never traverse the relay.

After explicitly choosing to publish these public endpoints:

1. Keep Poppy running locally at `http://localhost:3000`.
2. Start the restricted listener from the repository root:
   ```sh
   node apps/playground/scripts/identity-relay.mjs
   ```
3. In another terminal, tunnel **only the relay**:
   ```sh
   cloudflared tunnel --url http://127.0.0.1:4101
   ```
4. Add the generated HTTPS origin to `apps/playground/.env.local`, preserving all existing model/key values:
   ```dotenv
   AGENT_PUBLIC_ORIGIN=https://your-assigned-host.trycloudflare.com
   ```
5. Restart only the playground, preserving the Company process. Until restart, the relay may return 503 for the public identity.
6. Enter one of the three Company URLs in Poppy, Connect, select a configured LLM and sign in on the Company’s own page. Poppy shows the Company name and declared PAP version. The no-LLM natural-language router remains Juniper-specific; use a real model for the remote stores.
7. First verify a read. Then propose one change and check the displayed Company summary and exact terms. Only click Approve if you intend to apply that fictional change. For an uncertain result, Check status rather than proposing again.

The public callback is advertised at the relay origin but ultimately opens localhost in **the same browser on the same machine**. It is not a hosted multi-user login. Keep both listeners and the tunnel alive during sign-in. Sign out/revoke remote grants before closing a temporary identity tunnel. If its URL changes, restart Poppy with the new origin and start a fresh remote connection/sign-in; the previous client identity and grants do not migrate automatically.

Public deployment of the full playground remains unapproved and disabled by default. Production account routes remain disabled. General Company sign-in, conversations and browser Session joining remain out of scope. The separate [Ample MCP read-only integration](ample-readonly.md) is fixture-tested; its [public identity relay was renewed](identity-relay-renewal.md), without authorizing an Ample account.

# Build a Company

This guide shows how to add Personal Agent Protocol to systems you already
run, one milestone at a time. It is for developers of a business or service
with an HTTPS site, an API and a customer login. [Poppy compared](compared.md)
explains what a Company gets for the work.

## Before you start

If you use a coding agent, start with the official
[Company kit](https://personalagentprotocol.org/kit/company): its skill designs
and builds this, following these milestones, and its validator checks each one.
The validator needs Node 22.18 or later; [Validator results](validator.md)
shows the setup.

Decide four things before you write code:

| Decision              | Options                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| Which interfaces      | OpenAPI, MCP, a conversation endpoint for your Company Agent, browser join |
| Which sign-in types   | None, Direct (browser redirect), Device (code on another screen), Mediated |
| Which scopes          | Your own                                                                   |
| Which Personal Agents | Any agent with an HTTPS `client_id`, or an allowlist                       |

Spend the most time on scopes. Your consent page shows them to customers, so
describe each for the person approving. State in `scope_hints` what it changes (`none`,
`reversible`, `irreversible`) and whether it touches personal data. Split
reading from changing, and irreversible from reversible changes, so an agent
that only looks never asks for more.

This guide builds Direct Sign-In and leaves out browser join. The
[guides](https://personalagentprotocol.org/docs/1.0/guides#companies) cover
Device and Mediated Sign-In.

![A vertical rail of five milestones, numbered 0 to 4, each adding to the ones before it. Milestone 0, be found, is one static file with no sign-in that tells agents who you are and what exists, and a Company that only wants that can stop there. Milestone 1, foundation, makes agents identifiable, with metadata, a verified Session header and a record of each Session, and milestone 2, interfaces, offers what anyone may see, signed out, through the interfaces the Company already has. Milestone 3, sign-in, lets a user connect an agent the Company never registered, and milestone 4, operations, makes every consequential change wait for the user's approval of its exact terms.](../../apps/playground/public/learn-media/diagrams/company-milestones.svg "Five milestones, each adding to the ones before it, from being found to approving every consequential change.")

## Milestone 0: be found

Publish one static file, with no sign-in, that tells agents who you are and
what already exists. Serve it at `/.well-known/poppy.json` on your domain:

```json
// https://shop.example/.well-known/poppy.json
{
  "protocol_version": "1.0",
  "organization": { "name": "Example Shop", "domain": "shop.example" },
  "apis": [
    {
      "type": "openapi",
      "url": "https://shop.example/openapi.json",
      "description": "Products, stock and opening hours"
    }
  ]
}
```

Set `organization.domain` to the host that serves the file, with its port when
it isn't 443
([§3.1](https://personalagentprotocol.org/docs/1.0/spec#fields)). Leave out
`auth`: without it, agents won't try to sign in. Check the file offline:

```sh
node validate/index.ts check --file poppy.json
```

You know it works when the validator reports no failures and the file's URL
returns the same JSON.

If you only want agents to find your website and public API, stop here.

## Milestone 1: foundation

Make agents identifiable.

### Metadata

- Add `auth` to `poppy.json` with your issuer and scopes.
- Publish protected resource metadata at `/.well-known/oauth-protected-resource`
  ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) naming that issuer.
- Make the issuer's metadata
  ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) say
  `client_id_metadata_document_supported: true`, `private_key_jwt` with ES256
  and PS384, and the grant types you support.
- Send `Cache-Control` with a short `max-age` on every metadata document,
  because agents and Companies fetch them often.

[One task, request by request](one-task.md#2-find-the-authorization-server)
shows real examples.

### Verifying the Session header

Every request from an agent carries a `Poppy-Session` JWT. Verify it
([§5.3](https://personalagentprotocol.org/docs/1.0/spec#session-verification)),
in outline with [jose](https://github.com/panva/jose):

```ts
import {
  decodeProtectedHeader,
  decodeJwt,
  jwtVerify,
  importJWK,
  calculateJwkThumbprint,
} from "jose";

async function verifySession(
  jwt: string,
  req: { method: string; url: string; accessToken?: string },
) {
  const header = decodeProtectedHeader(jwt);
  if (header.typ !== "poppy-session+jwt" || header.alg !== "ES256")
    throw invalid();
  const clientId = decodeJwt(jwt).iss as string; // only to find keys; trusted after verifying

  // 1. The agent's keys: its client metadata, then its jwks_uri. No redirects,
  //    no private addresses, cached briefly.
  const keys = await agentKeys(clientId);

  // 2. The delegation in poppy_dlg, signed by one of those keys, names the
  //    short-lived key that signed this JWT.
  const dlg = String(header.poppy_dlg);
  const root = keys.find((k) => k.kid === decodeProtectedHeader(dlg).kid);
  if (!root) throw invalid();
  const { payload: delegation } = await jwtVerify(dlg, await importJWK(root), {
    typ: "poppy-delegation+jwt",
    issuer: clientId,
  });
  const cnf = (delegation.cnf as { jwk: JsonWebKey }).jwk;
  if ((await calculateJwkThumbprint(cnf)) !== header.kid) throw invalid();

  // 3. The Session JWT itself, for this request, recently signed.
  const { payload } = await jwtVerify(jwt, await importJWK(cnf, "ES256"), {
    typ: "poppy-session+jwt",
    issuer: clientId,
    audience: COMPANY_IDENTIFIER, // compared character for character
    maxTokenAge: "60s",
  });
  if (payload.iat! > delegation.exp!) throw invalid();
  if (payload.htm !== req.method || payload.htu !== withoutQuery(req.url))
    throw invalid();
  if (
    req.accessToken ? payload.ath !== sha256url(req.accessToken) : payload.ath
  )
    throw invalid();

  // 4. The Session: client, sid and user together name it.
  return session(clientId, payload.sid as string, payload.sub as string);
}
```

Answer every failure with `400 {"error": "invalid_session"}`. The lab's gateway
uses the full
[`verifySessionHeader`](../../packages/pap-client/src/session-header.ts), with
size limits, claim checks and a replay cache.

### Session records

Key each Session by the agent's `client_id`, the `sid` it chose and the user
ID. Store who it is for, when it was last used and, once the user signs in,
which account. Three rules:

- Start a signed-out Session for an unknown combination, and continue a known
  one.
- Keep one account in each Session. When a token for a second account arrives,
  end the Session with `session_ended` and let the agent start a new one; don't
  rebind it ([§5.4](https://personalagentprotocol.org/docs/1.0/spec#sign-in)).
- End Sessions when idle. Lantern's gateway slides the limit by an hour on each
  request.

Put the verification in front of your API as gateway middleware, and pass the
verified client, user and Session to backend services as headers or context;
the services don't change.

You know it works when a request with a tampered `Poppy-Session` answers
`invalid_session`, and the validator, run with `--probe` naming a signed-out
`GET` that succeeds, reports no failures:

```sh
node validate/index.ts check https://shop.example --probe "https://shop.example/api/products"
```

## Milestone 2: interfaces

Offer what anyone may see, signed out, through the interfaces you already have.

- **OpenAPI.** Give every operation an `operationId` and a description written
  for a model choosing between tools, and declare the scopes each needs: an
  agent turns each operation into a tool, so a vague description means a wrong
  choice.
- **Tasks and feedback.** List what you deliberately don't offer through the
  protocol at `tasks.endpoint`, with an alternative where there is one, and take
  feedback reports
  ([§9](https://personalagentprotocol.org/docs/1.0/spec#task-coverage)).
- **Conversations.** If you have a support chat or a Company Agent, offer the
  conversation endpoint
  ([§8](https://personalagentprotocol.org/docs/1.0/spec#conversations)).
- **MCP.** If you already run an MCP server, leave it as it is and list it in
  `poppy.json`. It takes ordinary OAuth access tokens issued for it.

You know it works when you connect your Company to Iris, the lab's Personal
Agent, at [poppylab.dev/playground](https://poppylab.dev/playground), and the
Inspector lists each operation you meant to offer.

### Feedback, on the wire

Take a report at the address your tasks response gives in `feedback.endpoint`
([§9.3](https://personalagentprotocol.org/docs/1.0/spec#feedback)). It carries
the Session header, so you know which agent and user sent it, and it needs no
scope. Iris's keyless demo sends this report when a message mentions a gift
card:

```http
POST https://food-demo.poppylab.dev/poppy/feedback
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAiOiJwb3BweS1zZXNzaW9uK2p3dCIs…
Content-Type: application/json

{
  "task": "Pay with a gift card",
  "description": "The User wanted to pay with a gift card they were given. None of the Company's APIs or its agent's requests apply a gift card."
}
```

Match a report's words against the tasks you know an alternative for, with your
own code. On a match, answer `200` with the alternative
([§9.2](https://personalagentprotocol.org/docs/1.0/spec#alternatives)).
Lantern answers this report:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "instructions": "Gift cards, catering and large group orders are handled by phone at +1 555-0142 (fictional number)."
}
```

Answer a report that matches nothing with `202 Accepted` and no body. Answer one
without a `task` (at most 200 characters) or a `description` (at most 2,000)
with `400` and `{"error": "invalid_request"}`. For the reports you keep:

- Keep each report as data, with the customer's own data, and escape it
  wherever you show it. Never pass a report to a model as instructions.
- Show customers the reports their agent sent: task, description, the agent's
  host, time and whether an alternative was offered.
- Keep a bounded number. Lantern keeps the newest 50.

You know it works when a report that matches nothing answers `202` and one
without a `task` answers `400`.

### The conversation endpoint

- Decide whether a model sits behind it. Lantern's Company Agent is about 600
  lines of deterministic code. A model behind a public endpoint lets anyone
  spend your money signed out, so rate-limit and budget it.
- Answer every request ID once. A retry to the same path with the same body gets
  the original response; another path or body with that ID is
  `request_id_conflict`
  ([§8.3](https://personalagentprotocol.org/docs/1.0/spec#sending-messages)).
- Bind each conversation to its owner: the agent, the user and, once a request
  carries a token, that account. Anyone else gets `conversation_not_found`.
- Bound everything: conversations per user, messages and bytes per conversation,
  `data` per message and the request IDs you remember. Lantern keeps the newest
  64, more than the 40 messages it allows.
- Check `parent_conversation_id` first. An unknown parent is
  `conversation_not_found` and a closed one is `conversation_closed`, because
  the specification doesn't make Direct Conversations optional
  ([§8.10](https://personalagentprotocol.org/docs/1.0/spec#direct-conversations)).

You know it works when resending a `POST` with the same request `id` and body
returns the first response, and another body answers `request_id_conflict`.

## Milestone 3: sign-in

Let a user connect an agent you never registered, with OAuth on your own pages.

- **Verify agents at the token endpoint.** When a `client_id` is a URL, fetch it
  (no redirects, no private addresses) and verify the client assertion against
  the keys at its `jwks_uri`
  ([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)).
  Accept ES256 and PS384, and assertions up to five minutes old. An identity
  provider that supports client ID metadata documents can be the token endpoint.
- **Choose the key in one place.** A `kid` names its key. Without one, use the
  client's key only when it publishes exactly one, and refuse when it publishes
  several.
- **Name the agent and its host on the consent page.** Show "Connecting Iris
  from poppylab.dev": the name is the agent's claim, the host is what you
  verified. Let the user grant scopes one by one, behind your existing login.
- **Bind and refresh carefully.** Use PKCE, offer PAR, bind tokens with DPoP if
  you can, and refresh only with the key a refresh token was bound to. Look up
  the refresh token before you check the DPoP proof: an unknown one is
  `invalid_grant` whatever else is wrong, and the validator relies on it.
- **Challenge a DPoP nonce only when the request carries a proof.** A pushed
  authorization request may come without one, and a revocation never carries
  one. Answer a challenge the same way at every endpoint: `400`,
  `{"error": "use_dpop_nonce"}` and a `DPoP-Nonce` header.
- **Give users an off switch.** Add a "connected agents" page where a customer
  sees and disconnects each grant. Disconnecting doesn't log the customer out,
  and logging out doesn't disconnect.

The validator never signs anyone in: check this milestone by hand against the
kit's `checklist.md`.

You know it works when a refresh with an unknown refresh token answers
`invalid_grant`, with or without a DPoP proof, and your consent page shows the
agent's name next to the host of its `client_id`.

## Milestone 4: Operations

If agents may change something that matters, such as an order or a payment, add
the
[Operations extension](https://personalagentprotocol.org/docs/1.0/extensions/operations),
so every such change waits for the user's approval of its exact terms. List it
in `poppy.json`:

```json
"extensions": { "operations": [{ "version": "3" }] }
```

Refuse a change that doesn't declare `Poppy-Extensions: "operations";v="3"` with
`403 {"error": "extension_required", "extension": "operations"}`, so an agent
that doesn't understand approvals can't trigger a change. Send it as a JSON body
without a `WWW-Authenticate` challenge, and read the declaration from each
request, never from the token.

For a request that declares it, answer with the terms and wait:

```ts
async function changeOrder(req, session) {
  const terms = priceAndDescribe(req.body, currentOrder); // what would happen
  const approval = parseApproval(req.headers["poppy-approval"]);
  const op = operations.find(session, req) ?? operations.create(session, req);

  if (op.performed) return op.performed.response; // a retry: same result, no second change

  const revision = op.revisionFor(terms); // new terms or state → new revision
  if (
    !approval ||
    approval.operation_id !== op.id ||
    approval.revision !== revision.id ||
    revision.expired
  )
    return {
      status: 403,
      body: { error: "approval_required", operation: op.view(revision) },
    };

  const response = await performOnce(op, () => applyChange(req.body)); // record before replying
  return response;
}
```

Four rules hold it up:

- **Return an operation for every consequential change.** Put everything the
  user is agreeing to in `terms`: amounts, dates, items. Write the `summary` for
  reading, with no links or images, and compare the terms, never the summary.
- **Pin the terms with a revision.** Issue a new revision whenever the terms or
  the expiry change; the old approval then no longer applies. Answer a mismatch
  with a revision for what the request asks now, never the one the approval
  names, so the agent can't loop on a stale approval.
- **Perform at most once.** Perform only the approved revision. Record the
  result before replying, and answer a repeated approval with that result, so a
  network failure can't move an order twice.
- **Record who approved.** Store `approver` (`"user"` or `"agent"`),
  `input_type` and the agent's `reference` with the change, so your support
  staff can answer "who agreed to this?".

If you refuse a valid approval for your own reasons, answer
`403 {"error": "approval_declined"}` with the operation ID, the revision and,
optionally, a plain-language `reason` and an alternative
([Operations](https://personalagentprotocol.org/docs/1.0/extensions/operations#declining-approval)).

You know it works when a change without `Poppy-Approval` answers
`403 approval_required` with the terms, and the same change resent with the
approval happens once, even if you send it twice.

## Reference implementation

[`packages/pap-company`](../../packages/pap-company) runs each of the lab's
Companies on Hono, on Node and Cloudflare Workers. A Company supplies its
scopes, consent page, OpenAPI paths and business routes; the gateway does the
protocol. [`apps/lantern`](../../apps/lantern) is one, in about 500 lines of
business code.

| Milestone  | Where                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foundation | [`discovery.ts`](../../packages/pap-company/src/gateway/discovery.ts), [`sessions.ts`](../../packages/pap-company/src/gateway/sessions.ts)                                                                                                       |
| Interfaces | [`conversations.ts`](../../packages/pap-company/src/gateway/conversations.ts), [`feedback.ts`](../../packages/pap-company/src/gateway/feedback.ts), Lantern's Company Agent [`agent.ts`](../../apps/lantern/src/agent.ts), each Company's routes |
| Sign-in    | [`signin.ts`](../../packages/pap-company/src/gateway/signin.ts) (authorize, PAR, consent), [`tokens.ts`](../../packages/pap-company/src/gateway/tokens.ts) (token, refresh, revoke)                                                              |
| Operations | [`approvals.ts`](../../packages/pap-company/src/approvals.ts)                                                                                                                                                                                    |
| A Company  | [`apps/lantern/src/lantern.ts`](../../apps/lantern/src/lantern.ts)                                                                                                                                                                               |

The gateway is lab code: its state lives in memory or a Durable Object, its
customers are fictional and nobody has reviewed it for production.

## Check your work

- [ ] Each milestone's `You know it works when` check passes.
- [ ] The validator's last run against the live deployment reports no failures.

## Go deeper

- [Approvals with Operations](operations.md): the life of an operation, and who
  approves.
- [Conversations with a Company Agent](conversations.md): when to use the
  endpoint instead of an API.
- [One task, request by request](one-task.md): what a Company receives for one
  change.
- [Build a Personal Agent](build-an-agent.md): the other side, to test against.

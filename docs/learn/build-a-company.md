# Build a Company

This page shows how to add Personal Agent Protocol to systems you already run,
one milestone at a time. It has small pieces of code you can adapt and points
to our gateway as a complete reference.

If you use a coding agent, start with the official
[Company kit](https://personalagentprotocol.org/kit/company) instead: its skill
surveys your systems, writes a design and builds this for you, and its
validator checks each milestone. This page explains what that work is, so you
can review it, or do it by hand. It follows the kit's milestones.

## Before you start: four decisions

| Decision              | Options                                                                    | Our four Companies                                        |
| --------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| Which interfaces      | OpenAPI, MCP, a conversation endpoint for your Company Agent, browser join | OpenAPI and a conversation endpoint                       |
| Which sign-in types   | None, Direct (browser redirect), Device (code on another screen), Mediated | Direct, with PAR offered                                  |
| Which scopes          | Your own, named for what the person approving understands                  | Two to six each, such as `orders:read` and `orders:write` |
| Which Personal Agents | Any agent with an HTTPS `client_id`, or an allowlist                       | Any                                                       |

Scopes deserve the most thought. They're shown to your customers on your own
consent page, so describe each for a person, and say in `scope_hints` what it
changes (`none`, `reversible`, `irreversible`) and whether it touches personal
data. Split reading from changing, and irreversible changes from reversible
ones: an agent that only needs to look shouldn't have to ask for more.

## Milestone 0: be found

The smallest useful Poppy deployment is one static file. It tells agents who
you are and points them at what already exists, with no sign-in:

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

`organization.domain` must be the host serving the file. Without `auth`,
agents won't try to sign in. The validator checks the file offline:

```sh
node validate/index.ts check --file poppy.json
```

A Company that only wants agents to find its website and public API can stop
here.

## Milestone 1: foundation

This is where agents become identifiable. It has three parts.

### Metadata

Add `auth` to `poppy.json` with your issuer and scopes, publish protected
resource metadata at `/.well-known/oauth-protected-resource`
([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) naming that issuer, and
make the issuer's metadata
([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) say
`client_id_metadata_document_supported: true`, `private_key_jwt` with ES256
and PS384, and the grant types you support. See
[One task, request by request](one-task.md#2-find-the-authorization-server)
for real examples.

### Verifying the Session header

Every request from an agent carries a `Poppy-Session` JWT. Verifying it
([§5.3](https://personalagentprotocol.org/docs/1.0/spec#session-verification))
is the core of this milestone. In outline, with [jose](https://github.com/panva/jose):

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

Failures are `400 {"error": "invalid_session"}`. Our full version, with the
size limits, claim checks and replay cache this outline leaves out, is
[`verifySessionHeader`](../../packages/pap-client/src/session-header.ts).

### Session records

A Session is keyed by the agent's `client_id`, the `sid` it chose and the
user ID ([§5.3](https://personalagentprotocol.org/docs/1.0/spec#session-verification)).
Store who it's for, when it was last used and, once the user signs in, which
account. Rules worth getting right early:

- An unknown combination starts a signed-out Session; a known one continues
  it. Another user ID with a known `sid` is another Session.
- One account per Session. A token for a second account ends the Session
  with `session_ended`, and the agent starts a new one.
- Sessions end when idle. Ours slide by an hour on each request.

Put the verification in front of your API, as gateway middleware, and pass the
verified client, user and Session to backend services as headers or context.
The services themselves don't change.

## Milestone 2: interfaces

Start signed out, with what anyone may see.

- **OpenAPI.** Give every operation an `operationId` and a description written
  for a model choosing between tools, and declare the scopes each needs. An
  agent turns each operation into a tool; vague descriptions become wrong
  tool choices.
- **Tasks and feedback.** List what you deliberately don't offer through the
  protocol at `tasks.endpoint`, with an alternative where there is one, and
  take feedback reports about what agents couldn't do
  ([§9](https://personalagentprotocol.org/docs/1.0/spec#task-coverage)). It
  costs little and tells you what to build next.
- **Conversations.** If you have a support chat or a Company Agent, the
  conversation endpoint lets agents talk to it, with structured `data` both
  ways and handoff to a person
  ([§8](https://personalagentprotocol.org/docs/1.0/spec#conversations)). Our
  Company Agents are deterministic code, not models, so a public endpoint
  can't be made to spend money; see [conversations](../conversations.md).
- **MCP.** An existing MCP server can stay as it is and be listed in
  `poppy.json`; it takes ordinary OAuth access tokens issued for it.

## Milestone 3: sign-in

Sign-in is OAuth with a client you didn't register.

- **The token endpoint verifies agents.** When a `client_id` is a URL, fetch it
  (no redirects, no private addresses), take the keys from its `jwks_uri` and
  verify the client assertion against them
  ([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)).
  Accept ES256 and PS384, and assertions up to five minutes old. If your
  identity provider already supports client ID metadata documents, it can be
  the token endpoint.
- **The consent page names the agent and its host.** "Connecting Iris from
  poppylab.dev": the name is the agent's claim, the host is what you
  verified. Let the user grant scopes one by one, and use your existing login.
- **Bind and refresh carefully.** Use PKCE, offer PAR, bind tokens with DPoP
  if you can, and refresh only with the key a refresh token was bound to. An
  unknown refresh token is `invalid_grant`, even without a DPoP proof; the
  validator relies on it.
- **Give users an off switch.** A "connected agents" page on your website
  where a customer sees each grant and disconnects it. Disconnecting an agent
  shouldn't log the customer out, and logging out shouldn't disconnect it.

The validator can't sign anyone in, so check this milestone by hand against
the kit's `checklist.md`.

## Milestone 4: Operations

If agents may change anything that matters, such as an order or a payment,
add the [Operations extension](https://personalagentprotocol.org/docs/1.0/extensions/operations).
Instead of performing a change, your API answers with its exact terms and waits
for an approval of those terms. The pattern, for a request that declares the
extension:

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

It depends on four rules:

- **Terms are the contract.** Put everything the user is agreeing to in
  `terms`: amounts, dates, items. The summary is for reading; the terms are
  what you compare.
- **Revisions pin them.** If the order changes, the price changes, or the agent
  asks for something else, there's a new revision and the old approval no
  longer applies. Never answer an approval with the revision it names.
- **At most once.** Record the result before replying, and answer a repeated
  approval with that result. A network failure then can't move an order twice.
- **Record who approved.** `approver="user"` or `"agent"`, and the agent's
  reference, so your support staff can answer "who agreed to this?".

## Our gateway as a reference

[`packages/pap-company`](../../packages/pap-company) runs all four Poppy Lab
Companies on Hono, so the same code runs on Node and Cloudflare Workers. Each
Company supplies its scopes, consent page, OpenAPI paths and business routes;
the gateway does the protocol.

| Milestone  | Where                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation | [`discovery.ts`](../../packages/pap-company/src/gateway/discovery.ts), [`sessions.ts`](../../packages/pap-company/src/gateway/sessions.ts)                                          |
| Interfaces | [`conversations.ts`](../../packages/pap-company/src/gateway/conversations.ts), [`feedback.ts`](../../packages/pap-company/src/gateway/feedback.ts), each Company's routes           |
| Sign-in    | [`signin.ts`](../../packages/pap-company/src/gateway/signin.ts) (authorize, PAR, consent), [`tokens.ts`](../../packages/pap-company/src/gateway/tokens.ts) (token, refresh, revoke) |
| Operations | [`approvals.ts`](../../packages/pap-company/src/approvals.ts)                                                                                                                       |
| A Company  | [`apps/lantern/src/lantern.ts`](../../apps/lantern/src/lantern.ts): about 450 lines of business code on top                                                                         |

The gateway is lab code. Its state lives in memory or a Durable Object, its
customers are fictional, and nobody has reviewed it for production. Read it to
see how the pieces fit, then build on what you run.

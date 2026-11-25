# Build a Personal Agent

This guide shows how to build a Personal Agent, the software that acts for a
user at Companies, from its identity to its approvals. It is for developers of
agents, and it assumes you can call a model with tools, keep a secret and use
a JOSE library for the cryptography. [Approvals with Operations](operations.md)
explains why the user, and never the model, approves.

The lab's agent, Iris, is the working example. Where it applies, a step ends
with **The line**: where the model stops and deterministic code takes over.

## Before you start

- Host two public JSON files over HTTPS, without redirects: your client
  document and your keys.
- Keep a secret store for the root key, and encrypt tokens at rest.
- Pick a Company to test against. The lab's Companies accept any HTTPS
  `client_id`, and their customers are fictional
  ([developers](https://poppylab.dev/developers)).
- Choose your sign-in types. This guide builds Direct Sign-In; the
  [guides](https://personalagentprotocol.org/docs/1.0/guides#agent-choosing-sign-in)
  cover Device and Mediated Sign-In.

## The pieces

| Piece          | Does                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| Identity       | Publishes who the agent is and its public keys                            |
| Session layer  | Gives each user an ID per Company, signs the Session header               |
| Transport      | Fetches Company URLs without becoming an attack tool                      |
| Interfaces     | Turns an OpenAPI document, MCP server or conversation endpoint into tools |
| Account access | Signs the user in, stores and refreshes tokens                            |
| Approvals      | Shows exact terms, takes the user's decision, resends                     |
| The model      | Reads, plans, explains, proposes                                          |

Build every piece except the model as deterministic code. The model calls
tools, and the tools decide what goes over the wire.

## 1. Identity: a URL, two keys, no registration

Publish who the agent is, so that a Company can verify it without registering
it. Use the HTTPS URL of a small JSON document as your `client_id`
([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)).
Companies fetch it:

```json
{
  "client_id": "https://poppylab.dev/agent/client.json",
  "client_name": "Iris",
  "jwks_uri": "https://poppylab.dev/agent/jwks.json",
  "redirect_uris": ["https://poppylab.dev/api/account/callback"],
  "token_endpoint_auth_method": "private_key_jwt"
}
```

- Pick a `client_name` that doesn't impersonate anyone. It is a claim and the
  host is the proof, and Companies show both: "Connecting Iris from
  poppylab.dev".
- Keep the root key in `jwks_uri` out of daily use. It signs only client
  assertions at token endpoints and short-lived _delegations_, so it can live
  in a secret store. Use ES256 or PS384, the two algorithms every Company must
  accept.
- If you sign requests with Web Bot Auth
  ([guides](https://personalagentprotocol.org/docs/1.0/guides#both-operator-signatures),
  [spec](https://personalagentprotocol.org/docs/1.0/spec#operator-signatures)),
  publish a third key at `/.well-known/http-message-signatures-directory`,
  apart from `jwks_uri`. Iris derives it from the identity secret with HKDF.

A request signed this way carries three more headers. This is a signed-out
read of Lantern's tasks; the key ID and signature come from a test key, not
from Iris's:

```http
GET https://food-demo.poppylab.dev/poppy/tasks
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAiOiJwb3BweS1zZXNzaW9uK2p3dCIs…
Signature-Agent: sig1="https://poppylab.dev/.well-known/http-message-signatures-directory"
Signature-Input: sig1=("@authority" "@method" "@path" "signature-agent";key="sig1" "poppy-session");created=1795597200;expires=1795597500;keyid="NZ26DAePNX3uItLapeBswY0LueqOKWZ4CNGEPdCv1-A";alg="ed25519";nonce="c2FtcGxlLW5vbmNlLTAwMDE";tag="web-bot-auth"
Signature: sig1=:xHZUsAsD98qnjJZVD4v/es9TQY4avsccEZGI8HQsWKBPmdOwv2AsMgDf1c56lQTjboSygUUO4pPCzIlKU6SRAg==:
```

The signature covers the host, the method, the path, the `Signature-Agent`
member and the Session header. It covers `Authorization` too when the request
is signed in, and it is valid for five minutes. It adds nothing to
authorization: a Company still verifies the Session JWT, and bot defenses in
front of it can tell which operator is calling. `Signature-Agent` names where
the key is published, which for Iris answers:

```http
HTTP/2 200
Content-Type: application/http-message-signatures-directory+json
Cache-Control: public, max-age=86400

{
  "keys": [
    {
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "91M73e8SDa_Ahhp7MQ9eesF-jNWxprxetBKtlos8wHs",
      "kid": "R1pKzSbRnRFT3Ylg-cr5OG6Xr50_LmkESQ_p8cQW5qA",
      "use": "sig"
    }
  ]
}
```

Sign that response with the same key, so a reader knows whoever serves the
directory holds the key it lists. Serve all these documents without redirects
and with short cache lifetimes: a Company that cached your old keys can't
verify you after a rotation (see _Rotating keys_ in the
[guides](https://personalagentprotocol.org/docs/1.0/guides)).

You know it works when fetching your `client_id` URL returns the document
with no redirect, and the `jwks_uri` it names returns your public keys the
same way.

## 2. Users and Sessions

Give every request a Session header that names the user and the Session
([§5.2](https://personalagentprotocol.org/docs/1.0/spec#session-header)), so
create both before the first request.

- **Derive a user ID per Company, don't store one.** The ID must be stable,
  opaque, different at each Company and not derived from personal data, even
  with a keyed hash
  ([§5.1](https://personalagentprotocol.org/docs/1.0/spec#user-ids)). Iris
  computes it from its own random visitor ID and the Company's identifier with
  a secret only it has:

  ```ts
  const secret = hmac("poppy-user-ids", identitySecret);
  const userId = `usr_${hmac(secret, `${visitor}\n${companyIdentifier}`).slice(0, 32)}`;
  ```

  The same user gets the same ID at Lantern every time, and IDs at Lantern and
  Juniper can't be linked. Don't start from an email address: that breaks the
  rule.

- **Delegate a key per user.** Sign the Session JWT with an ES256 key you
  generate, vouched for by a delegation the root key signs and carried in the
  JWT's `poppy_dlg` header. Use each delegated key, and each DPoP key, for one
  user only, so a Company can't link two users through a shared key. Create a
  fresh delegated key whenever the user ID changes, and renew it before the
  delegation expires.
- **Sign every request.** Add `ath`, the hash of the access token, when the
  request is signed in.
- **Keep a Session per task, and start a new one when told.** The `sid` is your
  choice. Keep one while a user works with a Company. When the Company answers
  `session_ended`, start a new one and resend the request once. Never retry
  `invalid_session`: the header itself is wrong.

You know it works when a signed-out `GET` to Lantern's `/poppy/tasks`, sent
with your Session header, returns the tasks and not
`400 {"error": "invalid_session"}`.

## 3. Fetching Company URLs safely

Fetch the URLs that strangers give you, the domain the user types and the
endpoints it lists, without becoming a way into internal services. Build this
first, before any model is involved. Enforce these rules in one function that
every request passes through, as Iris's `protocolRequest` does, in code the
model can't change:

- Use HTTPS only, with no credentials in URLs.
- Refuse private, loopback and link-local addresses. In Node, resolve the
  hostname once and pin the connection to the checked address, so a DNS answer
  can't change between the check and the request. On Cloudflare Workers, which
  can't pin, check the hostname before every hop.
- Follow redirects one hop at a time, and check each. Let discovery redirects
  end only at a `/.well-known/poppy.json`. Let protocol endpoints not redirect
  at all, because a redirect must never carry a token or Session JWT
  ([§3](https://personalagentprotocol.org/docs/1.0/spec#discovery)).
- Limit the size and time of every response. After a 429, keep a cool-down per
  origin: check it before any connection opens, never shorten it for a later
  answer with an earlier deadline, and never repeat a `POST` automatically.
- Send a Session header or token only to the Company's own domain or a
  subdomain, and compare `host`, not `hostname`, so the port counts
  ([§3.1](https://personalagentprotocol.org/docs/1.0/spec#fields)). Apply this
  to every endpoint that `poppy.json` and the tasks response name.

The [guides](https://personalagentprotocol.org/docs/1.0/guides) call this
_Fetching metadata safely_.

You know it works when the fetcher refuses an `http://` URL and a hostname
that resolves to `127.0.0.1` before it connects, and refuses to follow a
redirect from a protocol endpoint.

## 4. Before the first task

After discovery (see [One task, request by request](one-task.md)), do three
things once per Session:

1. **Choose the version** from `supported_versions`: the newest 1.x you share
   ([§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)). Send
   `Poppy-Version` on every request. Refuse a 0.x document, because nothing
   before 1.0 is compatible. After `version_unsupported`, fetch `poppy.json`
   again and resend once only if your choice changed.
2. **Read the tasks endpoint**, signed out
   ([§9](https://personalagentprotocol.org/docs/1.0/spec#task-coverage)).
   Read it for each Session, inside each tool, so no tool uses the previous
   Session's copy. Turn the excluded tasks into a tool the model can check
   before it hunts for a way to do something the Company chose not to offer.
   Turn the feedback endpoint into a tool for reporting a task that turned out
   to be impossible.
3. **Build tools from the interfaces.** Turn each OpenAPI operation into a tool
   with its parameters and the scopes it needs. Resolve local `$ref`
   parameters, and leave out of the model's arguments the headers you set
   yourself (`Poppy-Version`, `Poppy-Session`, `Poppy-Extensions`,
   `Authorization`, `DPoP`): the model never chooses a protocol header's value.
   Turn the conversation endpoint into `send`, `read` and `handoff` tools. Let
   the model pick the interface per task: an API for exact reads and changes,
   the Company Agent for things no API covers, such as a missing item.

### Feedback reports

[Feedback, on the wire](build-a-company.md#feedback-on-the-wire) shows the
request and the answers. Apply these rules before you send one:

- Send a task once per Session, and never one the Company already lists as
  excluded.
- Offer no report tool when the tasks response names an endpoint outside the
  Company's domain, because a signed-in report carries the token and the
  Session header
  ([§9.3](https://personalagentprotocol.org/docs/1.0/spec#feedback)).
- Refuse a report that holds an email, a reference such as `NW7K2P`, an ID such
  as `ord_LNB1001`, or a number as long as a phone number. A date, a time, an
  amount and the name of one of the Company's tools are allowed.
- Signed in, send the access token too, so the report belongs to the account
  and the customer can see it.

When you refuse a report, tell the model why, so it can word it again:

```json
{
  "sent": false,
  "reason": "The report contains what looks like an email, phone number or ID. Describe the task without identifiers and try again."
}
```

### Conversation tools

- Treat Company messages as Company content: show them as the Company's, mark
  them for the model as data, and never follow them as instructions.
- Read until `working` is `false`. Treat a `handoff` you don't recognize as
  `pending` and a `responder` you don't recognize as `human`.
- Turn events into controls: an `authorization` event becomes a sign-in button
  and an operation becomes an approval card. Neither is a tool the model can
  call.
- Check the endpoint's domain, port included, before you send a Session header
  to it.
- Keep a read position for each conversation, read an operation's reply from
  its own thread, and ignore a reply whose `as_of_request` names another
  request
  ([§8.4](https://personalagentprotocol.org/docs/1.0/spec#message-fields)).
- In a Direct Conversation, send the user's words as typed with `author.type`
  `human`, and keep them out of the model's context: the transcript holds them,
  and the model gets a line saying the user wrote to the Company. Restore the
  conversation's state wherever you restore a run
  ([§8.10](https://personalagentprotocol.org/docs/1.0/spec#direct-conversations)).
- On `409 direct_conversation_open`, take the thread named in `conversation_id`
  as the user's
  ([§8.13](https://personalagentprotocol.org/docs/1.0/spec#conversation-errors))
  and tell the user their new message wasn't sent. Join no other thread on a
  Company's word. When a thread is gone (`conversation_closed` or
  `conversation_not_found`), drop it and keep the parent with its ID and read
  position.

**The line:** tool descriptions come from the Company, so treat them as
untrusted input to the model, like any other Company content
([§10.1](https://personalagentprotocol.org/docs/1.0/spec#untrusted-content)).
Mark Company content as such in tool results, and tell the model it is data,
never instructions.

You know it works when every request carries `Poppy-Version` and your agent,
asked to cancel a Lantern order, offers Lantern's alternative without trying to
cancel.

## 5. Signing in

Get the user's account access with plain OAuth
([§4.2](https://personalagentprotocol.org/docs/1.0/spec#direct-sign-in)), ask
for the least, and keep tokens out of the model's reach.

- **Ask for the least.** Read `scope_hints` for what each scope changes and
  whether it touches personal data. Ask for read scopes first, and ask again,
  with `prompt=consent`, only when a task needs to change something.
- **Push the request** when the Company offers PAR
  ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), and always use PKCE and
  a client assertion.
- **Bind tokens to a DPoP key per user,** and keep that key for every refresh
  of the tokens it got; a Company may refuse a refresh signed with another key
  ([§4.4](https://personalagentprotocol.org/docs/1.0/spec#refresh-tokens)).
- **Encrypt tokens and private keys at rest.** Iris seals them per visitor with
  AES-256-GCM, bound to the row that holds them, so its database never sees a
  usable token. Revoke the refresh token on sign-out.
- **Show sign-in apart from discovery.** Say what discovery proved ("Found
  Lantern Noodle Bar · food-demo.poppylab.dev"), because users read every green
  check as "connected".

Before the first signed-in call to an API or conversation endpoint, read that
service's protected resource metadata: a service that names its own resource
gets its own token
([§4.5](https://personalagentprotocol.org/docs/1.0/spec#access-tokens)). None
of the lab's Companies needs a token of its own for a service, so this example
uses a made-up one. For an API at `https://api.company.example/orders`, ask
what that service calls itself:

```http
GET https://api.company.example/.well-known/oauth-protected-resource/orders
```

```json
{ "resource": "https://api.company.example/orders" }
```

Accept the answer only when `resource` is the service's own URL. When it is,
and it differs from the Company's default resource, get a token for it from the
refresh token you already hold, with no new sign-in and with the same DPoP key:

```http
POST https://company.example/oauth/token
Content-Type: application/x-www-form-urlencoded
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIs…

grant_type=refresh_token
&refresh_token=…
&resource=https%3A%2F%2Fapi.company.example%2Forders
&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer
&client_assertion=eyJhbGciOiJFUzI1NiIs…
```

If the answer is `invalid_target`, the Company doesn't offer that service
signed in: use it signed out for the next hour. If a service has no metadata,
use the default token. Drop every cached token with the sign-in it came from,
and keep the services' resource metadata, which is public.

**The line:** make the sign-in control a button in the interface, not a tool.
When a tool needs a scope the agent doesn't have, return `sign_in_required` or
`insufficient_scope` with `sent: false` and an instruction for the model to ask
the user. Send nothing to the Company, and log "Not sent" rather than naming a
request. Never show the model the authorization URL, the code or the token.

You know it works when the Company's consent page shows your agent's name next
to your host, and a tool that needs a missing scope returns `sign_in_required`
or `insufficient_scope`, with `sent: false` and no URL.

## 6. Approvals

With the Operations extension, a change comes back as `403 approval_required`
with exact `terms` and a `revision`
([Operations §4](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval-required)).
Declare `Poppy-Extensions: "operations";v="3"` only on requests where you can
show approvals. Then:

1. **Record the operation and the exact request** that produced it. Give the
   model the terms, the summary if the Company sent one, and a note: _"Nothing
   was done. The user must approve these exact terms with the control in the
   chat; your words can't approve it."_ Check the terms against the request and
   the summary, because the Company writes both.
2. **Show the terms** from the record, not from the model's retelling, with the
   Company's name and its verified domain.
3. **Take the decision in your own interface.** When the user taps Approve,
   create one approval (`approver="user"`, `input_type="tap"`, a time and a
   reference) and store it with the operation
   ([Operations §5](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval)).
4. **Resend the identical request** with that approval in `Poppy-Approval`. If
   the result is uncertain, resend the same approval, so the Company performs
   the change at most once
   ([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions/operations#at-most-once)).
   Never propose the change again to check. In a conversation, send the
   approval in a message whose request `id` derives from the approval (approver,
   time, reference), so a retry is the same request
   ([§8.3](https://personalagentprotocol.org/docs/1.0/spec#sending-messages)).
5. **Treat a decline as final.** Show `approval_declined` as declined by the
   Company, and don't resend it; a new revision needs a new approval. Report a
   reply to an approval with an error in its `data` as declined too, with what
   the Company said as the reason.
6. **Treat a 4xx answer to a first send, or `conversation_closed`, as a
   refusal.** Nothing was performed: keep the operation proposed, so the user
   can approve again or ask for fresh terms, and name the Company's status and
   error code, never its text. A Retry resends the stored approval or nothing;
   only Approve makes a new one.

**The line:** approving is never a tool, and neither the model nor Company
content can approve. "Yes, go ahead" in the chat changes nothing. Check
standing rules, such as "approve refunds under $10", in code against the
operation's `terms`, record each approval they make as `approver="agent"`, and
send anything a rule can't settle to the user. After the Company declines an
agent approval or answers it with new terms, leave that operation to the user
for every later revision
([Operations §6](https://personalagentprotocol.org/docs/1.0/extensions/operations#sending-approval)).

You know it works when Lantern answers your change request with
`403 approval_required`, nothing changes until the user taps Approve, and the
order changes once after you resend.

## 7. The model boundary

Write down what never enters the model's context and enforce it in code. For
Iris:

| Never in context                                      | Why                                                     |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Access and refresh tokens, authorization codes, state | Anything in context can end up in output or a tool call |
| Root, delegated and DPoP private keys, Session JWTs   | Same, and they're signing material                      |
| Approval controls                                     | The model proposes; only the user approves              |
| Raw URLs it hasn't been given by the Company          | Tools take parameters, not arbitrary destinations       |

Flag what does enter the context:

- Company content (API responses, Company Agent messages, alternatives,
  skills): mark it `untrusted_company_content`, and describe it in the system
  prompt as data, never instructions.
- Operation summaries: pass what the Company says the change is, next to the
  note that nothing was done.

Redact tokens, codes and signatures from logs and traces too, as Iris's
Inspector does. Render the few marks a model uses (bold, code) as elements,
never as HTML, and only in the model's own messages. Show Company content
verbatim.

You know it works when a search of everything you send to the model finds no
token, code, key or Session JWT.

## Reference implementation

Iris is a working Personal Agent you can read. It runs GPT, Claude or no model
at all, with the same deterministic code under each. Read it to see one way to
meet each rule above.

| Piece          | Where in Iris                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity       | [`/agent/client.json`](../../apps/playground/app/agent/client.json/route.ts), `/agent/jwks.json`                                                                    |
| Session layer  | [`runtime.ts`](../../apps/playground/lib/runtime.ts) `ensureSession`, `sessionHeaders`                                                                              |
| Transport      | [`pap-client`](../../packages/pap-client/src/index.ts) `protocolRequest`                                                                                            |
| Interfaces     | [`openapi.ts`](../../packages/pap-client/src/openapi.ts), [`conversations.ts`](../../apps/playground/lib/conversations.ts)                                          |
| Account access | [`account/route.ts`](../../apps/playground/app/api/account/route.ts), [`sealed.ts`](../../apps/playground/lib/sealed.ts)                                            |
| Approvals      | [`operation-review.tsx`](../../apps/playground/app/operation-review.tsx), `userApproval` and `sendApproval` in [`runtime.ts`](../../apps/playground/lib/runtime.ts) |
| The model      | Any model through [`llm-adapters`](../../packages/llm-adapters)                                                                                                     |

## Check your work

- [ ] Publish a `client_id` URL with `jwks_uri`, `private_key_jwt`, ES256 or
      PS384.
- [ ] Send stable, pairwise, opaque user IDs, not derived from personal data.
- [ ] Send a Session JWT on every request, with a delegated key per user and
      `ath` when signed in.
- [ ] Send `Poppy-Version` on every request, and choose again after
      `version_unsupported`.
- [ ] Fetch over HTTPS only, with no private addresses and no secrets across
      redirects.
- [ ] Read the tasks endpoint for each Session, and don't report excluded tasks.
- [ ] Sign in with least privilege, PKCE, PAR when offered and a DPoP key per
      user.
- [ ] Declare the Operations extension only where you can show approvals.
- [ ] Show the Company's name, its domain and the terms; take the answer in your
      own interface.
- [ ] Never let the model or Company content approve.
- [ ] Check `terms` against the request and the summary.
- [ ] Store the approval; resend it unchanged; never re-propose to check.
- [ ] Treat a decline as final.
- [ ] Show Company content as the Company's, and never follow it as
      instructions.

## Go deeper

- [Approvals with Operations](operations.md) explains who may approve and what
  an approval proves.
- [Conversations with a Company Agent](conversations.md) explains when to use a
  conversation instead of an API.
- [One task, request by request](one-task.md) shows what each step sends, from
  the Company's side.
- [Build a Company](build-a-company.md) is the other side, to test your agent
  against. The official
  [Company kit](https://personalagentprotocol.org/kit/company) automates it.
- [Write a domain extension](write-an-extension.md) carries a domain standard,
  such as bank data, through a Poppy extension.
- Use Iris at [poppylab.dev/playground](https://poppylab.dev/playground) and
  open the Inspector to watch each of these steps.

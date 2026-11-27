# Build a Personal Agent

This guide shows how to build a Personal Agent, the software that acts for a
user at Companies. It is for developers of agents and assumes you can call a
model with tools, keep a secret and use a JOSE library.
[Approvals with Operations](operations.md) explains why the user, never the
model, approves.

Iris, the lab's agent, is the example. Where it applies, a step ends with **The
line**, where the model stops and deterministic code takes over.

## Before you start

- Host two public JSON files over HTTPS: your client document and your keys.
- Keep a secret store for the root key.
- Test against a Company. The lab's Companies accept any HTTPS `client_id`, and
  their customers are fictional ([developers](https://poppylab.dev/developers)).
- Choose your sign-in types. This guide builds Direct Sign-In.
  [Signing in](sign-in.md) weighs Device and Mediated Sign-In, and the
  [guides](https://personalagentprotocol.org/docs/1.0/guides#agent-choosing-sign-in)
  cover each.

## The pieces

![The model's side and the agent's code, divided by a dashed edge. The model calls tools that take parameters, not arbitrary destinations, and sees Company content marked as data and a change's terms with a note that nothing was done; its tool calls cross the edge and the results come back. The agent's own deterministic code has six pieces, in the order of the steps: identity, users and Sessions, safe fetching of Company URLs, before the first task, where interfaces become tools, sign-in, and approvals, where the user decides, marked in amber. The code keeps tokens, authorization codes, the authorization URL, private keys, Session JWTs and OAuth state from the model.](../../apps/playground/public/learn-media/diagrams/agent-pieces.svg "The model calls tools and reads what comes back, and everything it must never see or do stays in the agent's own code.")

Build every piece except the model as deterministic code, in the order of steps
1 to 6. The model calls tools; the tools decide what goes over the wire.

## 1. Identity: a URL, two keys, no registration

Use the HTTPS URL of a small JSON document as your `client_id`
([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)), so a
Company can verify the agent without registering it. Companies fetch it:

```json
{
  "client_id": "https://poppylab.dev/agent/client.json",
  "client_name": "Iris",
  "jwks_uri": "https://poppylab.dev/agent/jwks.json",
  "redirect_uris": ["https://poppylab.dev/api/account/callback"],
  "token_endpoint_auth_method": "private_key_jwt"
}
```

- Pick a `client_name` that impersonates no one. Companies show it next to your
  host, which is the proof.
- Use the root key in `jwks_uri` only for client assertions at token endpoints
  and short-lived _delegations_. Use ES256 or PS384, which every Company must
  accept.
- To sign requests with Web Bot Auth
  ([guides](https://personalagentprotocol.org/docs/1.0/guides#both-operator-signatures),
  [spec](https://personalagentprotocol.org/docs/1.0/spec#operator-signatures)),
  publish a third key at `/.well-known/http-message-signatures-directory`,
  apart from `jwks_uri`. Iris derives it from the identity secret with HKDF.

Web Bot Auth adds three headers, here on a signed-out read of Lantern's tasks
with a test key:

```http
GET https://food-demo.poppylab.dev/poppy/tasks
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAiOiJwb3BweS1zZXNzaW9uK2p3dCIs…
Signature-Agent: sig1="https://poppylab.dev/.well-known/http-message-signatures-directory"
Signature-Input: sig1=("@authority" "@method" "@path" "signature-agent";key="sig1" "poppy-session");created=1795597200;expires=1795597500;keyid="NZ26DAePNX3uItLapeBswY0LueqOKWZ4CNGEPdCv1-A";alg="ed25519";nonce="c2FtcGxlLW5vbmNlLTAwMDE";tag="web-bot-auth"
Signature: sig1=:xHZUsAsD98qnjJZVD4v/es9TQY4avsccEZGI8HQsWKBPmdOwv2AsMgDf1c56lQTjboSygUUO4pPCzIlKU6SRAg==:
```

The signature covers the host, method, path, `Signature-Agent` member and
Session header, plus `Authorization` when signed in, and is valid for five
minutes. It adds nothing to authorization: a Company still verifies the Session
JWT. `Signature-Agent` names where the key is published:

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

Sign that response with the same key, which proves the server holds it. Serve
all these documents without redirects and with short cache lifetimes, so a
rotation doesn't break verification (see _Rotating keys_ in the
[guides](https://personalagentprotocol.org/docs/1.0/guides)).

You know it works when your `client_id` URL returns the document, and the
`jwks_uri` it names returns your public keys, both with no redirect.

## 2. Users and Sessions

Every request carries a Session header naming the user and the Session
([§5.2](https://personalagentprotocol.org/docs/1.0/spec#session-header)), so
create both first.

- **Derive a user ID per Company, don't store one.** It must be stable, opaque,
  different at each Company and not derived from personal data such as an email
  address, even with a keyed hash
  ([§5.1](https://personalagentprotocol.org/docs/1.0/spec#user-ids)). Iris
  computes it from a random visitor ID:

  ```ts
  const secret = hmac("poppy-user-ids", identitySecret);
  const userId = `usr_${hmac(secret, `${visitor}\n${companyIdentifier}`).slice(0, 32)}`;
  ```

- **Delegate a key per user.** Sign the Session JWT with an ES256 key you
  generate, vouched for by a delegation the root key signs and carries in the
  JWT's `poppy_dlg` header. Use each delegated key for one user only, so a
  Company can't link users. Create a fresh one when the user ID changes, and
  renew it before the delegation expires.
- **Sign every request.** Add `ath`, the hash of the access token, when signed
  in.
- **Keep one Session while a user works with a Company, and start a new one
  when told.** The `sid` is your choice. After `session_ended`, start a new
  Session and resend once. Never retry `invalid_session`: the header is wrong.

You know it works when a signed-out `GET` to Lantern's `/poppy/tasks` with your
Session header returns the tasks, not `400 {"error": "invalid_session"}`.

## 3. Fetching Company URLs safely

Fetch URLs that strangers give you without becoming a way into internal
services (the [guides](https://personalagentprotocol.org/docs/1.0/guides) call
this _Fetching metadata safely_). Build this before any model, as one function
every request passes through, in code the model can't change, as Iris's
`protocolRequest` does:

- Use HTTPS only, with no credentials in URLs.
- Refuse private, loopback and link-local addresses. In Node, resolve the
  hostname once and pin the connection to the checked address, so DNS can't
  change between check and request. On Cloudflare Workers, which can't pin,
  check the hostname before every hop.
- Follow redirects one hop at a time, checking each. Discovery redirects may end
  only at a `/.well-known/poppy.json`. Protocol endpoints must not redirect: a
  redirect must never carry a token or Session JWT
  ([§3](https://personalagentprotocol.org/docs/1.0/spec#discovery)).
- Limit the size and time of every response. After a 429, keep a cool-down per
  origin: check it before any connection opens, never shorten it for a later
  answer with an earlier deadline, and never repeat a `POST` automatically.
- Send a Session header or token only to the Company's own domain or a
  subdomain, comparing `host`, not `hostname`, so the port counts
  ([§3.1](https://personalagentprotocol.org/docs/1.0/spec#fields)). Apply this
  to every endpoint that `poppy.json` and the tasks response name, and to a
  conversation endpoint.

You know it works when the fetcher refuses an `http://` URL and a hostname that
resolves to `127.0.0.1` before connecting, and refuses a redirect from a
protocol endpoint.

## 4. Before the first task

After discovery (see [One task, request by request](one-task.md)), do three
things once per Session:

1. **Choose the version** from `supported_versions`: the newest 1.x you share
   ([§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)). Send
   `Poppy-Version` on every request. Refuse a 0.x document: nothing before 1.0
   is compatible. After `version_unsupported`, fetch `poppy.json` again and
   resend once only if your choice changed.
2. **Read the tasks endpoint**, signed out
   ([§9](https://personalagentprotocol.org/docs/1.0/spec#task-coverage)), for
   each Session and inside each tool, so no tool uses a previous Session's copy.
   Turn the excluded tasks into a tool the model checks before it hunts for a
   way around them. Turn the feedback endpoint into a tool for reporting an
   impossible task.
3. **Build tools from the interfaces.** Turn each OpenAPI operation into a tool
   with its parameters and the scopes it needs. Resolve local `$ref`
   parameters, and leave out of the model's arguments the headers you set
   yourself (`Poppy-Version`, `Poppy-Session`, `Poppy-Extensions`,
   `Authorization`, `DPoP`): the model never chooses a protocol header's value.
   Turn the conversation endpoint into `send`, `read` and `handoff` tools. Let
   the model pick the interface per task: an API for exact reads and changes,
   the Company Agent for what no API covers.

### Feedback reports

[Feedback, on the wire](build-a-company.md#feedback-on-the-wire) shows the
request and the answers. Before you send a report:

- Send a task once per Session, and never one the Company lists as excluded.
- Offer no report tool when the tasks response names an endpoint outside the
  Company's domain: a signed-in report carries the token and the Session header
  ([§9.3](https://personalagentprotocol.org/docs/1.0/spec#feedback)).
- Refuse a report that holds an email, a reference such as `NW7K2P`, an ID such
  as `ord_LNB1001`, or a number as long as a phone number. A date, a time, an
  amount and the name of one of the Company's tools are allowed.
- Signed in, send the access token too, so the report belongs to the account
  and the customer can see it.

When you refuse a report, tell the model why:

```json
{
  "sent": false,
  "reason": "The report contains what looks like an email, phone number or ID. Describe the task without identifiers and try again."
}
```

### Skills

A Company may list skills in the tasks response's `skill_index`: files on how to
do a task with its interfaces
([§9.4](https://personalagentprotocol.org/docs/1.0/spec#agent-context)). An
agent may ignore them. To use one:

- Match the user's task against each entry's `name` and `description`, and
  fetch only a skill that fits.
- Resolve `url` against `tasks.endpoint`, and fetch it through the function
  every request passes through. A file on another domain gets no token and no
  Session header.
- Compare the SHA-256 of the bytes with `digest`, and drop a file that differs.
- Load the file as Company content, never as instructions. It grants no access
  and approves nothing. Run no script from it unless the user allows that.
- Skip an entry whose `type` you don't know, and ignore the index when its
  `$schema` is absent or unknown. The rest of the tasks response still applies.

Iris lists a Company's skills in the Inspector and loads none.

### Conversation tools

- Read until `working` is `false`. Treat a `handoff` you don't recognize as
  `pending` and a `responder` you don't recognize as `human`.
- Turn events into controls: an `authorization` event becomes a sign-in button
  and an operation becomes an approval card. Neither is a tool the model can
  call.
- Keep a read position for each conversation, read an operation's reply from its
  own thread, and ignore a reply whose `as_of_request` names another request
  ([§8.4](https://personalagentprotocol.org/docs/1.0/spec#message-fields)).
- In a Direct Conversation, send the user's words as typed with `author.type`
  `human`, and keep them out of the model's context: it gets a line saying the
  user wrote to the Company. Restore the conversation's state wherever you
  restore a run
  ([§8.10](https://personalagentprotocol.org/docs/1.0/spec#direct-conversations)).
- On `409 direct_conversation_open`, take the thread named in `conversation_id`
  as the user's
  ([§8.13](https://personalagentprotocol.org/docs/1.0/spec#conversation-errors))
  and tell the user their new message wasn't sent. Join no other thread on a
  Company's word. When a thread is gone (`conversation_closed` or
  `conversation_not_found`), drop it and keep the parent with its ID and read
  position.

**The line:** tool descriptions and skills come from the Company, so treat them
as untrusted input to the model
([§10.1](https://personalagentprotocol.org/docs/1.0/spec#untrusted-content)).

You know it works when every request carries `Poppy-Version` and your agent,
asked to cancel a Lantern order, offers Lantern's alternative without trying to
cancel.

## 5. Signing in

Get the user's account access with plain OAuth
([§4.2](https://personalagentprotocol.org/docs/1.0/spec#direct-sign-in)).

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
  AES-256-GCM. Revoke the refresh token on sign-out.
- **Show sign-in apart from discovery.** Say what the agent holds at each
  Company, because users read every green check as "connected". Iris's
  Companies bar says "Public access" until the user signs in, then "Signed in ·
  read only" or "Signed in · can propose changes".

Before the first signed-in call to an API or conversation endpoint, read the
service's protected resource metadata: a service that names its own resource
gets its own token
([§4.5](https://personalagentprotocol.org/docs/1.0/spec#access-tokens)). This
made-up example asks what the API at `https://api.company.example/orders` calls
itself:

```http
GET https://api.company.example/.well-known/oauth-protected-resource/orders
```

```json
{ "resource": "https://api.company.example/orders" }
```

Accept the answer only when `resource` is the service's own URL. If it differs
from the Company's default resource, get a token for it from your refresh token,
with no new sign-in and the same DPoP key:

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

On `invalid_target`, use the service signed out for the next hour. If a service
has no metadata, use the default token. Drop cached tokens with the sign-in they
came from, and keep the services' resource metadata, which is public.

**The line:** when a tool needs a scope the agent lacks, return
`sign_in_required` or `insufficient_scope` with `sent: false` and an instruction
for the model to ask the user. Send nothing to the Company, and log "Not sent"
rather than naming a request.

You know it works when the consent page shows your agent's name next to your
host, and a tool with a missing scope returns `sent: false` and no URL.

## 6. Approvals

With the Operations extension, a change comes back as `403 approval_required`
with exact `terms` and a `revision`
([Operations §4](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval-required)).
Declare `Poppy-Extensions: "operations";v="3"` only on requests where you can
show approvals. Then:

1. **Record the operation and the request** that produced it. Give the model the
   terms, the summary if there is one, and the note _"Nothing was done. The user
   must approve these exact terms with the control in the chat; your words can't
   approve it."_ Check the terms against the request and the summary, which the
   Company writes.
2. **Show the terms** from the record, not the model's retelling, with the
   Company's name and verified domain.
3. **Take the decision in your own interface.** When the user taps Approve,
   create one approval (`approver="user"`, `input_type="tap"`, a time and a
   reference) and store it with the operation. If you also ask in the chat,
   read the user's own next message by fixed rules, never a model, and record
   a typed answer as `input_type="typed"`
   ([Operations §5](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval)).
4. **Resend the identical request** with that approval in `Poppy-Approval`. If
   the result is uncertain, resend the same approval, so the Company performs
   the change at most once
   ([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions/operations#at-most-once)).
   Never propose the change again to check. In a conversation, send the approval
   in a message whose request `id` derives from it (approver, time, reference),
   so a retry is the same request
   ([§8.3](https://personalagentprotocol.org/docs/1.0/spec#sending-messages)).
5. **Treat a decline as final.** Show `approval_declined` as the Company's
   decline, and don't resend; a new revision needs a new approval. Treat a reply
   to an approval with an error in its `data` as a decline too, with the
   Company's words as the reason.
6. **Treat a 4xx answer to a first send, or `conversation_closed`, as a
   refusal.** Nothing was performed: keep the operation proposed, so the user
   can approve again or ask for fresh terms, and name the Company's status and
   error code, never its text. A Retry resends the stored approval; only Approve
   makes a new one.

**The line:** neither the model nor Company content can approve. In Iris a
typed "yes" counts only as the user's next message after the agent's own
question about that revision, read before any model is asked; "yes, go ahead"
anywhere else changes nothing. Check standing rules, such as "approve refunds
under $10", in code against the operation's `terms`, record each approval they
make as `approver="agent"`, and send anything a rule can't settle to the user.
After the Company declines an agent approval or answers it with new terms, leave
that operation to the user for every later revision
([Operations §6](https://personalagentprotocol.org/docs/1.0/extensions/operations#sending-approval)).

You know it works when Lantern answers your change request with
`403 approval_required`, nothing changes until the user approves, and the
order changes once after you resend.

## 7. The model boundary

Enforce in code what never enters the model's context, because anything there
can end up in output or a tool call. For Iris:

- Access and refresh tokens, authorization codes and URLs, and state.
- Root, delegated and DPoP private keys, and Session JWTs.
- Raw URLs the Company hasn't given it: tools take parameters, not arbitrary
  destinations.

Mark Company content (API responses, Company Agent messages, alternatives,
skills, tool descriptions, operation summaries) `untrusted_company_content`, and
describe it in the system prompt as data, never instructions.

Redact tokens, codes and signatures from logs and traces too, as Iris's
Inspector does. Render the few marks a model uses (bold, code) as elements,
never as HTML, and only in the model's own messages. Show Company content
verbatim, as the Company's.

You know it works when a search of everything you send to the model finds no
token, code, key or Session JWT.

## Reference implementation

Iris is a working Personal Agent you can read and
[use](https://poppylab.dev/playground); its Inspector shows each step. It runs
any model behind an OpenAI-compatible, Anthropic, Google Gemini or Ollama API,
a free Workers AI model, or no model in demo mode, with the same deterministic
code.

| Piece          | Where in Iris                                                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity       | [`/agent/client.json`](../../apps/playground/app/agent/client.json/route.ts), `/agent/jwks.json`                                                                                                                                             |
| Session layer  | [`session.ts`](../../packages/pap-agent/src/session.ts) `ensureSession`, `sessionHeaders`                                                                                                                                                    |
| Transport      | [`pap-client`](../../packages/pap-client/src/index.ts) `protocolRequest`                                                                                                                                                                     |
| Interfaces     | [`openapi.ts`](../../packages/pap-client/src/openapi.ts), [`conversations.ts`](../../packages/pap-agent/src/conversations.ts)                                                                                                                |
| Account access | [`account-sign-in.ts`](../../packages/pap-agent/src/account-sign-in.ts), [`sealed.ts`](../../packages/pap-agent/src/sealed.ts)                                                                                                               |
| Approvals      | [`operation-review.tsx`](../../apps/playground/app/operation-review.tsx), [`chat-answers.ts`](../../packages/pap-agent/src/chat-answers.ts), `approvalFor` and `sendApproval` in [`transport.ts`](../../packages/pap-agent/src/transport.ts) |
| The model      | Any model through [`llm-adapters`](../../packages/llm-adapters)                                                                                                                                                                              |

## Check your work

- [ ] A user's IDs differ at each Company and hold nothing derived from personal
      data.
- [ ] The tasks endpoint is read for each Session, and excluded tasks are never
      reported.
- [ ] Sign-in asks for least privilege, with PKCE, PAR when offered and a DPoP
      key per user.
- [ ] The approval card shows the Company's name, domain and the terms from the
      record, and a decline is final.
- [ ] Nothing the model or Company content says approves anything.

## Go deeper

- [Approvals with Operations](operations.md): who may approve and what an
  approval proves.
- [Conversations with a Company Agent](conversations.md): when to use a
  conversation instead of an API.
- [One task, request by request](one-task.md): what each step sends.
- [Build a Company](build-a-company.md): the side to test your agent against,
  automated by the [Company kit](https://personalagentprotocol.org/kit/company).

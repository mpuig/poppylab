# Build a Personal Agent

The official [Company kit](https://personalagentprotocol.org/kit/company)
covers the Company side only. This page is the other side: what a Personal
Agent has to do, in the order it does it, written from building
[Iris](https://poppylab.dev/playground), Poppy Lab's agent. It links to the
[specification](https://personalagentprotocol.org/docs/1.0/spec) for the
rules and to our code for one way to meet them.

Libraries handle the cryptography. The hard part is deciding where the model
stops and deterministic code takes over, and most sections end with a paragraph
headed **The line** that says where.

## The pieces

| Piece          | Does                                                                      | In Iris                                                                                                                    |
| -------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Identity       | Publishes who the agent is and its public keys                            | [`/agent/client.json`](../../apps/playground/app/agent/client.json/route.ts), `/agent/jwks.json`                           |
| Session layer  | Gives each user an ID per Company, signs the Session header               | [`runtime.ts`](../../apps/playground/lib/runtime.ts) `ensureSession`, `sessionHeaders`                                     |
| Transport      | Fetches Company URLs without becoming an attack tool                      | [`pap-client`](../../packages/pap-client/src/index.ts) `protocolRequest`                                                   |
| Interfaces     | Turns an OpenAPI document, MCP server or conversation endpoint into tools | [`openapi.ts`](../../packages/pap-client/src/openapi.ts), [`conversations.ts`](../../apps/playground/lib/conversations.ts) |
| Account access | Signs the user in, stores and refreshes tokens                            | [`account/route.ts`](../../apps/playground/app/api/account/route.ts), [`sealed.ts`](../../apps/playground/lib/sealed.ts)   |
| Approvals      | Shows exact terms, takes the user's decision, resends                     | [`operation-review.tsx`](../../apps/playground/app/operation-review.tsx), `sendApproval`                                   |
| The model      | Reads, plans, explains, proposes                                          | Any model; Iris runs GPT, Claude or no model at all                                                                        |

Everything in the table except the last row is deterministic code. The model
calls tools; the tools decide what goes over the wire.

## 1. Identity: a URL, two keys, no registration

A Personal Agent's `client_id` is the HTTPS URL of a small JSON document
([§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)).
Companies fetch it instead of asking you to register:

```json
{
  "client_id": "https://poppylab.dev/agent/client.json",
  "client_name": "Iris",
  "jwks_uri": "https://poppylab.dev/agent/jwks.json",
  "redirect_uris": ["https://poppylab.dev/api/account/callback"],
  "token_endpoint_auth_method": "private_key_jwt"
}
```

- **`client_name` is a claim, the host is proof.** Companies show both, so a
  Company's consent page reads "Connecting Iris from poppylab.dev". Pick a
  name that doesn't impersonate anyone.
- **The root key in `jwks_uri` signs almost nothing.** It signs client
  assertions at token endpoints and short-lived _delegations_. Everything
  else is signed by delegated keys (below), so the root key can live in a
  secret store and rarely be touched. ES256 and PS384 are the two algorithms
  every Company must accept.
- **Operator signatures use a third key.** If you sign requests with Web Bot
  Auth ([guides](https://personalagentprotocol.org/docs/1.0/guides#both-operator-signatures), [spec](https://personalagentprotocol.org/docs/1.0/spec#operator-signatures)),
  publish that key at `/.well-known/http-message-signatures-directory`, apart
  from `jwks_uri`. Iris derives it from the identity secret with HKDF.

Serve these documents without redirects and with short cache lifetimes: a
Company that cached your old keys can't verify you after a rotation (see
_Rotating keys_ in the [guides](https://personalagentprotocol.org/docs/1.0/guides)).

## 2. Users and Sessions

Every request to a Company carries a Session header naming the user and the
Session ([§5.2](https://personalagentprotocol.org/docs/1.0/spec#session-header)),
so the agent needs both before its first request.

**A user ID per Company, derived rather than stored.** The ID must be stable,
opaque, different at each Company and not derived from personal data, even with
a keyed hash
([§5.1](https://personalagentprotocol.org/docs/1.0/spec#user-ids)).
Iris computes it from its own internal visitor ID and the Company's identifier
with a secret only it has:

```ts
const secret = hmac("poppy-user-ids", identitySecret);
const userId = `usr_${hmac(secret, `${visitor}\n${companyIdentifier}`).slice(0, 32)}`;
```

The same user gets the same ID at Lantern every time, and IDs at Lantern and
Juniper can't be linked. If the visitor ID were an email address, this would
break the rule; it's a random ID.

**A delegated key per user.** The Session JWT is signed with an ES256 key the
agent generates, vouched for by a delegation the root key signs and carried in
the JWT's `poppy_dlg` header. Use each delegated key, and each DPoP key, for
one user only; otherwise a Company could link two users through a shared key.
Iris creates a fresh delegated key whenever the user ID changes and renews it
before the delegation expires.

**A Session per task, a new one when told.** The `sid` is the agent's choice.
Iris keeps one while a user works with a Company and starts a new one when the
Company answers `session_ended`, resending the request once. It never retries
`invalid_session`: that means the header itself is wrong.

## 3. Fetching Company URLs safely

A Personal Agent fetches URLs that strangers give it: whatever domain the user
types, and whatever endpoints that domain lists. Without care, it becomes a
way to reach internal services.

`protocolRequest` enforces these rules in code, where the model can't change
them:

- **HTTPS only**, no credentials in URLs.
- **No private, loopback or link-local addresses.** In Node, the hostname is
  resolved once and the connection is pinned to the checked address, so a
  DNS answer can't change between the check and the request. On Cloudflare
  Workers, which can't pin, the hostname is checked before every hop.
- **Redirects one hop at a time, each checked.** Discovery redirects must end
  at a `/.well-known/poppy.json`; protocol endpoints may not redirect at all,
  because a redirect must never carry a token or Session JWT
  ([§3](https://personalagentprotocol.org/docs/1.0/spec#discovery)).
- **Size and time limits** on every response, and a cool-down per origin after
  a 429.

The [guides](https://personalagentprotocol.org/docs/1.0/guides) cover this as
_Fetching metadata safely_. It's the first thing to build, before any model is
involved.

## 4. Before the first task

After discovery (see [One task, request by request](one-task.md)), Iris does
three things once per Session:

1. **Chooses the version** from `supported_versions`, the newest 1.x it
   shares, and sends `Poppy-Version` on every request. After
   `version_unsupported`, it fetches `poppy.json` again and resends once only
   if its choice changed.
2. **Reads the tasks endpoint**, signed out. Excluded tasks become a tool the
   model can check before hunting for a way to do something the Company
   chose not to offer; the feedback endpoint becomes a tool for reporting a
   task that turned out to be impossible ([the request, the answers and the
   rules Iris applies](build-a-company.md#feedback-on-the-wire)).
3. **Builds tools from the interfaces.** Each OpenAPI operation becomes a
   tool with its parameters and the scopes it needs; the conversation endpoint
   becomes `send`, `read` and `handoff` tools. The model picks the interface
   per task: an API for exact reads and changes, the Company Agent for things
   no API covers, such as a missing item.

**The line:** tool descriptions come from the Company, so they're untrusted
input to the model, like any other Company content. Iris marks Company
content as such in tool results and tells the model it is data, never
instructions.

## 5. Signing in

Account access is plain OAuth with three habits worth copying:

- **Ask for the least.** `scope_hints` says what each scope changes and whether
  it touches personal data. Iris asks for read scopes first and asks again,
  with `prompt=consent`, only when a task needs to change something.
- **Push the request** when the Company offers PAR
  ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), and always use PKCE and
  a client assertion.
- **Bind tokens to a DPoP key per user** and keep that key for every refresh
  of the tokens it got; a Company may refuse a refresh signed with another key
  ([§4.4](https://personalagentprotocol.org/docs/1.0/spec#refresh-tokens)).

Store tokens and private keys encrypted at rest. Iris keeps them per visitor,
sealed with AES-256-GCM and bound to the row that holds them, so its database
never sees a usable token. Before its first signed-in call to an API or
conversation endpoint, it also reads that service's protected resource
metadata: a service that names its own resource gets its own token
([§4.5](https://personalagentprotocol.org/docs/1.0/spec#access-tokens)). On
sign-out, it revokes the refresh token.

**The line:** the sign-in control is a button in the interface, not a tool.
When a tool needs a scope the agent doesn't have, it returns
`sign_in_required` or `insufficient_scope` with an instruction for the model
to ask the user. The model never sees the authorization URL, the code or the
token.

## 6. Approvals

With the Operations extension, a change comes back as `403 approval_required`
with exact `terms` and a `revision`. What Iris does with it:

1. **The tool records the operation and the exact request** that produced it,
   and returns to the model only a summary and a note: _"Nothing was done.
   The user must approve these exact terms with the control in the chat; your
   words can't approve it."_
2. **The interface shows the terms**, from the record, not from the model's
   retelling, with the Company's name and its verified domain.
3. **The user taps Approve.** That creates one approval (`approver="user"`,
   `input_type="tap"`, a time and a reference) and stores it with the
   operation.
4. **Code resends the identical request** with that approval in
   `Poppy-Approval`. If the result is uncertain, a retry sends the same
   approval again, so the Company can perform the change at most once
   ([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions/operations#at-most-once)).
5. **A decline is final.** `approval_declined` shows as declined by the
   Company; a new revision needs a new approval.

**The line:** approving is never a tool, and chat text never counts. "Yes, go
ahead" in the chat changes nothing. If you add standing rules, such as
"approve refunds under $10", check them in code against the operation's
`terms`, record each approval the rule made as `approver="agent"`, and send
anything the rule can't settle to the user.

## 7. The model boundary

Write down what never enters the model's context and enforce it in code. For
Iris:

| Never in context                                      | Why                                                     |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Access and refresh tokens, authorization codes, state | Anything in context can end up in output or a tool call |
| Root, delegated and DPoP private keys, Session JWTs   | Same, and they're signing material                      |
| Approval controls                                     | The model proposes; only the user approves              |
| Raw URLs it hasn't been given by the Company          | Tools take parameters, not arbitrary destinations       |

What does enter the context is flagged:

- Company content (API responses, Company Agent messages, alternatives,
  skills): marked `untrusted_company_content`, described in the system prompt
  as data, never instructions.
- Operation summaries: what the Company says the change is, next to the note
  that nothing was done.

Logs and traces follow the same rule: Iris's Inspector shows every request
and response, with tokens, codes and signatures redacted.

## A checklist

| Area            | Requirement                                                                | Spec                                                                                         |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Identity        | `client_id` URL with `jwks_uri`, `private_key_jwt`, ES256 or PS384         | [§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity)                       |
| Users           | Stable, pairwise, opaque user IDs, not derived from personal data          | [§5.1](https://personalagentprotocol.org/docs/1.0/spec#user-ids)                             |
| Sessions        | Session JWT on every request, delegated key per user, `ath` when signed in | [§5.2](https://personalagentprotocol.org/docs/1.0/spec#session-header)                       |
| Versions        | `Poppy-Version` on every request; choose again after `version_unsupported` | [§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)                             |
| Transport       | HTTPS, no private addresses, no secrets across redirects                   | [§3](https://personalagentprotocol.org/docs/1.0/spec#discovery)                              |
| Tasks           | Read the tasks endpoint per Session; don't report excluded tasks           | [§9](https://personalagentprotocol.org/docs/1.0/spec#task-coverage)                          |
| Sign-in         | Least privilege, PKCE, PAR when offered, DPoP key per user                 | [§4.2–4.4](https://personalagentprotocol.org/docs/1.0/spec#sign-in)                          |
| Approvals       | Exact terms shown, explicit user approval, identical resend, retries       | [Operations §5–7](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval) |
| Company content | Shown as the Company's, never followed as instructions                     | [§10.1](https://personalagentprotocol.org/docs/1.0/spec#security)                            |

## Try it

- Use Iris at [poppylab.dev/playground](https://poppylab.dev/playground) and
  open the Inspector to watch each of these steps.
- Point your own agent at the four test Companies
  ([developers](https://poppylab.dev/developers)): they accept any HTTPS
  `client_id`, and their customers are fictional.

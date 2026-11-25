# Glossary

The words Personal Agent Protocol uses, in plain language. Each entry links to
where it's explained in practice, and to the
[specification](https://personalagentprotocol.org/docs/1.0/spec) when you need
the exact rule.

**Access token.** What a Personal Agent sends to read or change the user's
account, after the user signed in. Ordinary OAuth, usually bound to the agent's
key with DPoP. See [One task](one-task.md#6-get-a-token).

**Agent approval.** An approval the Personal Agent gives itself, on an
instruction the user gave it, such as "refunds under $10 are fine". See
[Approvals](operations.md#4-who-approves).

**Agent ID.** An optional ID that tells apart several agents one operator runs
for the same user, such as a travel agent and a shopping agent. Like a User
ID, it's different at each Company.

**Alternative.** Another way to do a task, offered by the Company: in plain
words, a page, an API operation or a tool. It comes with an excluded task, a
feedback reply or a declined approval.

**Approval.** A statement that one revision of an operation was approved, by
the user or by the agent on the user's instruction. At an API it travels in
the `Poppy-Approval` header. See [Approvals](operations.md).

**At most once.** The guarantee that a change approved once happens once, even
if the agent resends the request after a lost response. The Company answers a
repeated approval with the original result.

**Browser join.** A way for the Personal Agent's browser to join the same
Session on the Company's website, with a cookie limited to the scopes the user
granted
([§6](https://personalagentprotocol.org/docs/1.0/spec#web-browsing)). Poppy
Lab doesn't implement it yet.

**`client_id`.** A Personal Agent's identity: the HTTPS URL of a small JSON
document with its name, its keys' URL and its redirect URIs. Companies fetch it
instead of asking agents to register. See
[Build a Personal Agent](build-an-agent.md#1-identity-a-url-two-keys-no-registration).

**Company.** Any business or service a Personal Agent works with: a shop, a
bank, an airline. It publishes `poppy.json` and decides what agents may do.

**Company Agent.** The Company's own automated agent, reachable in a
conversation. It can be a model or, as in Poppy Lab, plain code. See
[Conversations](conversations.md).

**Consent page.** The Company's own page where the user signs in and grants
an agent scopes. It shows the agent's name next to the verified host of its
`client_id`.

**Conversation.** A thread between a Personal Agent and a Company Agent, with
text and structured data, state, sign-in requests, operations and handoff to a
person. See [Conversations](conversations.md).

**Decline.** A Company's refusal of a valid approval, for its own reasons,
with an optional plain-language reason and alternative. Final for that
revision.

**Delegated key, delegation.** A short-lived key the Personal Agent generates
to sign Session JWTs, and the signed statement from its long-term key that
vouches for it, carried in the JWT's `poppy_dlg` header. The long-term key
then signs almost nothing.

**Device Sign-In.** Signing in with a code shown on one device and entered on
another, for agents without a browser on hand.

**Direct Conversation.** A conversation in which the user talks to the Company
in their own words, linked to the agent's conversation before it. The Company
can ask for one; only the agent, on the user's choice, opens it. See
[Conversations](conversations.md#6-the-company-asks-for-the-user-a-direct-conversation).

**Direct Sign-In.** Signing in through the browser: the agent opens the
Company's consent page and gets a code back. What Poppy Lab uses.

**Discovery.** Finding out what a Company offers by fetching
`/.well-known/poppy.json` from its domain. See
[One task](one-task.md#1-find-out-what-the-company-offers).

**DPoP.** A way to bind a token to a key
([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)): each request carries a
fresh proof signed with the key, so a stolen token is useless on its own.

**Excluded task.** A task a Company chose not to offer through the protocol,
listed at its tasks endpoint, often with an alternative. Agents check them
before trying.

**Feedback.** A short report a Personal Agent sends when a user's task
couldn't be done. It describes the task, never the user.

**Handoff.** Asking for a person to join a conversation. The state shows
`pending` while the Company looks for someone.

**Issuer.** The Company's OAuth authorization server, named in its protected
resource metadata.

**Mediated Sign-In.** A transitional extension in which the Personal Agent
signs in for the user with credentials the user gave it for that Company, such
as an email and password, at the token endpoint. It exists only until a
Company can offer Direct or Device Sign-In
([extension](https://personalagentprotocol.org/docs/1.0/extensions/mediated-sign-in)).
Poppy Lab doesn't implement it.

**Operation.** A change the Company won't perform until it's approved: an
ID, a revision, exact terms, an optional summary and an expiry. See
[Approvals](operations.md).

**Operations extension.** The part of the protocol, version 3, that defines
operations and approvals. Companies list it in `poppy.json`; agents declare it
on each request.

**Operator signature.** An HTTP message signature (Web Bot Auth) on each
request, so a Company's edge can identify the agent's operator before the
request reaches the application. Separate from the Session JWT.

**PAR.** Pushed Authorization Requests
([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)): the agent sends the
sign-in parameters to the Company first, so they never travel in a URL.

**Personal Agent.** Software that acts for one person, such as an assistant
app. It identifies itself, signs every request and asks the user before
anything consequential. [Iris](https://poppylab.dev/playground) is Poppy Lab's.

**PKCE.** A check that the app finishing a sign-in is the one that started it.

**Poppy.** Short for Personal Agent Protocol, the name its authors use.

**`poppy.json`.** The discovery document every Company publishes at
`/.well-known/poppy.json`: its name and domain, how to sign in, its scopes and
its interfaces.

**`Poppy-Session`.** The Session header: a JWT the agent signs for every
request, naming itself, the user and the Session. See
[One task](one-task.md#3-open-a-session-signed-out).

**Protected resource metadata.** A small document
([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) at the Company's domain
naming its authorization server, and, for a service with its own resource,
that service's.

**Refresh token.** A longer-lived token that gets new access tokens without
asking the user again, bound to the same key as the tokens it was issued with.

**Revision.** One version of an operation's terms. It changes whenever the
terms or the expiry change, and an approval covers one revision only.

**Revocation.** Ending a grant, from the agent (on sign-out) or from the
Company's website ("disconnect this agent").

**Scope.** One permission a Company defines, such as `orders:read`. The user
grants scopes on the consent page.

**Scope hints.** What each scope changes (`none`, `reversible`,
`irreversible`) and whether it touches personal data, so agents can ask for
the least.

**Session.** One stretch of work between an agent, a user and a Company,
named by the agent's `client_id`, the `sid` it chose and the User ID. It
exists before sign-in and belongs to at most one account.

**Signed out.** Working with a Company without account access: public data,
conversations and feedback, all still attributed to a Session.

**Skills.** Instructions a Company publishes for agents on how to do a task
with its interfaces. Poppy Lab doesn't use them.

**Terms.** The data in an operation that defines exactly what will happen:
amounts, dates, items. What the user approves.

**User.** The person a Personal Agent acts for.

**User ID.** The ID an agent gives its user at one Company: stable, opaque and
different at every Company, so Companies can't link users with each other.

**Validator.** A tool that tests an implementation against the protocol. The
official one ships with the Company kit. See
[Validator results](validator.md).

# Glossary

The protocol's words, each linked to the Learn page that uses it. The
[specification](https://personalagentprotocol.org/docs/1.0/spec) holds the exact
rules; this page restates none.

**Access token.** What a Personal Agent sends to read or change the user's
account after sign-in, usually DPoP-bound to the agent's key. See
[One task](one-task.md#6-get-a-token).

**Agent approval.** An approval the Personal Agent gives itself on the user's
instruction, such as "refunds under $10 are fine". See
[Approvals](operations.md#who-approves).

**Agent ID.** An optional ID telling apart agents one operator runs for one user,
such as a travel agent and a shopping agent. It differs at each Company.

**Alternative.** Another way to do a task that the Company offers: a page, an
API operation or a tool. Offered with an excluded task, a feedback reply or a
declined approval. See [One task](one-task.md#3-open-a-session-signed-out).

**Approval.** A statement that one revision of an operation was approved, by the
user or by the agent. At an API it travels in
`Poppy-Approval`; `input_type` says how the user gave it, such as `tap` or
`typed`. See [Approvals](operations.md).

**At most once.** A change approved once happens once, even if the agent resends
after a lost response: the Company answers a repeat with the original result. See [Approvals](operations.md).

**Browser join.** The Personal Agent's browser joins the same Session on the
Company's website, with a cookie limited to the granted scopes
([§6](https://personalagentprotocol.org/docs/1.0/spec#web-browsing)). The
lab's Companies offer it at `/poppy/browser-session`; Iris has no browser and
never asks for it. See [Poppy compared](compared.md).

**`client_id`.** A Personal Agent's identity: the HTTPS URL of a JSON document
with its name, keys URL and redirect URIs. Companies fetch it instead
of registering agents. See
[Build a Personal Agent](build-an-agent.md#1-identity-a-url-two-keys-no-registration).

**Company.** A business or service a Personal Agent works with, such as a shop
or a bank. It publishes `poppy.json` and decides what agents may do. See
[Build a Company](build-a-company.md).

**Company Agent.** The Company's own automated agent in a conversation: a model
or, in Poppy Lab, plain code. See [Conversations](conversations.md).

**Consent page.** The Company's page where the user signs in and grants an agent
scopes, showing the agent's name and the verified host of its `client_id`. See [One task](one-task.md#5-ask-the-user-for-access).

**Conversation.** A thread between a Personal Agent and a Company Agent, with
text, structured data, state, sign-in requests, operations and handoff to a
person. See [Conversations](conversations.md).

**Decline.** A Company's refusal of a valid approval, for its own reasons, with
an optional reason and alternative. Final for that revision. See
[Approvals](operations.md).

**Delegated key, delegation.** A short-lived key the Personal Agent generates to
sign Session JWTs, with the statement from its long-term key that vouches for it,
in the `poppy_dlg` header. See
[One task](one-task.md#3-open-a-session-signed-out).

**Device Sign-In.** Signing in with a code shown on one device and entered on
another, for agents without a browser on hand. Every lab Company but Harborline
offers it. See
[Signing in](sign-in.md#device-sign-in-for-an-agent-without-a-browser).

**Direct Conversation.** The user talks to the Company in their own words, linked
to the agent's conversation. The Company can ask for one; only the agent, on the user's choice, opens it. See
[Conversations](conversations.md#when-the-company-needs-to-hear-from-the-user).

**Direct Sign-In.** Signing in through the browser: the agent opens the
Company's consent page and gets a code back. See
[One task](one-task.md#5-ask-the-user-for-access) and
[Signing in](sign-in.md).

**Discovery.** Finding out what a Company offers by fetching
`/.well-known/poppy.json` from its domain. See
[One task](one-task.md#1-find-out-what-the-company-offers).

**DPoP.** A way to bind a token to a key
([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)): each request carries a
fresh proof signed with the key. See [One task](one-task.md#6-get-a-token).

**Domain extension.** An extension from outside the protocol's authors, named
with a domain its author controls, such as `poppylab.dev/fdx`. A Company lists
it under `extensions` in `poppy.json`. See
[Domain extensions](extensions/README.md).

**Excluded task.** A task a Company chose not to offer through the protocol,
listed at its tasks endpoint, often with an alternative. See
[One task](one-task.md#3-open-a-session-signed-out).

**Feedback.** A short report a Personal Agent sends when a user's task couldn't
be done. It describes the task, never the user. See
[One task](one-task.md#3-open-a-session-signed-out).

**Handoff.** Asking for a person to join a conversation. The state shows
`pending` while the Company looks for someone. See
[Conversations](conversations.md).

**Issuer.** The Company's OAuth authorization server, named in its protected
resource metadata. See
[One task](one-task.md#2-find-the-authorization-server).

**Mediated Sign-In.** A transitional extension, until a Company offers Direct or
Device Sign-In: the Personal Agent signs in for the user at the token endpoint
with credentials such as an email and password
([extension](https://personalagentprotocol.org/docs/1.0/extensions/mediated-sign-in)).
The protocol plans to retire it on 17 March 2027, and none of the lab's
Companies offers it. See
[Signing in](sign-in.md#mediated-sign-in-and-why-the-lab-doesnt-offer-it).

**Operation.** A change the Company won't perform until it's approved: an ID, a
revision, exact terms, an optional summary and an expiry. See
[Approvals](operations.md).

**Operations extension.** The part of the protocol, version 3, that defines
operations and approvals. Companies list it in `poppy.json`; agents declare it
on each request. See [Approvals](operations.md).

**Operator signature.** An HTTP message signature (Web Bot Auth) on each
request, so a Company's edge can identify the agent's operator. Separate from
the Session JWT. See [Build a Personal Agent](build-an-agent.md).

**PAR.** Pushed Authorization Requests
([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)): the agent sends the
sign-in parameters to the Company first, not in a URL. See
[One task](one-task.md#5-ask-the-user-for-access).

**Personal Agent.** Software that acts for one person, such as an assistant app.
It identifies itself, signs every request and asks the user before anything
consequential. Poppy Lab's runs as [Iris](https://poppylab.dev/playground).

**PKCE.** A check that the app finishing a sign-in is the one that started it.
See [One task](one-task.md#5-ask-the-user-for-access).

**Poppy.** Short for Personal Agent Protocol, the name its authors use.

**`poppy.json`.** The discovery document every Company publishes at
`/.well-known/poppy.json`: its name and domain, how to sign in, its scopes and
its interfaces. See [One task](one-task.md#1-find-out-what-the-company-offers).

**`Poppy-Session`.** The Session header: a JWT the agent signs for every
request, naming itself, the user and the Session. See
[One task](one-task.md#3-open-a-session-signed-out).

**Protected resource metadata.** A small document
([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) at the Company's domain
naming its authorization server and, for a service with its own resource, that
service's. See [One task](one-task.md#2-find-the-authorization-server).

**Refresh token.** A longer-lived token that gets new access tokens without
asking the user again, bound to the same key. See
[One task](one-task.md#6-get-a-token).

**Revision.** One version of an operation's terms, new whenever the terms or the
expiry change. An approval covers one revision only. See
[Approvals](operations.md).

**Revocation.** Ending a grant, from the agent (on sign-out) or from the
Company's website ("disconnect this agent"). See
[One task](one-task.md#what-each-side-got).

**Scope.** One permission a Company defines, such as `orders:read`, granted by
the user on the consent page. See
[One task](one-task.md#1-find-out-what-the-company-offers).

**Scope hints.** What each scope changes (`none`, `reversible`, `irreversible`)
and whether it touches personal data. See
[One task](one-task.md#1-find-out-what-the-company-offers).

**Session.** One stretch of work between an agent, a user and a Company, named
by the agent's `client_id`, its `sid` and the User ID. It exists before
sign-in and belongs to at most one account. See
[One task](one-task.md#3-open-a-session-signed-out).

**Signed out.** Working with a Company without account access: public data,
conversations and feedback, still attributed to a Session. See
[One task](one-task.md#3-open-a-session-signed-out).

**Skills.** Instructions a Company publishes for agents on how to do a task with
its interfaces. The lab's Companies list theirs in the tasks response, and the
playground's Inspector shows that list. Iris loads none.

**Streaming.** Reading a conversation's events as server-sent events instead of
waiting reads
([§8.6](https://personalagentprotocol.org/docs/1.0/spec#streaming)). Every lab
Company streams. See
[Conversations](conversations.md#waiting-for-a-reply-or-streaming-it).

**Terms.** The data in an operation that defines exactly what will happen:
amounts, dates, items. What the user approves. See
[One task](one-task.md#8-propose-the-change).

**User.** The person a Personal Agent acts for.

**User ID.** The ID an agent gives its user at one Company: stable, opaque and
different at every Company. See
[One task](one-task.md#3-open-a-session-signed-out).

**Validator.** A tool that tests an implementation against the protocol. The
official one ships with the Company kit. See [Validator results](validator.md).

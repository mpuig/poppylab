# Pitfalls and interop

Things that went wrong while building Poppy Lab, or while testing it against
other implementations, and what fixed them. Entries marked _Seen_ are bugs we
actually shipped, usually found by another implementation, a validator or a
person using the product, after our own tests passed. The others are traps
we designed around. Either way, it's cheaper to read these than to
rediscover them.

## Agent side

**OpenAPI documents that declare the protocol headers.**
_Seen:_ Iris loaded no tools at all from Cliffside Retail's 1.0 API.
_Cause:_ Cliffside's OpenAPI declares `Poppy-Version` on every operation as a
header parameter, by reference to `#/components/parameters`, and our tool
generator refused `$ref` parameters, so it skipped every operation.
_Fix:_ resolve local parameter references, and leave out of the model's
arguments the headers the agent sets itself (`Poppy-Version`,
`Poppy-Session`, `Poppy-Extensions`, `Authorization`, `DPoP`). A model must
never choose the value of a protocol header.

**Comparing endpoints without the port.**
_Seen:_ against local Companies on ports 4100 and 4200, conversation requests
were refused as going to the wrong host.
_Cause:_ the check that a conversation URL belongs to the Company compared
`hostname`, which drops the port.
_Fix:_ compare `host` (or the whole origin). `organization.domain` includes a
non-443 port for the same reason
([§3.1](https://personalagentprotocol.org/docs/1.0/spec#discovery)).

**Retrying the wrong errors.**
_Trap:_ the two Session errors look alike and mean opposite things.
_Fix:_ on `session_ended`, start a new Session and resend once; on
`invalid_session`, stop, because the header itself is wrong. On
`version_unsupported`, fetch `poppy.json` again and resend once only if the
chosen version changed
([§3.4](https://personalagentprotocol.org/docs/1.0/spec#versions)).

**Losing the response after the change happened.**
_Seen:_ in a test that cut the connection after the Company saved an order,
the agent didn't know whether it had ordered.
_Cause:_ none; this is the failure Operations is designed for.
_Fix:_ keep the approval with the operation and resend the identical request
with the identical approval. The Company returns the original result instead of
ordering twice
([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions)).
Never propose the purchase again to "check".

**Rate limits across origins.**
_Trap:_ a `Retry-After` honoured only for the next request to the same URL.
_Fix:_ a cool-down per origin, checked before any connection opens, never
shortened by a later, earlier deadline, and no automatic repeat of a POST.

**Feedback that never reached the customer.**
_Seen:_ a feedback report sent signed out didn't appear in the customer's
portal at the Company.
_Cause:_ the Company links a customer's browser to the agent's data on the
first request that carries the access token. A report sent without one went
to the agent's data before that link existed.
_Fix:_ when signed in, send feedback with the access token. The spec allows it,
and the report is then tied to the account.

**Interface text that implies more than it means.**
_Seen:_ after disconnecting the agent at the Company, the playground still
showed a green check next to the Company's name.
_Cause:_ the check meant "discovery succeeded", which says nothing about
account access.
_Fix:_ say what discovery proved ("Found Lantern Noodle Bar ·
food-demo.poppylab.dev") and show account access separately. Users read every
green check as "connected".

**Markdown from the model.**
_Seen:_ `**+1 555-0117**` with the asterisks, in a chat that renders plain text.
_Fix:_ render the few marks models use (bold, code) as elements, never as
HTML, and only for the model's own messages. Company content stays verbatim.

**Reading the wrong thread after an approval.**
_Seen:_ in production, approving a refund proposed in a Direct Conversation
left Iris's card pending, although the Company had refunded.
_Cause:_ Iris read the Company's reply with the parent conversation's cursor.
The Direct Conversation has its own, so the read started from its beginning,
met the original proposal, and Iris took it for new terms.
_Fix:_ keep a read position per conversation and use the operation's own
thread, and ignore Company replies whose `as_of_request` names another
request ([§8.4](https://personalagentprotocol.org/docs/1.0/spec#message-fields)).
The tests had a single thread; the bug needed two.

## Company side

**The token endpoint's check order.**
_Seen:_ the official validator reported eight client-assertion checks as
inconclusive.
_Cause:_ it tests assertions by sending a valid one with a refresh token that
doesn't exist and expecting `invalid_grant`. Our endpoint checked the DPoP
proof first and answered `invalid_dpop_proof`.
_Fix:_ look the refresh token up before the proof. An unknown one is
`invalid_grant` whatever else is wrong; a real one still needs its key.

**Errors for features you don't offer yet.**
_Seen:_ the official validator failed two Direct Conversation checks.
_Cause:_ we refused every `parent_conversation_id` with `invalid_request`. The
spec gives an unknown parent `conversation_not_found` and a closed one
`conversation_closed`, and doesn't make Direct Conversations optional.
_Fix:_ validate the parent first. Before shipping "not supported", check whether
the spec lets you not support it.

**Metadata without caching headers.**
_Seen:_ the community validator warned on our OAuth and resource metadata,
client metadata and JWKS.
_Fix:_ `Cache-Control` with a short `max-age` on every metadata document.
Agents and Companies both fetch them often.

**The extension challenge in the wrong place.**
_Trap:_ a change attempted without `Poppy-Extensions: "operations";v="3"`
looks like an authorization problem, so it's tempting to answer with a
`WWW-Authenticate` challenge.
_Fix:_ `403 {"error": "extension_required", "extension": "operations"}` as a
JSON body only. And read the extension from the request's header, per request;
it's not a property of the token.

**A second account in the same Session.**
_Fix:_ a Session belongs to one account
([§5.4](https://personalagentprotocol.org/docs/1.0/spec#signing-in)). A token
for another account ends it with `session_ended`; the agent starts a new
Session. Don't silently rebind it.

**Answering an approval with its own revision.**
_Trap:_ a mismatch handler that echoes the revision from the request makes
the agent retry the same approval in a loop.
_Fix:_ a mismatch always returns a revision for what the request asks now,
never the one the approval names.

**Feedback text shown to other people.**
_Trap:_ the obvious design, one list of reports on a page, publishes on a
public demo whatever any visitor types.
_Fix:_ keep each report with the customer's own data, escape it, and match
alternatives with your own code. A report is data; never pass it to a model
as instructions.

**A public Company Agent backed by a model.**
_Trap:_ anyone can open a conversation, signed out, and each message would
cost the Company a model call.
_Fix:_ our Company Agents are deterministic: structured `data` in, data out.
If yours uses a model, put the same rate limits and budgets on it as on any
public endpoint.

**Consent pages that trust the name.**
_Fix:_ always show the agent's `client_name` next to the verified host of its
`client_id`: "Connecting Iris from poppylab.dev". The name is only what the
agent claims; the host is what was verified.

## Between implementations

**The spec moves.**
The Session JWT's delegation header changed between drafts, and other
implementations changed with it at different times. We keep a copy of the
spec in the repo with its digest and run `pnpm spec:drift` to see when the
published text differs. It caught the change the day it happened.

**Versions don't mix.**
1.0 promises later 1.x versions won't break it, but nothing before 1.0 is
compatible. Iris refuses a 0.x document instead of guessing; when we moved to
1.0 we discarded saved 0.3 runs rather than migrating them. Check the
[demos page](https://personalagentprotocol.org/docs/demos) for the version
each implementation follows before testing against it.

**Sign-in types don't always overlap.**
Cliffside Retail offers only Mediated Sign-In, which Iris doesn't implement,
so Iris works with it signed out only. Before testing account access between
two implementations, compare the sign-in types each lists.

**Two validators find different things.**
The community validator found our missing `Cache-Control`; the official one
found the token endpoint's check order and the Direct Conversation errors.
Neither found what the other did, and our 470 tests had found none of it. Run
both, and don't read a pass as proof that an implementation is correct.

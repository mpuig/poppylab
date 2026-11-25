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
([§3.1](https://personalagentprotocol.org/docs/1.0/spec#fields)).

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
([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions/operations#at-most-once)).
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

**A token that outlives its sign-in.**
_Seen:_ after **Request change permission**, the next call to a service
answered `invalid_token` and the User was told access was lost.
_Cause:_ a token for one service's resource
([§4.5](https://personalagentprotocol.org/docs/1.0/spec#access-tokens)) was cached for its lifetime, and nothing cleared
the cache on a new sign-in or a sign-out. The old token went out with the new
sign-in's DPoP key. With Bearer tokens, a second account's requests would
have carried the first account's token.
_Fix:_ drop every cached token with the sign-in it came from. The services'
resource metadata can stay: it is public and doesn't depend on who signed in.

**Feedback sent wherever the tasks response says.**
_Trap:_ `feedback.endpoint` can name any HTTPS URL, and a signed-in report
carries the access token and the Session header. A tasks response naming
another host would hand that host the User's token.
_Fix:_ a feedback endpoint counts only on the Company's own domain or a
subdomain of it, the rule a conversation endpoint already follows
([§9.3](https://personalagentprotocol.org/docs/1.0/spec#feedback)). Elsewhere, offer no report tool and send nothing.

**Tools that remember the last Session's tasks.**
_Seen:_ after `session_ended` in the middle of a turn, `excluded_tasks`
returned an empty list and a report no longer saw the feedback endpoint.
_Cause:_ a tasks response is used only in its own Session
([§9](https://personalagentprotocol.org/docs/1.0/spec#task-coverage)), so the new Session dropped it, but the tools
built at the start of the turn kept reading the old copy.
_Fix:_ each tool reads the tasks for the current Session before using them.
The same Session still reads them once.

**One request ID for two approvals.**
_Seen:_ the User approved an operation the Company had declined from Iris,
and the page reported an unknown outcome until the operation expired.
_Cause:_ the request ID of an approval message came from the operation and
its revision alone. The User's approval reused the ID of Iris's with a
different body, and the Company answered `request_id_conflict`
([§8.3](https://personalagentprotocol.org/docs/1.0/spec#sending-messages)).
_Fix:_ derive the ID from the approval itself (approver, time, reference). A
retry sends the same approval, so it is still the same request
([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions/operations#at-most-once)); any other approval is another message.

**An error shown as the result.**
_Seen:_ "Company operation succeeded: The card changed after the proposal.
Ask again for fresh terms."
_Cause:_ an approval sent in a conversation took the text of the Company's
reply as the result, whatever it said. Some Company Agents answer a stale
proposal with plain text and an `error` in `data`.
_Fix:_ a reply to an approval with an error in its data means nothing was
performed. Report it as a declined approval, with what the Company said as
the reason, and don't send that approval again.

**A refusal reported as "may have completed".**
_Seen:_ a transfer the bank refused with `409 insufficient_funds` showed
"unknown outcome" and a Retry button, which then failed with a sign-in
error.
_Cause:_ only a few 4xx answers had a case of their own. The rest fell
through to the answer for a lost response.
_Fix:_ a 4xx in answer to a first send is a refusal: nothing was performed,
and the outcome is known. Iris answers the page with `409 not_performed` and
the operation, still proposed, so the User can approve again or ask for
fresh terms. The same holds when the operation's conversation is closed
(`conversation_closed`): the Company didn't take the message. The message
names the Company's status and error code, never its text.

**A Retry that makes a new approval.**
_Seen:_ after the Company declined a retried agent approval, a second Retry
performed the operation in the User's name, though they had only pressed
Retry.
_Cause:_ the stored approval had been dropped, and Retry fell back to
approver `user` and built a new one.
_Fix:_ Retry resends the stored approval or sends nothing. A new approval is
made only by Approve. A declined retry is a known outcome, so the operation
goes back to proposed and waits for the User.

**A standing instruction that keeps approving.**
_Seen:_ every reload sent another agent approval for an operation the
Company had already declined, and each one counted against the hour's
allowance.
_Cause:_ the rule looked only at the terms. Nothing on the operation said
the Company had declined the agent, and proposing it again rebuilt it.
_Fix:_ mark the operation when the Company declines the agent's approval or
answers it with new terms, keep the mark whatever the revision, and leave
the operation to the User
([Operations §5](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval),
[§6](https://personalagentprotocol.org/docs/1.0/extensions/operations#sending-approval)). Count an automatic approval toward the allowance
only when the Company performed it or the outcome is unknown, once, at the
amount it covered.

**A model that isn't told the terms.**
_Seen:_ an API call refused with `approval_required` gave the model the
operation's ID, summary and expiry. The summary is optional, so without one
the model had nothing to tell the User about what was waiting.
_Fix:_ give the model the terms, and leave the summary out when the Company
sent none.

**A reload that sends the User's words to the model.**
_Seen:_ in a Direct Conversation the page says Iris doesn't read what the
User types. After a reload the page had forgotten the conversation was
direct, and the next message went to Iris and the model.
_Cause:_ the state came back only with a chat answer, not when the page
restored the run. Separately, the User's direct words were recorded in the
run's history, which is the model's context for later turns.
_Fix:_ return the Direct Conversation's state wherever the run is restored,
and clear it on connecting elsewhere or signing out. Record a direct turn
apart: the User's words go to the transcript only, and the model gets
Iris's own line with a note that the User wrote to the Company. When the
words were not sent (the thread had closed, or sign-in was needed), say so
in both places ([§8.10](https://personalagentprotocol.org/docs/1.0/spec#direct-conversations)).

**A Direct Conversation the agent lost track of.**
_Seen:_ every message, start and handoff got `409 direct_conversation_open`,
the page showed no way to leave, and only signing out recovered.
_Cause:_ Iris recorded a Direct Conversation only when the Company's answer
arrived. When that answer was lost, the Company had a thread open that Iris
didn't know.
_Fix:_ the refusal names the open thread in `conversation_id`
([§8.13](https://personalagentprotocol.org/docs/1.0/spec#conversation-errors)). When the User starts a Direct Conversation and gets
that refusal, take the named thread as theirs, show what the Company said in
it, and tell them their new message wasn't sent, since the earlier one may
have arrived. Nothing else joins a thread on the Company's word. When only the User's
thread is gone (`conversation_closed`, `conversation_not_found`), drop that
thread and keep the parent with its ID and read position. Read a closed
thread once more before dropping it, which sends nothing
([§8.12](https://personalagentprotocol.org/docs/1.0/spec#closing)), so the User sees the Company's last message.

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
([§5.4](https://personalagentprotocol.org/docs/1.0/spec#sign-in)). A token
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

**A nonce check that needs a proof.**
_Seen:_ with DPoP nonces on, a pushed authorization request without a
proof, which is allowed, was refused with `invalid_client`. So was a
revocation, which never takes a proof.
_Cause:_ the early nonce check decoded the `DPoP` header even when there
was none.
_Fix:_ challenge a nonce only when the request carries a proof. Where a
challenge applies, answer it the same way everywhere: revocation
([§4.6](https://personalagentprotocol.org/docs/1.0/spec#revocation)) answered `401 invalid_client` with no nonce to
retry with, and now answers as the token endpoint does:

```http
HTTP/1.1 400 Bad Request
DPoP-Nonce: 8Ie5cRqxWkyXcS1n
Content-Type: application/json

{ "error": "use_dpop_nonce" }
```

**An assertion without a `kid`.**
_Seen:_ a client that publishes one key and signs its assertion without a
`kid` header was refused with `invalid_client` at the token, revocation and
pushed-request endpoints.
_Cause:_ neither [§4.1](https://personalagentprotocol.org/docs/1.0/spec#agent-identity) nor RFC 7523 requires a `kid`
in a client assertion, and the fallback to the client's key had been
dropped. The first repair then matched an assertion without a `kid` to a
published key without one, so a client with several such keys had its
first picked.
_Fix:_ choose the key in one place. A `kid` names its key. Without one,
use the client's key only when it publishes exactly one, and refuse when it
publishes several: never pick the first of several.

**A consent page that can't be reloaded.**
_Seen:_ a User who opened the consent page a minute after the push and
reloaded it 40 seconds later got `invalid_request_uri`, though the page had
260 seconds left and the browser held its cookie.
_Cause:_ a pushed request is used once, and its 90 seconds also limited
reloading the page it had made.
_Fix:_ the 90 seconds limit only opening the request. Once it has made its
consent page, the browser with that page's cookie gets it again until it is
answered or its own 300 seconds end. A request still makes one page and one
code at most.

**Context emptied when it grows too large.**
_Seen:_ once a conversation's merged context passed 4,096 bytes, the Company
Agent's next turn saw none of it, not even the field just sent.
_Cause:_ over the limit, the whole context was replaced with `{}`. The
limit of 20 fields kept the first 20, so the newest were the ones dropped.
A second fault hid behind the first: an object lists keys such as `"2027"`
or `"0"` first, whenever they were set, so a field just sent under such a
key counted as the oldest.
_Fix:_ fill the bounds from the newest field back. This message's fields
come first, then each older one while it still fits, and the order of age
is kept apart from the object's own key order.

**Request IDs kept forever.**
_Trap:_ every accepted POST stores its request ID so a retry gets the first
answer. Messages stop at 40, but a handoff, a cancel and a close aren't
counted, so an agent sending new IDs made stored state grow without limit.
_Fix:_ a conversation keeps its 64 newest request IDs, on every route. That
is more than its 40 messages and the request that started it, so a
conversation that only talks never drops one.

**A lookup in a plain object.**
_Seen:_ Northwind's travel information answered `200` with no text for the
topic `constructor`, instead of `400 unknown_topic`.
_Cause:_ the topic was looked up in a plain object, and every object
inherits keys such as `constructor` and `__proto__`.
_Fix:_ accept only the object's own keys, and only a string.

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

## What the official validator found on the first run

The first run, before the fixes, had 97 passes, 2 failures and 8 warnings,
the same at every Company because they share one gateway:

1. **Unknown refresh tokens got the wrong error.** The validator tests client
   assertions by sending a good assertion with a refresh token that doesn't
   exist and expecting `invalid_grant`. Our token endpoint checked the DPoP
   proof first and answered `invalid_dpop_proof`, so none of its eight
   assertion checks could tell whether the assertion had been accepted. The
   fix looks the refresh token up before the proof; a real refresh token
   still needs the key it was bound to.
2. **Direct Conversations had the wrong errors.** We don't offer Direct
   Conversations yet and refused every `parent_conversation_id` with
   `invalid_request`. The spec gives a bad parent its own errors,
   `conversation_not_found` and `conversation_closed`
   ([§8.10](https://personalagentprotocol.org/docs/1.0/spec#direct-conversations)),
   and it doesn't make Direct Conversations optional. The parent is now
   checked first, and Direct Conversations are implemented since; see
   [Conversations](../learn/conversations.md#when-the-company-needs-to-hear-from-the-user).

Neither showed up in our own 470-odd tests or in the community validator,
because both test what we thought the rules were.

## Domain extensions (FDX and ESPI)

Source material from the single page "Domain extensions: bank data through
Poppy", before it became the Learn pages
[Domain extensions](../learn/extensions/README.md),
[FDX: bank data through Poppy](../learn/extensions/fdx.md),
[ESPI: energy data through Poppy](../learn/extensions/espi.md) and
[Write a domain extension](../learn/write-an-extension.md). The rules these
stories teach are now plain rules in the last of those pages. The stories stay
here, as the original page told them.

### Pitfalls we hit

- **One consent in 32 vanished.** Grant IDs are base64url, and about one in 32
  starts with `-` or `_`. Our ID check wanted a letter or digit first, so for
  those Users the consent was simply "unknown". It looked like a flaky test until
  we did the arithmetic. We fixed it in two places, the adapter and the token
  response, and then found a third copy in the revocation path. Now there is one
  ID rule, in the adapter, and everything uses it.
- **The generic adapter took the wrong API.** Iris used the first OpenAPI entry
  it found. With two listed, the FDX-shaped description could have ended up in
  front of the model as ordinary tools.
- **`Accept` headers merged.** Our transport's default
  `Accept: application/json` was combined with the caller's `application/pdf`, so
  the statement request asked for both. The defaults are now replaced, not
  merged.
- **Error bodies were thrown away.** The transport turned every non-2xx response
  into an error with a code and dropped the body, which is right for Poppy errors
  and wrong for `701`.
- **The account choice was bypassable.** At first the choice limited only the
  FDX-shaped routes, and the consent page said so in small print. The same
  sign-in also granted Harborline's own read scopes, and in a test with a real
  model the model preferred that API and told the User the balance of the
  savings account they hadn't shared. From the User's side the choice meant
  nothing. Now the bank applies it to the whole grant, both APIs and the Company
  Agent, and Iris, with Use FDX on, steers the model to the FDX-shaped tools for
  account data.
- **The specification can't be copied.** Check a domain standard's licence
  before you vendor its schemas. FDX's forbids it, so our shapes are written by
  hand from public implementers' documentation.

### Checking the two sides against each other

From the section "A second domain: energy usage". Checking the two sides
against each other found two mismatches the separate test suites hadn't.
Fernwick bills UTC months, and the agent printed them in Pacific dates, so
September seemed to start on 31 August. And the default 92-day window for bills
crosses the November clock change, which makes it an hour longer than 92 × 24
hours: the utility refused it.

### Fragments from the original page

Sentences of the original page that told the lab's own story, and that the
Learn pages now say as plain rules or facts.

- In "What each side has to get right", for the Company: "Put the extension's
  routes behind the Session middleware too. Ours guarded only `/api/*` at first,
  so `/fdx/v6/...` would have run with no Session check at all."
- In the same list: "Keep the domain consent and the Poppy grant one record:
  same ID, same end. Make the end real. Harborline's record once said `ONE_TIME`
  while the grant refreshed for 7 days; now a grant without `offline_access` ends
  with its first access token, and a refresh after it gets `invalid_grant`."
- In "Why an extension, and not just an OpenAPI": "Our generic adapter stops at
  24 tools and 64 paths and doesn't follow `$ref`, and an FDX-style description
  goes well past both."
- In "4. Reading": "Treating `ACCOUNT_BASIC` as descriptors without balances is
  how implementing banks describe it, not something we could check in FDX's own
  text."
- In the energy section, on XML: "We wrote a strict one for the subset Atom uses,
  which refuses document type declarations, any entity beyond the five
  predefined ones and processing instructions, and bounds size, depth and
  element count. Company XML is untrusted input, and an XML parser is where the
  old attacks live."
- On revoking: "ESPI speaks of updating or deleting the authorization without
  settling the method, so the method is ours."
- In "Writing your own domain extension", step 7: "Write down what it doesn't
  cover. For us that's money movement, tax documents and data-recipient
  registration, plus open questions about field names we couldn't verify."
- After the seven steps: "We have now tried the pattern twice, on bank data and
  on energy usage (below)."

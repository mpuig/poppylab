# Conversations with a Company Agent

Why does Poppy have conversations, and when does an agent use one instead of an
API? Companies already handle complaints, refunds and exceptions in a support
chat, often with an automated agent in front of their staff. Poppy's
conversations
([§8](https://personalagentprotocol.org/docs/1.0/spec#conversations)) let a
Personal Agent talk to that agent directly: structured data both ways, sign-in
when needed, approvals for anything that matters and a way to reach a person.

The examples come from one conversation at
[Lantern Noodle Bar](https://food-demo.poppylab.dev), trimmed from its gateway.
A customer's delivery is missing a dish and they want a refund. Lantern's API
has no refund endpoint, so Iris, the lab's Personal Agent, talks to Lantern's
Company Agent for them.

![A Personal Agent starts a conversation with the Company Agent, which answers with text for people and data for agents. The agent reports a missing dish, and the Company Agent asks it to sign in, in the middle of the conversation. The user signs in on the Company's own page, the agent sends the request again, and the Company Agent answers with a proposal inside a message. The user approves, the agent sends the approval as a message, and the Company Agent answers that the refund is done. If the agent asks for a person, one joins, or the Company Agent says how to call.](../../apps/playground/public/learn-media/diagrams/conversation-sequence.svg "A refund asked for in a conversation: the sign-in, the proposal and the approval all happen inside it.")

## When to use a conversation instead of an API

| Use the API when…                                                                      | Use the conversation when…                                                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| the task is one exact read or change, every parameter is known and an operation exists | the task needs judgement or a case, no API covers it, or the Company prefers to handle it in support |
| no person needs to be involved                                                         | the Company has to ask questions or ask for sign-in, or the user might need a person                 |

An agent can use both in one task: Iris reads the order with the API and
reports the missing dish in a conversation.

## A Company Agent doesn't have to be a model

Lantern's Company Agent is under 400 lines of deterministic code: structured
`data` in, data and a fixed sentence out. A model behind a public endpoint
would let anyone spend the Company's money, so a Company that puts one there
rate-limits and budgets it like any public endpoint.

## Text for people, data for agents

The endpoint comes from `poppy.json` (`agent.protocols[].endpoint`). Every
`POST` carries a request `id` that the
agent chooses, so a retry after a lost response is recognized and changes
nothing ([§8.3](https://personalagentprotocol.org/docs/1.0/spec#sending-messages)).
The Company answers each ID once: a retry to the same path with the same body
gets the original response, and another path or body with that ID is
`request_id_conflict`.

```http
POST https://food-demo.poppylab.dev/poppy/conversations?wait=0
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAi…

{ "id": "req_1", "message": { "author": { "type": "agent" }, "data": { "request": "help" } } }
```

The reply, trimmed:

```http
HTTP/1.1 201 Created

{
  "conversation_id": "cnv_M7yGoZoGX1nd5tmf_2pQ",
  "events": [
    {
      "type": "message",
      "message": {
        "role": "company",
        "author": { "type": "agent", "name": "Lantern's automated agent" }, // (1)
        "as_of_request": "req_1",
        "text": "Lantern's automated agent answers structured requests: send one in data.request. To reach a person, ask for a handoff.", // (2)
        "data": {
          "requests": [
            { "request": "opening_hours", "scopes": [] },
            {
              "request": "report_missing_item",
              "fields": { "order_id": "…", "dish_id": "…", "quantity": "Optional" },
              "scopes": ["orders:read", "orders:write"]
            }
          ]
        }
      }
    }
  ],
  "cursor": "evt_2_M9tBynN_", // (3)
  "working": false, "handoff": "none", "responder": "agent", "closed": false // (4)
}
```

1. **`author.type` says who wrote it.** `agent` for anything the Personal Agent
   wrote, `human` only for the user's own words, never a paraphrase
   ([§8.8](https://personalagentprotocol.org/docs/1.0/spec#human-or-ai)). The
   Company does the same.
2. **Messages carry `text` and `data`.** Lantern's agent lists the requests it
   understands as `data`, with the fields and scopes each needs, so the
   Personal Agent doesn't parse prose.
3. **The cursor** is where the next read starts
   ([§8.5](https://personalagentprotocol.org/docs/1.0/spec#reading-events)).
4. **Four state fields on every read**
   ([§8.7](https://personalagentprotocol.org/docs/1.0/spec#state)): `working`
   (still replying, read again), `handoff` (`none` or `pending`), `responder`
   (`agent` or `human`) and `closed`.

## Signing in without leaving the conversation

A conversation can need more access than the agent has. Signed in with
`orders:read` only, the agent sends `report_missing_item`, and Lantern replies
with an `authorization` event
([§8.11](https://personalagentprotocol.org/docs/1.0/spec#conversation-sign-in)):

```json
{ "type": "message", "message": { "role": "company", "as_of_request": "req_2",
  "text": "That needs your Lantern account. Sign in, then send the request again.",
  "data": { "error": "sign_in_required", "scopes": ["orders:read", "orders:write"] } } },
{ "type": "authorization", "error": "insufficient_scope", "scope": "orders:read orders:write" }
```

Lantern keeps the conversation open while it waits for more access.

## A proposal inside a message

With `orders:write`, the same request gets an answer that carries an operation
in the message's `extensions`
([Operations, conversations](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval-required-conversations)):

```json
{
  "role": "company",
  "as_of_request": "req_3",
  "text": "I can refund USD 8.00 for the missing Pork gyoza (6). I'll do it once you approve.",
  "extensions": {
    "operations": {
      "operation": {
        "operation_id": "op_xs9hiC1D6rgUPCI-CV-jEARy",
        "revision": "1795602001-9J3BYg4QmZBKbSiM",
        "summary": "Refund 1 × Pork gyoza (6) (USD 8.00) missing from order ord_LNB0907, …",
        "terms": {
          "order_id": "ord_LNB0907",
          "dish_id": "pork-gyoza",
          "quantity": 1,
          "refund_cents": 800,
          "currency": "USD"
        },
        "expires_at": "2026-11-25T10:30:01.660Z"
      }
    }
  }
}
```

The text says what Lantern's agent will do; the terms are what the user
approves. Lantern sends operations only to requests that declare the extension in
`Poppy-Extensions`; without it, its agent says to call instead.
[Approvals](operations.md) explains each field.

## The approval as a message

The user approves with a button in Iris, not by typing, and Iris sends the
approval in a message:

```json
{
  "id": "req_4",
  "message": {
    "author": { "type": "agent" },
    "text": "The user approved the refund.",
    "extensions": {
      "operations": {
        "approval": {
          "operation_id": "op_xs9hiC1D6rgUPCI-CV-jEARy",
          "revision": "1795602001-9J3BYg4QmZBKbSiM",
          "approver": "user",
          "approved_at": 1795600000,
          "input_type": "tap"
        }
      }
    }
  }
}
```

Lantern answers with the refund (simulated: no real money moves). Its `data`
holds the `operation_id` and `refund.amount_cents`, 800.

The text "The user approved the refund." changes nothing on its own; the
`approval` object does. Iris derives the request `id` from the revision, so if
the response is lost and it resends, the Company sees the same request and
refunds once.

## Reaching a person

The agent asks for a person with a handoff request, and the state goes
`pending` while the Company looks for someone
([§8.9](https://personalagentprotocol.org/docs/1.0/spec#handoff)):

```http
POST https://food-demo.poppylab.dev/poppy/conversations/cnv_OVkOhfxK5Gc1TcFHlQNj/handoff
{ "id": "req_5" }
```

Lantern's fictional staff are never available, so its agent gives a number:

```json
{ "type": "state", "handoff": "pending", "responder": "agent", "closed": false },
{ "type": "message", "message": { "role": "company", "as_of_request": "req_5",
  "text": "Nobody at Lantern can join this conversation right now. Call +1 555-0142 (Wednesday to Sunday, during kitchen hours).",
  "data": { "handoff": "unavailable", "phone": "+1 555-0142" } } },
{ "type": "state", "handoff": "none", "responder": "agent", "closed": false }
```

At a real Company, a person would join and `responder` would become `human`.

## When the Company needs to hear from the user

A **Direct Conversation**
([§8.10](https://personalagentprotocol.org/docs/1.0/spec#direct-conversations))
is a new thread linked to this one, where the user speaks for themselves and
the Company keeps the earlier history.

![The Company Agent asks to talk with the user directly, and the Personal Agent shows the user the Company's reason. Only the user can say yes, so the process waits; when the user accepts, the agent opens a new thread linked to the first, with no message, and the Company speaks first. While it is open the agent steps aside and cannot talk over the user: the user's words go to the Company as written, and the Company's answers come back to the user, including a change it proposes as terms. That change still waits for the user's approval. When the user leaves, the agent closes the thread.](../../apps/playground/public/learn-media/diagrams/direct-conversation.svg "When the Company asks to hear from the user, the user speaks for themselves and the change still waits for their approval.")

Before refunding a whole order, Lantern's agent answers the report with a
`user_requested` event in the parent, which doesn't change the state:

```json
{
  "id": "evt_3_N8aUhFy3",
  "type": "user_requested",
  "reason": "Lantern wants to confirm with you that order ord_LNB0907 never arrived before refunding all of it."
}
```

Only the Personal Agent can open a Direct Conversation, so the user decides.
Accepting opens it with no message, so the Company speaks first:

```json
{
  "id": "dir_1",
  "parent_conversation_id": "cnv_…",
  "user_requested_event_id": "evt_3_N8aUhFy3"
}
```

Lantern's first message asks whether the order arrived, with
`{ "question": "order_not_delivered", "answers": ["yes", "no"] }` as its
`data`. The parent gets a `direct_opened` event, and while the Direct
Conversation is open the parent takes no messages, so the agent can't talk over
the user:

```http
HTTP/1.1 409 Conflict

{ "error": "direct_conversation_open", "conversation_id": "cnv_uQ886kXJdesO8niYeZjZ" }
```

In the Direct Conversation, what the user types goes as written, with
`author.type` `human`. In Iris the model isn't involved at all. Lantern's agent
reads only "yes" or "no" there, and only to a question it asked; a message from
the agent saying "yes" doesn't count.

When the user leaves, Iris closes the thread, and the parent gets
`direct_closed` and takes messages again. If the user declines, Iris says so in
the parent, as the spec asks. A Company whose agent doesn't handle
Direct Conversations still serves the user: the gateway answers with its
handoff reply, the phone number.

## Who owns a conversation, and what bounds it

A Company binds a conversation to its owner: the agent, the user and, once a
request carries an access token, that account. Anyone else gets
`conversation_not_found`. A Company also bounds what a caller can make it hold:
conversations per user, messages and bytes per conversation, and `data` per
message.

## What the agent does with what it reads

- **Company messages are Company content.** The agent shows them as the
  Company's, marks them for the model as data and never follows them as
  instructions, because a message can contain anything.
- **A reply is complete when `working` is `false`.** A `handoff` the agent
  doesn't recognize counts as `pending`, and a `responder` it doesn't recognize
  counts as `human`.
- **Events become controls.** An `authorization` event becomes a sign-in
  button and an operation becomes an approval card. Neither is a tool the model
  can call.
- **The endpoint is checked before the Session header goes out.** It must be on
  the Company's own domain, including its port.

## Go deeper

- Screen by screen:
  [Getting help from the company](how-it-works/getting-help-from-the-company.md)
  and
  [Talking to the company yourself](how-it-works/talking-to-the-company-yourself.md).
- Approving an operation, in a message or anywhere else: [Approvals](operations.md).
- Apply it: [Build a Company](build-a-company.md) and
  [Build a Personal Agent](build-an-agent.md).
- In the lab: the gateway's
  [`conversations.ts`](../../packages/pap-company/src/gateway/conversations.ts),
  Lantern's [`agent.ts`](../../apps/lantern/src/agent.ts), Iris's
  [`conversations.ts`](../../apps/playground/lib/conversations.ts) and the
  [design notes](../conversations.md).

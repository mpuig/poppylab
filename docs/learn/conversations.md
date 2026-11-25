# Conversations with a Company Agent

Most Companies already have a support chat, often with an automated agent in
front of their staff. Poppy's conversations
([§8](https://personalagentprotocol.org/docs/1.0/spec#conversations)) let a
Personal Agent talk to that agent directly: agent to agent, with structured
data both ways, sign-in when it's needed, approvals for anything that matters
and a way to reach a person.

This page follows one conversation at
[Lantern Noodle Bar](https://food-demo.poppylab.dev): a customer's delivery was
missing a dish and they want a refund. Lantern's API has no refund endpoint;
its Company Agent handles it. The exchanges are real, from the same gateway
run in-process by our tests, trimmed.

## When to use a conversation instead of an API

| Use the API when…                    | Use the conversation when…                                              |
| ------------------------------------ | ----------------------------------------------------------------------- |
| the task is one exact read or change | the task needs judgement or a case: a complaint, a refund, an exception |
| an operation exists for it           | no API covers it, or the Company prefers to handle it in support        |
| you know every parameter             | the Company has to ask questions, or ask the user to sign in            |
| no person needs to be involved       | the user might need a person                                            |

An agent can use both in one task. Iris reads the order with the API and
reports the missing dish in a conversation.

## 1. Start a conversation

The endpoint comes from `poppy.json`
(`agent.protocols[].endpoint`). The first message starts the conversation.
Every `POST` carries a request `id` chosen by the agent, so a retry after a
lost response is recognized and changes nothing
([§8.3](https://personalagentprotocol.org/docs/1.0/spec#sending-messages)):

```http
POST https://food-demo.poppylab.dev/poppy/conversations?wait=0
Poppy-Version: 1.0
Poppy-Session: eyJ0eXAi…

{ "id": "req_1", "message": { "author": { "type": "agent" }, "data": { "request": "help" } } }
```

```json
HTTP/1.1 201 Created

{
  "conversation_id": "cnv_M7yGoZoGX1nd5tmf_2pQ",
  "events": [
    { "type": "message", "message": { "id": "req_1", "role": "user", "data": { "request": "help" } } },
    {
      "type": "message",
      "message": {
        "role": "company",
        "author": { "type": "agent", "name": "Lantern's automated agent" },
        "as_of_request": "req_1",
        "text": "Lantern's automated agent answers structured requests: send one in data.request. To reach a person, ask for a handoff.",
        "data": {
          "requests": [
            { "request": "opening_hours", "scopes": [] },
            { "request": "order_status", "scopes": ["orders:read"] },
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
  "cursor": "evt_2_M9tBynN_",
  "working": false, "handoff": "none", "responder": "agent", "closed": false
}
```

Things to notice:

- **Messages carry `text` and `data`.** Text is for people; `data` is for
  agents. Lantern's agent lists the requests it understands as data, with the
  fields and scopes each needs, so the Personal Agent doesn't have to parse
  prose.
- **`author.type` says who wrote it.** `agent` for anything the Personal Agent
  wrote, `human` only for the user's own words, never a paraphrase
  ([§8.8](https://personalagentprotocol.org/docs/1.0/spec#human-or-ai)). The
  Company does the same.
- **Four state fields on every read**
  ([§8.7](https://personalagentprotocol.org/docs/1.0/spec#state)): `working`
  (still replying, read again), `handoff` (`none` or `pending`), `responder`
  (`agent` or `human`) and `closed`.
- **The cursor** is where the next read starts
  ([§8.5](https://personalagentprotocol.org/docs/1.0/spec#reading-events)).

## 2. Asked to sign in, mid-conversation

The agent reports the missing dish while signed in with `orders:read` only:

```json
{
  "id": "req_2",
  "message": {
    "author": { "type": "agent" },
    "data": {
      "request": "report_missing_item",
      "order_id": "ord_LNB0907",
      "dish_id": "pork-gyoza"
    }
  }
}
```

Lantern accepts the message, replies, and adds an `authorization` event
([§8.11](https://personalagentprotocol.org/docs/1.0/spec#sign-in-during-a-conversation)):

```json
{ "type": "message", "message": { "role": "company", "as_of_request": "req_2",
  "text": "That needs your Lantern account. Sign in, then send the request again.",
  "data": { "error": "sign_in_required", "scopes": ["orders:read", "orders:write"] } } },
{ "type": "authorization", "error": "insufficient_scope", "scope": "orders:read orders:write" }
```

The conversation isn't refused; it's waiting for more access. Iris turns the
event into its usual "Request change permission" control, so the user grants
`orders:write` on Lantern's consent page, and then sends the request again.

## 3. A proposal inside a message

Now with `orders:write`, the same request gets an answer with an operation in
the message's `extensions`
([Operations, conversations](https://personalagentprotocol.org/docs/1.0/extensions)):

```json
{
  "type": "message",
  "message": {
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
}
```

It's the same operation an API would return, carried in a message. The text
says what the agent will do; the terms are what the user approves. Lantern
sends operations only to requests that declare the extension in
`Poppy-Extensions`; without it, its agent says to call instead.

## 4. The approval as a message

The user approves in Iris, with a button, not in the chat. Iris sends the
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

```json
{
  "type": "message",
  "message": {
    "role": "company",
    "as_of_request": "req_4",
    "text": "Refunded USD 8.00 for 1 × Pork gyoza (6) on order ord_LNB0907. Simulated: no real money moves.",
    "data": {
      "operation_id": "op_xs9hiC1D6rgUPCI-CV-jEARy",
      "refund": { "amount_cents": 800 }
    }
  }
}
```

The text "The user approved the refund." changes nothing on its own; the
`approval` object does. Iris derives this message's request `id` from the
revision, so if the response is lost and it resends, the Company sees the same
request and refunds once.

## 5. Asking for a person

```http
POST https://food-demo.poppylab.dev/poppy/conversations/cnv_OVkOhfxK5Gc1TcFHlQNj/handoff
{ "id": "req_5" }
```

The state goes `pending` while the Company looks for someone, then back
([§8.9](https://personalagentprotocol.org/docs/1.0/spec#handoff-to-a-person)).
Lantern's fictional staff are never available, so its agent says how to call:

```json
{ "type": "state", "handoff": "pending", "responder": "agent", "closed": false },
{ "type": "message", "message": { "role": "company", "as_of_request": "req_5",
  "text": "Nobody at Lantern can join this conversation right now. Call +1 555-0142 (Wednesday to Sunday, during kitchen hours).",
  "data": { "handoff": "unavailable", "phone": "+1 555-0142" } } },
{ "type": "state", "handoff": "none", "responder": "agent", "closed": false }
```

At a real Company, a person would join and `responder` would become `human`.

## 6. The Company asks for the user: a Direct Conversation

Sometimes the Company needs the user's own word, not their agent's. A
**Direct Conversation**
([§8.10](https://personalagentprotocol.org/docs/1.0/spec#direct-conversations))
is a new thread linked to this one, where the user speaks for themselves and
the Company keeps the earlier history.

Before refunding a whole order, Lantern wants to hear it from the customer.
Its agent answers the report with a `user_requested` event in the parent; it
doesn't change the state:

```json
{
  "id": "evt_3_N8aUhFy3",
  "type": "user_requested",
  "reason": "Lantern wants to confirm with you that order ord_LNB0907 never arrived before refunding all of it."
}
```

Only the Personal Agent can open the Direct Conversation, so the user decides.
Iris shows the reason with **Talk to Lantern Noodle Bar** and **Not now**.
Accepting opens it with no message, so the Company speaks first:

```json
{
  "id": "dir_1",
  "parent_conversation_id": "cnv_…",
  "user_requested_event_id": "evt_3_N8aUhFy3"
}
```

```json
HTTP/1.1 201 Created

{ "conversation_id": "cnv_uQ886kXJdesO8niYeZjZ",
  "events": [{ "type": "message", "message": { "role": "company", "as_of_request": "dir_1",
    "text": "Hi, this is Lantern. Did none of order ord_LNB0907 arrive? Reply yes or no.",
    "data": { "question": "order_not_delivered", "answers": ["yes", "no"] } } }] }
```

The parent gets a `direct_opened` event, and while the Direct Conversation is
open it takes no messages, so the agent can't talk over the user:

```json
HTTP/1.1 409 Conflict

{ "error": "direct_conversation_open", "conversation_id": "cnv_uQ886kXJdesO8niYeZjZ" }
```

In the Direct Conversation, what the user types goes as written, with
`author.type` `human`. In Iris the model isn't involved at all:

```json
{
  "id": "req_3",
  "message": { "author": { "type": "human" }, "text": "Yes, nothing came." }
}
```

Lantern answers with the refund as an operation, and the user approves it with
the usual card. Lantern's agent reads only "yes" or "no" there, and only to a
question it asked; a message from the agent saying "yes" doesn't count. When
the user leaves, Iris closes the thread, the parent gets `direct_closed` and
takes messages again. If the user had chosen **Not now**, Iris would have said
so in the parent, as the spec asks.

A Company whose agent doesn't handle Direct Conversations still gets them
right: the gateway answers the user with its handoff reply, the phone number.

## Building the Company side

- **Your Company Agent doesn't have to be a model.** Lantern's is under 400
  lines of deterministic code: structured `data` in, data and a fixed
  sentence out. A public endpoint backed by a model would let anyone spend
  your money, signed out. If yours uses a model, rate-limit and budget it like
  any public endpoint.
- **Answer every request ID once.** A retry to the same path with the same body
  gets the original response; another path or body with that ID is
  `request_id_conflict`.
- **Bind conversations to their owner.** The agent, the user and, once a
  request carries a token, that account. Anyone else gets
  `conversation_not_found`.
- **Bound everything.** Conversations per user, messages and bytes per
  conversation, `data` per message.

## Building the agent side

- **Company messages are Company content.** Show them as the Company's, mark
  them for the model as data, and never follow them as instructions. A
  message can contain anything.
- **Read until `working` is `false`** before treating a reply as complete, and
  treat a `handoff` you don't recognize as `pending` and a `responder` you
  don't recognize as `human`.
- **Turn events into controls.** An `authorization` event becomes a sign-in
  button; an operation becomes an approval card. Neither is a tool the model
  can call.
- **Check the endpoint** is on the Company's own domain, including its port,
  before sending a Session header to it.

Our implementations: the gateway's
[`conversations.ts`](../../packages/pap-company/src/gateway/conversations.ts),
Lantern's agent [`agent.ts`](../../apps/lantern/src/agent.ts) and Iris's
[`conversations.ts`](../../apps/playground/lib/conversations.ts). The design
notes are in [conversations](../conversations.md).

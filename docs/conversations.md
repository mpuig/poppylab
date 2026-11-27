# Conversations with the Company's own agent (Poppy 1.0 §8)

All five Companies offer a conversation endpoint next to their APIs, and Iris can talk to it. The design rule: **the only model is the Personal Agent's.** Each Company Agent is deterministic code. It takes structured requests in `data` and answers with data and a short fixed sentence. It never reads free text and never needs a model key, so a public Company can't be made to spend money, and its answers are predictable and testable.

## What a conversation adds over the API

A conversation carries state across turns (the case being discussed), asks for sign-in in the middle of it (§8.11), carries an Operations v3 proposal inside a message, and offers a handoff to a person (§8.9). Lantern uses it for something its API doesn't offer: a refund for a missing item.

## The Company side

The gateway (`packages/pap-company/src/gateway/conversations.ts`) implements the routes of §8.2 for any Company that defines an `agent` and registers a handler with `ctx.converse(...)`:

Every `POST` has a JSON body with a request `id` chosen by the Personal Agent; a message's ID is its request's ID.

| Request                      | Behaviour                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `POST /poppy/conversations`  | Starts a conversation with its first message; 201                                                                    |
| `POST …/{id}/messages`       | Another message; 202                                                                                                 |
| `GET …/{id}/events`          | Events after `cursor`, 50 per page with `has_more`, and the state; a stream of them with `Accept: text/event-stream` |
| `POST …/{id}/handoff`        | `handoff` goes `pending`, then back to `none`, with a reply saying nobody is available and the number to call        |
| `POST …/{id}/handoff/cancel` | Nothing is ever pending here, so it changes nothing; 202                                                             |
| `POST …/{id}/close`          | 202; `closed` becomes `true`; closing again changes nothing                                                          |

- **Responses (§8.3).** A successful `POST` means the request was accepted: without `wait` the body is only `{"conversation_id": …}`; with `wait` it's a read of the events from the cursor, with the state.
- **State (§8.7).** Four fields on every read: `working`, `handoff` (`none` or `pending`), `responder` and `closed`. Each change to the last three adds a `state` event carrying all three. Replies are computed when a request is accepted, so `working` is always `false` and `wait` is capped at zero (§8.5 allows that).
- **Ownership (§8.2).** The client, the User ID and, once a request carries an access token, that account. Another User or account gets `conversation_not_found`. A signed-out request on a conversation that used the account gets a sign-in challenge.
- **Request IDs (§8.3).** Unique per User. A retry to the same path with the same body gets the original response and adds nothing; another path or body gets `request_id_conflict`.
- **Messages (§8.4).** An unknown `author.type` counts as `agent`; `author` id, name and image from the Personal Agent are ignored; a `context` field set to `null` clears it. Company messages carry `as_of_request`, the request they answer.
- **Authorization events (§8.11).** An account request without the scopes is still accepted. The reply is followed by `{"type":"authorization","error":"insufficient_scope","scope":"…"}`. Signed out, the reply asks the customer to sign in (`data.error` `sign_in_required`); signed in without a scope, it names the missing permission in plain words, such as "propose changes to your orders", and says to allow it from the agent (`data.error` `insufficient_scope`). Both list every scope the request needs in `data.scopes`.
- **Operations v3 in messages.** A proposal arrives in `extensions.operations.operation`, with its terms. Only a later message carrying `extensions.operations.approval` (with `approver`) performs it, at most once. A repeated approval adds no reply. Text never approves anything. Operations are keyed to the conversation and sent only to requests that declare the extension in `Poppy-Extensions`.
- **Bounds.** 8 conversations per User (closed, then least recently used, go first), 40 messages and 64 KiB of events per conversation, 8 KiB of `data` per message.
- **Direct Conversations (§8.10).** Opened with `parent_conversation_id`, by the Personal Agent or accepting a `user_requested` event (then without a message, and the Company speaks first). The parent must be the caller's, open and not a Direct Conversation; one open per parent, meanwhile the parent's messages, handoffs and cancels get `direct_conversation_open`; `direct_opened` and `direct_closed` in the parent; closing the parent closes it; accepting the same invitation again returns the same conversation. A Company Agent that sets `agent.direct` answers the User there; the others answer with the handoff reply.
- **Streaming (§8.6).** A read with `Accept: text/event-stream` gets the same events as server-sent events, then each new event as another request adds it. See [Streaming events](#streaming-events).

The phone numbers are fictional: 555-0100 to 555-0199 are reserved for fiction in North America.

## Streaming events

A read of `GET …/{id}/events` whose `Accept` lists `text/event-stream` (with a `q` above 0) gets a stream. Without it, or with only JSON types, the read is JSON as before. A Personal Agent sees this on the wire:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-store

event: working
data: {"working":false}

id: evt_1_q2Lx9TfA
data: {"id":"evt_1_q2Lx9TfA","type":"message","created_at":"2026-11-27T15:40:00.000Z","message":{"id":"req_1","role":"user","author":{"type":"agent"},"data":{"request":"help"}}}

id: evt_2_q2Lx9TfA
data: {"id":"evt_2_q2Lx9TfA","type":"message","created_at":"2026-11-27T15:40:00.000Z","message":{"id":"msg_…","role":"company","author":{"type":"agent","id":"aut_company_agent","name":"…"},"as_of_request":"req_1","text":"…"}}

: keep-alive
```

- **What comes.** `working` first, as an event with no SSE `id`, then every event after the cursor, each with its event ID as the SSE `id` and the same JSON a read returns as `data`. After that, each event another request adds (a reply, a `state` event for a handoff or a close, `authorization`, `user_requested`, `direct_opened`, `direct_closed`) arrives as it is added, with no page limit. `working` is always `false` here, so it comes once. A comment after 15 quiet seconds keeps proxies from closing the connection.
- **No `text-delta`.** §8.6 lets a Company send pieces of a message while the Company Agent writes it. These Company Agents are deterministic: a reply is complete when the request is accepted, before any read can see it, so pieces would only repeat the message in parts, and a Personal Agent replaces them with the message anyway.
- **Where it starts.** After `Last-Event-ID` when the request has one, which wins over `cursor`, because an SSE client adds it to the URL the stream was first opened with; an empty `Last-Event-ID` names no event, so `cursor` counts. Without either, at the start. A bad cursor gets `invalid_cursor` or `cursor_expired` as JSON, and no stream opens.
- **When it ends.** After a minute at most, sooner when the access token runs out first. Within a few seconds of the Session ending, the token or its grant ending or being revoked, or the conversation going (evicted with its visitor's copy). At once when a signed-out stream's conversation starts using an account (§8.2: signed out, it would now get a challenge), and when the conversation closes, after its last events. If the conversation dropped events the stream hadn't sent yet (it keeps the newest 64 KiB), the stream ends instead of skipping them, and reconnecting from the last one sent gets `cursor_expired`. The Personal Agent reconnects with `Last-Event-ID`.
- **The same checks as a JSON read.** The Session header, the access token and ownership are checked before the stream opens, and refused with the same errors. Each agent user (client and User ID) holds four open streams at most, and all clients 100, with each client a fifth of them as for Sessions (or its share from `clientShares`). One more gets 429 `rate_limited` with `Retry-After`: the seconds until the soonest of those streams ends.
- **Single writer.** A stream only reads. It is woken when another request adds an event to its conversation, and checks every five seconds for what changes without one, such as a token's end. It holds no lock and writes nothing while it is open, so the Durable Object's other requests go on as before.

`pap-client` reads a stream with `streamConversationEvents(url, request, onItem, options)`: it sends `Accept: text/event-stream` and `Last-Event-ID` when given, hands each event, `working` and `text-delta` to `onItem` in order, skips event names it doesn't know and data that isn't what its name says, and returns how the stream ended and the last event handled, for the next `Last-Event-ID`. A Company that answers JSON gets its read back as JSON. Iris still reads JSON with `wait`.

## The five Company Agents

Each answers `{"request":"help"}` (and any message it doesn't understand) with the list of requests it handles, their fields and the scopes they need.

**Lantern** (`apps/lantern/src/agent.ts`):

| Request               | Needs                         | Answer                                                                                 |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `opening_hours`       | —                             | Kitchen hours and the phone number                                                     |
| `delivery_info`       | —                             | Slots and the delivery fee                                                             |
| `order_status`        | `orders:read`                 | Scheduled orders and the last delivery, with any refunds                               |
| `report_missing_item` | `orders:read`, `orders:write` | A refund proposal for the missing dish, performed after approval; shown on the website |

**Harborline** (`apps/harborline/src/agent.ts`):

| Request            | Needs                               | Answer                                                                   |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `cash_position`    | `accounts:read`                     | Owned accounts and total fictional available balance                     |
| `spending_summary` | `transactions:read`, `budgets:read` | Recent debit totals by category and current budgets                      |
| `card_status`      | `cards:read`                        | Fictional cards and their active, frozen or inactive status              |
| `freeze_card`      | `cards:read`, `cards:write`         | A card-freeze proposal, performed once after exact conversation approval |

**Juniper** (`apps/juniper/src/agent.ts`):

| Request           | Needs                       | Answer                                                                  |
| ----------------- | --------------------------- | ----------------------------------------------------------------------- |
| `store_info`      | —                           | Hours, returns policy, delivery, FAQs and the phone number              |
| `delivery_status` | `poppy:read`                | The recurring delivery and recent orders                                |
| `report_problem`  | `poppy:read`, `poppy:write` | A support-case proposal, opened after approval and shown on the website |

**Northwind** (`apps/northwind/src/agent.ts`):

| Request              | Needs           | Answer                                                 |
| -------------------- | --------------- | ------------------------------------------------------ |
| `flight_status`      | —               | Fictional status and gate for a flight number and date |
| `travel_information` | —               | Baggage, check-in or fare-condition information        |
| `trip_summary`       | `bookings:read` | The signed-in customer's upcoming fictional booking    |
| `loyalty_summary`    | `profile:read`  | Loyalty balance, tier and points due to expire         |

**Fernwick** (`apps/fernwick/src/agent.ts`):

| Request            | Needs                        | Answer                                                                        |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------- |
| `usage_this_month` | `account:read`               | Energy delivered (and sent to the grid) and cost this month per shared meter  |
| `last_bill`        | `account:read`               | The last closed monthly bill of each shared meter                             |
| `change_plan`      | `account:read`, `plan:write` | A rate-plan switch proposal for a shared meter, performed once after approval |

## Iris's side

`packages/pap-agent/src/conversations.ts` keeps one conversation per connection (a run's connection to one Company), with its cursor and the event IDs it has handled. The model gets four tools: `company_agent_send` (`data` and/or `text`), `company_agent_read`, `company_agent_handoff` and `company_agent_cancel_handoff`.

- Every request gets a fresh request ID; Iris's messages carry `as_of_cursor`, the last cursor it read.
- Company replies are untrusted content: bounded, without control characters, and marked as such for the model. A message with an unknown `role` is Company content too. In the chat they show as separate entries labelled "Company content", with `data` collapsed.
- The state is read from the four fields. An unknown `handoff` counts as `pending` and an unknown `responder` as a person. While `working` is `true` or a person is being sought, the model is told to read again.
- An `authorization` event becomes the usual Sign in instruction, or, when the User is signed in, `permission_needed` with Request change permission: §8.11 sends the same event either way, and a signed-in User is never told to sign in, whatever the Company's own reply says. The chat notes "Asked for sign-in" or "Asked for a permission your sign-in doesn't include".
- An operation becomes the usual approval card, but only at allowlisted account Companies that list Operations v3. Approving sends a message with the User's approval (Operations v3 §6). Its request ID is derived from the revision, so a retry after a lost response is the same request. A decline in `extensions.operations.declined` is shown on the card and never resent.
- A lost response is resent once with the same request ID. A refusal is never resent. `conversation_not_found`, `conversation_closed` or `version_mismatch` starts a new conversation on the next message.
- The endpoint must be on the Company's own domain (`organization.domain`, with its port, or a subdomain).
- Signing out forgets the conversation in Iris. The Company keeps it open (§5.5).

The keyless Protocol demo can ask for "customer service" (it sends `help`) and "talk to a person" (a handoff).

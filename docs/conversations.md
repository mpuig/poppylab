# Conversations with the Company's own agent (PAP 0.3 §8)

Both Companies offer a conversation endpoint next to their APIs, and Iris can talk to it. The design rule: **the only model is the Personal Agent's.** Each Company Agent is deterministic code. It takes structured requests in `data` and answers with data and a short fixed sentence. It never reads free text and never needs a model key, so a public Company can't be made to spend money, and its answers are predictable and testable.

## What a conversation adds over the API

A conversation carries state across turns (the case being discussed), asks for sign-in in the middle of it (§8.11), carries an Operations v2 proposal inside a message, and offers a handoff to a person (§8.9). Lantern uses it for something its API doesn't offer: a refund for a missing item.

## The Company side

The gateway (`packages/pap-company/src/gateway/conversations.ts`) implements the routes of §8.2 for any Company that defines an `agent` and registers a handler with `ctx.converse(...)`:

| Request                     | Behaviour                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /poppy/conversations` | Starts a conversation with its first message; 201                                              |
| `POST …/{id}/messages`      | Another message; 202                                                                           |
| `GET …/{id}/events`         | Events after `cursor`, 50 per page with `has_more`                                             |
| `POST …/{id}/handoff`       | `queued`, then back to `idle` with a reply saying nobody is available and which number to call |
| `POST …/{id}/close`         | `closed`; closing again changes nothing                                                        |

- **Replies when the message is accepted.** A conversation is never `working`, so `wait` is accepted and capped at zero (§8.5 allows that). `?wait` on a `POST` returns the events from the cursor.
- **Ownership (§8.2).** The client, the User ID and, once a request carries an access token, that account. Another User or account gets `conversation_not_found`. A signed-out request on a conversation that used the account gets a sign-in challenge.
- **Message IDs (§8.3).** Unique per User. A retry with the same content gets the original response and adds nothing; other content gets `message_id_conflict`.
- **Authorization events (§8.11).** An account request without the scopes is still accepted. The reply is followed by `{"type":"authorization","error":"insufficient_scope","scope":"…"}`.
- **Operations v2 in messages.** A proposal arrives in `extensions.operations.operation`. Only a later message carrying `extensions.operations.approval` performs it, at most once. A repeated approval adds no reply. Text never approves anything. Operations are keyed to the conversation and are never sent to an agent whose metadata doesn't list the extension.
- **Bounds.** 8 conversations per User (the least recently used go first), 40 messages and 64 KiB of events per conversation, 8 KiB of `data` per message.
- **Not offered yet:** Direct Conversations (§8.10; a `parent_conversation_id` gets `invalid_request`) and streaming (§8.6; a stream request gets JSON, which the spec allows).

The phone numbers are fictional: 555-0100 to 555-0199 are reserved for fiction in North America.

## The two Company Agents

Each answers `{"request":"help"}` (and any message it doesn't understand) with the list of requests it handles, their fields and the scopes they need.

**Lantern** (`apps/lantern/src/agent.ts`):

| Request               | Needs                         | Answer                                                                                 |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `opening_hours`       | —                             | Kitchen hours and the phone number                                                     |
| `delivery_info`       | —                             | Slots and the delivery fee                                                             |
| `order_status`        | `orders:read`                 | Scheduled orders and the last delivery, with any refunds                               |
| `report_missing_item` | `orders:read`, `orders:write` | A refund proposal for the missing dish, performed after approval; shown on the website |

**Juniper** (`apps/example-company/src/agent.ts`):

| Request           | Needs                       | Answer                                                                  |
| ----------------- | --------------------------- | ----------------------------------------------------------------------- |
| `store_info`      | —                           | Hours, returns policy, delivery, FAQs and the phone number              |
| `delivery_status` | `poppy:read`                | The recurring delivery and recent orders                                |
| `report_problem`  | `poppy:read`, `poppy:write` | A support-case proposal, opened after approval and shown on the website |

## Iris's side

`apps/playground/lib/conversations.ts` keeps one conversation per run, with its cursor and the event IDs it has handled. The model gets three tools: `company_agent_send` (`data` and/or `text`), `company_agent_read` and `company_agent_handoff`.

- Company replies are untrusted content: bounded, without control characters, and marked as such for the model. In the chat they show as separate entries labelled "Company content", with `data` collapsed.
- An `authorization` event becomes the usual Sign in or Request change permission instruction.
- An operation becomes the usual approval card, but only at allowlisted account Companies that speak Operations v2. Approving sends a message with the approval. Its ID is derived from the revision, so a retry after a lost response is the same message.
- A lost response is resent once with the same message ID. A refusal is never resent. `conversation_not_found` or `conversation_closed` starts a new conversation on the next message.
- The endpoint must be on the Company's own domain (`organization.domain` or a subdomain).
- Signing out forgets the conversation in Iris. The Company keeps it open (§5.5).

The keyless Protocol demo can ask for "customer service" (it sends `help`) and "talk to a person" (a handoff).

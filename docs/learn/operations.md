# Approvals with Operations

The [Operations extension](https://personalagentprotocol.org/docs/1.0/extensions/operations)
(version 3) answers one question: how does a Company know the user agreed to
_this exact change_, when the request comes from an agent? Instead of
performing the change, the Company answers with its exact terms and waits for
an approval of them.

## The life of an operation

![A Personal Agent asks a Company for a change. The Company answers approval_required with an operation holding its terms and a revision. The user approves, or the agent approves on the user's instruction, and the agent resends the same request with the approval. The Company checks it and performs the change once, or declines. If the terms change, the Company returns a new revision and the old approval no longer applies.](../../apps/playground/public/learn-media/diagrams/operation-lifecycle.svg "A request, an answer that holds the terms, an approval of exactly those terms, and a change made once.")

## Advertising the extension

A Company lists the extension in `poppy.json`:

```json
"extensions": { "operations": [{ "version": "3" }] }
```

and an agent that supports it declares it on each request:

```http
Poppy-Extensions: "operations";v="3"
```

A change attempted without it is refused with
`403 {"error": "extension_required", "extension": "operations"}`, so an agent
that can't show the user an approval can't trigger a change. An agent declares
the extension only where it can show one.

## What an operation holds

```json
{
  "operation_id": "op_xs9hiC1D6rgUPCI-CV-jEARy", // (1)
  "revision": "1795602001-9J3BYg4QmZBKbSiM", // (2)
  "summary": "Refund 1 × Pork gyoza (6) (USD 8.00) missing from order ord_LNB0907, …", // (3)
  "terms": { // (4)
    "order_id": "ord_LNB0907",
    "dish_id": "pork-gyoza",
    "quantity": 1,
    "refund_cents": 800,
    "currency": "USD"
  },
  "expires_at": "2026-11-25T10:30:01.660Z" // (5)
}
```

1. **`operation_id`** is the action. It stays the same when the terms change.
2. **`revision`** is these terms. Any change to the terms or the expiry means a
   new revision.
3. **`summary`** is the terms in plain language, optional: bold, italics and
   lists, never links or images.
4. **`terms`** is everything that affects the action, as data the agent can
   check and show.
5. **`expires_at`** is the last moment an approval of this revision counts.

The Company performs only what the approved revision describes, so anything
missing from `terms` isn't part of the deal.

## The same operation in every interface

Every interface carries the same operation
([Operations §4](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval-required)):

| Interface    | The Company asks with                                                                                              | The agent approves with                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| API          | `403 {"error": "approval_required", "operation": {…}}` ([example](one-task.md#8-propose-the-change))               | the identical request with a `Poppy-Approval` header                                                    |
| MCP          | an error tool result (`isError`), with the operation in `structuredContent`                                        | the identical tool call with the approval in `_meta` under `personalagentprotocol.org/approval`         |
| Conversation | a Company message with `extensions.operations.operation` ([example](conversations.md#a-proposal-inside-a-message)) | a message with `extensions.operations.approval`                                                         |
| Website      | `403` with a `Poppy-Operation` header naming the Session and a reference                                           | a request to the extension's `endpoint`, never through the browser; then the browser repeats the action |

## Who approves

Approval comes in two kinds
([Operations §5](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval)):

- **User approved.** The agent shows the user the Company's name and the
  terms, and takes the answer through its own interface; in Iris, a card with
  the Company's verified domain and a button. A Company message saying "the
  user agreed" is never an approval; neither is the model deciding the user
  would agree.
- **Agent approved.** The agent approves on an instruction the user gave it,
  such as "any exchange under $20 is fine". The instruction must come from the
  user, not from anything the agent read. When the agent can't tell whether the
  terms fit, or the Company returns a new revision, the user decides.

![The Company sends its terms to the agent. If an instruction the user wrote already holds the exact terms, which code finds, the agent approves: agent approved. Whatever the instruction does not cover, including a new revision, goes to the user, who sees the Company's name and the terms and approves in the agent's own interface: user approved. A Company message saying the user agreed, or the model deciding the user would agree, is never an approval.](../../apps/playground/public/learn-media/diagrams/who-approves.svg "An approval comes from the user in the agent's own interface, or from the agent on an instruction the user wrote.")

Either way, the agent checks that `terms` agree with what was asked for and
with the `summary`. The Company writes both, so a summary could describe
something the terms don't.

In Iris, an agent approval comes from a standing instruction for one Company.
Code, never the model, checks it against the exact `terms`: an amount over the
limit (fees included), a refund, another currency or a disagreeing summary goes
to the user. The server checks again with its own copy of the operation and
holds its own limits, five approvals an hour and three times the limit in
total, so a tampered browser can't stretch a rule. The approval goes out as
`approver="agent"`, without `input_type`, and its `reference` is an entry in a
ledger the user sees next to the instruction.

## What an approval carries

At an API, the approval is a header on the identical request:

```http
Poppy-Approval: operation_id="op_xs9hiC1D6rgUPCI-CV-jEARy", revision="1795602001-9J3BYg4QmZBKbSiM", approver="user", approved_at=1795600000, input_type="tap", reference="apr_01JD8ZK3Q9"
```

| Member        | Meaning                                                 |
| ------------- | ------------------------------------------------------- |
| `approver`    | `user` or `agent`                                       |
| `approved_at` | When it was given, in seconds                           |
| `input_type`  | For a user approval, how, such as `tap`                 |
| `reference`   | The agent's own record, for the Company's support staff |

The agent keeps the approval with the operation. The Company records
`approver`, `input_type` and `reference` with the change, and can stop
accepting a misbehaving agent.

## What the Company checks

After the usual Session and token checks, the Company checks that:

1. the Session can approve this operation;
2. it hasn't been performed already, and if it has, it answers with the
   original result;
3. the revision is one it issued, hasn't expired, and the request asks for
   exactly what that revision describes.

If the third check fails, it performs nothing and returns the operation with a
revision for what the request asks now, never the one the approval named, so
the agent can't loop on a stale approval.

![After the Company proposes an operation, it waits for approval of its terms and revision. When the user approves, or the agent does on an instruction the user gave it, the Company checks the approval: if the terms still match, the change is made once. If the Company declines, the operation ends as declined by the Company, final for that approval. If the terms have changed, a new revision replaces it and the old approval no longer applies. If the user declines in the agent, the Company is not told and the proposal waits until it expires; when the time runs out it expires, with nothing done.](../../apps/playground/public/learn-media/diagrams/operation-states.svg "A proposal ends with the change made once or with nothing done, and the Company checks each approval first.")

## Declines

A Company may refuse a valid approval for its own reasons. It answers
`403 {"error": "approval_declined"}` with the operation ID and revision, an
optional `reason` in plain language and an optional alternative, such as a page
where the user can do it themselves. The
extension has no reason codes: an agent does the same whatever the reason, and
codes would reveal the Company's risk rules.

A decline is final for that approval. The agent shows it to the user and
doesn't resend it.

The lab's bank, Harborline, declines every agent approval that moves money:
"Harborline moves money only when you approve it yourself." The user can then
approve the same revision themselves, and Harborline performs it. A decline
lets a Company accept agents for some actions and insist on the person for
others.

## Retries and at most once

Networks fail after the work is done. The agent resends the identical request
with the identical approval, and the Company answers with the original result
instead of acting twice
([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions/operations#at-most-once)).
For that to hold:

- the Company records the result **before** replying;
- the agent never proposes the change again to "check" whether it happened.

It must also hold across a failure: when the connection is cut after an order
is saved and the Company is rebuilt from its store, the resent approval still
gets the original response and the store holds one order.

## What an approval proves, and what it doesn't

An approval proves that a specific agent, in a specific Session, and with an
access token for the account when signed in, stated that a specific revision
was approved, by the user or on their instruction. It doesn't prove what
happened on the user's screen: the Company relies on the agent for that.

A Company that must see the user confirm for itself, as when closing an
account, can skip operations and have the user confirm on its website or app,
signed in.

## Go deeper

- Watch it happen: [Changing an order](how-it-works/changing-an-order.md),
  [Moving money](how-it-works/moving-money.md),
  [Letting the agent approve for you](how-it-works/letting-the-agent-approve-for-you.md)
  and [When something goes wrong](how-it-works/when-something-goes-wrong.md).
- As HTTP: [One task](one-task.md#9-the-user-approves-the-agent-resends).
- Apply it: [Build a Company](build-a-company.md#milestone-4-operations) and
  [Build a Personal Agent](build-an-agent.md).
- In the lab: [`approvals.ts`](../../packages/pap-company/src/approvals.ts),
  [`runtime.ts`](../../apps/playground/lib/runtime.ts) (`userApproval`,
  `sendApproval`) and
  [`operation-review.tsx`](../../apps/playground/app/operation-review.tsx).

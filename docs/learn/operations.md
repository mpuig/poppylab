# Approvals with Operations

The [Operations extension](https://personalagentprotocol.org/docs/1.0/extensions/operations)
(version 3) answers one question: how does a Company know the user agreed to
_this exact change_, when the request comes from an agent? Instead of
performing a change, the Company answers with its exact terms and waits for an
approval of those terms. This page explains the life of an operation, with
examples from Poppy Lab, and what each side has to get right.

## The life of an operation

![A Personal Agent asks a Company for a change. The Company answers approval_required with an operation holding its terms and a revision. The user approves, or the agent approves on the user's instruction, and the agent resends the same request with the approval. The Company checks it and performs the change once, or declines. If the terms change, the Company returns a new revision and the old approval no longer applies.](../../apps/playground/public/learn-media/diagrams/operation-lifecycle.svg "A request, an answer that holds the terms, an approval of exactly those terms, and a change made once.")

Everything else in the extension is detail on one of those arrows.

## Advertising the extension

A Company lists the extension in `poppy.json`:

```json
"extensions": { "operations": [{ "version": "3" }] }
```

and an agent that supports it declares it on each request:

```http
Poppy-Extensions: "operations";v="3"
```

Only requests that declare it get operations. A change attempted without it is
refused with `403 {"error": "extension_required", "extension": "operations"}`,
so an agent that doesn't understand approvals can't trigger a change it
couldn't have asked the user about. An agent declares the extension only where
it can show the user an approval.

## What an operation holds

```json
{
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
```

| Field          | What it is                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `operation_id` | The action. It stays the same when the terms change.                                                         |
| `revision`     | These terms. Any change to the terms or the expiry means a new revision.                                     |
| `terms`        | Everything that affects the action, as data the agent can check and show: amounts, dates, items, recipients. |
| `summary`      | The same terms in plain language, optional. It may use bold, italics and lists, but never links or images.   |
| `expires_at`   | The last moment an approval of this revision counts.                                                         |

The Company performs only what the approved revision describes, so anything
missing from `terms` isn't part of the deal.

## The same operation in every interface

The same operation travels through every interface
([Operations §4](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval-required)):

| Interface    | The Company asks with                                                       | The agent approves with                                                                                 |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| API          | `403 {"error": "approval_required", "operation": {…}}`                      | the identical request again, with a `Poppy-Approval` header                                             |
| MCP          | an error tool result (`isError`), with the operation in `structuredContent` | the identical tool call again, with the approval in `_meta` under `personalagentprotocol.org/approval`  |
| Conversation | a Company message with `extensions.operations.operation`                    | a message with `extensions.operations.approval`                                                         |
| Website      | `403` with a `Poppy-Operation` header naming the Session and a reference    | a request to the extension's `endpoint`, never through the browser; then the browser repeats the action |

[One task, request by request](one-task.md#8-propose-the-change) shows the API
form, and [Conversations](conversations.md#a-proposal-inside-a-message) the
conversation form, both from Lantern.

## Who approves

There are two kinds of approval
([Operations §5](https://personalagentprotocol.org/docs/1.0/extensions/operations#approval)):

- **User approved.** The agent shows the user the Company's name and the
  terms, and takes the answer through its own interface. A message from the
  Company saying "the user agreed" is never an approval; neither is the model
  deciding the user would agree.
- **Agent approved.** The agent approves on an instruction the user gave it,
  such as "any exchange under $20 is fine". The instruction must come from the
  user, not from anything the agent read. The agent checks the terms against
  it and asks the user when it can't tell. If the Company answers with a new
  revision, the instruction doesn't stretch to cover it: the user decides.

Either way, the agent checks before approving that `terms` agree with what was
asked for and with the `summary`. The Company writes both, so a summary could
describe something the terms don't.

In Iris, a user approval is a button on a card that shows the Company's name,
its verified domain and the terms. An agent approval comes from a standing
instruction the user writes for one Company, such as "up to $20". Code checks
it against the exact `terms`, never the model: any amount over the limit (fees
included), a refund, another currency or a summary that disagrees with the
terms goes to the user.

The server checks again with its own copy of the operation and holds its own
limits, five approvals an hour and three times the limit in total, so a
tampered browser can't stretch a rule. The approval goes out as
`approver="agent"`, without `input_type`, and its `reference` is an entry in a
ledger the user sees next to the instruction.

## What an approval carries

At an API, the approval is a header on the identical request:

```http
Poppy-Approval: operation_id="op_xs9hiC1D6rgUPCI-CV-jEARy", revision="1795602001-9J3BYg4QmZBKbSiM", approver="user", approved_at=1795600000, input_type="tap", reference="apr_01JD8ZK3Q9"
```

| Member        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `approver`    | `user` or `agent`                                                       |
| `approved_at` | When the approval was given, in seconds                                 |
| `input_type`  | For a user approval, how they gave it, such as `tap`                    |
| `reference`   | The agent's own record of the approval, for the Company's support staff |

The agent keeps the approval with the operation and sends exactly the same one
on every retry. The Company records `approver`, `input_type` and `reference`
with the change.

## What the Company checks

Before performing anything, after the usual Session and token checks, the
Company checks that:

1. the Session can approve this operation;
2. it hasn't been performed already, and if it has, it answers with the
   original result;
3. the revision is one it issued, hasn't expired, and the request asks for
   exactly what that revision describes.

If the third check fails, it performs nothing and returns the operation with a
revision for what the request asks now, never the one the approval named, so
the agent can't loop on a stale approval.

## Declines

A Company may refuse a valid approval for its own reasons: the approver, the
account, its risk checks. It answers `403 {"error": "approval_declined"}` with
the operation ID and revision, an optional `reason` in plain language and an
optional alternative, such as a page where the user can do it themselves. The
extension deliberately has no reason codes, because an agent does the same
whatever the reason, and codes would reveal the Company's risk rules.

A decline is final for that approval. The agent shows it to the user and
doesn't resend it.

The lab's bank, Harborline, declines every agent approval that moves money:
"Harborline moves money only when you approve it yourself." Iris then hands the
operation back to the user, with the reason, and doesn't try the rule on it
again. The user can approve the same revision with an approval of their own,
which Harborline performs. A decline lets a Company accept agents for some
actions and insist on the person for others, and it needs neither reason codes
nor a new operation.

## Retries and at most once

Networks fail after the work is done. The extension's answer is that the agent
resends the identical request with the identical approval, and the Company
answers with the original result instead of acting twice
([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions/operations#at-most-once)).
For that to hold:

- the Company records the result **before** replying;
- the agent never proposes the change again to "check" whether it happened.

It also has to hold across a failure. When the connection is cut after an
order is saved and the Company is then rebuilt from its store, the resent
approval still gets the original response, and the store still holds one
order.

## What an approval proves, and what it doesn't

An approval proves that a specific agent, in a specific Session, and with an
access token for the account when signed in, stated that a specific revision
was approved, by the user or on their instruction. It doesn't prove what
happened on the user's screen: the Company relies on the agent for that, as it
does for sign-in. That's why approvals carry `approver`, `input_type` and a
`reference`, and why a Company can stop accepting a misbehaving agent.

For an action where a Company must see the user confirm for itself,
such as closing an account, it can skip operations and have the user confirm
on its website or app, signed in.

## Go deeper

- Watch approvals happen:
  [Changing an order](how-it-works/changing-an-order.md) follows a customer's
  approval end to end,
  [Moving money](how-it-works/moving-money.md) does the same at a bank,
  [Letting the agent approve for you](how-it-works/letting-the-agent-approve-for-you.md)
  shows an agent approval within a standing limit, and
  [When something goes wrong](how-it-works/when-something-goes-wrong.md) shows a
  declined proposal, an expired approval and terms that change.
  [One task, request by request](one-task.md#9-the-user-approves-the-agent-resends)
  shows the approval as an HTTP request.
- Apply it: [Build a Company](build-a-company.md#milestone-4-operations) for the
  Company's side and [Build a Personal Agent](build-an-agent.md) for the
  agent's.
- In the lab: the Company side is
  [`approvals.ts`](../../packages/pap-company/src/approvals.ts), the agent's is
  [`runtime.ts`](../../apps/playground/lib/runtime.ts) (`userApproval`,
  `sendApproval`) and the approval card is
  [`operation-review.tsx`](../../apps/playground/app/operation-review.tsx).

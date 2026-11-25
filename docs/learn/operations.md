# Approvals with Operations

The [Operations extension](https://personalagentprotocol.org/docs/1.0/extensions)
(version 3) answers one question: how does a Company know the user agreed to
_this exact change_, when the request comes from an agent? Instead of
performing a change, the Company answers with its exact terms and waits for an
approval of those terms. This page explains the life of an operation, with
examples from Poppy Lab, and what each side has to get right.

## The life of an operation

```text
agent asks for a change ──▶ Company: approval_required + operation (terms, revision)
                                   │
              ┌────────────────────┴───────────────────────┐
              ▼                                            ▼
     user approves (or the agent,               terms change (price, stock, the
     on the user's instruction)                 user asks for something else)
              │                                            │
              ▼                                            ▼
agent resends the same request         Company returns a new revision;
with the approval                      the old approval no longer applies
              │
              ▼
Company checks it and performs the change once, or declines it
```

Everything else in the extension is detail on one of those arrows.

## 1. Advertising it

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
couldn't have asked the user about.

## 2. The operation

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

## 3. Where it shows up

The same operation travels through every interface
([Operations §4](https://personalagentprotocol.org/docs/1.0/extensions)):

| Interface    | The Company asks with                                                       | The agent approves with                                                                                 |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| API          | `403 {"error": "approval_required", "operation": {…}}`                      | the identical request again, with a `Poppy-Approval` header                                             |
| MCP          | an error tool result (`isError`), with the operation in `structuredContent` | the identical tool call again, with the approval in `_meta` under `personalagentprotocol.org/approval`  |
| Conversation | a Company message with `extensions.operations.operation`                    | a message with `extensions.operations.approval`                                                         |
| Website      | `403` with a `Poppy-Operation` header naming the Session and a reference    | a request to the extension's `endpoint`, never through the browser; then the browser repeats the action |

[One task, request by request](one-task.md#8-propose-the-change) shows the API
form, and [Conversations](conversations.md#3-a-proposal-inside-a-message) the
conversation form, both from Lantern.

## 4. Who approves

There are two kinds of approval
([Operations §5](https://personalagentprotocol.org/docs/1.0/extensions)):

- **User approved.** The agent shows the user the Company's name and the
  terms, and takes the answer through its own interface. A message from the
  Company saying "the user agreed" is never an approval; neither is the model
  deciding the user would agree.
- **Agent approved.** The agent approves on an instruction the user gave it,
  such as "any exchange under $20 is fine". The instruction must come from the
  user, not from anything the agent read. The agent checks the terms against
  it and asks the user when it can't tell. If the Company answers with a new
  revision, the instruction doesn't stretch to cover it: the user decides.

Either way, before approving, check that `terms` agree with what was asked for
and with the `summary`. The Company writes both, so a summary could describe
something the terms don't.

In Iris, a user approval is a button on a card that shows the Company's name,
its verified domain and the terms. An agent approval comes from a standing
instruction the user writes for one Company, such as "up to $20". Code checks
it against the exact `terms`, never the model: any amount over the limit
(fees included), a refund, another currency or a summary that disagrees with
the terms goes to the user. The server checks again with its own copy of the
operation and holds its own limits, five approvals an hour and three times
the limit in total, so a tampered browser can't stretch a rule. The approval
goes out as `approver="agent"`, without `input_type`, and its `reference` is
an entry in a ledger the user sees next to the instruction.

## 5. Sending the approval

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

Keep the approval with the operation and send exactly the same one on every
retry.

## 6. What the Company checks

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

## 7. Declines

A Company may refuse a valid approval for its own reasons: the approver, the
account, its risk checks. It answers `403 {"error": "approval_declined"}` with
the operation ID and revision, an optional `reason` in plain language and an
optional alternative, such as a page where the user can do it themselves. The
extension deliberately has no reason codes, because an agent does the same
whatever the reason, and codes would reveal the Company's risk rules.

A decline is final for that approval. Show it to the user; don't resend it.

The lab's bank, Harborline, declines every agent approval that moves money:
"Harborline moves money only when you approve it yourself." Iris then hands the
operation back to the user, with the reason, and doesn't try the rule on it
again. The user can approve the same revision with an approval of their own,
which Harborline performs. A decline lets a Company accept agents for some
actions and insist on the person for others, and it needs neither reason codes
nor a new operation.

## 8. Retries and at most once

Networks fail after the work is done. The extension's answer is that the agent
resends the identical request with the identical approval, and the Company
answers with the original result instead of acting twice
([Operations §7](https://personalagentprotocol.org/docs/1.0/extensions)). For
that to hold:

- the Company records the result **before** replying;
- the agent never proposes the change again to "check" whether it happened.

Our tests cut the connection after an order was saved, rebuilt the Company
from its store and resent the approval: one order, the same response.

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

## Checklists

**Company**

- [ ] Every consequential change returns an operation; everything that matters
      is in `terms`.
- [ ] A new revision whenever the terms or the expiry change.
- [ ] Perform only the approved revision, once; store the result before replying.
- [ ] A mismatch returns a fresh revision, never the approval's.
- [ ] Record `approver`, `input_type` and `reference` with the change.

**Personal Agent**

- [ ] Declare the extension only where you can show approvals.
- [ ] Show the Company's name, its domain and the terms; take the answer in your
      own interface.
- [ ] Never let the model or Company content approve.
- [ ] Check `terms` against the request and the summary.
- [ ] Store the approval; resend it unchanged; never re-propose to check.
- [ ] Treat a decline as final.

Our implementations: the Company side in
[`approvals.ts`](../../packages/pap-company/src/approvals.ts), the agent's in
[`runtime.ts`](../../apps/playground/lib/runtime.ts) (`userApproval`,
`sendApproval`) and the approval card in
[`operation-review.tsx`](../../apps/playground/app/operation-review.tsx).

# Juniper service foundation

First vertical slice of the approved [testbed plan](juniper-testbed-plan.md), not complete PAP conformance.

## Working customer journey

1. Open `/help` for public FAQs, or enter `/account` as fictional Alex.
2. The account navigation covers shopping, deliveries, orders, billing, help/cases, profile and collapsed agent activity. [Shopping and recurring delivery editors](juniper-shopping-web.md) share version guards with agent proposals. Billing derives simulated documents from existing orders; profile now supports [versioned website edits and approval-gated agent changes](juniper-profile.md). No new payment ledger is implied.
3. Submit a case in **Help and support**, optionally selecting one of your actual fictional orders. Submission is an explicit customer action, not a PAP approval. Both surfaces read the same persisted record.
4. A clearly labeled automatic test responder posts topic-based guidance. No real support worker, LLM support conversation, refund or delivery intervention is involved.
5. In Poppy, choose an LLM (verified with OpenAI compatible / `gpt-6-luna`) and ask it to read the complete case and propose closing it as answered. The deterministic Protocol demo has not gained a support-intent parser.
6. Review Company-owned terms and explicitly approve or decline in Poppy. Natural-language agreement does not close a case. An approved closure changes only case status/version.
7. A website follow-up adds customer/test-support messages, reopens the case and increments its version. A prior closure proposal fails rather than overwriting newer information.

## API contract

PAP API reads require a DPoP Session; account routes additionally require the account grant. Public FAQs are available with a signed-out Session. `/help` is ordinary public HTML.

| Route                               | Authority / behavior                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/faq`                      | Public FAQ list, no account scope                                                        |
| `GET /api/account/profile`          | `poppy:read`; fictional contact/address projection                                       |
| `GET /api/account/invoices`         | `poppy:read`; simulated order-derived documents, not fiscal invoices or payment evidence |
| `GET /api/account/cases`            | `poppy:read`; latest 20 case summaries                                                   |
| `GET /api/account/cases/:id`        | `poppy:read`; owned complete case and messages, otherwise 404                            |
| `POST /api/account/case-proposal`   | `poppy:read/write` client contract; propose opening only, optional owned order           |
| `POST /api/account/case-resolution` | `poppy:read/write` client contract; propose closing the current case version, no refund  |
| `POST /site/cases`                  | Separate browser session + exact Origin; explicit website submission                     |
| `POST /site/cases/:id/messages`     | Same browser boundary; explicit follow-up/reopen                                         |

The original seven service tools plus the profile proposal tool join the existing eleven (19 total). Website mutation routes are not advertised as model tools. Shared existing Operations routes enforce ownership, revision, expiry, explicit approval, current-state preconditions and idempotent confirmation. Repeated identical pending case-creation proposals reuse the original operation and case ID; succeeded/declined/expired proposals are not silently reused as a new case request. Unknown operation kinds fail closed rather than falling through to checkout.

No new scope silently expands a grant: this milestone still uses `poppy:read/write`. Fine-grained service scopes and reconsent remain planned.

## Persistence, limits and failure behavior

Optional `cases` and `profile` fields migrate older customer records lazily without resetting baskets, delivery versions, orders or Operations. The existing encrypted snapshot persists them; no separate website fixture store exists. Confirmed operation results snapshot case data rather than changing retroactively when the conversation continues.

Limits: 100 cases per customer, 20 messages per case, 120-character subjects, 2,000-character customer messages (the agent creation tool deliberately advertises 1,000), and the latest 20 cases on the website/list route. An automatic response consumes a message slot too. The API detail route returns the full bounded conversation. Existing operation storage/expiry limits still apply. Order linkage is validated against the same account, including at confirmation. There is no global reset or case deletion endpoint.

Forms retain text on errors; an uncertain response asks the customer to refresh before retrying. Browser submissions do not yet have durable idempotency keys: do not blindly resend after a network timeout. The model proposal/confirmation path has independent idempotency behavior described above. Unchanged polling does not rebuild DOM; case expansion and form drafts survive unrelated state updates. All dynamic customer text uses `textContent`.

## Evidence and limits

Automated coverage includes case proposal/confirmation retry, cross-account case lookup isolation, shared website/PAP state, browser-session/Origin checks, stale closure rejection after a follow-up, successful fresh closure, input/order validation, old-state migration, unknown-kind fail-closed behavior, generated tool permissions and parseable HTML-injection-free client code. Actual DPoP tests verify read-only grants cannot propose support changes, PAP tokens cannot replace browser login, and revoked grants cannot read cases.

A real local browser created a fictional case, then GPT-6 Luna used `my_support_cases`, `support_case_details`, `search_help` and `propose_case_resolution` through signed DPoP requests. The trace loaded 18 tools and ended awaiting explicit approval. **No live closure was confirmed and no shopping, order, delivery or money state was changed by this service test.** Closure success/staleness was verified in isolated automated fixtures. The live proposal may now have expired; the case remains open.

Still pending: website checkout/order management, true billing/credit workflows, delivery/invoice-specific case links, local scenario/fault console, MCP, Company conversations/handoff, PAP browser joining, feedback and remaining authorization flows. This is a functional foundation, not the finished comprehensive testbed or a production service.

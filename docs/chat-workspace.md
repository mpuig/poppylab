# Conversation-first Poppy Lab

The playground at `/playground` is a chat with Iris, the lab's Personal Agent. It offers three ways to answer: **Protocol demo** (no model, no key), **OpenAI compatible · gpt-6-luna / low** and **Anthropic · sonnet-5**. A first visit starts in the demo. OpenAI uses Responses with `reasoningEffort: low` and `store: false`. Model names are fixed in the UI. Older browser settings keep their provider and key when the provider is still offered, and move to these model names.

## A first run

Nothing needs to be set up. The page opens with four cards, one for each fictional Company, and a guide of four steps above the chat that says what to do next.

1. **Pick a company.** Each card shows the Company, what it is and a request to try. Picking one connects to it; the row above the guide then says what discovery found ("Found Juniper Market · grocery-demo.poppylab.dev · 1 API · Company agent · Poppy 1.0"). **Use another address** opens a form for any other Company's URL.
2. **Sign in.** The button in the chat opens the Company's own consent page in a new tab. You choose Elena or Robin, the two test customers every Company has, and allow read access. Iris never sees a password. Read access is all a first sign-in asks for.
3. **Ask for a change.** First press **Request change permission**, which opens the consent page again for the change scope. Then ask, in your own words or with the suggestion under the guide.
4. **Approve it.** The Company answers with the exact terms and holds the change. It appears in the "Needs you" panel above the message box; you approve or decline it there. The guide ends with "Done: Juniper Market performed the change once. Its website shows the same data."

A run at Juniper Market, in demo mode, is three messages and two consent pages:

| You do                                          | What happens                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Pick **Juniper Market**                         | Discovery, a signed-out Session, the tasks and the API tools                                            |
| Ask "What are your products?"                   | Iris reads the public catalogue; no sign-in is needed                                                   |
| Press **Sign in to Juniper Market · read only** | Juniper's consent page; pick Elena, allow access                                                        |
| Ask "my deliveries"                             | Iris reads Elena's recurring delivery: Thursday, oranges and coffee                                     |
| Press **Request change permission**             | Juniper's consent page again, with "Allow change proposals" ticked                                      |
| Ask "Move my recurring delivery to Saturday."   | Juniper answers `approval_required`: Thursday to Saturday, change fee $0.00. Nothing has changed.       |
| Press **Approve this change**                   | Iris resends the same request with your approval. Juniper performs it once; its website shows Saturday. |

Each conversation has its own address and is listed under **History**; see [chat continuity](chat-continuity.md).

## Demo mode

Demo mode answers without a model. Keyword rules choose one of the Company's tools, call it, and show the Company's answer as plain lines, with the exact JSON one click away under "Data". Every answer starts with "Protocol demo (no LLM)." It exists so the protocol can be watched with no key: discovery, Sessions, sign-in, proposals and approvals are the real ones.

It reads at every Company and can propose one kind of change at each. A Company is recognised by the tools it offers, never by its name.

| Company            | Reads                                                                                                                        | Changes it can propose                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Juniper Market     | "What are your products?", "When do you deliver?", "What are your opening hours?", "my basket", "my orders", "my deliveries" | "Move my recurring delivery to Saturday.", "set apples in my basket to 2", "remove coffee from my basket", "checkout on Saturday"            |
| Lantern Noodle Bar | "my orders"                                                                                                                  | "add 2 vegetable gyoza", "remove the edamame", "move my order to Saturday dinner", "Add a matcha ice cream and move it to Sunday lunchtime." |
| Harborline Bank    | "my account balances"                                                                                                        | "Transfer $500 from checking to savings.", "Pay Beacon Studio $125 for November design work"                                                 |
| Northwind Air      | "my upcoming trips"                                                                                                          | "Upgrade my NA 118 flight to Business.", "add 2 bags to NA 402"                                                                              |

How it reads a request:

- **It reads the account first.** At Lantern, Harborline and Northwind the demo reads the orders, accounts, recipients or trips, and builds the request only from what it read. It never invents an identifier.
- **It asks instead of guessing.** "change my order" gets a question back, as does a dish, a day or a flight it can't find. At Juniper, "set apples to 2" without saying basket or delivery gets "Do you mean your shopping basket or your recurring delivery?"
- **A question is a question.** "Can you upgrade my NA 118 flight?" is answered by reading the trip, not by asking for the upgrade.
- **Numbers.** "$1,000" is one amount. A count is the number beside the thing it counts ("add 2 vegetable gyoza"), and a time such as "18:30" is never a count. At Juniper a quantity is the new total, not an increase.
- **Days.** An order moves to the day the message names as its destination ("to Friday"), not to the day it is on ("from Friday").
- **Several things at once.** "Remove the edamame and add a matcha ice cream" removes and adds, each by its own verb. It removes only a dish the order has.
- **Money.** A payment goes only to a saved, active recipient, from the account the message names. Words after "for" are the payment's memo.
- **Flights.** A flight number is taken only from the flights that are booked.

What it says when it can't:

- Signed out: "Sign in first: the demo reads your account to prepare this change, and nothing changes until you approve it."
- Signed in without change permission: it says your access doesn't include the permission the change needs.
- When the Company's own description of a tool rejects the values the demo chose: it says nothing was sent.
- Anything else: "The demo can't prepare that change here." A model can.

Three more things a message can start, when the Company offers them:

- **The Company's own agent.** "customer service", "support" or "talk to a person" sends the Company's agent a structured request, or asks it for a person.
- **Feedback.** "gift card", "voucher" or "feedback" sends one fixed report about a task the Company doesn't offer (see [Build a Company](learn/build-a-company.md#feedback-on-the-wire)).
- **A Direct Conversation.** "my order never arrived" tells the Company's agent, which may ask to talk with you directly; you accept or decline above the message box (see [Conversations](learn/conversations.md)).

At Harborline, with **Use FDX** on, reads use the bank's FDX-shaped API and are worded as that API words them; see [the FDX extension](extensions/fdx.md).

Choosing the demo with **No key? Try the protocol demo** lasts for that browser tab. It is kept apart from the saved settings, so it never replaces a saved key and it survives a change of view or a reload; saving a model or forgetting the settings ends it.

The rules are in `apps/playground/lib/` (`demo-changes.ts`, `demo-tool.ts`, `demo-text.ts`, `demo-fdx.ts`, `guide.ts`), each with its tests, and Juniper's in `apps/playground/app/api/chat/route.ts`.

## With your own model

1. Open Model settings, choose a provider, paste an API key and Save model. The form closes.
2. Pick a Company, or use another address.
3. Use the conversation. Sign-in, permission expansion, sign-out, recovery and Operation approval/status widgets are inside the chat. Inspector, Identity and History remain optional views. Company OAuth consent still opens the Company's own tab; Poppy never collects Company credentials in chat.

The API key and provider preference persist under `poppy.model.v1` in localStorage. This is **not encrypted**: scripts on the same origin and users of the browser profile can read it. Avoid shared devices; Forget saved settings removes this entry. It does not revoke the provider key or erase unrelated Poppy account grants.

Browser keys go over a same-origin request to the server, then to the selected provider. They are request-scoped, not written to runs/vaults, included in messages/tool context or exposed in protocol traces. A browser OpenAI key uses the official OpenAI endpoint, not an environment-configured proxy. There is no arbitrary provider endpoint field.

## Local defaults without credential disclosure

In development on localhost/127.0.0.1, `/api/model` advertises whether a provider environment key exists, never its value. The form shows **Using local environment key**, and the adapter uses that key server-side unless a browser key overrides it. The raw environment key is deliberately **not prefilled into an HTML input or cached in the browser**. Existing `.env.local` values, including `OPENAI_MODEL=gpt-6-luna`, are not modified; the UI explicitly sends the chosen fixed model.

Remote/production requests cannot use this environment-key fallback. They must supply their own key. Existing public-chat/access-control gates remain: this change does not deploy or publicly enable the playground. It is not a multi-user production security review.

## Approvals, steps and the log

How the playground shows what Iris did and asks for a decision. All of it is
in the page; the server's approval endpoint is the one it always was.

- **Needs you.** Proposals waiting for a decision collect in a panel above the
  message box, with a count. It folds with its button or Escape and opens
  again when a new proposal arrives; you can keep chatting while it is open.
  A status line announces a waiting proposal to screen readers. Settled
  operations stay in the transcript. On a short window the panel shrinks and
  scrolls, so the message box is always on screen.
- **The approval card.** It leads with the amount being approved, which is also
  on the button ("Approve $28.00"), and quotes the Company's summary as the
  Company's own words, as text only. It warns when the summary names an amount
  the exact terms do not hold. That check reads amounts written with `$`, `€`
  or `£` and does not compare ones written "USD 9.99".
- **A standing instruction.** One rule per Company, set under the account row
  once change permission is granted: approve exchanges up to an amount without
  asking. It is kept in the browser (`localStorage`, under
  `poppy-lab:standing-instructions`, with the hour's approvals under
  `poppy-lab:auto-approvals`), is read as a rule of the User's and sends the
  same approve action a click would. The server does not know of it.
  - It covers an operation only when its terms show a total in the rule's
    currency and **every** amount in them, nested ones and fees included, is
    within the limit; it never covers a refund, an unreadable amount, a
    proposal that has expired or a summary that disagrees with the terms.
  - It makes at most 5 approvals an hour per Company and no more than three
    times the limit in total over that hour. The most a rule can allow is
    $1,000. When the hour's allowance is the reason, the log says so and the
    operation waits for you.
  - The log says "Applying your standing instruction" when it sends the
    approval, and the next line says how the Company answered.
  - Removing the rule, or clearing the site's storage, removes the rule and the
    hour's record; the limits are only as strong as the browser that keeps them.
- **What Iris did.** Under each answer, a list of its steps in plain words: what
  it read or sent, how (API, the Company's own agent, sign-in or setup) and
  with what access (view, or view and change).
- **The log.** The inspector lists the session's events with a time, their spec
  section, the method and address without its query, and an outcome read from
  the event's own words. Times are when the page received each event, and one
  turn's events arrive together. The trace can be copied or downloaded as text
  for an interop report; it holds no headers, bodies, tokens or keys.
- **Failed messages and links.** A message that fails offers Try again, which
  puts its text back in the composer, and Remove. A link that carries a token
  or signature in its query or fragment is shown with "…" in its place; a
  secret inside the path itself cannot be recognised and is not hidden.

The code is in `apps/playground/lib/` (`standing-instructions.ts`,
`auto-approval.ts`, `operation-presentation.ts`, `protocol-log.ts`,
`agent-steps.ts`, `link-display.ts`), each with its tests, and in
`apps/playground/app/playground/` (`conversation.tsx`, `inspector.tsx`,
`standing-instruction.tsx`, `fdx-consent.tsx`).

## Evidence

276 automated tests pass across the workspace. New tests cover request-scoped keys, no key in model context, environment proxy isolation, safe configuration metadata and fixed-choice restoration. TypeScript, lint, build and formatting pass.

Browser checks used a fictional key only: save/collapse, refresh restoration, masked key field, exactly two options, no free model field and no horizontal overflow at 390px. Account state was injected through a browser fixture; no sign-in/approval/revocation or paid model requests were performed. Existing real purchases were not modified. Visual review was in-thread, without an independent reviewer.

`sonnet-5` is the exact requested identifier. It has not been live-validated with Anthropic; availability depends on the provider/account.

## Layout of the code (3 November 2026)

`apps/playground/app/playground/` holds the playground: `page.tsx` composes the views and owns the viewport and scroll effects; `use-playground.ts` is the state and the three server calls (discovery, chat, account actions) plus run restore and consent polling; `connection-setup.tsx`, `conversation.tsx`, `inspector.tsx` and `identity-panel.tsx` render one section each; `companies.ts` has the Company URLs, the sign-in visibility rule and the transcript types. The DOM, class names and ARIA are unchanged from the single-file version.

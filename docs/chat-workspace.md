# Conversation-first Poppy Lab

The playground at `/playground` is a chat with Iris, the lab's Personal Agent. It offers three ways to answer: **Protocol demo** (no model, no key), **OpenAI compatible · gpt-6-luna / low** and **Anthropic · sonnet-5**. A first visit starts in the demo. OpenAI uses Responses with `reasoningEffort: low` and `store: false`. Model names are fixed in the UI. Older browser settings keep their provider and key when the provider is still offered, and move to these model names.

## A first run

Nothing needs to be set up. The page opens with five cards, one for each fictional Company, and a guide of four steps above the chat that says what to do next.

1. **Pick a company.** Each card shows the Company, what it is and a request to try. Picking one connects to it and starts the conversation; the Companies bar above the guide then shows it, with its state ("Public access"), and opening it says what discovery found ("Juniper Market · grocery-demo.poppylab.dev · 1 API · Company agent · Poppy 1.0"). **Use another address** opens a form for any other Company's URL. The message box works before any Company too: Iris answers that one is needed, with a button for each of the lab's.
2. **Sign in.** The button in the chat opens the Company's own consent page in a new tab. You choose Elena or Robin, the two test customers every Company has, and allow read access. Iris never sees a password. Read access is all a first sign-in asks for. When you allow or decline, the tab lands on a short page of the lab's that says how it went and to close the tab (`/playground/sign-in/done` or `/playground/sign-in/failed`); the one-time code the Company sent back does not stay in its address. After a completed sign-in the page names the Company ("Signed in to Juniper Market."). The address carries nothing for that: the playground tab leaves the display name in the browser's storage when it opens the sign-in, and the page reads it there once and shows it as text. Where the browser blocks storage, the page says "the Company account".
3. **Ask for a change.** First press **Request change permission**, which opens the consent page again for the change scope. Then ask, in your own words or with the suggestion under the guide.
4. **Approve it.** The Company answers with the exact terms and holds the change. It appears in the "Needs you" panel above the message box; you approve or decline it there. The guide ends with "Done: Juniper Market performed the change once. Its website shows the same data." If the change isn't performed, the guide says which way it ended and what you can do: you declined it, it expired, the Company declined or refused the approval, or the Company answered with new terms. While a card reads "Outcome unknown", the guide says that the change may or may not have been made, to retry the same approval, which the Company performs at most once, and not to ask for the change again until the outcome is known. The fourth step is ticked only beside "Done": a proposal that ended without being performed leaves it open, even after an earlier change went through. With several proposals in one conversation, the guide speaks about the one something happened to last, and a proposal that waits for you comes before one that is finished.

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

**Use FDX** (Harborline, which lists the `poppylab.dev/fdx` extension) is a switch in the chat's account row. It is off by default, kept with the conversation, and starts a new Session when changed ([Use FDX](openapi-tools.md#in-the-playground-use-fdx-and-use-espi)). Signed in with it on, the account row shows the FDX consent (its id, status, shared accounts and expiry) and **Revoke FDX consent**, which turns into **Confirm revoke** and **Cancel** in place, with no browser dialog. Once the bank revokes it, the conversation is signed out as after Sign out, and the row says so and offers sign-in again. With `fdx:STATEMENTS` granted, the row also offers **Show FDX statements**: each shared account's statements, each with **Download PDF**, which saves the bank's PDF as a file without a browser dialog. Iris never gets the file ([Statements](openapi-tools.md#in-the-playground-use-fdx-and-use-espi)).

**Use ESPI** is the same switch at Fernwick, which lists the `poppylab.dev/espi` extension, with the same rules ([Use ESPI](openapi-tools.md#use-espi)). Signed in with it on, the account row shows the ESPI authorization (its id, status, shared meters and expiry) and **Revoke ESPI access**, confirmed the same way in place. Fernwick ends the grant and the conversation is signed out; the row says so and offers **Sign in again to share meters over ESPI**. Usage and bills are read through tools that add up the hourly readings first, so the model never sees a raw interval.

Each conversation has its own address and is listed under **History**; see [chat continuity](chat-continuity.md).

## Demo mode

Demo mode answers without a model. Keyword rules choose one of the Company's tools, call it, and show the Company's answer as plain lines, with the exact JSON one click away under "Data". Every answer starts with "Protocol demo (no LLM)." It exists so the protocol can be watched with no key: discovery, Sessions, sign-in, proposals and approvals are the real ones.

It reads at every Company and can propose one kind of change at each but Fernwick, where a plan switch needs a model. A Company is recognised by the tools it offers, never by its name.

| Company                | Reads                                                                                                                        | Changes it can propose                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Juniper Market         | "What are your products?", "When do you deliver?", "What are your opening hours?", "my basket", "my orders", "my deliveries" | "Move my recurring delivery to Saturday.", "set apples in my basket to 2", "remove coffee from my basket", "checkout on Saturday"            |
| Lantern Noodle Bar     | "my orders"                                                                                                                  | "add 2 vegetable gyoza", "remove the edamame", "move my order to Saturday dinner", "Add a matcha ice cream and move it to Sunday lunchtime." |
| Harborline Bank        | "my account balances"                                                                                                        | "Transfer $500 from checking to savings.", "Pay Beacon Studio $125 for November design work"                                                 |
| Northwind Air          | "my upcoming trips"                                                                                                          | "Upgrade my flight to Business.", "Upgrade my NA 118 flight to Business.", "add 2 bags to NA 402"                                            |
| Fernwick Power & Light | "my bills"; with Use ESPI on, "How much electricity did my EV use last week?", "mi factura"                                  | None                                                                                                                                         |

How it reads a request:

- **It reads the account first.** At Lantern, Harborline, Northwind and, with Use ESPI on, Fernwick the demo reads the orders, accounts, recipients or trips, and builds the request only from what it read (at Fernwick, each shared meter's last seven days or its bills, through the ESPI-shaped tools). It never invents an identifier.
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

One thing a message can do with or without a model, because Iris reads it before either: connect a Company to the conversation, or remove one. "Connect with Lantern", "connect to the bank", "add Northwind" or "also Harborline Bank" connects one of the lab's Companies by name, up to three in a conversation; "disconnect from Juniper" or "remove Lantern" takes one out, and revokes its sign-in first. "Connect with Lantern and show me the menu" connects, then asks. A name Iris doesn't know is never made into an address: it says so and lists the lab's Companies. What the server takes and answers for several is in [A conversation and its Companies](chat-continuity.md#a-conversation-and-its-companies).

## Several Companies in one conversation

The page shows every Company of the conversation, up to three, and the person can add or remove one at any moment.

- **The Companies bar**, above the guide once there is a conversation, has one item for each Company: its mark (a small square in the colour of its own website), its name and its state in a few words ("Public access", "Signed in · read only", "Signed in · can propose changes", "Sign-in under way", "Access lost"). An item opens that Company's panel: what discovery found and "Inspect connection", its account controls (sign-in, Use FDX or Use ESPI and the grant, Request change permission, Sign out, the standing instruction), and "Remove from this conversation". **Add a company** offers the lab's Companies not yet connected and **Use another address**; a fourth is refused before anything is sent. Opening an item is a view only: it never decides which Company a message is for.
- **Removing** asks first, in the panel, when the Company is signed in or holds a proposal that waits, and says what goes ("Remove Lantern Noodle Bar from this conversation? That revokes the access you gave Iris at Lantern Noodle Bar, and what Iris read with your account there no longer shows."). The server removes at once, so this question is the confirmation; while an approval sent there has an unknown outcome the server refuses, and the panel shows its words. A line under the bar then says "Lantern Noodle Bar was removed from this conversation.", followed by the server's notice when the grant couldn't be revoked.
- **Messages** name the Company they came from, with its mark, once the conversation has had two: each answer ("Protocol demo · Lantern Noodle Bar"), each failed turn and each piece of Company content. Iris's own words (it connected or removed a Company, or asks "Which company is this for?") are labelled "Iris" and name none; their buttons send what they carry, never their label as words.
- **Which Company a message is for.** With several, Iris decides: today the Company of the last turn, or it asks with a button for each. A select beside the send button ("Iris decides", "For Lantern Noodle Bar") lets the person say so for one message; a suggestion picked under an empty conversation is for its Company too. When Iris works out the Company from the words, as it is to next, the screen stays as it is.
- **Account controls.** The Company the conversation is with (the last turn's, or the one just connected) has its account row at the end of the transcript, headed with its name, so a request that needs a sign-in there has "Sign in to Harborline Bank · read only" right under the answer. The others' are in their panels. Two sign-ins can be under way at once, each in its own tab.
- **Needs you** lists the proposals of every Company in the order they came, each card with its Company's mark and name, and every action goes to the card's Company.
- **The guide** speaks about one Company and names it in each sentence: the one whose proposal waits for the person, the newest first, and otherwise the one the last turn was with.
- **The Inspector** lists every line with its Company and offers a choice of Company, which shows that one's discovery, lines, profile and document. **History** lists each conversation with all its Companies.

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
  operations stay in the transcript. One card is open at a time: the first to
  arrive, until you open another by its title. The others are closed lines
  above it, each with its amount. A closed line whose proposal waits again
  says why before the amount: "Last approval refused", "Came back with new
  terms", "Iris’s approval declined" or "Standing instruction did not
  apply". The open card's Approve and Decline stay at the foot of the panel
  while its terms scroll behind them, and so does the note that says why a
  card still waits: the Company refused the approval or answered it with new
  terms, or your standing instruction did not apply.
  Where only the top of the card is in view, the buttons stay in view and
  cover the note until you scroll on. In a window up to 1100px tall the panel
  does not scroll inside the conversation. The page grows instead and moves
  to the panel, the card is shown whole, and the buttons stay at the foot of
  the window until you reach the end of the card. The message box is then
  below the card; the panel's button or Escape folds the panel and brings the
  window-sized chat back.
- **The approval card.** It leads with the amount being approved, which is also
  on the button ("Approve $28.00"), and quotes the Company's summary as the
  Company's own words, as text only. It warns when the summary names an amount
  the exact terms do not hold. That check reads amounts written with `$`, `€`
  or `£` and does not compare ones written "USD 9.99".
  - The amount is the first of `amount_due_cents`, `amount_cents`,
    `new_total_cents`, `total_cents` and `refund_cents` that the terms hold
    (a zero gives way to a later one), labelled by its field: "Amount due",
    "Amount", "Total", "Refund". A balance, a fee or a "before" value is
    never it.
  - An order's new total leads the card only when it is more than
    `before_total_cents`. A change that keeps the total costs nothing and one
    that lowers it returns money, so the card then leads with no amount and
    its button reads "Approve this change"; the previous total, the
    difference and the new total stay in its rows.
  - Juniper's and Lantern's terms have their own layout. Any other Company's
    terms are read from their shape: a field's name is its label, `*_cents`
    is money, `from_x` and `to_x` (or `x_before` and `x_after`) are one
    change shown before and after, and versions, IDs and keys stay under
    "All exact terms".
- **A standing instruction.** One rule per Company, set under the account row
  once change permission is granted: approve exchanges up to an amount without
  asking. It is kept in the browser (`localStorage`, under
  `poppy-lab:standing-instructions`, with the hour's approvals under
  `poppy-lab:auto-approvals`), is read as a rule of the User's and sends the
  same approve action a click would. The server does not know of it.
  - The limit is compared with the amount you pay or move
    (`amount_due_cents`, `amount_cents`, `new_total_cents` or `total_cents`),
    in the rule's currency. For a change to an order that is its new total,
    whether or not the card leads with it. **Every** other amount in the
    terms, nested ones and fees included, must be within the limit too.
  - A balance is not an amount: it says what an account holds. It is read
    only as a pair, before and after, and the change between the two must be
    within the limit. That is what lets the rule cover a bank transfer, whose
    terms hold the amount moved and four balances.
  - A bare `amount_cents` counts as moved only beside a balance that changes
    with it. An amount due and a total say by their names that they are
    paid; "amount" alone does not. Harborline's category change names the
    amount of a transaction already posted and no balance, and approving it
    moves nothing, so the rule leaves it to you: "Your standing instruction
    did not apply: it can't tell from the terms that the amount, $25.00, is
    paid or moved. It's up to you now."
  - It never covers a refund (a refund of zero, or a refund policy in words,
    is not one), terms with no amount to pay or move, an amount or a balance
    it can't read, an amount or a balance below zero (a price difference of
    -$6.00 is money coming back), a proposal that has expired or a summary
    that disagrees with the terms.
  - It makes at most 5 approvals an hour per Company and no more than three
    times the limit in total over that hour. The most a rule can allow is
    $1,000. When the hour's allowance is the reason, the operation waits
    for you.
  - A waiting change the rule left to you says why in one sentence, on its
    card and under "Standing instruction": over the limit (with both
    amounts), an amount below zero (with the amount), terms it can't read,
    the hour's allowance, or that the Company declined Iris's approval or
    answered it with new terms.
  - The log says "Applying your standing instruction" when it sends the
    approval, and the next line says how the Company answered. For a change
    the rule left to you it says "Standing instruction not applied", with
    the same reason as the card, once; a reload lists it as it was.
  - In demo mode the answer about a change is written while the Company
    still holds it, so it ends "The Company holds a change until you click
    Approve." Once Iris has approved that change on the rule, the same answer
    ends "Iris approved this change on your standing instruction, so there is
    nothing for you to approve."
  - Removing the rule, or clearing the site's storage, removes the rule and the
    hour's record; the limits are only as strong as the browser that keeps them.
- **What Iris did.** Under each answer, a list of its steps in plain words: what
  it read or sent, how (API, the Company's own agent, sign-in or setup) and
  with what access (view, or view and change). A request Iris stops before
  asking, because you are signed out or your sign-in lacks a permission, is
  listed as not asked ("Did not ask for /api/account/orders (sign-in needed);
  nothing was sent"), and the log has "Not sent" in place of the request.
- **The log.** The inspector lists the session's events with a time, their spec
  section, the method and address without its query, and an outcome read from
  the event's own words. Times are when the page received each event, and one
  turn's events arrive together. The lines are kept with the conversation, up
  to 400 of them, so a reload or the History view lists them again, with the
  time the server kept each (see [chat continuity](chat-continuity.md)). The
  trace can be copied or downloaded as text
  for an interop report; it holds no headers, bodies, tokens or keys. A request
  the Company refuses is logged after the request itself, with its status and
  error code and never the Company's words ("POST /api/account/payments ·
  refused by the Company · HTTP 409 insufficient_funds", labelled Declined);
  the chat's error names the same status and code, and the available balance
  or the limit when the Company gave one as a number. When the Company
  refuses a request you approved, the note on the approval card says the same
  ("Harborline Bank refused this request (HTTP 409, insufficient_funds;
  available balance: 4,220.00)"). The number is written as money ("$4,220.00")
  only when the Company's answer names its currency; none is assumed.
- **Failed messages and links.** A message that fails offers Try again, which
  puts its text back in the composer, and Remove. A link that carries a token
  or signature in its query or fragment is shown with "…" in its place; a
  secret inside the path itself cannot be recognised and is not hidden.

### What each of these looks like

The examples below are from the run in [A first run](#a-first-run): Elena
asks Juniper Market to move her recurring delivery to Saturday.

**The approval card**, in the "Needs you" panel:

```text
Change delivery day                                   Approval required
Juniper Market · grocery-demo.poppylab.dev · terms revision 1795610120-n19JJxSZnvGF54sY

Juniper Market says:
  Move Elena Maren's fictional delivery delivery_001 from Thursday to
  Saturday, recurring weekly. No charge (USD 0.00). No real shipment is
  affected.

Recurring delivery day
  Before  Thursday    →    After  Saturday
Change fee                 $0.00

› All exact terms

Approval covers only revision 1795610120-n19JJxSZnvGF54sY. Expires 25/11/2026, 13:45:20.
[ Approve this change ]   Decline
```

The domain sits beside the name because discovery proves the domain, not who
owns it. "All exact terms" opens the terms as the Company sent them. Once
approved, the card moves to the transcript as a closed entry, "Change
delivery day · Completed", which shows how it ended without a click: the
Company's result, quoted as its words ("Juniper Market says: Fictional
delivery delivery_001 now repeats weekly on Saturday. USD 0.00 charged. No
real shipment affected."), and who approved ("Approved by you." or "Approved
by Iris on your standing instruction."). A declined, refused, replaced or
expired entry says why nothing was done and what to do next; an expired one
reads "This proposal ran out before it was approved, so nothing was done. Ask
for the change again to get new terms." If an approval was sent before the
terms ran out, the entry says so instead: "This proposal was approved, but
Harborline Bank refused the approval and did nothing. Its terms then ran
out." or, for new terms nobody approved in time, "Harborline Bank returned
these terms instead of performing the ones that were approved. These terms
ran out before they were approved, so nothing was done." The guide's line
says the same about the last proposal. While a card still waits, what became
of an approval already sent (the Company refused the request) is a notice
right above its buttons.

**What Iris did**, under the answer that proposed the change:

```text
Company Agent conversations at https://grocery-demo.poppylab.dev/poppy/conversations    setup
Found 19 API tools at the Company                                                       setup
Sent a request to /api/account/delivery-change                                          API · view and change
Asked for your approval; nothing was done yet                                           API · view and change · waiting for you
```

**The log**, in the Inspector, for the same turn:

```text
13:22:03.971  Poppy 1.0 Session signed in · delegated ES256 Session header · Poppy-Version 1.0 · Poppy-Extensions "operations";v="3"   §5.2              OK
13:22:03.971  GET /poppy/tasks · tasks for this Session · 3 excluded · 2 skills listed                                                  §9                Note
13:22:03.971  Loaded 19 API tools; confirmation is never a model tool                                                                   §7                OK
13:22:03.971  POST /api/account/delivery-change · Poppy Session                                                                         §7                Note
13:22:03.971  Approval required · nothing performed                                                                                     Operations §4–6   Needs you
```

Each section number is a link to that section of the published text. The times are the same because one turn's events reach the page together.

**The downloaded trace** has the same events as text, oldest first, in UTC:

```text
Poppy Lab trace · Poppy 1.0 · Juniper Market
Recorded 2026-11-25T12:22:10.000Z

Discovery
- [passed] Company URL: https://grocery-demo.poppylab.dev
- [passed] Discovery document · Poppy 1.0 (§3): https://grocery-demo.poppylab.dev/.well-known/poppy.json · 10 ms

Session and API calls
- 2026-11-25T12:22:03.971Z (§7) POST /api/account/delivery-change · Poppy Session [info]
- 2026-11-25T12:22:03.971Z (Operations §4–6) Approval required · nothing performed [waiting]

Recorded: time, spec section, method, address without its query, and the event's own words.
Times are when this page received each event, or when the server kept it for events from before the page was loaded; one turn's events arrive together.
Never recorded: headers, bodies, tokens, Session JWTs, DPoP proofs, keys, codes or sign-in values.
```

**A standing instruction.** With "Approve exchanges up to (USD) 20" saved for
a Company, a covered proposal whose terms total $18.50 is approved by Iris:
the log shows "Applying your standing instruction" and, on the next line, how
the Company answered. One for $28.00 is not covered and waits in "Needs you"
with "Approve $28.00" on its button and the reason on its card: "Your
standing instruction did not apply: the total, $28.00, is over your limit of
$20.00. It's up to you now." The log says "Standing instruction not applied
· the total, $28.00, is over your limit of $20.00; waiting for you".

**A hidden link.** A Company's message with
`https://company.example/track?token=8f3a…` is shown as
`https://company.example/track?…`. The page prints the address as text, not as a link, and leaves the secret out.

The code is in `apps/playground/lib/` (`standing-instructions.ts`,
`auto-approval.ts`, `operation-presentation.ts`, `protocol-log.ts`,
`agent-steps.ts`, `link-display.ts`), each with its tests, and in
`apps/playground/app/playground/` (`conversation.tsx`, `inspector.tsx`,
`standing-instruction.tsx`, `fdx-consent.tsx`, `fdx-statements.tsx`).

## Evidence

276 automated tests pass across the workspace. New tests cover request-scoped keys, no key in model context, environment proxy isolation, safe configuration metadata and fixed-choice restoration. TypeScript, lint, build and formatting pass.

Browser checks used a fictional key only: save/collapse, refresh restoration, masked key field, exactly two options, no free model field and no horizontal overflow at 390px. Account state was injected through a browser fixture; no sign-in/approval/revocation or paid model requests were performed. Existing real purchases were not modified. Visual review was in-thread, without an independent reviewer.

`sonnet-5` is the exact requested identifier. It has not been live-validated with Anthropic; availability depends on the provider/account.

## Layout of the code (3 November 2026)

`apps/playground/app/playground/` holds the playground: `page.tsx` composes the views and owns the viewport and scroll effects; `use-playground.ts` is the state and the three server calls (discovery, chat, account actions) plus run restore and consent polling; `connection-setup.tsx`, `conversation.tsx`, `inspector.tsx` and `identity-panel.tsx` render one section each; `companies.ts` has the Company URLs, the sign-in visibility rule and the transcript types. The DOM, class names and ARIA are unchanged from the single-file version.

Since several Companies (26 November 2026): `company-state.ts` holds each Company's state and the steps that change it, `answers.ts` turns a chat answer into messages and Inspector lines, `companies-bar.tsx` is the bar and its panels, `account-row.tsx` one Company's account controls and `company-mark.tsx` its mark, each with its tests.

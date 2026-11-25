# Conversation-first Poppy Lab

The playground offers exactly two model choices: **OpenAI compatible · gpt-6-luna / low** and **Anthropic · sonnet-5**. OpenAI uses Responses with `reasoningEffort: low` and `store: false`. Model names are fixed in the UI. Older browser settings retain their provider/key when supported, but migrate to these model names. Other adapters and the deterministic demo remain available internally for existing tests; they are not UI choices.

## Setup

1. Open Model settings, choose a provider, paste an API key and Save model. The form closes automatically.
2. Enter the Company URL and Connect.
3. Use the conversation. Sign-in, permission expansion, sign-out, recovery and Operation approval/status widgets are inside the chat. So is **Use FDX**, for a Company that lists the `poppylab.dev/fdx` extension (Harborline). It is off by default, kept with the conversation, and starts a new Session when changed ([Use FDX](openapi-tools.md#in-the-playground-use-fdx)). Signed in with it on, the account row shows the FDX consent (its id, status, shared accounts and expiry) and **Revoke FDX consent**. That button turns into **Confirm revoke** and **Cancel** in place, with no browser dialog. Once the bank revokes it, the conversation is signed out as after Sign out, and the row says so and offers sign-in again. Inspector and Identity remain optional views. Company OAuth consent still opens the Company's own tab; Poppy never collects Company credentials in chat.

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

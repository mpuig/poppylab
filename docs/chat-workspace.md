# Conversation-first Poppy Lab

The playground offers exactly two model choices: **OpenAI compatible · gpt-6-luna / low** and **Anthropic · sonnet-5**. OpenAI uses Responses with `reasoningEffort: low` and `store: false`. Model names are fixed in the UI. Older browser settings retain their provider/key when supported, but migrate to these model names. Other adapters and the deterministic demo remain available internally for existing tests; they are not UI choices.

## Setup

1. Open Model settings, choose a provider, paste an API key and Save model. The form closes automatically.
2. Enter the Company URL and Connect.
3. Use the conversation. Sign-in, permission expansion, sign-out, recovery and Operation approval/status widgets are inside the chat. Inspector and Identity remain optional views. Company OAuth consent still opens the Company's own tab; Poppy never collects Company credentials in chat.

The API key and provider preference persist under `poppy.model.v1` in localStorage. This is **not encrypted**: scripts on the same origin and users of the browser profile can read it. Avoid shared devices; Forget saved settings removes this entry. It does not revoke the provider key or erase unrelated PAP account grants.

Browser keys go over a same-origin request to the server, then to the selected provider. They are request-scoped, not written to runs/vaults, included in messages/tool context or exposed in protocol traces. A browser OpenAI key uses the official OpenAI endpoint, not an environment-configured proxy. There is no arbitrary provider endpoint field.

## Local defaults without credential disclosure

In development on localhost/127.0.0.1, `/api/model` advertises whether a provider environment key exists, never its value. The form shows **Using local environment key**, and the adapter uses that key server-side unless a browser key overrides it. The raw environment key is deliberately **not prefilled into an HTML input or cached in the browser**. Existing `.env.local` values, including `OPENAI_MODEL=gpt-6-luna`, are not modified; the UI explicitly sends the chosen fixed model.

Remote/production requests cannot use this environment-key fallback. They must supply their own key. Existing public-chat/access-control gates remain: this change does not deploy or publicly enable the playground. It is not a multi-user production security review.

## Evidence

276 automated tests pass across the workspace. New tests cover request-scoped keys, no key in model context, environment proxy isolation, safe configuration metadata and fixed-choice restoration. TypeScript, lint, build and formatting pass.

Browser checks used a fictional key only: save/collapse, refresh restoration, masked key field, exactly two options, no free model field and no horizontal overflow at 390px. Account state was injected through a browser fixture; no sign-in/approval/revocation or paid model requests were performed. Existing real purchases were not modified. Visual review was in-thread, without an independent reviewer.

`sonnet-5` is the exact requested identifier. It has not been live-validated with Anthropic; availability depends on the provider/account.

## Layout of the code (3 November 2026)

`apps/playground/app/playground/` holds the playground: `page.tsx` composes the views and owns the viewport and scroll effects; `use-playground.ts` is the state and the three server calls (discovery, chat, account actions) plus run restore and consent polling; `connection-setup.tsx`, `conversation.tsx`, `inspector.tsx` and `identity-panel.tsx` render one section each; `companies.ts` has the Company URLs, the sign-in visibility rule and the transcript types. The DOM, class names and ARIA are unchanged from the single-file version.

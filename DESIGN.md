# Poppy Lab design system

## Lantern Noodle Bar website: ticket machine

The fictional noodle bar's read-only site (`apps/lantern/src/site.ts`): home (menu, slots, how ordering works, hours), `/for-agents`, and the consent page, all server-rendered with no JavaScript. The world is the shokkenki ticket machine at a ramen shop's door.

- **Palette:** warm wall `#f3efe6`; a navy machine panel `#17202a`; cream button tiles `#fbf7ee` with an amber edge light `#e4a11b`; red `#c62f1e` only as the header strip; rules `#d9d2c5`.
- **Type:** Big Shoulders Display (700–900, uppercase) for the name, headings and button labels; Manrope for prose; Sometype Mono only for prices (as embossed black labels), codes, times and the header tag. Fonts load from Google Fonts; the page and consent CSPs allow exactly those two origins.
- **Composition:** red strip with the wordmark, two links and the fictional tag; a 14ch headline; the machine panel with six dish buttons (3×2, numbered, name and price), four slot buttons (day and time) and a darker "tray" with the explanation and an amber "Order through your agent" link to the playground; then three-column sections (how ordering works; kitchen hours, slots, address) and a navy footer with the disclaimer. Two columns per row on phones.
- **Account area:** sign-in form as a white card; each order as a cream tile with the amber edge light, dish lines and totals with mono prices, a dashed-rule editor (slot select, quantity grid), and quiet secondary buttons; activity and connected agents as ruled lists.
- **Content rule:** the dishes, prices, slots and customers on the page come from the same `data.ts` the API serves.

## poppylab.dev home (`/`): registered post

The public home is a Persuade surface in its own world; the playground moved to `/playground` and keeps the system below.

- **World:** an agent request as a registered item. White ground `#ffffff`, navy ink `#121a2b` (soft `#2c3548`, muted `#4a5468`), postal yellow `#f6c514` (pressed `#e2b100`) as committed fields, rules `#d7dbe2`, mist `#f1f3f6`, and delivered green `#1f7a4d` for the stamp only.
- **Type:** Archivo, variable width, 112–120% for headings and the wordmark, weights 650–800, tracking −0.025 to −0.035em. Martian Mono only for codes, paths, scopes and spec sections.
- **First viewport:** headline and lead on the left, yellow "Open the playground" plus a ghost "See the test Companies". On the right, a sample tracking slip: a yellow head with a perforated edge (mask), code and generated barcode, From/To, the request, and a timeline whose state is a mark (filled tick, dashed ring for "Awaiting your signature"). **Sign for it** completes the last two steps and stamps "Delivered"; it is labelled as a sample.
- **Sections:** a route of three numbered stops on one ink line; the playground as a full-width yellow label; Juniper and Lantern as address labels with a mono code strip, barcode and tear line; "What stays below the model" as a ruled list; and "Bring your own agent" as a coded endpoint legend (code, what, where, spec), stacked on narrow screens. The footer is navy with the independence disclaimer.
- **Buttons:** 52px (40px in the bar), 8px radius; yellow primary, navy dark, ghost with a rule. Labels have 14px radii and one elevation each (border, or the slip's soft shadow). Focus rings are 3px ink (yellow on the footer); selection is yellow.
- **Motion:** one entrance, the slip's steps arriving with a stagger from an already-visible state (opacity 0.25, 6px, 2px blur, ease-out expo), and the stamp landing. Reduced motion shows everything at rest.
- **Playground (`/playground`):** the same world in Operate mode. A cool canvas `#f7f8fa` with white working surfaces, the same navy and yellow tokens, Archivo for UI and Martian Mono for codes and the Inspector's spec badges. The send button is yellow; the selected tab is navy; errors use `#b3261e`. On phones the header is one row (wordmark and three compact tabs). The layout and behaviour below are unchanged.
- **Content:** URLs for the Companies come from `NEXT_PUBLIC_JUNIPER_URL`/`NEXT_PUBLIC_LANTERN_URL`; "Connect in the playground" links to `/playground?company=…`, which only prefills the URL.

## Direction

A minimal, form-first playground inspired by the clarity of papplayground.com. This direction replaces the earlier Protocol Tracing Table at the user's request. Developer visibility remains available through progressive disclosure rather than a prominent topology drawing.

## Layout

- A quiet, 1080px-wide header contains the wordmark and three working views: Playground, Inspector, and Identity.
- Main content has a 780px maximum width with a simple title and one-sentence explanation.
- The Playground begins with a collapsible Model settings form, Company URL, and a single Connect action. Only OpenAI compatible (gpt-6-luna, low) and Anthropic (sonnet-5) are offered; model names are fixed. Saving settings closes the form.
- Chat is the primary working surface. The workspace occupies the visible viewport; the conversation box closes 24px above the window edge (12px on phones, plus the safe area) while the transcript scrolls independently. Setup has bounded overflow when expanded, and the introductory heading recedes after messages arrive.
- Discovery checks, timing, API events, and the raw document live in the Inspector.
- Public client metadata and JWKS links live in Identity.
- Changing views preserves the current connection, conversation, provider, and draft message.

## Visual system

One self-hosted Source Sans 3 family, restrained weights, and a compact type scale. The background is off-white `#f8f8f5`; working surfaces are `#fefefd`; primary text is charcoal `#272923`. Muted text is `#696d64`, rules are `#dddfd6`, and a subdued red `#a43e31` marks the send action and errors. Verified connection states use green `#41624d` with a check symbol and text.

Inputs have 6px corners; the single conversation surface has 12px corners and a border, without shadows. No drawing grids, decorative coordinates, topology nodes, or oversized headings remain.

## Interaction and accessibility

Visible labels, keyboard focus rings, explicit loading/disabled/error states, and polite live updates remain. Enter submits a message; Shift+Enter inserts a line break. Composition events are respected for IME users. Empty-state suggestions fill the composer but never trigger paid requests automatically. Reduced-motion preferences disable activity animation.

Model settings sits above Company URL and Connect. Its provider/key fields stack on mobile. Account access, permission expansion, sign-out, errors and Operation widgets live inside the conversation, not above it. All views and provider choices remain accessible; long URLs and responses wrap without horizontal page overflow.

## Juniper customer website

The Company account at `/account` preserves Juniper’s warm paper and forest-green identity, with restrained serif headings and flat, ruled sections. It serves the customer Operate use case: inspect the same persisted basket, recurring delivery, orders and recent agent activity. Desktop pairs basket and delivery in unequal columns; mobile stacks them. Prices use localized currency, line items are readable, order details expand natively, and polling has visible retry/logout states. Pending proposals never appear as committed account changes. The landing page links to customer login. The service foundation adds billing derived from actual fictional orders, a versioned fictional profile editor, public FAQs and a working help/case area. Support uses an unequal two-column list/form layout on desktop and stacks on mobile; messages expand natively and are labeled as automatic test responses. Optional order linkage uses actual account-order choices, not manual opaque-ID entry. Agent activity is collapsed by default to avoid turning the customer account into a protocol log. The profile pairs current contact data with an on-demand editor; drafts and opening versions stay stable during polling. Conflict copy preserves the draft and offers an explicit reload of current data. Agent profile reviews show exact name/email/address before and after, while existing orders retain historical destinations. Basket and recurring delivery now have independent on-demand quantity editors, with native bounded number inputs and a weekday select for recurrence. Editors capture their opening entity version and preserve drafts across polling; explicit reload/cancel/save controls distinguish replacing a draft from committing it. Saved totals are explicitly labeled as not previewing drafts. Neither editor creates orders. Login and Company consent now use native selectors for Alex, Maya and Leo. The customer account explicitly labels its persona and offers a switch-account link. A flat Connected agents section exposes active agent grants only on request, with scope/expiry and explicit revocation; copy distinguishes revocation from website logout. Forms are bound to their opening page account so stale tabs cannot save into another persona.

## Juniper consent

The Company consent page uses Juniper's warm paper, forest-green text and serif heading rather than unstyled OAuth markup. A bounded two-column form separates the fictional account selector from permissions; at 680px it stacks into a single reading order. The permission list explicitly covers shopping, profile/address, billing and support messages. Optional write access remains a native checkbox, with separate-approval guidance always visible. Read-only choice, nonce/PKCE binding and existing grants are unchanged. Actions have 48px targets, a quiet Don't allow button and a dark Allow access button; declining bypasses password field validation without bypassing server-side consent binding. The page needs no JavaScript or remote assets.

## Permission requests and recovery

New Poppy sign-ins request read-only access. A separate Request change permission action opens Company consent for read/write; its helper explains that the user asks for the change again afterwards and approves it separately. Existing grants are not silently changed. The Juniper consent renderer only describes requested scopes: no write checkbox for read-only, and no read claim for write-only. The account row reflects granted permissions. Polling uses a completed-consent counter, not the previous account's signed-in flag. Unavailable access, insufficient scope, expired proposals and uncertain outcomes have distinct recovery copy; unknown outcomes point to Check status rather than another purchase.

## Ample account access

The in-chat account controls distinguish Ample's real infrastructure account from Juniper's fictional personas. They name the requested servers:read and budgets:read permissions and explicitly exclude deployments, commands and credential tools. Granted scopes are shown rather than assumed. A partial grant offers Request remaining read access, not a write-permission action. OAuth stays in the Company's own consent tab; no credentials are collected in chat. MCP tools cannot confirm Operations or mutate infrastructure.

## Product honesty

Demo is explicitly labeled as having no LLM. Optional Company sign-in uses a separate Juniper consent tab and a clearly fictional account. Delivery, basket, and checkout proposals appear inside the chat with exact terms, revision, expiry, and explicit Approve/Decline/Check status controls. Still-valid saved runs restore their bounded conversation and connection on refresh. Active proposals expand to show Company summaries, before/after quantities or days, formatted prices and readable line items. Complete structured terms remain available on demand. Completed, declined and expired records are collapsed by default. Sandbox order/booking reviews include observed before/after dates, product replacements/additions, card text, rate plans and declared cancellation conditions. Missing observed prior values are labeled rather than invented; prior totals may be calculated only from the Company's declared new total and price difference, with the calculation explicitly labeled. Before snapshots have source/time provenance, are separate from Company terms and are marked unversioned when the API provides no account version. The model cannot confirm changes; completed results are shown as Company results. Only public identity metadata is linked, and protocol secrets never appear in the Inspector.

# Poppy Lab design system

## The four fictional Companies: what they share

Each Company keeps its own visual world (below), because they stand for different businesses and the demo is only convincing if one agent works across sites that look nothing alike. Three things are the same on all four:

- **The demo strip (`labBarHtml` in `pap-core`):** a thin navy band above the Company's own header on every public and account page: "Demo · {Company} is a fictional company in Poppy Lab. Nothing here is real.", with "Try it with an AI agent" (the playground with this Company prefilled) and "What is this?" (the lab home). It carries its own inline styles and a system font, so it never borrows the Company's identity, and it has no script. Because the strip says the site is fictional, headers no longer carry "Fictional test Company · Poppy 1.0" tags.
- **The Company's own voice:** home pages speak as the business would (a shop front, a menu, a bank, an airline) with real content from the same data the APIs serve. Each has one section that announces personal agents the way a real company would ("Shop with your personal agent"), with a "Try it with Iris, the demo agent" action. Endpoints, scopes, spec sections and test customers live on `/for-agents`, which all four now have.
- **The same two people:** every Company has the same two test customers, Elena Maren (listed first) and Robin Ito, so a visitor is one person with one agent at four companies. Their account IDs are `elena` and `robin` everywhere.
- **Plain account pages:** sign-in says there is no password and nobody's identity is checked; the page shows "Signed in as …, a test customer"; proposals are approved "in your agent"; grants are "connected agents" that can be disconnected. Entity versions, internal IDs and timestamps in the viewer's time zone are not shown.

The footer keeps each Company's fiction notice and the shared "Part of Poppy Lab" line.

## Northwind Air website: synoptic route chart

Northwind Air (`apps/northwind/src/site.ts`) is a fictional airline site and account portal built as a working weather-route briefing rather than a destination-photo template. The search form opens `/flights`, a results page for people built from the same search the API uses; times are airport local time.

- **Palette:** pale chart sky `#dbeaf0` and paper `#f7f4ea`; pressure ink `#102a38`; route blue `#1d6882`; weather-line blue-gray `#91aab4`; sun yellow `#efb73e` for committed actions; restrained red and green for errors and current state.
- **Type:** Barlow Condensed for compressed operational headings, Figtree for readable interface prose and Azeret Mono for flight numbers, times, prices, scopes and status. The site and consent CSPs allow only Google Fonts' stylesheet and font origins.
- **First viewport:** curved isobars and one dashed route fill a pale chart field. A large, compact headline sits left; a real origin/destination/date search form sits right and submits to the signed-out flight-search API. The no-real-ticket notice remains visible in the offer, not buried in the footer.
- **Structure:** a dark three-part capability band follows the search; a ruled departure board uses the same schedule and prices as the APIs; travel information is a varied three-column passage; the final yellow strip sends visitors to Iris. `/for-agents` uses the same typographic chart language for endpoints, scopes and personas.
- **Account:** the portal is a precise Operate surface: an unequal trip/sidebar grid, ruled segment rows, loyalty and preferences as compact facts, agent activity below the trip, and connected grants on demand. It polls the same tenant state every two seconds and never presents a pending proposal as completed.
- **Consent:** requested scopes appear as a ruled manifest. Read-only consent has no change control; a write request has one explicit checkbox covering reversible preferences and consequential booking changes, while explaining that every mutation still needs separate exact approval.
- **Responsive behavior:** the hero becomes one column, the dark capability band becomes stacked rows, departure times yield before route/fare data, and the account sidebar follows trips. Controls keep 50px targets and focus uses the sun-yellow chart mark.
- **Motion:** no decorative animation is required; state change is the portal's live refresh. The route chart remains legible with reduced motion because its diagram is static.
- **Content rule:** schedule, fares, personas, booking references, loyalty balances and notices come from `data.ts` and the same business projection used by OpenAPI routes. Every surface says the data is fictional and that no real ticket is sold, changed, cancelled or charged.

## Lantern Noodle Bar website: ticket machine

The fictional noodle bar's read-only site (`apps/lantern/src/site.ts`): home (menu, slots, how ordering works, hours), `/for-agents`, and the consent page, all server-rendered with no JavaScript. The world is the shokkenki ticket machine at a ramen shop's door.

- **Palette:** warm wall `#f3efe6`; a navy machine panel `#17202a`; cream button tiles `#fbf7ee` with an amber edge light `#e4a11b`; red `#c62f1e` only as the header strip; rules `#d9d2c5`.
- **Type:** Big Shoulders Display (700–900, uppercase) for the name, headings and button labels; Manrope for prose; Sometype Mono only for prices (as embossed black labels), codes, times and the header tag. Fonts load from Google Fonts; the page and consent CSPs allow exactly those two origins.
- **Composition:** red strip with the wordmark, two links and the fictional tag; a 14ch headline; the machine panel with six dish buttons (3×2, numbered, name and price), four slot buttons (day and time) and a darker "tray" with the explanation and an amber "Order through your agent" link to the playground; then three-column sections (how ordering works; kitchen hours, slots, address) and a navy footer with the disclaimer. Two columns per row on phones.
- **Account area:** sign-in form as a white card; each order as a cream tile with the amber edge light, dish lines and totals with mono prices, a dashed-rule editor (slot select, quantity grid), and quiet secondary buttons; activity and connected agents as ruled lists.
- **Content rule:** the dishes, prices, slots and customers on the page come from the same `data.ts` the API serves.

## Harborline Bank website: tide ledger

Harborline's public site, consent page and customer portal (`apps/harborline/src/site.ts`, `portal.ts`) use a daylight harbor master's ledger as an information system, not maritime decoration. The landing page is Persuade; consent and the portal are Operate.

- **Palette:** chalk paper `#f4f7f5`, white working sheets, channel blue `#073b5c` and deep blue `#062b43`, buoy orange `#ed6b2f` for the primary action and safety band, sea-glass `#b8ddd4`/`#1f6e65` for healthy state, and `#a7352c` only for warnings. Thin blue-grey rules keep the dense records legible.
- **Type:** Barlow Condensed (600–800, uppercase) gives the bank name and headings the compressed lettering of a harbor notice board. Public Sans carries prose and controls. Native tabular numerals carry money; monospace is reserved for scopes and endpoints.
- **First viewport:** a compact blue masthead above a two-column composition. The left names the Poppy 1.0 banking proposition, explicit no-real-money/no-real-data warning, and the connect/portal actions. The right is a full fictional customer ledger showing two owned accounts, a transaction, a card status and budget progress from the same seed the APIs serve.
- **Structure:** capabilities are ruled manifest rows rather than equal cards: read-only records, reversible organization/card changes, and irreversible payment/transfer requests. Persona summaries are two joined ledger panels. The `/for-agents` page uses the same manifest grammar for scopes and protocol runs.
- **Consent:** the Company's own page names the verified client host, always includes read permissions that were requested, gives each reversible or irreversible change scope its own checked control, and leaves `offline_access` off by default. Copy repeatedly distinguishes permission from the later exact Operations v3 approval.
- **Portal:** account balances, transactions, budgets, cards, recipients, operation activity and connected grants are flat ruled lists in two unequal columns. It polls every two seconds, exposes retry/logout states, and labels the current fictional persona. The portal and APIs read the same tenant state; pending proposals never render as committed changes.
- **Responsive/accessibility:** the hero and account grid become one column below 900px; manifest metadata moves under its description; controls retain 48px targets, visible orange focus rings and explicit loading/error status text. Selection, links and tabular figures are themed.
- **Honesty:** every surface says no real money moves and no real banking data or credentials should be entered. No real institution, payment rail or identity verification is implied.

## poppylab.dev home (`/`) and `/developers`: registered post, decluttered

The public home is a Persuade surface for readers with no protocol vocabulary; `/developers` holds everything technical. The playground at `/playground` keeps the system below.

- **World:** the registered-post identity reduced to type, rules and one accent. White ground `#ffffff`, navy ink `#121a2b` (soft `#2c3548`, muted `#4a5468`), rules `#d7dbe2`, mist `#f1f3f6`. Postal yellow `#f6c514` (pressed `#e2b100`) appears only on the primary button, the waiting step of the sample request and the two user actions in the diagram. No barcodes, perforations, dashed borders, offset shadows or boxed mono tags.
- **Type:** Archivo, variable width, 112–118% for headings and the wordmark, weights 650–800, tracking −0.025 to −0.035em. Martian Mono only on `/developers`, for codes, paths and spec sections.
- **Structure:** sections are separated by a 1px rule and built from ruled columns rather than cards: a 2px ink rule above a column, 1px rules between rows. Section heads pair the h2 with a short paragraph on the right. The only bordered object on the home is the sample request in the hero.
- **Home order:** hero (eyebrow, headline, one-sentence definition, "Try the live demo" and "Why it exists", with the interactive sample request on the right); "Today it is all or nothing" as a five-column ladder from Blocked to Full access, the three middle steps ruled in ink; "How it works" as the three-party diagram above three numbered steps; "What each side gets" for people, companies and agent builders; "Try it in four industries" as a two-column ruled list led by the sentence to ask; "What the AI can never do"; a closing row with both calls to action. The footer is navy with the independence disclaimer.
- **Diagram (`flow-diagram.tsx`):** inline SVG, three nodes and four orthogonal connectors on a 4px grid with 8px elbows, labels on opaque yellow tags only for the two things the person does (sign in, approve). The person is the solid ink node, the agent is outlined, the company is mist. It is hidden below 720px, where the three steps carry the same facts.
- **`/developers`:** a compact hero; "Test a Company with Iris" as a paragraph beside a ruled fact list; the four Companies as a ruled table (host, scopes, customers, links; it scrolls sideways on phones); "Bring your own agent" as the endpoint legend (code, what, where, spec; stacked on narrow screens); "What the lab implements" as a ruled list with spec references.
- **Vocabulary:** the protocol is "Personal Agent Protocol" or "Poppy", never "PAP". The home writes "personal agent" and "company" in lower case, as the protocol's own home does; `/developers` and the playground capitalise the spec's defined terms. Iris is introduced once per page as the lab's personal agent; generic explanation says "your agent".
- **Buttons:** 52px (44px small), 8px radius; yellow primary, navy dark, ghost with a rule. Focus rings are 3px ink (yellow on the footer); selection is yellow.
- **Motion:** one entrance, the sample request's steps arriving with a short stagger from an already-visible state. Reduced motion shows everything at rest.
- **Shared chrome:** `site-chrome.tsx` holds the bar, the footer and the Company data both pages render.
- **Playground (`/playground`):** the same decluttered world in Operate mode. White ground and working surfaces, the same navy and yellow tokens, Archivo for UI and Martian Mono only for code, timings and the Inspector's spec references. The header matches the home's bar (same edges, 72px, wordmark with no tag); the three views are text tabs with a 2px ink rule under the current one. The conversation is the one bordered object (1px rule, 14px radius, no shadow). Inspector sections and the Identity list are ruled: a 2px ink rule under the heading, 1px rules between rows. Message labels, the "Company content" mark and spec references are plain text, without boxes. The send button is the only yellow; Connect and approvals use the navy button; errors use `#b3261e`. On phones the header is one row (wordmark and three compact tabs). The layout and behaviour below are unchanged.
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

## Company messages in the chat

What the Company's own agent says (§8) appears as separate transcript entries before Iris's answer. They are indented behind a 2px rule in `--line`, headed with the Company's name and "automated agent" (or the person's name) in the mono label style, and marked with a small "Company content" badge so they never read as Iris speaking. Structured `data` stays collapsed under a native "Data" disclosure with a bounded, scrollable mono block. A short muted note marks what the entry asked for: sign-in, or an operation to approve in the usual card below.

## Interaction and accessibility

Visible labels, keyboard focus rings, explicit loading/disabled/error states, and polite live updates remain. Enter submits a message; Shift+Enter inserts a line break. Composition events are respected for IME users. Empty-state suggestions fill the composer but never trigger paid requests automatically. Reduced-motion preferences disable activity animation.

Model settings sits above Company URL and Connect. Its provider/key fields stack on mobile. Account access, permission expansion, sign-out, errors and Operation widgets live inside the conversation, not above it. All views and provider choices remain accessible; long URLs and responses wrap without horizontal page overflow.

## Juniper customer website

The shop front (`home.ts`) and `/for-agents` share the account's frame: warm paper, forest green, Georgia serif headings, flat ruled sections, and one header nav (Shop, Help, For agents, Your account). The home shows the week's shelf with prices and stock, delivery terms and hours from the API's own data, and "Shop with your personal agent".

The Company account at `/account` preserves Juniper’s warm paper and forest-green identity, with restrained serif headings and flat, ruled sections. It serves the customer Operate use case: inspect the same persisted basket, recurring delivery, orders and recent agent activity. Desktop pairs basket and delivery in unequal columns; mobile stacks them. Prices use localized currency, line items are readable, order details expand natively, and polling has visible retry/logout states. Pending proposals never appear as committed account changes. The landing page links to customer login. The service foundation adds billing derived from actual fictional orders, a versioned fictional profile editor, public FAQs and a working help/case area. Support uses an unequal two-column list/form layout on desktop and stacks on mobile; messages expand natively and are labeled as automatic test responses. Optional order linkage uses actual account-order choices, not manual opaque-ID entry. Agent activity is collapsed by default to avoid turning the customer account into a protocol log. The profile pairs current contact data with an on-demand editor; drafts and opening versions stay stable during polling. Conflict copy preserves the draft and offers an explicit reload of current data. Agent profile reviews show exact name/email/address before and after, while existing orders retain historical destinations. Basket and recurring delivery now have independent on-demand quantity editors, with native bounded number inputs and a weekday select for recurrence. Editors capture their opening entity version and preserve drafts across polling; explicit reload/cancel/save controls distinguish replacing a draft from committing it. Saved totals are explicitly labeled as not previewing drafts. Neither editor creates orders. Login and Company consent now use native selectors for Elena and Robin. The customer account explicitly labels its persona and offers a switch-account link. A flat Connected agents section exposes active agent grants only on request, with scope/expiry and explicit revocation; copy distinguishes revocation from website logout. Forms are bound to their opening page account so stale tabs cannot save into another persona.

## Juniper consent

The Company consent page uses Juniper's warm paper, forest-green text and serif heading rather than unstyled OAuth markup. A bounded two-column form separates the fictional account selector from permissions; at 680px it stacks into a single reading order. The permission list explicitly covers shopping, profile/address, billing and support messages. Optional write access remains a native checkbox, with separate-approval guidance always visible. Read-only choice, nonce/PKCE binding and existing grants are unchanged. Actions have 48px targets, a quiet Don't allow button and a dark Allow access button; declining bypasses password field validation without bypassing server-side consent binding. The page needs no JavaScript or remote assets.

## Permission requests and recovery

New Poppy sign-ins request read-only access. A separate Request change permission action opens Company consent for read/write; its helper explains that the user asks for the change again afterwards and approves it separately. Existing grants are not silently changed. The Juniper consent renderer only describes requested scopes: no write checkbox for read-only, and no read claim for write-only. The account row reflects granted permissions. Polling uses a completed-consent counter, not the previous account's signed-in flag. Unavailable access, insufficient scope, expired proposals and uncertain outcomes have distinct recovery copy; unknown outcomes point to Check status rather than another purchase.

## Ample account access

The in-chat account controls distinguish Ample's real infrastructure account from Juniper's fictional personas. They name the requested servers:read and budgets:read permissions and explicitly exclude deployments, commands and credential tools. Granted scopes are shown rather than assumed. A partial grant offers Request remaining read access, not a write-permission action. OAuth stays in the Company's own consent tab; no credentials are collected in chat. MCP tools cannot confirm Operations or mutate infrastructure.

## Product honesty

Demo is explicitly labeled as having no LLM. Optional Company sign-in uses a separate Juniper consent tab and a clearly fictional account. Delivery, basket, and checkout proposals appear inside the chat with exact terms, revision, expiry, and explicit Approve/Decline/Check status controls. Still-valid saved runs restore their bounded conversation and connection on refresh. Active proposals expand to show Company summaries, before/after quantities or days, formatted prices and readable line items. Complete structured terms remain available on demand. Completed, declined and expired records are collapsed by default. Sandbox order/booking reviews include observed before/after dates, product replacements/additions, card text, rate plans and declared cancellation conditions. Missing observed prior values are labeled rather than invented; prior totals may be calculated only from the Company's declared new total and price difference, with the calculation explicitly labeled. Before snapshots have source/time provenance, are separate from Company terms and are marked unversioned when the API provides no account version. The model cannot confirm changes; completed results are shown as Company results. Only public identity metadata is linked, and protocol secrets never appear in the Inspector.

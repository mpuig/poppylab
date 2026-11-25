# Conversation continuity and viewport composer

## Conversations have addresses

Each conversation with a Company is one run, and its ID is the page's address: `/playground/<id>`. `/playground` is a new, empty conversation; connecting to a Company starts the run and puts its ID in the address. The ID is a name, not a key: the server looks it up under the visitor's cookie, so the address opens nothing in another browser (the page says so and offers a new conversation).

- **Running:** 30 minutes from its start, at most five at a time. Requests name it in the `X-Poppy-Conversation` header; the server answers with the same header, so a conversation that had to be started again (the old one ended) moves the address to the new ID. No cookie names a run any more.
- **Ended:** when it expires, is pushed out by a sixth, or the demo is reset, a conversation becomes read-only. Its tokens, keys, Session and pending sign-in are removed; the transcript, the Company and how its proposals ended stay. It is kept for seven days from its start, up to 20 conversations per visitor (the oldest ended ones go first). One in which nothing was said or signed in is dropped instead.
- **Transcript:** `history` is still cut to the model's last ten turns; `transcript` keeps the conversation for the page and resets wherever `history` does (sign-in, sign-out). It holds what the page showed, so a reload or the History view shows it again: the User's words (those said in a Direct Conversation marked as such), each Company content entry with its author, and each answer with its label, its "What Iris did" steps and its "Data". None of that goes into `history`: the model is sent a turn's words only, and never Company content or the User's direct words. The transcript is bounded (`TRANSCRIPT_LIMITS` in `lib/transcript.ts`): 200 entries, 12,000 characters of words and 20,000 of data per entry, 30 steps per answer, and 256 KB in all. Over that, the oldest data goes first, then the oldest steps, then the oldest entries. It holds no tokens, headers or request bodies.
- **History view:** lists them (`GET /api/conversations`: names and times only) and links to each address.
- **Reset demo data:** a new conversation keeps what earlier ones changed at the Companies, because a Company's copy of its test customers belongs to the User ID Iris presents. The reset stores a new per-visitor epoch that goes into that User ID (`userFor`), so every Company meets the visitor as a new person and gives a fresh copy on the next connection. Running conversations end, since their Sessions belong to the person before. Locally the Companies share one copy unless `COMPANY_ISOLATION=visitor`, so the reset shows fresh data only on the deployed, per-visitor Companies.

## Sign-in

The callback previously cleared every history entry on successful consent, and the UI polling path independently called `setMessages([])`. First sign-in now snapshots and retains the pre-account conversation (bounded to the existing 10-message model history). Polling renders the server's returned history. Refresh uses the same persisted history.

Later consent may select a different account, so it retains only this public prefix, never private account turns or pending approvals. Legacy signed-in runs without a recorded public prefix fail closed and do not carry private history across consent. Sign out clears both histories. Messages already discarded by the old behavior cannot be recovered from the run.

Callback regressions cover initial public continuity, immutable copy, later account-context separation, invalid grants and failed consent. Browser fixture test confirmed both prior messages remain after the simulated consent completion; no real grants issued.

## Composer

The run view is a viewport-height flex workspace. Main/conversation/transcript use `min-height: 0` so content can shrink inside the available height; the transcript owns scrolling, not the document. Composer and conversation header do not shrink. Setup scrolls within its own bound when expanded. The introductory heading disappears once the conversation has content; the secondary note/footer do not occupy bottom space in run view. Inspector and Identity retain normal document scrolling.

Height follows `visualViewport.height` when available, with a dynamic viewport fallback and safe-area padding. This supports a shrinking visual viewport, but real mobile keyboard behavior has not been tested on hardware.

Measured browser fixtures:

- 1044×798: composer bottom 798, document height 798; transcript scrollable.
- 390×844: composer bottom 844, document height 844; no horizontal overflow.
- 390×500: composer bottom 500, transcript remains visible (135px).
- New message + fixture reply: composer unchanged at 798 and transcript scrolled to the latest reply.
- Expanded mobile model settings: composer stays at 844; setup becomes scrollable.

Review in-thread, no independent reviewer. Two paired screenshot batches; detector `[]`. Final captures: `screenshot-1792514066758.png` and `screenshot-1792514091954.png` under the agent-browser screenshots directory. On desktop-to-mobile resize the transcript did not consistently stay at its absolute bottom; the composer remained correctly pinned. New messages scroll to the latest content. No more visual polishing in this pass.

Validation: 278 workspace tests (110 Playground tests), typecheck, lint, production build and formatting pass. No paid model calls or business changes used.

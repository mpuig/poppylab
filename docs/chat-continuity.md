# Conversation continuity and viewport composer

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

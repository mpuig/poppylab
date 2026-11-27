/**
 * When the message box takes the focus back. After the person sends a
 * message, presses one of Iris's quick replies or decides a proposal from
 * the keyboard, the box is given the focus again once it can take it (it
 * is disabled while a turn runs), so they can type again without
 * clicking. Only when the focus went nowhere on purpose: it fell to the
 * page as the control that had it was disabled or went, or it is still
 * on the control that was pressed. Never when the person has moved to
 * another field, the inbox, a dialog or a sign-in window, and never on
 * page load: nothing asks for it then. Plain data.
 */

/** What of the focused element decides it: a DOM element has all of it. */
export type Focused = {
  tagName: string;
  closest(selector: string): unknown;
};

/** Where the focus may be left behind by the action that was pressed. */
const PRESSED =
  ".composer, .message-choices, .operation-actions, .ask-actions, .suggestions";

/** Somewhere the person went on purpose. */
const AWAY =
  ".pending-inbox, [role='dialog'], dialog, input, select, textarea, [contenteditable='true']";

/**
 * Whether the box should take the focus back, given what has it now
 * (`document.activeElement`), and whether this page's window has it at
 * all (a sign-in tab has it otherwise).
 */
export function focusGoesBack(
  active: Focused | null,
  windowHasFocus = true,
): boolean {
  if (!windowHasFocus) return false;
  if (!active || /^(BODY|HTML)$/i.test(active.tagName)) return true;
  // The box itself, or the send button beside it.
  if (active.closest(".composer")) return true;
  if (active.closest(AWAY)) return false;
  return !!active.closest(PRESSED);
}

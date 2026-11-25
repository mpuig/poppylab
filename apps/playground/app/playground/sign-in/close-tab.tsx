"use client";

/**
 * Closes the sign-in tab. A browser lets a page close only a tab that a
 * script opened, which is how the playground opens this one; anywhere else
 * the button does nothing and the sentence above it still says what to do.
 */
export function CloseTab() {
  return (
    <button
      type="button"
      className="ghost-button"
      onClick={() => window.close()}
    >
      Close this tab
    </button>
  );
}

import { Fragment, type ReactNode } from "react";

/**
 * The model's own text with the two Markdown marks models use most:
 * `**bold**` and `` `code` ``. Built from React elements, never HTML, so the
 * text can't inject markup. Everything else stays as written. Company
 * content doesn't go through this: it's shown verbatim.
 */
export function inlineText(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^\s*](?:[^*\n]*[^\s*])?\*\*|`[^`\n]+`)/g)
    .map((part, i) =>
      part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

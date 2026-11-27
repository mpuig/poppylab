/**
 * "sign out of Harborline", "sign in to Lantern", typed in the chat. The
 * agent asks before either: a sign-out revokes the access the User gave
 * and takes back what was read with it, and a sign-in opens the
 * Company's own page, which only the User's browser or app can open.
 * Only the User's message is read here, as for `connect-command.ts`.
 *
 * English only. The words count only when nothing but a connected
 * Company's name follows them, or nothing at all: "sign in to see my
 * balances" is a request to a Company, and goes on as one.
 *
 * Plain data and no I/O.
 */
import { namedPlainly, type Nameable } from "./company-names";

export type AccountCommand = {
  verb: "signin" | "signout";
  /** The Companies the words name: none when they name none. */
  named: Nameable[];
};

const MANNERS =
  /^(?:(?:hey|hi|ok|okay|please)[,!]?\s+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i(?:'d|’d| would)\s+like\s+to\s+|i\s+want\s+to\s+|let\s+me\s+)?/i;
const WORDINGS = [
  {
    verb: "signout" as const,
    start: /^(?:sign|log)\s*(?:out|off)\b(?:\s+(?:of|from|at)\b)?\s*/i,
  },
  {
    verb: "signin" as const,
    start: /^(?:sign|log)\s*in\b(?:\s+(?:to|at|with|into)\b)?\s*/i,
  },
];

/** What the message asks of the User's sign-ins, if it does. */
export function accountCommand(
  message: string,
  connected: readonly Nameable[],
): AccountCommand | undefined {
  const text = message.trim().replace(MANNERS, "");
  for (const { verb, start } of WORDINGS) {
    const begins = start.exec(text);
    if (!begins) continue;
    const rest = text
      .slice(begins[0].length)
      .replace(/[.!?]+$/, "")
      .replace(/\s+(?:please|now|for me)$/i, "")
      .trim();
    if (!rest || /^(?:please|now)$/i.test(rest)) return { verb, named: [] };
    const named = namedPlainly(rest, connected);
    return named.length ? { verb, named } : undefined;
  }
  return undefined;
}

/**
 * What Iris says when the model wrote no answer to a turn, even asked once
 * more from what its tools returned (`runModel`): what was done, in the
 * conversation's language, and what the User can do next. It is worked out
 * from the calls the turn made, never from what a Company said in them.
 *
 * Plain data and no I/O.
 */
import type { Language } from "./language";
import { say } from "./lines";

/** One call the turn made: the Company's name, the tool, what it answered. */
export type MadeCall = { company: string; tool: string; output: unknown };

/** A proposal that waits for the User (Operations v3), however it was sent. */
const proposes = (output: unknown) => {
  try {
    return /"approval_required"/.test(JSON.stringify(output) ?? "");
  } catch {
    return false;
  }
};

export function noAnswer(language: Language, calls: readonly MadeCall[]) {
  const at = (kept: readonly MadeCall[]) => [
    ...new Set(kept.map((c) => c.company)),
  ];
  const proposed = calls.filter((c) => proposes(c.output));
  if (proposed.length)
    return say(language, "noAnswer", { names: at(proposed), did: "proposed" });
  const own = calls.filter((c) => !c.tool.endsWith("connect_company"));
  if (!own.length)
    return say(language, "noAnswer", { names: [], did: "nothing" });
  const asked = own.filter((c) => /company_agent_/.test(c.tool));
  return asked.length === own.length
    ? say(language, "noAnswer", { names: at(asked), did: "agent" })
    : say(language, "noAnswer", { names: at(own), did: "read" });
}

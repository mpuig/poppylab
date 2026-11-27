/**
 * TEST ONLY: what a turn was asked and of whom (`addressed.ts`), for the
 * tests that run every kind of tool through `runtime.connect`'s guard.
 */
import type { ApiTool } from "@poppy-lab/pap-client";
import type { Addressed } from "./addressed";

const lantern = { url: "https://lantern.example", name: "Lantern Noodle Bar" };

/**
 * "conéctate con Lantern Noodle Bar", in a conversation whose only Company
 * is the one at `here`, called `name`: the turn went there as the
 * fallback, and the request names another Company.
 */
export const askedOfLantern = (here: string, name: string): Addressed => ({
  asked: "conéctate con lantern noodle bar",
  companies: () => [{ url: here, name }, lantern],
  chosen: [],
});

/** A request the turn was asked of `here` for, by the model's choice. */
export const askedHere = (here: string, name: string): Addressed => ({
  ...askedOfLantern(here, name),
  asked: "what do I have here?",
  chosen: [here],
});

/** Every tool called once, by name, with what it answered. */
export const callEach = async (tools: Record<string, ApiTool>) => {
  const answers: Array<[string, unknown]> = [];
  for (const [name, tool] of Object.entries(tools))
    answers.push([
      name,
      await tool.execute({ task: "A task", description: "A task." }),
    ]);
  return answers;
};

/** What each of them answers at `name` for "conéctate con …". */
export const refusedAt = (name: string) => ({
  sent: false,
  not_addressed: true,
  reason: `The user's request is about Lantern Noodle Bar, not ${name}. ${name} only receives what was asked of it, so nothing was sent to ${name}.`,
});

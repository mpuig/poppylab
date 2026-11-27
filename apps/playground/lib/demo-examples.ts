/**
 * Demo mode's scripted examples: the requests the demo runs without a
 * model, each for one of the lab's Companies (`company`, the lab's key for
 * it in `labSites`). A message that is no example is answered by Iris
 * with the examples to try.
 *
 * A minimal table, so the routing and its tests run; the full one is
 * written elsewhere with this same interface.
 */
import { plain } from "./company-names";

export type DemoExample = {
  /** The lab Company's key, as `labSites` names it ("lantern"). */
  company: string;
  /** The words of the example, as the User sends them. */
  text: string;
};

export const DEMO_EXAMPLES: readonly DemoExample[] = [
  {
    company: "lantern",
    text: "Add a matcha ice cream and move it to Sunday lunchtime.",
  },
  { company: "harborline", text: "Transfer $500 from checking to savings." },
  { company: "northwind", text: "Upgrade my NA 118 flight to Business." },
];

/** The example these words are, said in any case and punctuation. */
export function demoExampleFor(message: string): DemoExample | undefined {
  const said = plain(message);
  return DEMO_EXAMPLES.find((example) => plain(example.text) === said);
}

/**
 * Iris's answer, in demo mode, to a message that is no example: what the
 * demo can run, with a button for each example of these Companies (all of
 * them when the conversation has none of theirs).
 */
export function demoGuidedReply(companies: string[]): {
  text: string;
  choices: { label: string; message: string }[];
} {
  const own = DEMO_EXAMPLES.filter((e) => companies.includes(e.company));
  const shown = own.length ? own : DEMO_EXAMPLES;
  return {
    text: "Demo mode runs scripted examples only. Pick one below, or select a model in Model settings to ask anything.",
    choices: shown.map((e) => ({ label: e.text, message: e.text })),
  };
}

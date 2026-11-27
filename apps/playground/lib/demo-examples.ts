/**
 * Demo mode's scripted examples. With no model, Iris runs only these
 * messages: the suggestions the playground offers for each lab Company and
 * the messages the Learn pages tell the reader to type. Any other message
 * gets one answer of Iris's own (`demoGuidedReply`), which offers them.
 *
 * Each example still runs through the demo's rules (`demo-changes.ts`, the
 * chat route): this list decides only which messages reach them.
 */
import { labSites } from "@poppy-lab/pap-core";
import { labCompanies } from "@/app/playground/companies";

/** One scripted message demo mode runs, and the lab Company it is for. */
export type DemoExample = {
  /** The lab Company's key, as `labSites` names it ("juniper", "lantern"…). */
  company: string;
  /** The message, as the chip or the Learn page writes it. */
  text: string;
};

/** The lab's key for one of the playground's Companies, by its name. */
const keyOf = (name: string) =>
  labSites("http://localhost:3000").find((site) => site.label === name)?.id ??
  name;

/**
 * The suggestions demo mode shows for each Company, in the order it shows
 * them: public requests, account requests, and the change where the demo
 * can propose it.
 */
const SUGGESTED: readonly DemoExample[] = labCompanies.flatMap((c) =>
  [...c.open, ...c.account, ...(c.demoChange ? [c.ask] : [])].map((text) => ({
    company: keyOf(c.name),
    text,
  })),
);

/**
 * What the Learn pages have the reader type in demo mode, as their steps
 * and screenshots write it, and what the demo's own answers suggest
 * trying. Each one must go on doing what the page shows.
 */
const WRITTEN: readonly DemoExample[] = [
  // Connecting to a company, Signing in and giving permission.
  { company: "juniper", text: "Show my orders" },
  { company: "juniper", text: "Show my deliveries" },
  // The demo's own answer at Juniper says to try these.
  { company: "juniper", text: "my basket" },
  { company: "juniper", text: "set apples in my basket to 2" },
  { company: "juniper", text: "checkout on Saturday" },
  // Changing an order, Letting the agent approve for you, When something
  // goes wrong, When the company can't do it, Getting help from the
  // company, Talking to the company yourself.
  { company: "lantern", text: "Show my orders" },
  { company: "lantern", text: "Add a matcha ice cream" },
  { company: "lantern", text: "Add 2 pork gyoza" },
  { company: "lantern", text: "Move it to Sunday lunchtime" },
  { company: "lantern", text: "Remove the pork gyoza from my order." },
  { company: "lantern", text: "Show me the excluded_tasks list." },
  { company: "lantern", text: "Pay for my order with a gift card." },
  { company: "lantern", text: "customer service" },
  { company: "lantern", text: "My last order never arrived." },
  { company: "lantern", text: "I would like to talk to someone at Lantern." },
  // Moving money, Letting the agent approve for you, When something goes
  // wrong. The last four are named in the pages' prose with their amounts.
  { company: "harborline", text: "Transfer $1,000 from checking to savings." },
  {
    company: "harborline",
    text: "Send Beacon Studio $125 for the quarterly report.",
  },
  { company: "harborline", text: "Transfer $25 from checking to savings." },
  {
    company: "harborline",
    text: "Send Beacon Studio $4,500 for the December invoice.",
  },
  { company: "harborline", text: "Pay my old landlord $900." },
  { company: "harborline", text: "Transfer $3,000 from checking to savings." },
  {
    company: "harborline",
    text: "Pay Beacon Studio $4,000 for November design work",
  },
  {
    company: "harborline",
    text: "Pay Beacon Studio $5,000 for November design work",
  },
  {
    company: "harborline",
    text: "Pay Beacon Studio $6,000 for November design work",
  },
  // Changing a trip.
  { company: "northwind", text: "Is there an upgrade available on my trip?" },
  { company: "northwind", text: "Upgrade my NA 118 flight to Business." },
  { company: "northwind", text: "Add a bag." },
  { company: "northwind", text: "Add a bag to NA 402." },
  { company: "northwind", text: "add 3 bags to NA 402" },
  { company: "northwind", text: "Add a bag to my flight on 18 May" },
  { company: "northwind", text: "upgrade NA 999" },
];

export const DEMO_EXAMPLES: readonly DemoExample[] = [...SUGGESTED, ...WRITTEN];

/**
 * A message as the examples are compared: case, runs of spaces, curly or
 * straight quotes and the punctuation it ends with don't count, so "what’s
 * on the menu" is "What's on the menu?".
 */
const folded = (message: string) =>
  message
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.!?…]+$/, "")
    .replace(/^'+|'+$/g, "")
    .trim();

const byText = new Map<string, DemoExample[]>();
for (const example of DEMO_EXAMPLES) {
  const key = folded(example.text);
  const same = byText.get(key) ?? [];
  if (!same.some((e) => e.company === example.company)) same.push(example);
  byText.set(key, same);
}

/** The example a message is, matched after folding case, spaces, quotes and end punctuation; undefined when it is none. */
export function demoExampleFor(message: string): DemoExample | undefined {
  return byText.get(folded(message))?.[0];
}

/**
 * Every Company a message is an example for, in the table's order: the
 * same words ("my orders") can be an example at several.
 */
export function demoExamplesFor(message: string): DemoExample[] {
  return [...(byText.get(folded(message)) ?? [])];
}

/**
 * Iris's own answer, in demo mode, to a message that is no example: one
 * plain line saying demo mode runs these examples and a model can be asked
 * anything, and as choices the suggested examples of the given Companies
 * (with none connected, the first suggestion of each lab Company, so the
 * list stays short). Each choice sends its `message` as the User's words,
 * as a suggestion does.
 */
export function demoGuidedReply(companies: string[]): {
  text: string;
  choices: { label: string; message: string }[];
} {
  const offered = companies.length
    ? SUGGESTED.filter((example) => companies.includes(example.company))
    : SUGGESTED.filter(
        (example, i) =>
          SUGGESTED.findIndex((e) => e.company === example.company) === i,
      );
  const choices = offered.map((example) => ({
    label: example.text,
    message: example.text,
  }));
  return {
    text: "Demo mode runs the examples below, without a model. To ask anything in your own words, press “Use your own model”.",
    choices,
  };
}

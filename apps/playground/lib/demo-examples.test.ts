import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { labCompanies } from "@/app/playground/companies";
import {
  DEMO_EXAMPLES,
  demoExampleFor,
  demoExamplesFor,
  demoGuidedReply,
} from "./demo-examples";

it("has every suggestion demo mode shows, for its Company", () => {
  for (const c of labCompanies)
    for (const text of [
      ...c.open,
      ...c.account,
      ...(c.demoChange ? [c.ask] : []),
    ])
      expect(DEMO_EXAMPLES).toContainEqual({
        company: expect.any(String),
        text,
      });
  expect(demoExampleFor("Upgrade my flight to Business.")).toEqual({
    company: "northwind",
    text: "Upgrade my flight to Business.",
  });
  // The demo can't switch a plan: Fernwick's change is no example.
  expect(demoExampleFor("Switch my EV charger to the flat rate.")).toBe(
    undefined,
  );
});

it("has every message a Learn page has the reader type", () => {
  const folder = join(__dirname, "../../../docs/learn/how-it-works");
  const asked = readdirSync(folder)
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => [
      ...readFileSync(join(folder, name), "utf8").matchAll(
        /\b(?:types|writes|asks|answers|asks for it):? "([^"]+)"/g,
      ),
    ])
    .map((match) => match[1]!)
    // Said in a Direct Conversation: the Company reads it, not demo mode.
    .filter((text) => text !== "yes");
  expect(asked.length).toBeGreaterThan(8);
  for (const text of asked) expect(demoExampleFor(text), text).toBeDefined();
});

it("matches whatever the case, the spaces, the quotes or the last punctuation", () => {
  for (const message of [
    "What’s on the menu?",
    "what's on the menu",
    "  WHAT'S   ON THE MENU?! ",
    "“What’s on the menu?”",
  ])
    expect(demoExampleFor(message)).toEqual({
      company: "lantern",
      text: "What’s on the menu?",
    });
  // Other words are no example, however close.
  for (const message of [
    "What's on the menu today?",
    "Cancel my booking",
    "The pork gyoza was missing from my last delivery.",
    "",
  ])
    expect(demoExampleFor(message)).toBeUndefined();
});

it("answers anything else with the examples of the Companies connected", () => {
  const reply = demoGuidedReply(["northwind"]);
  expect(reply.text).toBe(
    "Demo mode runs the examples below, without a model. To ask anything in your own words, press “Use your own model”.",
  );
  expect(reply.choices).toEqual([
    { label: "my upcoming trips", message: "my upcoming trips" },
    {
      label: "Upgrade my flight to Business.",
      message: "Upgrade my flight to Business.",
    },
  ]);
  // With none connected, one of each lab Company's, so the list stays short.
  const all = demoGuidedReply([]).choices.map(
    ({ message }) => demoExampleFor(message)?.company,
  );
  expect(all).toEqual([
    "juniper",
    "lantern",
    "harborline",
    "northwind",
    "fernwick",
  ]);
});

it("tells apart the Companies the same words are an example for", () => {
  expect(demoExamplesFor("my orders").map((e) => e.company)).toEqual([
    "juniper",
    "lantern",
  ]);
  expect(demoExamplesFor("Transfer $500 from checking to savings")).toEqual([
    {
      company: "harborline",
      text: "Transfer $500 from checking to savings.",
    },
  ]);
  expect(demoExamplesFor("what is my bank account")).toEqual([]);
});

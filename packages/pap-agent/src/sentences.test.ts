import { describe, expect, it } from "vitest";
import { LONGEST, sentenceSplitter, sentencesOf } from "./sentences";

describe("sentences", () => {
  it.each([
    [
      "one sentence",
      "Your order is on its way.",
      ["Your order is on its way."],
    ],
    [
      "two, with the space kept",
      "Your order is on its way. It arrives at 3 pm.",
      ["Your order is on its way. ", "It arrives at 3 pm."],
    ],
    [
      "a question and an exclamation",
      "Approve it? Done! Thanks.",
      ["Approve it? ", "Done! ", "Thanks."],
    ],
    [
      "an amount and an address are no stops",
      "It costs $12.50 at poppylab.dev today. Next.",
      ["It costs $12.50 at poppylab.dev today. ", "Next."],
    ],
    [
      "closing quotes stay with their sentence",
      "Lantern says: “Your noodles are ready.” Pick them up.",
      ["Lantern says: “Your noodles are ready.” ", "Pick them up."],
    ],
    [
      "an ellipsis ends one",
      "Let me look… Found it.",
      ["Let me look… ", "Found it."],
    ],
    [
      "an abbreviation goes on",
      "Fruit, e.g. apples, is fresh. Dr. Lee agrees.",
      ["Fruit, e.g. apples, is fresh. ", "Dr. Lee agrees."],
    ],
    [
      "a line is a sentence, and a list's number is no stop",
      "You have:\n1. Apples\n2. Pears\n\nAnything else?",
      ["You have:\n", "1. Apples\n", "2. Pears\n\n", "Anything else?"],
    ],
    [
      "a bullet list",
      "- Apples, 2\n- Pears, 1",
      ["- Apples, 2\n", "- Pears, 1"],
    ],
    [
      "a code block is one piece",
      'Send this:\n```json\n{ "a": 1. }\n```\nThen wait.',
      ["Send this:\n", '```json\n{ "a": 1. }\n```\n', "Then wait."],
    ],
    ["no stop at the end", "Apples and pears", ["Apples and pears"]],
    ["only space", "  \n ", []],
  ])("%s", (_name, text, expected) => {
    expect(sentencesOf(text)).toEqual(expected);
    expect(sentencesOf(text).join("")).toBe(text.trim() ? text : "");
  });

  it("cuts a sentence too long to say at once at its last clause, never in a word", () => {
    const long = `${"Your basket has apples, pears and plums from the market".repeat(5)}.`;
    const pieces = sentencesOf(long);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe(long);
    for (const piece of pieces.slice(0, -1)) {
      expect(piece.length).toBeLessThanOrEqual(LONGEST + 1);
      expect(piece).toMatch(/[,\s]$/);
    }
    // No comma at all: at the last space.
    const words = `${"word ".repeat(80)}end.`;
    const cut = sentencesOf(words);
    expect(cut.join("")).toBe(words);
    for (const piece of cut.slice(0, -1)) expect(piece).toMatch(/word $/);
  });

  it("answers the same sentences however the text is cut on its way", () => {
    const text =
      "The total is $88.00. It was $73.00, so 15 more. Approve it?\n\nYes.";
    const whole = sentencesOf(text);
    for (const size of [1, 2, 3, 5, 8, 13]) {
      const splitter = sentenceSplitter();
      const pieces: string[] = [];
      for (let at = 0; at < text.length; at += size)
        pieces.push(...splitter.push(text.slice(at, at + size)));
      pieces.push(...splitter.end());
      // The same sentences; a space may go with the one after it.
      expect(pieces.map((p) => p.trim())).toEqual(whole.map((p) => p.trim()));
      expect(pieces.join("")).toBe(text);
    }
    expect(whole).toEqual([
      "The total is $88.00. ",
      "It was $73.00, so 15 more. ",
      "Approve it?\n\n",
      "Yes.",
    ]);
  });

  it("holds a stop until it sees the space after it", () => {
    const splitter = sentenceSplitter();
    expect(splitter.push("It costs $12.")).toEqual([]);
    expect(splitter.push("50. Next")).toEqual(["It costs $12.50. "]);
    expect(splitter.end()).toEqual(["Next"]);
  });
});

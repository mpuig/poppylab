import { describe, expect, it } from "vitest";
import { answeredWith, namedBy, namedIn, plain } from "./company-names";

const lantern = {
  url: "https://food.example",
  name: "Lantern Noodle Bar",
  words: ["restaurant", "noodles", "the noodle bar"],
};
const harborline = {
  url: "https://bank.example",
  name: "Harborline Bank",
  words: ["bank"],
};
const fernwick = {
  url: "https://energy.example",
  name: "Fernwick Power & Light",
  words: ["utility", "power company"],
};
const all = [lantern, harborline, fernwick];
const names = (found: Array<{ name: string }>) => found.map((c) => c.name);

describe("the Companies a person names", () => {
  it("reads words without case, accents or punctuation", () => {
    expect(plain("  Fernwick Power & Light!  ")).toBe(
      "fernwick power and light",
    );
    expect(plain("It's the Café")).toBe("its the cafe");
  });

  it.each([
    ["Lantern Noodle Bar", "Lantern Noodle Bar"],
    ["lantern", "Lantern Noodle Bar"],
    ["LANTERN NOODLE", "Lantern Noodle Bar"],
    ["the restaurant", "Lantern Noodle Bar"],
    ["The Noodle Bar.", "Lantern Noodle Bar"],
    ["Harborline", "Harborline Bank"],
    ["the bank", "Harborline Bank"],
    ["my bank", "Harborline Bank"],
    ["Fernwick Power & Light", "Fernwick Power & Light"],
    ["fernwick power and light", "Fernwick Power & Light"],
    ["the power company", "Fernwick Power & Light"],
  ])("takes “%s” for %s", (said, name) => {
    expect(names(namedBy(said, all))).toEqual([name]);
  });

  it.each([
    "",
    "the",
    "noodle",
    "bar",
    "light",
    "the bank's opening hours",
    "lantern please show the menu",
    "harbor",
    "bank-demo.poppylab.dev",
    "https://food.example",
  ])("takes “%s” for none: a name, and nothing more than a name", (said) => {
    expect(namedBy(said, all)).toEqual([]);
  });

  it("finds every Company named somewhere in the words, a name before a plain word", () => {
    expect(names(namedIn("Lantern or the bank?", all))).toEqual([
      "Lantern Noodle Bar",
    ]);
    expect(names(namedIn("lantern or harborline", all))).toEqual([
      "Lantern Noodle Bar",
      "Harborline Bank",
    ]);
    expect(names(namedIn("the bank, please", all))).toEqual([
      "Harborline Bank",
    ]);
    expect(names(namedIn("a restaurant or a utility", all))).toEqual([
      "Lantern Noodle Bar",
      "Fernwick Power & Light",
    ]);
    // Whole words only.
    expect(namedIn("lanterns and banking", all)).toEqual([]);
  });

  it("gives two when the words fit two", () => {
    const twin = { url: "https://trust.example", name: "Harborline Trust" };
    expect(names(namedBy("Harborline", [...all, twin]))).toEqual([
      "Harborline Bank",
      "Harborline Trust",
    ]);
    expect(names(namedBy("Harborline Trust", [...all, twin]))).toEqual([
      "Harborline Trust",
    ]);
  });
});

describe("an answer to “Which company is this for?”", () => {
  it.each([
    ["Lantern", "Lantern Noodle Bar"],
    ["Lantern Noodle Bar", "Lantern Noodle Bar"],
    ["for Lantern", "Lantern Noodle Bar"],
    ["It's for the bank, please", "Harborline Bank"],
    ["the bank.", "Harborline Bank"],
    ["ask Harborline", "Harborline Bank"],
    ["that's the utility", "Fernwick Power & Light"],
  ])("takes “%s” for %s", (said, name) => {
    expect(answeredWith(said, all)?.name).toBe(name);
  });

  it.each([
    "What's on the menu?",
    "Lantern or Harborline",
    "both",
    "the first one",
    "Lantern, and show me the menu",
  ])("takes “%s” for no answer", (said) => {
    expect(answeredWith(said, all)).toBeUndefined();
  });

  it("is none when the name fits two", () => {
    const twin = { url: "https://trust.example", name: "Harborline Trust" };
    expect(answeredWith("Harborline", [...all, twin])).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  readApproval,
  SAYS_YES,
  tryAgain,
  yesOrNo,
  type Named,
} from "./typed-answers";

describe("yesOrNo", () => {
  it.each([
    ["yes", "yes"],
    ["Yes.", "yes"],
    ["yes please", "yes"],
    ["Yes, please!", "yes"],
    ["ok", "yes"],
    ["OK, go ahead", "yes"],
    ["sure", "yes"],
    ["go ahead", "yes"],
    ["do it", "yes"],
    ["yep", "yes"],
    ["Sounds good", "yes"],
    ["no", "no"],
    ["No thanks", "no"],
    ["nope", "no"],
    ["not now", "no"],
    ["cancel", "no"],
    ["Don't", "no"],
    ["don't do it", "no"],
    ["never mind", "no"],
    ["no, cancel it", "no"],
  ])("reads %j as %s", (text, answer) => {
    expect(yesOrNo(text)).toBe(answer);
  });

  it.each([
    "yes and show me the menu",
    "what are your products?",
    "ok but first tell me the fee",
    "maybe",
    "no idea what that means",
    "approve",
    "",
  ])("reads %j as neither", (text) => {
    expect(yesOrNo(text)).toBeUndefined();
  });

  it("takes a question's own verbs as a yes, and only for that question", () => {
    expect(yesOrNo("approve it", SAYS_YES.approve)).toBe("yes");
    expect(yesOrNo("yes, approve", SAYS_YES.approve)).toBe("yes");
    expect(yesOrNo("sign me in", SAYS_YES.signin)).toBe("yes");
    expect(yesOrNo("sign me in", SAYS_YES.approve)).toBeUndefined();
    expect(yesOrNo("carry on", SAYS_YES.resume)).toBe("yes");
    expect(yesOrNo("decline", SAYS_YES.approve)).toBe("no");
  });

  it("leaves a long message alone, whatever it begins with", () => {
    expect(yesOrNo(`yes ${"really ".repeat(30)}`)).toBeUndefined();
  });
});

describe("readApproval", () => {
  const lantern: Named = {
    names: ["Lantern Noodle Bar", "restaurant"],
    cents: 8800,
    noun: "change",
  };
  const harborline: Named = {
    names: ["Harborline Bank", "bank"],
    cents: 50000,
    noun: "transfer",
  };

  it.each([
    ["yes", "approve"],
    ["approve", "approve"],
    ["Approve it.", "approve"],
    ["yes, approve it please", "approve"],
    ["ok", "approve"],
    ["no", "decline"],
    ["decline", "decline"],
    ["No thanks", "decline"],
  ] as const)(
    "with one proposal asked about, %j decides it",
    (text, decision) => {
      expect(readApproval(text, [lantern])).toEqual({ decision, picked: 0 });
    },
  );

  it.each([
    "yes and also add a gyoza",
    "what is the fee?",
    "show me my orders",
    "lantern",
    "the $88 one",
  ])("with one proposal, %j is no answer", (text) => {
    expect(readApproval(text, [lantern])).toBeUndefined();
  });

  it.each([
    ["approve the Lantern one", 0, "approve"],
    ["yes, Lantern", 0, "approve"],
    ["approve the $88.00 change", 0, "approve"],
    ["approve 88", 0, "approve"],
    ["yes the bank", 1, "approve"],
    ["approve the transfer", 1, "approve"],
    ["approve the $500 transfer at Harborline", 1, "approve"],
    ["decline the transfer", 1, "decline"],
    ["no to the Harborline one", 1, "decline"],
    ["the Lantern one", 0, "approve"],
    ["$500", 1, "approve"],
  ] as const)(
    "with two, %j picks one by its Company, amount or kind",
    (text, picked, decision) => {
      expect(readApproval(text, [lantern, harborline], true)).toEqual({
        decision,
        picked,
      });
    },
  );

  it.each([
    ["yes", "approve"],
    ["ok go ahead", "approve"],
    ["no", "decline"],
    ["approve the $99 one", "approve"],
    ["approve Lantern and the bank", "approve"],
    ["approve the $500 change at Lantern", "approve"],
  ] as const)(
    "with two, %j doesn't say which: asked again",
    (text, decision) => {
      expect(readApproval(text, [lantern, harborline], true)).toEqual({
        unclear: decision,
      });
    },
  );

  it("leaves words it can't read either way as a message", () => {
    // "Not the Harborline one" could mean either: nothing is decided.
    expect(
      readApproval("no, not the Harborline one", [lantern, harborline], true),
    ).toBeUndefined();
    expect(
      readApproval(
        "approve the one for my landlord",
        [lantern, harborline],
        true,
      ),
    ).toBeUndefined();
  });

  it("takes a reference alone only when the question asked which", () => {
    expect(
      readApproval("Lantern", [lantern, harborline], false),
    ).toBeUndefined();
    expect(readApproval("Lantern", [lantern, harborline], true)).toEqual({
      decision: "approve",
      picked: 0,
    });
  });

  it("reads nothing into a Company's name that sounds like an answer", () => {
    // A Company may call itself anything; its name is a reference, never
    // a yes.
    const odd: Named = { names: ["Approve Ltd"], cents: 100, noun: "change" };
    expect(readApproval("approve", [odd])).toBeUndefined();
    expect(readApproval("yes", [odd])).toEqual({
      decision: "approve",
      picked: 0,
    });
  });
});

describe("tryAgain", () => {
  it.each([
    "try again",
    "Try again.",
    "please try again",
    "retry",
    "again",
    "try that again",
  ])("reads %j", (text) => expect(tryAgain(text)).toBe(true));
  it.each(["try again with the bank", "again, but for Lantern", "yes"])(
    "leaves %j",
    (text) => expect(tryAgain(text)).toBe(false),
  );
});

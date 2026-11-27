import { describe, expect, it } from "vitest";
import { typedAnswer } from "./company-commands";
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

describe("answers in Spanish, Catalan and French", () => {
  it.each([
    // Spanish
    ["sí", "yes"],
    ["Sí, por favor", "yes"],
    ["vale", "yes"],
    ["claro", "yes"],
    ["de acuerdo", "yes"],
    ["adelante", "yes"],
    ["sí, hazlo", "yes"],
    ["no", "no"],
    ["no, gracias", "no"],
    ["ahora no", "no"],
    ["cancela", "no"],
    ["mejor no", "no"],
    // Catalan
    ["d'acord", "yes"],
    ["sí, si us plau", "yes"],
    ["endavant", "yes"],
    ["fes-ho", "yes"],
    ["no, gràcies", "no"],
    ["ara no", "no"],
    ["millor no", "no"],
    // French
    ["oui", "yes"],
    ["Oui, s'il vous plaît", "yes"],
    ["d'accord", "yes"],
    ["vas-y", "yes"],
    ["ça marche", "yes"],
    ["non", "no"],
    ["non merci", "no"],
    ["pas maintenant", "no"],
    ["annule", "no"],
  ] as const)("reads %j as %s", (text, answer) => {
    expect(yesOrNo(text)).toBe(answer);
  });

  it("reads each question's own verbs in each language", () => {
    for (const approve of [
      "aprueba",
      "apruébalo",
      "sí, apruébalo",
      "aprova-ho",
      "l'aprovo",
      "approuve-le",
      "j'approuve",
    ])
      expect(yesOrNo(approve, SAYS_YES.approve)).toBe("yes");
    for (const signin of ["inicia sesión", "inicia sessió", "connecte-moi"])
      expect(yesOrNo(signin, SAYS_YES.signin)).toBe("yes");
    for (const signout of [
      "cierra sesión",
      "tanca la sessió",
      "déconnecte-moi",
    ])
      expect(yesOrNo(signout, SAYS_YES.signout)).toBe("yes");
    for (const resume of ["sí, sigue", "continua", "continuez"])
      expect(yesOrNo(resume, SAYS_YES.resume)).toBe("yes");
    for (const talk of ["hablar", "parlar", "parler"])
      expect(yesOrNo(talk, SAYS_YES.invitation)).toBe("yes");
    // A question's verb answers that question alone.
    expect(yesOrNo("aprueba", SAYS_YES.signin)).toBeUndefined();
  });

  it("leaves anything more than an answer as a message", () => {
    for (const text of [
      "sí, pero primero dime el total",
      "no sé, ¿cuánto cuesta?",
      "oui mais combien ça coûte ?",
      "d'acord, i quin és el total?",
      "muéstrame mis pedidos",
    ])
      expect(yesOrNo(text, SAYS_YES.approve)).toBeUndefined();
  });

  const two: Named[] = [
    { names: ["Lantern Noodle Bar"], cents: 8800, noun: "change" },
    { names: ["Harborline Bank"], cents: 50000, noun: "transfer" },
  ];
  it.each([
    ["aprueba la de Lantern", { decision: "approve", picked: 0 }],
    ["sí, la transferencia", { decision: "approve", picked: 1 }],
    ["no, el cambio de 88", { decision: "decline", picked: 0 }],
    ["la de Harborline", { decision: "approve", picked: 1 }],
    ["aprova la de Harborline", { decision: "approve", picked: 1 }],
    ["rebutja el canvi", { decision: "decline", picked: 0 }],
    ["approuve le virement", { decision: "approve", picked: 1 }],
    ["non, celle de Lantern", undefined],
    ["oui, chez Lantern", { decision: "approve", picked: 0 }],
    ["sí", { unclear: "approve" }],
  ] as const)("picks a proposal from %j", (text, read) => {
    expect(readApproval(text, two, true)).toEqual(read);
  });

  it("answers the question about removing a Company in each language", () => {
    const asked = { remove: ["https://food.example"] };
    for (const yes of [
      "yes, remove it",
      "sí, quítala",
      "d'acord, treu-la",
      "oui, retire-la",
      "go ahead",
    ])
      expect(typedAnswer(yes, asked)).toEqual({ remove: asked.remove });
    for (const no of [
      "no, keep it",
      "no, mantenla",
      "no, mantingues-la",
      "non, garde-la",
      "cancel",
    ])
      expect(typedAnswer(no, asked)).toEqual({ keep: asked.remove });
    expect(typedAnswer("quita las naranjas", asked)).toBeUndefined();
    // Removal's verbs answer that question alone.
    expect(yesOrNo("quítala", Object.values(SAYS_YES).flat())).toBeUndefined();
  });

  it.each([
    "inténtalo de nuevo",
    "otra vez",
    "torna-ho a provar",
    "un altre cop",
    "réessaie",
    "encore une fois",
  ])("reads %j as try again", (text) => expect(tryAgain(text)).toBe(true));
});

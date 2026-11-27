import { describe, expect, it } from "vitest";
import {
  followLanguage,
  languageFrom,
  languageOf,
  listIn,
  noteLanguage,
  quoteIn,
} from "./language";

describe("the language the User writes in", () => {
  it.each([
    ["Show me my balance", "en"],
    ["What did I order from Lantern?", "en"],
    ["Muéstrame el saldo de mi cuenta", "es"],
    ["¿Cuándo llega mi pedido?", "es"],
    ["mueve mi pedido al domingo", "es"],
    ["Mostra'm el saldo del meu compte", "ca"],
    ["Vull moure la comanda a diumenge", "ca"],
    ["Quant he de pagar aquest mes?", "ca"],
    ["Montre-moi le solde de mon compte", "fr"],
    ["Quand arrive ma commande ?", "fr"],
    ["connecte-toi à Lantern Noodle Bar", "fr"],
  ] as const)("reads %j as %s", (text, language) => {
    expect(followLanguage(undefined, text)).toBe(language);
  });

  it("stays as it is on words that say no language", () => {
    for (const text of [
      "ok",
      "Lantern",
      "$88",
      "Harborline Bank",
      "no",
      "👍",
    ]) {
      expect(followLanguage("es", text)).toBe("es");
      expect(followLanguage("ca", text)).toBe("ca");
      expect(followLanguage(undefined, text)).toBe("en");
    }
  });

  it("reads a short answer in the language it is in, and keeps a shared word", () => {
    expect(followLanguage(undefined, "sí")).toBe("es");
    expect(followLanguage("en", "vale")).toBe("es");
    expect(followLanguage("en", "d'acord")).toBe("ca");
    expect(followLanguage("en", "oui")).toBe("fr");
    expect(followLanguage("en", "d'accord")).toBe("fr");
    // "sí" is Catalan too: a Catalan conversation stays Catalan.
    expect(followLanguage("ca", "sí")).toBe("ca");
    expect(followLanguage("es", "hola")).toBe("es");
    expect(followLanguage("ca", "hola")).toBe("ca");
  });

  it("is stable through a conversation, and changes when the User switches", () => {
    expect(
      languageFrom(["Hola, muéstrame mis pedidos", "sí", "ok", "Lantern"]),
    ).toBe("es");
    expect(
      languageFrom([
        "Hola, muéstrame mis pedidos",
        "Show me my balance please",
      ]),
    ).toBe("en");
    expect(languageFrom([])).toBe("en");
  });

  it("is kept with the conversation, and English until another", () => {
    const run: { language?: "en" | "es" | "ca" | "fr" } = {};
    noteLanguage(run, "ok");
    expect(run.language).toBeUndefined();
    expect(languageOf(run)).toBe("en");
    noteLanguage(run, "¿Qué tengo en la cesta?");
    expect(run.language).toBe("es");
    noteLanguage(run, "vale");
    expect(run.language).toBe("es");
    expect(languageOf({ language: "xx" })).toBe("en");
    expect(languageOf(undefined)).toBe("en");
  });
});

describe("lists and quotes in each language", () => {
  it("joins names as each language does", () => {
    const names = ["A", "B", "C"];
    expect(listIn("en", names, "or")).toBe("A, B or C");
    expect(listIn("es", names)).toBe("A, B y C");
    expect(listIn("ca", names)).toBe("A, B i C");
    expect(listIn("fr", names, "or")).toBe("A, B ou C");
    expect(listIn("es", ["A"])).toBe("A");
  });

  it("quotes the User's words as each language does, exactly", () => {
    expect(quoteIn("en", "my orders")).toBe("“my orders”");
    expect(quoteIn("es", "mis pedidos")).toBe("«mis pedidos»");
    expect(quoteIn("fr", "mes commandes")).toBe("« mes commandes »");
  });
});

import { describe, expect, it } from "vitest";
import { spokenAmount, spokenText } from "./spoken";

describe("amounts said in the conversation's language", () => {
  it.each([
    ["es", 8800, "USD", "88 dólares"],
    ["es", 1250, "USD", "12 dólares con 50"],
    ["es", 100, "EUR", "1 euro"],
    ["ca", 8800, "USD", "88 dòlars"],
    ["ca", 1250, "EUR", "12 euros amb 50"],
    ["ca", 50, "EUR", "50 cèntims"],
    ["fr", 8800, "USD", "88 dollars"],
    ["fr", 50, "EUR", "50 centimes"],
    ["fr", -600, "USD", "moins 6 dollars"],
  ] as const)("in %s, %i %s is %j", (language, cents, currency, said) => {
    expect(spokenAmount(cents, currency, language)).toBe(said);
  });

  it("says a line's amounts in its language", () => {
    expect(spokenText("El total nuevo es de $88.00.", "es")).toBe(
      "El total nuevo es de 88 dólares.",
    );
    expect(spokenText("Le total est de $12.50.", "fr")).toBe(
      "Le total est de 12 dollars 50.",
    );
  });
});

describe("spokenAmount", () => {
  it.each([
    [8800, "USD", "88 dollars"],
    [1500, "USD", "15 dollars"],
    [100, "USD", "1 dollar"],
    [1250, "USD", "12 dollars 50"],
    [50, "USD", "50 cents"],
    [100000, "USD", "1,000 dollars"],
    [-600, "USD", "minus 6 dollars"],
    [500, "EUR", "5 euros"],
    [999, "GBP", "9 pounds 99"],
    [999, "CHF", "9.99 CHF"],
  ])("%i %s is %j", (cents, currency, said) => {
    expect(spokenAmount(cents, currency)).toBe(said);
  });
});

describe("spokenText", () => {
  it("says amounts as they are said, and leaves identifiers out", () => {
    expect(
      spokenText(
        "Your order ord_LNB1001 now comes to $88.00, $15.00 more than before.",
      ),
    ).toBe("Your order now comes to 88 dollars, 15 dollars more than before.");
  });

  it("keeps the first two sentences, without the demo's label", () => {
    expect(
      spokenText(
        "Protocol demo (no LLM). The company answered: you have 2 orders. One is on Sunday. The other on Friday.",
      ),
    ).toBe("The company answered: you have 2 orders. One is on Sunday.");
  });

  it("reads markdown, lists and tables as plain sentences", () => {
    const said = spokenText(
      [
        "## Balances",
        "**Checking** holds $1,204.50",
        "| Account | Balance |",
        "| --- | --- |",
        "| Checking | $1,204.50 |",
        "- Savings: $300",
      ].join("\n"),
    );
    expect(said).toBe("Balances. Checking holds 1,204 dollars 50.");
    expect(said).not.toMatch(/[|*#`]/);
  });

  it("leaves out addresses, codes and keys a voice would only spell", () => {
    const said = spokenText(
      "Moved `delivery_001` to sun-1300 (revision 1795610120-n19JJxSZnvGF54sY). See https://grocery-demo.poppylab.dev/orders.",
    );
    expect(said).not.toMatch(/delivery_001|sun-1300|n19JJ|https?:/);
    expect(said).toMatch(/^Moved to/);
  });

  it("keeps flight numbers, dates and plain numbers, which are words", () => {
    expect(spokenText("Your flight NA 118 leaves on 18 May with 2 bags.")).toBe(
      "Your flight NA 118 leaves on 18 May with 2 bags.",
    );
  });

  it("keeps a long sentence within what a voice says at once", () => {
    const said = spokenText(`${"word ".repeat(100)}end.`);
    expect(said.length).toBeLessThanOrEqual(281);
    expect(said.endsWith("…")).toBe(true);
  });
});

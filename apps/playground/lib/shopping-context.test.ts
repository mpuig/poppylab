import { it, expect } from "vitest";
import { shoppingTarget } from "./shopping-context";
it("resolves a bare removal to the preceding user delivery context", () =>
  expect(
    shoppingTarget("remove oranges", [
      { role: "user", content: "what are my deliveries?" },
      { role: "assistant", content: "Basket info is available too." },
    ]),
  ).toBe("delivery"));
it("resolves a bare removal to basket context without mixing targets", () =>
  expect(
    shoppingTarget("remove oranges", [
      { role: "user", content: "show my basket" },
    ]),
  ).toBe("basket"));
it.each([
  "remove oranges",
  "remove oranges from my basket and delivery",
  "remove oranges from my order",
])("does not guess an ambiguous target: %s", (message) =>
  expect(shoppingTarget(message, [])).toBeUndefined(),
);
it("explicit target overrides old context", () =>
  expect(
    shoppingTarget("remove oranges from my recurring delivery", [
      { role: "user", content: "show my basket" },
    ]),
  ).toBe("delivery"));
it("does not derive user intent from Company or assistant text", () =>
  expect(
    shoppingTarget("remove oranges", [
      { role: "assistant", content: "delivery" },
    ]),
  ).toBeUndefined());

import { expect, it } from "vitest";
import { chatModels, needsKey, restoreModel } from "./model-options";
it("offers exactly the free model, Luna low, Sonnet 5 and the keyless protocol demo", () => {
  expect(chatModels.map((p) => [p.id, p.model])).toEqual([
    ["free", "gemma-4"],
    ["openai-compatible", "gpt-6-luna"],
    ["anthropic", "sonnet-5"],
    ["demo", "none"],
  ]);
  expect(chatModels[1].detail).toBe("Low reasoning");
  // Neither the free model nor the demo takes a key.
  expect(chatModels.filter((p) => needsKey(p.id)).map((p) => p.id)).toEqual([
    "openai-compatible",
    "anthropic",
  ]);
});
it("restores the browser key but migrates old model names to the fixed model", () => {
  expect(
    restoreModel({
      provider: "anthropic",
      model: "old-model",
      apiKey: "fictional",
    }),
  ).toEqual({ provider: "anthropic", model: "sonnet-5", apiKey: "fictional" });
});
it("does not restore removed providers or malformed credentials", () => {
  expect(restoreModel({ provider: "demo", apiKey: "" })).toEqual({
    provider: "demo",
    apiKey: "",
    model: "none",
  });
  expect(restoreModel({ provider: "google", apiKey: "x" })).toBeNull();
  expect(restoreModel({ provider: "anthropic", apiKey: 123 })).toBeNull();
});

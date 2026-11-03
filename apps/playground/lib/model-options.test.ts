import { expect, it } from "vitest";
import { chatModels, restoreModel } from "./model-options";
it("offers exactly Luna low, Sonnet 5 and the keyless protocol demo", () => {
  expect(chatModels.map((p) => [p.id, p.model])).toEqual([
    ["openai-compatible", "gpt-6-luna"],
    ["anthropic", "sonnet-5"],
    ["demo", "none"],
  ]);
  expect(chatModels[0].detail).toBe("Low reasoning");
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

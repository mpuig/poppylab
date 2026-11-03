import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(() => ({ responses: vi.fn(() => ({})) })),
  generate: vi.fn(async () => ({ text: "Done" })),
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.create }));
vi.mock("ai", () => ({
  generateText: mocks.generate,
  tool: (v: unknown) => v,
  jsonSchema: (v: unknown) => v,
  stepCountIs: () => 5,
}));
import { runModel } from "./server";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("uses a request-scoped browser key, never the environment proxy, and excludes it from model context", async () => {
  vi.stubEnv("OPENAI_API_KEY", "server-key");
  vi.stubEnv("OPENAI_BASE_URL", "https://private-proxy.invalid/v1");
  await runModel(
    "openai-compatible",
    [{ role: "user", content: "Hello" }],
    {},
    { apiKey: "browser-key", model: "gpt-6-luna" },
  );
  expect(mocks.create).toHaveBeenCalledWith({ apiKey: "browser-key" });
  const args = mocks.generate.mock.calls[0];
  expect(JSON.stringify(args)).not.toContain("browser-key");
  expect(process.env.OPENAI_API_KEY).toBe("server-key");
});
it("keeps local environment fallback when the browser key is blank", async () => {
  vi.stubEnv("OPENAI_API_KEY", "server-key");
  vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
  await runModel("openai-compatible", [], {}, { apiKey: "" });
  expect(mocks.create).toHaveBeenCalledWith({ apiKey: "server-key" });
});

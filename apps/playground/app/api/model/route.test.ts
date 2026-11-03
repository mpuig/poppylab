import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";
afterEach(() => vi.unstubAllEnvs());
it("describes local environment configuration without exposing the key", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("OPENAI_API_KEY", "never-return-this-key");
  vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
  const response = GET(new Request("http://localhost:3000/api/model"));
  const text = await response.text();
  expect(text).not.toContain("never-return-this-key");
  expect(JSON.parse(text).providers["openai-compatible"]).toEqual({
    configured: true,
    model: "gpt-6-luna",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("does not advertise server credentials on remote or production hosts", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("OPENAI_API_KEY", "secret");
  expect(
    await GET(new Request("https://example.com/api/model")).json(),
  ).toEqual({ providers: {} });
  vi.stubEnv("NODE_ENV", "production");
  expect(
    await GET(new Request("http://localhost:3000/api/model")).json(),
  ).toEqual({ providers: {} });
});

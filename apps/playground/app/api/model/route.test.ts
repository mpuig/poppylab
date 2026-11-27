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
    (await GET(new Request("https://example.com/api/model")).json()).providers,
  ).toEqual({});
  vi.stubEnv("NODE_ENV", "production");
  expect(
    (await GET(new Request("http://localhost:3000/api/model")).json())
      .providers,
  ).toEqual({});
});
it("says plainly that the free model runs only where Workers AI is bound", async () => {
  vi.stubEnv("TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "never-return-this-secret");
  const text = await GET(new Request("http://localhost:3000/api/model")).text();
  expect(text).not.toContain("never-return-this-secret");
  expect(JSON.parse(text).free).toEqual({
    available: false,
    reason:
      "The free model runs only on the deployed site, where Workers AI is bound. Here, use Demo mode or your own model.",
  });
});

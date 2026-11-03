import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { runModel } from "./server";

const target = vi.hoisted(() => ({ url: "" }));
vi.mock("@ai-sdk/openai", async (original) => {
  const actual = await original<typeof import("@ai-sdk/openai")>();
  return {
    ...actual,
    createOpenAI: (settings: Parameters<typeof actual.createOpenAI>[0]) =>
      actual.createOpenAI({ ...settings, baseURL: target.url }),
  };
});
afterEach(() => vi.unstubAllEnvs());

it("uses Responses for GPT-6 Luna and completes a tool round trip", async () => {
  const requests: Array<{
    path: string | undefined;
    body: Record<string, unknown>;
  }> = [];
  const execute = vi.fn(async () => ({
    products: [{ name: "Apples", price: 390 }],
  }));
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      path: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        id: `resp_${requests.length}`,
        object: "response",
        created_at: 1,
        status: "completed",
        model: "gpt-6-luna",
        output:
          requests.length === 1
            ? [
                {
                  type: "function_call",
                  id: "fc_1",
                  call_id: "call_1",
                  name: "list_products",
                  arguments: "{}",
                },
              ]
            : [
                {
                  id: "msg_1",
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: "Apples cost $3.90.",
                      annotations: [],
                    },
                  ],
                },
              ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  target.url = `http://127.0.0.1:${address.port}/v1`;
  vi.stubEnv("OPENAI_API_KEY", "test-placeholder-not-a-secret");
  vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
  vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
  try {
    expect(
      await runModel(
        "openai-compatible",
        [{ role: "user", content: "What are your products?" }],
        { list_products: { description: "List products", execute } },
      ),
    ).toBe("Apples cost $3.90.");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.path).toBe("/v1/responses");
      expect(request.body.max_output_tokens).toBe(1800);
      expect(request.body).not.toHaveProperty("max_tokens");
      expect(request.body.store).toBe(false);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

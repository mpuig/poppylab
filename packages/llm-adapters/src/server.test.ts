import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { runModel } from "./server";

afterEach(() => vi.unstubAllEnvs());

it("executes a Company tool through an OpenAI-compatible model loop", async () => {
  let requests = 0;
  const execute = vi.fn(async () => ({ products: [{ name: "Apples" }] }));
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    requests++;
    const first = requests === 1;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        id: "test-completion",
        object: "chat.completion",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: first
              ? {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "list_products", arguments: "{}" },
                    },
                  ],
                }
              : { role: "assistant", content: "The Company has apples." },
            finish_reason: first ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  vi.stubEnv("OPENAI_API_KEY", "test-placeholder-not-a-secret");
  vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${address.port}/v1`);
  vi.stubEnv("OPENAI_MODEL", "test-model");
  try {
    const result = await runModel(
      "openai-compatible",
      [{ role: "user", content: "What do you sell?" }],
      { list_products: { description: "List products", execute } },
    );
    expect(result).toBe("The Company has apples.");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(requests).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

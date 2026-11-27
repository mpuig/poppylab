import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { runModel } from "./server";

afterEach(() => vi.unstubAllEnvs());

it("executes a Company tool through an OpenAI-compatible model loop", async () => {
  let requests = 0;
  const bodies: Array<{ messages: Array<{ role: string; content: string }> }> =
    [];
  const execute = vi.fn(async () => ({ products: [{ name: "Apples" }] }));
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
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
      { context: "Account note: the user is signed in at Lantern." },
    );
    expect(result).toBe("The Company has apples.");
    // Iris's own note for the turn follows the system prompt.
    const system = bodies[0]!.messages.find((m) => m.role === "system")!;
    expect(system.content).toMatch(
      /Answer concisely\.\n\nAccount note: the user is signed in at Lantern\.$/,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(requests).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

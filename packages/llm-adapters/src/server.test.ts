import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { askModel, runModel } from "./server";

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
    // In the User's language; a Company named in any language is
    // connected with Iris's tool, and is never sent another's request.
    expect(system.content).toContain(
      "Answer in the language the user writes in.",
    );
    expect(system.content).toContain(
      "to connect, add or remove a company in this conversation, call connect_company",
    );
    expect(system.content).toContain(
      "A Company only receives what was asked of it",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(requests).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("streams an OpenAI-compatible model's answer, and answers whole from one that doesn't stream", async () => {
  const asked: boolean[] = [];
  let streams = true;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const stream = (JSON.parse(body) as { stream?: boolean }).stream === true;
    asked.push(stream);
    if (stream && streams) {
      response.setHeader("Content-Type", "text/event-stream");
      for (const content of ["Apples", " are", " in. Pears too."])
        response.write(
          `data: ${JSON.stringify({ id: "s", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
        );
      response.end(
        `data: ${JSON.stringify({ id: "s", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
      return;
    }
    // A server that answers every request whole, streamed or not.
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        id: "w",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Whole." },
            finish_reason: "stop",
          },
        ],
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
    const pieces: string[] = [];
    const text = await runModel(
      "openai-compatible",
      [{ role: "user", content: "Fruit?" }],
      {},
      { onText: (t) => pieces.push(t) },
    );
    expect(text).toBe("Apples are in. Pears too.");
    expect(pieces.slice(0, 3)).toEqual(["Apples", " are", " in. Pears too."]);
    streams = false;
    const whole = await runModel(
      "openai-compatible",
      [{ role: "user", content: "Fruit?" }],
      {},
      { onText: (t) => pieces.push(t) },
    );
    expect(whole).toBe("Whole.");
    expect(asked).toEqual([true, true, false]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("asks the same model one short question, with no tools", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(JSON.parse(body));
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
            message: { role: "assistant", content: "unsure" },
            finish_reason: "stop",
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
    const answer = await askModel("openai-compatible", {
      system: "Answer with one word.",
      prompt: '{"message":"hello"}',
    });
    expect(answer).toBe("unsure");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("tools");
    expect(bodies[0]!.messages).toEqual([
      { role: "system", content: "Answer with one word." },
      { role: "user", content: '{"message":"hello"}' },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

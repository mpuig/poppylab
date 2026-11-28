/**
 * The free model's provider: the AI SDK's OpenAI-compatible model with
 * every call handed to a Workers AI binding, here a fake one.
 */
import { describe, expect, it, vi } from "vitest";
import { askModel, runModel, WORKERS_AI_MODEL } from "./server";

type Input = {
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ function: { name: string } }>;
  max_tokens?: number;
  chat_template_kwargs?: { enable_thinking: boolean };
};
const completion = (message: Record<string, unknown>, neurons = 10) => ({
  choices: [
    {
      index: 0,
      message: { role: "assistant", ...message },
      finish_reason: message.tool_calls ? "tool_calls" : "stop",
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 10, neurons },
});
/**
 * A streamed call as the binding sends it: OpenAI's chunks, each with its
 * own tokens' Neurons and padding, then the call's usage in the older
 * shape, then `[DONE]`, cut at odd places as a network would.
 */
const streamed = (deltas: Array<Record<string, unknown>>, neurons = 1) => {
  const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "@cf/google/gemma-4-26b-a4b-it-external",
    choices: [
      {
        index: 0,
        delta: {
          reasoning_content: null,
          ...delta,
          // A stream names each tool call by its place.
          ...(Array.isArray(delta.tool_calls)
            ? {
                tool_calls: delta.tool_calls.map((c: object, index) => ({
                  index,
                  ...c,
                })),
              }
            : {}),
        },
        finish_reason: finish,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 1, neurons: 0.03 },
    p: "padding",
  });
  const tools = deltas.some((d) => d.tool_calls);
  const events = [
    chunk({ role: "assistant", content: "" }, null),
    ...deltas.map((d) => chunk(d, null)),
    chunk({}, tools ? "tool_calls" : "stop"),
    {
      response: "",
      usage: { prompt_tokens: 50, completion_tokens: 9, neurons },
    },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`);
  const bytes = new TextEncoder().encode(`${events.join("")}data: [DONE]\n\n`);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += 37)
        controller.enqueue(bytes.slice(at, at + 37));
      controller.close();
    },
  });
};
const call = (name: string) => ({
  content: null,
  tool_calls: [
    {
      id: `call_${name}`,
      type: "function",
      function: { name, arguments: "{}" },
    },
  ],
});

describe("Workers AI through its binding", () => {
  it("runs a tool loop, sends the assistant's empty content as text, and reports each call's Neurons", async () => {
    const inputs: Input[] = [];
    const binding = {
      run: vi.fn(async (_model: string, input: Record<string, unknown>) => {
        inputs.push(input as Input);
        return inputs.length === 1
          ? completion(call("list_products"), 16.5)
          : completion({ content: "Apples." }, 21);
      }),
    };
    const onUsage = vi.fn();
    const execute = vi.fn(async () => ({ products: ["Apples"] }));
    const text = await runModel(
      "workers-ai",
      [{ role: "user", content: "What do you sell?" }],
      { list_products: { description: "List products", execute } },
      { workersAi: { binding, onUsage } },
    );
    expect(text).toBe("Apples.");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(binding.run.mock.calls.map(([model]) => model)).toEqual([
      WORKERS_AI_MODEL,
      WORKERS_AI_MODEL,
    ]);
    expect(inputs[0]!.tools!.map((t) => t.function.name)).toEqual([
      "list_products",
    ]);
    // The binding refuses `content: null` after a tool call (5006).
    const assistant = inputs[1]!.messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toBe("");
    // Thinking stays on for a turn.
    expect(inputs[0]!.chat_template_kwargs).toBeUndefined();
    expect(onUsage.mock.calls).toEqual([[16.5], [21]]);
  });

  it("takes two steps more than another model, and no more", async () => {
    const binding = {
      run: vi.fn(async () => completion(call("list_products"))),
    };
    await runModel(
      "workers-ai",
      [{ role: "user", content: "Loop" }],
      {
        list_products: {
          description: "List products",
          execute: async () => ({}),
        },
      },
      { workersAi: { binding } },
    );
    expect(binding.run).toHaveBeenCalledTimes(7);
  });

  it("asks a short question with thinking off, so it fits its tokens", async () => {
    const binding = {
      run: vi.fn(async (_model: string, _input: Record<string, unknown>) =>
        completion({ content: "https://bank-demo.poppylab.dev" }),
      ),
    };
    const answer = await askModel(
      "workers-ai",
      { system: "Which Company?", prompt: "what is my bank account" },
      { workersAi: { binding } },
    );
    expect(answer).toBe("https://bank-demo.poppylab.dev");
    const input = binding.run.mock.calls[0]![1] as Input;
    expect(input.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(input.max_tokens).toBe(64);
  });

  it("says what the visitor can do when the allocation is used up or the binding fails", async () => {
    const failing = (message: string) => ({
      run: vi.fn(async () => {
        throw new Error(message);
      }),
    });
    const ask = (binding: ReturnType<typeof failing>) =>
      askModel(
        "workers-ai",
        { system: "s", prompt: "p" },
        { workersAi: { binding } },
      ).catch((error: Error & { code?: string }) => error);
    const used = await ask(
      failing("4006: you have used up your daily free allocation"),
    );
    expect(used).toMatchObject({
      code: "provider_quota",
      message:
        "The free model is busy or has used its allowance for now. Try again later, or switch to Demo mode or your own model.",
    });
    const broken = await ask(failing("5000: internal detail never shown"));
    expect(broken).toMatchObject({ code: "provider_unavailable" });
    expect(String((broken as Error).message)).not.toContain("internal detail");
  });

  it("estimates fallback Neurons when Workers AI omits or zeros usage.neurons", async () => {
    const responses: Array<Record<string, unknown>> = [
      {
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "from tokens" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 450, completion_tokens: 60 },
      },
      {
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "small tokens" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, neurons: 0 },
      },
      {
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "no usage" },
            finish_reason: "stop",
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "negative neurons" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 300, completion_tokens: 5, neurons: -10 },
      },
    ];
    let index = 0;
    const binding = {
      run: vi.fn(async () => responses[index++]!),
    };
    const onUsage = vi.fn();
    for (let i = 0; i < responses.length; i++) {
      await askModel(
        "workers-ai",
        { system: "s", prompt: "p" },
        { workersAi: { binding, onUsage } },
      );
    }
    expect(onUsage.mock.calls).toEqual([[51], [20], [20], [31]]);
  });

  it("streams the answer through the binding, tools and all, and counts the whole call's Neurons once", async () => {
    const inputs: Array<Input & { stream?: boolean }> = [];
    const binding = {
      run: vi.fn(async (_model: string, input: Record<string, unknown>) => {
        inputs.push(input as Input);
        return inputs.length === 1
          ? streamed([{ tool_calls: call("list_products").tool_calls }], 2.5)
          : streamed(
              [
                { content: "We sell" },
                { content: " apples. They" },
                { content: " are fresh." },
              ],
              1.75,
            );
      }),
    };
    const onUsage = vi.fn();
    const pieces: string[] = [];
    const text = await runModel(
      "workers-ai",
      [{ role: "user", content: "What do you sell?" }],
      {
        list_products: {
          description: "List products",
          execute: async () => ({ products: ["Apples"] }),
        },
      },
      { workersAi: { binding, onUsage }, onText: (t) => pieces.push(t) },
    );
    expect(text).toBe("We sell apples. They are fresh.");
    expect(pieces.join("").trim()).toBe(text);
    expect(pieces.slice(0, 3)).toEqual([
      "We sell",
      " apples. They",
      " are fresh.",
    ]);
    expect(inputs.map((input) => input.stream)).toEqual([true, true]);
    // The binding still refuses `content: null` after a tool call.
    const assistant = inputs[1]!.messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toBe("");
    // Each call's total, from the binding's last event: not every chunk's.
    expect(onUsage.mock.calls).toEqual([[2.5], [1.75]]);
  });

  it("keeps what the model said before a tool, as a paragraph of the answer", async () => {
    let calls = 0;
    const binding = {
      run: vi.fn(async () =>
        ++calls === 1
          ? streamed([
              { content: "Let me look." },
              { tool_calls: call("list_products").tool_calls },
            ])
          : streamed([{ content: "Apples." }]),
      ),
    };
    const pieces: string[] = [];
    const text = await runModel(
      "workers-ai",
      [{ role: "user", content: "What do you sell?" }],
      {
        list_products: {
          description: "List products",
          execute: async () => ({}),
        },
      },
      { workersAi: { binding }, onText: (t) => pieces.push(t) },
    );
    expect(text).toBe("Let me look.\n\nApples.");
    expect(pieces.join("").trim()).toBe(text);
  });

  it("answers whole when the stream fails before anything was said or done", async () => {
    let calls = 0;
    const binding = {
      run: vi.fn(async (_model: string, input: Record<string, unknown>) => {
        calls++;
        if (input.stream) return { not: "a stream" };
        return completion({ content: "Apples." });
      }),
    };
    const pieces: string[] = [];
    const text = await runModel(
      "workers-ai",
      [{ role: "user", content: "What do you sell?" }],
      {},
      { workersAi: { binding }, onText: (t) => pieces.push(t) },
    );
    expect(text).toBe("Apples.");
    expect(pieces).toEqual([]);
    expect(calls).toBe(2);
  });

  it("is refused without a binding", async () => {
    await expect(
      askModel("workers-ai", { system: "s", prompt: "p" }),
    ).rejects.toThrow(/runs only on the deployed site/);
  });
});

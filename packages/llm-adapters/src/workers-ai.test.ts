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
    expect(input.max_tokens).toBe(400);
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

  it("is refused without a binding", async () => {
    await expect(
      askModel("workers-ai", { system: "s", prompt: "p" }),
    ).rejects.toThrow(/runs only on the deployed site/);
  });
});

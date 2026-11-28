/**
 * A turn the model wrote no answer to, or stopped at what it was about to
 * do, and a routing question kept cheap. The model is scripted: OpenAI's
 * Responses API, as GPT-6 Luna answers it, from a local server, and the
 * free model's Workers AI binding, streamed.
 */
import { createServer } from "node:http";
import { once } from "node:events";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { askModel, runModel } from "./server";

const target = vi.hoisted(() => ({ url: "" }));
vi.mock("@ai-sdk/openai", async (original) => {
  const actual = await original<typeof import("@ai-sdk/openai")>();
  return {
    ...actual,
    createOpenAI: (settings: Parameters<typeof actual.createOpenAI>[0]) =>
      actual.createOpenAI({ ...settings, baseURL: target.url }),
  };
});

/** One step the model takes: a tool call, words, or a refusal. */
type Output =
  | { call: string; args?: Record<string, unknown> }
  | { text: string }
  | { status: number };
/** What each request sent, as JSON: its instructions, input and options. */
const requests: Array<Record<string, unknown>> = [];
let script: Output[] = [];
let calls = 0;
const next = () => script.shift() ?? { text: "" };

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const step = next();
  response.setHeader("Content-Type", "application/json");
  if ("status" in step) {
    response.statusCode = step.status;
    response.end(JSON.stringify({ error: { message: "unsupported value" } }));
    return;
  }
  const n = ++calls;
  response.end(
    JSON.stringify({
      id: `resp_${n}`,
      object: "response",
      created_at: 1,
      status: "completed",
      model: "gpt-6-luna",
      output:
        "call" in step
          ? [
              {
                type: "function_call",
                id: `fc_${n}`,
                call_id: `call_${n}`,
                name: step.call,
                arguments: JSON.stringify(step.args ?? {}),
              },
            ]
          : [
              {
                id: `msg_${n}`,
                type: "message",
                role: "assistant",
                status: "completed",
                content: step.text
                  ? [{ type: "output_text", text: step.text, annotations: [] }]
                  : [],
              },
            ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }),
  );
});

/** The Workers AI binding's stream of one step, as it sends it. */
function streamOf(step: Output): ReadableStream<Uint8Array> {
  const n = ++calls;
  const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
    id: `c${n}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "gemma",
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const events =
    "call" in step
      ? [
          chunk(
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call_${n}`,
                  type: "function",
                  function: {
                    name: step.call,
                    arguments: JSON.stringify(step.args ?? {}),
                  },
                },
              ],
            },
            null,
          ),
          chunk({}, "tool_calls"),
        ]
      : [
          chunk({ role: "assistant", content: "" }, null),
          ...("text" in step && step.text
            ? [chunk({ content: step.text }, null)]
            : []),
          chunk({}, "stop"),
        ];
  const bytes = new TextEncoder().encode(
    `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`,
  );
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
const binding = {
  run: async (_model: string, input: Record<string, unknown>) => {
    requests.push(input);
    const step = next();
    if ("status" in step) throw new Error("5006: bad input");
    if (input.stream) return streamOf(step);
    const n = ++calls;
    return {
      choices: [
        {
          index: 0,
          message:
            "call" in step
              ? {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: `call_${n}`,
                      type: "function",
                      function: {
                        name: step.call,
                        arguments: JSON.stringify(step.args ?? {}),
                      },
                    },
                  ],
                }
              : { role: "assistant", content: step.text },
          finish_reason: "call" in step ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, neurons: 1 },
    };
  },
};

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  target.url = `http://127.0.0.1:${address.port}/v1`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  requests.length = 0;
  script = [];
  vi.stubEnv("OPENAI_API_KEY", "test-placeholder-not-a-secret");
  vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
  vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
});

const tool = (output: unknown) => ({
  description: "A tool",
  execute: vi.fn(async (_input?: Record<string, unknown>) => output),
});
/** Everything a request sent, to look for words in. */
const sent = (i: number) => JSON.stringify(requests[i]);

const backends = [
  {
    name: "GPT-6 Luna, whole",
    provider: "openai-compatible",
    budget: 5,
    config: {},
    toolChoice: (i: number) => requests[i]!.tool_choice,
  },
  {
    name: "the free model, streamed",
    provider: "workers-ai",
    budget: 7,
    config: { workersAi: { binding } },
    toolChoice: (i: number) => requests[i]!.tool_choice,
  },
] as const;

for (const backend of backends)
  describe(backend.name, () => {
    const streamed = backend.provider === "workers-ai";
    const run = async (
      messages: Parameters<typeof runModel>[1],
      tools: Parameters<typeof runModel>[2],
      config: Parameters<typeof runModel>[3] = {},
    ) => {
      const heard: string[] = [];
      const text = await runModel(backend.provider, messages, tools, {
        ...backend.config,
        ...config,
        ...(streamed ? { onText: (t: string) => heard.push(t) } : {}),
      });
      return { text, heard: heard.join("") };
    };

    it("asks once more, with no tool to call, when the tools ran and no answer was written", async () => {
      script = [
        { call: "my_orders" },
        { text: "" },
        { text: "Your order is on Friday." },
      ];
      const { text, heard } = await run(
        [{ role: "user", content: "When is my order?" }],
        { my_orders: tool({ orders: [{ slot: "Friday" }] }) },
      );
      expect(text).toBe("Your order is on Friday.");
      if (streamed) expect(heard).toContain("Your order is on Friday.");
      expect(requests).toHaveLength(3);
      expect(backend.toolChoice(2)).toBe("none");
      expect(sent(2)).toContain("called tools and wrote no answer");
      // What the tools returned is what it is asked from.
      expect(sent(2)).toContain("Friday");
    });

    it("keeps the budget's last step for the answer", async () => {
      script = Array.from({ length: backend.budget - 1 }, () => ({
        call: "my_orders",
      }));
      script.push({ text: "You have one order, on Friday." });
      const orders = tool({ orders: [] });
      const { text } = await run([{ role: "user", content: "Loop" }], {
        my_orders: orders,
      });
      expect(text).toBe("You have one order, on Friday.");
      // As many steps in all as before, the last with no tool to call.
      expect(requests).toHaveLength(backend.budget);
      expect(orders.execute).toHaveBeenCalledTimes(backend.budget - 1);
      expect(backend.toolChoice(backend.budget - 1)).toBe("none");
    });

    it("says what was done, in the caller's words, when there is still no answer", async () => {
      script = [{ call: "my_orders" }, { text: "" }, { text: "" }];
      const { text, heard } = await run(
        [{ role: "user", content: "¿Cuándo llega mi pedido?" }],
        { my_orders: tool({ orders: [] }) },
        { unanswered: () => "Lo he consultado en Lantern Noodle Bar, pero…" },
      );
      expect(text).toBe("Lo he consultado en Lantern Noodle Bar, pero…");
      if (streamed) expect(heard).toContain("Lo he consultado");
      expect(text).not.toMatch(/more specific question/);
      // Without the caller's words, plain ones of its own.
      script = [{ call: "my_orders" }, { text: "" }, { text: "" }];
      expect(
        (await run([{ role: "user", content: "x" }], { my_orders: tool({}) }))
          .text,
      ).toBe(
        "I made the requests for this, but no answer came out of them. Ask me again, or tell me in other words what you'd like done.",
      );
    });

    it("goes on when the answer stops at what it was about to do", async () => {
      script = [
        { text: "I'll check your balance for you now." },
        { call: "accounts" },
        { text: "Checking has $4,220.00." },
      ];
      const accounts = tool({ checking: 422000 });
      const { text } = await run(
        [{ role: "user", content: "What's my balance?" }],
        { accounts },
      );
      expect(accounts.execute).toHaveBeenCalledTimes(1);
      expect(text).toBe(
        "I'll check your balance for you now.\n\nChecking has $4,220.00.",
      );
      expect(sent(1)).toContain("said what you were about to do");
      expect(backend.toolChoice(1)).not.toBe("none");
    });

    it.each([
      "Your change is ready below. Let me know if you'd like anything else.",
      "Checking has $4,220.00.",
    ])("leaves a whole answer as it is: %j", async (answer) => {
      script = [{ text: answer }];
      expect(
        (await run([{ role: "user", content: "x" }], { a: tool({}) })).text,
      ).toBe(answer);
      expect(requests).toHaveLength(1);
    });

    it("goes on with the order, with its tools, after the user answers its question", async () => {
      // "pork", in answer to Iris's own question: the conversation says
      // what it answers, and the instructions say to go on with the task.
      script = [
        { call: "my_orders" },
        {
          call: "change_order",
          args: { order_id: "ord_LNB1001", add: [{ dish_id: "pork-gyoza" }] },
        },
        {
          text: "Lantern Noodle Bar has the change ready; its exact terms wait below.",
        },
      ];
      const orders = tool({ orders: [{ id: "ord_LNB1001" }] });
      const change = tool({ status: "approval_required" });
      const agent = tool({ replies: [] });
      const { text } = await run(
        [
          { role: "user", content: "Add gyoza to my order" },
          {
            role: "assistant",
            content:
              "Would you like pork gyoza or vegetable gyoza? Each order comes with six.",
          },
          { role: "user", content: "pork" },
        ],
        { my_orders: orders, change_order: change, company_agent_send: agent },
      );
      expect(text).toContain("ready");
      expect(change.execute).toHaveBeenCalledWith({
        order_id: "ord_LNB1001",
        add: [{ dish_id: "pork-gyoza" }],
      });
      expect(agent.execute).not.toHaveBeenCalled();
      expect(sent(0)).toContain("pork gyoza or vegetable");
      expect(sent(0)).toContain(
        "it is their answer to it: go on with the same task at the same Company, with the API tools that task uses",
      );
      expect(sent(0)).toContain(
        "never for what an API tool does, such as reading the menu or changing an order",
      );
    });
  });

describe("a routing question", () => {
  it("is asked with no reasoning and a few tokens", async () => {
    script = [{ text: "https://food-demo.poppylab.dev" }];
    expect(
      await askModel("openai-compatible", { system: "Which?", prompt: "menu" }),
    ).toBe("https://food-demo.poppylab.dev");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.reasoning).toEqual({ effort: "none" });
    expect(requests[0]!.max_output_tokens).toBe(64);
  });

  it("is asked again at the turn's effort, with room to reason, of a model that refuses no reasoning", async () => {
    script = [{ status: 400 }, { text: "https://food-demo.poppylab.dev" }];
    expect(
      await askModel("openai-compatible", { system: "Which?", prompt: "menu" }),
    ).toBe("https://food-demo.poppylab.dev");
    expect(requests.map((r) => r.reasoning)).toMatchObject([
      { effort: "none" },
      { effort: "low" },
    ]);
    expect(requests[1]!.max_output_tokens).toBe(64 + 1024);
  });
});

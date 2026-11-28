/**
 * The model's answer as it is written: the chat route and `/api/v1` with
 * `Accept: text/event-stream`, the free model's binding streaming a tool
 * call and then its words, a chunk every few milliseconds as a network
 * would. The real runtime and adapters; only the network, the binding and
 * Turnstile's answer are replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() =>
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
);
const discover = vi.hoisted(() => vi.fn());
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: discover,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.includes("visitor") ? { value: "s".repeat(43) } : undefined,
    set: vi.fn(),
  }),
}));
vi.mock("@poppy-lab/pap-agent/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-agent/deployment")>()),
  serving: () => true,
  publicMode: () => false,
  isAccountCompany: () => true,
  proposalsAllowed: () => true,
}));
import { connected, discovered } from "@poppy-lab/pap-agent/testing";
import { configureFreeModel } from "@poppy-lab/pap-agent/free-model";
import { seedRun } from "@poppy-lab/pap-agent/runs";
import type { Run } from "@poppy-lab/pap-agent/runtime";
import { POST } from "./route";
import { POST as V1 } from "../v1/[...path]/route";

const shop = "https://shop.papsandbox.com";
const api = {
  servers: [{ url: shop }],
  paths: { "/api/products": { get: { operationId: "list_products" } } },
};
const ANSWER =
  "Juniper Market sells apples at $2.50 a pound. They are picked this week. Anything else?";
/** How long the fake binding waits between two chunks of words. */
const EVERY = 15;

/** A call as the binding streams it: OpenAI's chunks, then its usage, then `[DONE]`. */
function streamed(deltas: Array<Record<string, unknown>>, every = EVERY) {
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "c",
      object: "chat.completion.chunk",
      created: 1,
      model: "@cf/google/gemma-4-26b-a4b-it-external",
      choices: [{ index: 0, delta, finish_reason: finish }],
      usage: { prompt_tokens: 0, completion_tokens: 1, neurons: 0.03 },
      p: "pad",
    })}\n\n`;
  const tools = deltas.some((d) => d.tool_calls);
  const events = [
    chunk({ role: "assistant", content: "" }, null),
    ...deltas.map((d) => chunk(d, null)),
    chunk({}, tools ? "tool_calls" : "stop"),
    `data: ${JSON.stringify({ response: "", usage: { neurons: 4 } })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
        await new Promise((resolve) => setTimeout(resolve, every));
      }
      controller.close();
    },
  });
}
/** The words of the answer, a few characters a chunk. */
const words = (text: string) =>
  text.match(/.{1,6}/gs)!.map((content) => ({ content }));
let streams = true;
const asked: Array<Record<string, unknown>> = [];
const binding = {
  run: vi.fn(async (_model: string, input: Record<string, unknown>) => {
    asked.push(input);
    const first = asked.length % 2 === 1;
    if (!input.stream || !streams)
      return {
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
              : { role: "assistant", content: ANSWER },
            finish_reason: first ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, neurons: 4 },
      };
    return first
      ? streamed([
          {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "list_products", arguments: "{}" },
              },
            ],
          },
        ])
      : streamed(words(ANSWER));
  }),
};
const siteverify = vi.fn(async () =>
  Response.json({ success: true, hostname: "localhost", action: "chat" }),
);

let count = 0;
let id = "";
beforeEach(async () => {
  vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
  vi.stubGlobal("fetch", siteverify);
  configureFreeModel({ binding: () => binding });
  streams = true;
  asked.length = 0;
  transport.mockReset().mockImplementation(async (url) => {
    const path = new URL(url).pathname;
    if (path === "/poppy/openapi.json") return api;
    if (path === "/poppy/tasks") return { excluded_tasks: [] };
    if (path === "/api/products") return { products: [{ name: "Apples" }] };
    return { ok: true };
  });
  discover
    .mockReset()
    .mockImplementation(async () => discovered(shop, "Juniper Market"));
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: [connected(shop, "Juniper Market")],
  };
  id = `run_streaming_${String(++count).padStart(6, "0")}`;
  await seedRun("s".repeat(43), id, run);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Event = { type: string; at: number; [key: string]: unknown };
/** A streamed response's events, each with when it arrived. */
async function read(response: Response, since: number) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Event[] = [];
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const blocks = buffered.split("\n\n");
    buffered = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split("\n").find((l) => l.startsWith("data: "));
      if (data)
        events.push({
          ...(JSON.parse(data.slice(6)) as { type: string }),
          at: performance.now() - since,
        });
    }
    if (done) return events;
  }
}
const page = (message: string, accept = "text/event-stream") =>
  POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        Accept: accept,
        "X-Poppy-Conversation": id,
      },
      body: JSON.stringify({
        message,
        provider: "free",
        apiKey: "",
        turnstile: "good",
        companies: true,
      }),
    }),
  );

describe("the page's chat, streamed", () => {
  it("sends each sentence as the model writes it, then the answer it always had", async () => {
    const since = performance.now();
    const response = await page("What do you sell?");
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const events = await read(response, since);
    const deltas = events.filter((e) => e.type === "message.delta");
    expect(deltas.map((d) => d.text)).toEqual([
      "Juniper Market sells apples at $2.50 a pound. ",
      "They are picked this week. ",
      // The step's end comes with its last sentence.
      "Anything else?\n\n",
    ]);
    const answer = events.at(-1)!;
    expect(answer).toMatchObject({
      type: "answer",
      status: 200,
      headers: { "X-Poppy-Conversation": id },
      body: { text: ANSWER, mode: "free", from: { name: "Juniper Market" } },
    });
    // The first sentence came well before the whole answer.
    expect(deltas[0]!.at).toBeLessThan(answer.at - 10 * EVERY);
    // Both calls streamed, and the tool's call went to the Company.
    expect(asked.map((a) => a.stream)).toEqual([true, true]);
    expect(
      transport.mock.calls.map(([url]) => new URL(url).pathname),
    ).toContain("/api/products");
  });

  it("answers whole, as before, a request that doesn't ask for the stream", async () => {
    const response = await page("What do you sell?", "application/json");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("X-Poppy-Conversation")).toBe(id);
    expect(await response.json()).toMatchObject({ text: ANSWER, mode: "free" });
    expect(asked.map((a) => a.stream)).toEqual([undefined, undefined]);
  });

  it("answers whole when the model's stream fails before it said anything", async () => {
    streams = false;
    const response = await page("What do you sell?");
    // Nothing was streamed: the answer is the one without the stream.
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ text: ANSWER, mode: "free" });
    // The streamed call failed; the turn was asked again, whole.
    expect(asked[0]!.stream).toBe(true);
    expect(asked.slice(1).every((a) => a.stream === undefined)).toBe(true);
  });

  it("answers a turn refused before it said anything with its own status", async () => {
    // A conversation past its 20 turns: refused before the model.
    id = `run_streaming_${String(++count).padStart(6, "0")}`;
    await seedRun("s".repeat(43), id, {
      protocol: "1.0",
      visitor: "",
      expires: Date.now() + 3600000,
      calls: 20,
      busy: false,
      history: [],
      connections: [connected(shop, "Juniper Market")],
    });
    const response = await page("What do you sell?");
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(asked).toEqual([]);
  });
});

describe("/api/v1, streamed", () => {
  const send = (text: string) =>
    V1(
      new Request(`http://localhost:3000/api/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          text,
          model: { provider: "free", turnstile: "good" },
        }),
      }),
    );

  it("sends the agent's sentences with their spoken form, then the turn, whose message names them", async () => {
    binding.run.mockClear();
    const since = performance.now();
    const response = await send("What do you sell?");
    const events = await read(response, since);
    const deltas = events.filter((e) => e.type === "message.delta");
    expect(
      deltas.map(({ index, text, spoken }) => ({ index, text, spoken })),
    ).toEqual([
      {
        index: 0,
        text: "Juniper Market sells apples at $2.50 a pound. ",
        spoken: "Juniper Market sells apples at 2 dollars 50 a pound.",
      },
      {
        index: 1,
        text: "They are picked this week. ",
        spoken: "They are picked this week.",
      },
      { index: 2, text: "Anything else?\n\n", spoken: "Anything else?" },
    ]);
    const turn = events.at(-1) as Event & {
      result: {
        messages: Array<{ from: string; text: string; id?: string }>;
      };
    };
    expect(turn.type).toBe("turn");
    const answer = turn.result.messages.find((m) => m.from === "agent")!;
    expect(answer.text).toBe(ANSWER);
    expect(new Set(deltas.map((d) => d.message))).toEqual(new Set([answer.id]));
    // The User's line carries no ID: only the agent's sentences stream.
    expect(turn.result.messages[0]).toMatchObject({
      from: "user",
      text: "What do you sell?",
    });
    expect(turn.result.messages[0]).not.toHaveProperty("id");
    expect(deltas[0]!.at).toBeLessThan(turn.at - 10 * EVERY);
  });
});

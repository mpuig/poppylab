/**
 * The chat route with the free model: a turn past Turnstile runs the
 * model through the Workers AI binding and counts what it cost; a turn
 * without a good token, or past a limit, runs in demo mode and says why
 * in one line. The real runtime and adapters; only the network, the
 * binding and Turnstile's answer are replaced.
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
      name.includes("visitor") ? { value: "f".repeat(43) } : undefined,
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
import { connected, discovered } from "@poppy-lab/pap-agent/company-fixture";
import {
  addNeurons,
  configureFreeModel,
  dailyNeurons,
  FREE_LIMITS,
  neuronsToday,
} from "@poppy-lab/pap-agent/free-model";
import { seedRun } from "@poppy-lab/pap-agent/runs";
import type { Run } from "@poppy-lab/pap-agent/runtime";
import { POST } from "./route";

const shop = "https://shop.papsandbox.com";
const api = {
  servers: [{ url: shop }],
  paths: { "/api/products": { get: { operationId: "list_products" } } },
};

/** What the binding was asked, and what it answers: a tool call, then words. */
const asked: Array<{ model: string; input: Record<string, unknown> }> = [];
const binding = {
  run: vi.fn(async (model: string, input: Record<string, unknown>) => {
    asked.push({ model, input });
    const first = asked.length % 2 === 1;
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
            : { role: "assistant", content: "Juniper sells apples." },
          finish_reason: first ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, neurons: 21.5 },
    };
  }),
};
/** Turnstile's siteverify: `good` passes for this host and the chat's action. */
const siteverify = vi.fn(async (_url: string, init?: RequestInit) => {
  const token = new URLSearchParams(String(init?.body)).get("response");
  return Response.json(
    token === "good"
      ? { success: true, hostname: "localhost", action: "chat" }
      : token === "other-action"
        ? { success: true, hostname: "localhost", action: "login" }
        : { success: false, "error-codes": ["invalid-input-response"] },
  );
});

let count = 0;
let id = "";
async function conversation() {
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: [connected(shop, "Juniper Market")],
  };
  id = `run_free_model_${String(++count).padStart(4, "0")}`;
  await seedRun("f".repeat(43), id, run);
}
const say = async (message: string, turnstile?: string) => {
  const response = await POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Poppy-Conversation": id,
      },
      body: JSON.stringify({
        message,
        provider: "free",
        apiKey: "",
        // The page sends its own name for the model: never used.
        model: "cf/some/costly-model",
        // As the page sends it: Iris works out the Company.
        companies: true,
        ...(turnstile ? { turnstile } : {}),
      }),
    }),
  );
  return { status: response.status, answer: await response.json() };
};

// Two hours apart, so the hourly limits start again for each test.
let now = Date.UTC(2026, 10, 27, 0, 0);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: (now += 2 * 3600000 + 1) });
  vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
  vi.stubGlobal("fetch", siteverify);
  configureFreeModel({ binding: () => binding });
  asked.length = 0;
  binding.run.mockClear();
  siteverify.mockClear();
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
  await conversation();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a free-model turn", () => {
  it("runs the deployment's model through the binding and counts its Neurons", async () => {
    const before = await neuronsToday();
    const turn = await say("What do you sell?", "good");
    expect(turn.status).toBe(200);
    expect(turn.answer.text).toBe("Juniper sells apples.");
    expect(turn.answer.mode).toBe("free");
    expect(turn.answer.before).toBeUndefined();
    // The deployment's model, never the one the request names; the tool's
    // call went to the Company, and the assistant's empty content went as "".
    expect(asked.map((a) => a.model)).toEqual([
      "@cf/google/gemma-4-26b-a4b-it",
      "@cf/google/gemma-4-26b-a4b-it",
    ]);
    const messages = asked[1]!.input.messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(messages.find((m) => m.role === "assistant")!.content).toBe("");
    expect(
      transport.mock.calls.map(([url]) => new URL(url).pathname),
    ).toContain("/api/products");
    expect(await neuronsToday()).toBe(before + 43);
    expect(siteverify).toHaveBeenCalledTimes(1);
    expect(String(siteverify.mock.calls[0]![1]!.body)).toContain(
      "secret=secret-key",
    );
  });
});

describe("a turn the free model doesn't take runs in demo mode", () => {
  const demo = "so this turn ran in demo mode, with guided examples";

  it("without a token, asking nothing of Turnstile or the model", async () => {
    const turn = await say("Tell me a joke.");
    expect(turn.status).toBe(200);
    expect(turn.answer.mode).toBe("iris");
    expect(turn.answer.before).toBe(
      `The browser check for the free model hadn't finished, ${demo}. Send it again in a moment.`,
    );
    // Demo mode's own answer follows the line, with its examples.
    expect(turn.answer.text).toMatch(/^Demo mode runs the examples below/);
    expect(turn.answer.choices.length).toBeGreaterThan(0);
    expect(siteverify).not.toHaveBeenCalled();
    expect(binding.run).not.toHaveBeenCalled();
  });

  it("with a token Turnstile refuses, or one for another action", async () => {
    for (const token of ["bad", "other-action"]) {
      const turn = await say("What do you sell?", token);
      expect(turn.answer.before).toBe(
        `Cloudflare's browser check didn't pass, ${demo}. Send it again in a moment.`,
      );
    }
    expect(binding.run).not.toHaveBeenCalled();
  });

  it("past the visitor's turns for the hour, until the hour is over", async () => {
    for (let turn = 0; turn < FREE_LIMITS.visitor.hour; turn++)
      expect((await say("What do you sell?", "good")).answer.mode).toBe("free");
    const over = await say("What do you sell?", "good");
    expect(over.answer.before).toBe(
      `You've used the free model's ${FREE_LIMITS.visitor.hour} turns for this hour, ${demo}. Try again later, or use your own model.`,
    );
    expect(over.answer.mode).not.toBe("free");
    // A new conversation each time stays under its own turn limit.
    vi.setSystemTime((now += 3600000 + 1));
    await conversation();
    expect((await say("What do you sell?", "good")).answer.mode).toBe("free");
  });

  it("past the day's cap for every visitor, until the next UTC day", async () => {
    await addNeurons(dailyNeurons());
    const turn = await say("What do you sell?", "good");
    expect(turn.answer.before).toBe(
      `The free model has used today's allowance for everyone, ${demo}. It starts again at midnight UTC, or you can use your own model.`,
    );
    expect(siteverify).not.toHaveBeenCalled();
    vi.setSystemTime((now += 86400000));
    await conversation();
    expect((await say("What do you sell?", "good")).answer.mode).toBe("free");
  });

  it("where there is no binding, saying the free model runs only on the deployed site", async () => {
    configureFreeModel({ binding: () => undefined });
    const turn = await say("What do you sell?", "good");
    expect(turn.answer.before).toBe(
      `The free model runs only on the deployed site, ${demo}.`,
    );
  });

  it("until the Turnstile secret is set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const turn = await say("What do you sell?", "good");
    expect(turn.answer.before).toBe(
      `The free model is off on this deployment, ${demo}.`,
    );
  });
});

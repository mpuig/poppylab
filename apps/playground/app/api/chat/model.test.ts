/**
 * The chat route with a model selected: what the model is told of the
 * account, and what the page gets with its answer. The real runtime; only
 * the network and the model are replaced.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() =>
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
);
const discover = vi.hoisted(() => vi.fn());
const model = vi.hoisted(() => vi.fn());
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: discover,
}));
vi.mock("@poppy-lab/llm-adapters/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/llm-adapters/server")>()),
  runModel: model,
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
      name.includes("visitor") ? { value: "m".repeat(43) } : undefined,
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
import { createIdentity } from "@poppy-lab/pap-client";
import { connected, discovered } from "@poppy-lab/pap-agent/company-fixture";
import { seedRun } from "@poppy-lab/pap-agent/runs";
import type { Run } from "@poppy-lab/pap-agent/runtime";
import { POST } from "./route";

const shop = "https://shop.papsandbox.com";
const api = {
  servers: [{ url: shop }],
  paths: {
    "/api/products": { get: { operationId: "list_products" } },
  },
};

let count = 0;
let id = "";
/** A conversation with Juniper, signed in when it is given scopes. */
async function conversation(scopes?: string) {
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: [connected(shop, "Juniper Market", scopes)],
  };
  for (const c of run.connections)
    if (c.accountToken) c.dpop = (await createIdentity()).privateKey;
  id = `run_chat_model_${String(++count).padStart(4, "0")}`;
  await seedRun("m".repeat(43), id, run);
  return run;
}
const say = async (message: string) => {
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
        provider: "anthropic",
        apiKey: "key",
        url: shop,
      }),
    }),
  );
  return { status: response.status, answer: await response.json() };
};
/** What the model was told besides the turns, by `runModel`'s config. */
const told = () =>
  (model.mock.calls.at(-1)![3] as { context?: string }).context ?? "";

/** Juniper's answer to every feedback report (§9.3), as it gives it. */
const alternative = {
  instructions:
    "What Juniper's API, agent and website can't do can be asked of its staff in a support case.",
  references: [
    {
      type: "openapi",
      url: `${shop}/poppy/openapi.json`,
      operation_id: "propose_support_case",
    },
  ],
};

let now = Date.now();
beforeEach(() => {
  // A minute apart, so the route's per-minute limit never counts.
  vi.useFakeTimers({ toFake: ["Date"], now: (now += 61_000) });
  transport.mockReset().mockImplementation(async (url) => {
    const path = new URL(url).pathname;
    if (path === "/poppy/openapi.json") return api;
    if (path === "/poppy/tasks")
      return {
        excluded_tasks: [],
        feedback: { endpoint: `${shop}/poppy/feedback` },
      };
    if (path === "/poppy/feedback") return alternative;
    return { ok: true };
  });
  discover.mockReset().mockImplementation(async () => {
    const company = discovered(shop, "Juniper Market");
    company.profile!.tasksEndpoint = `${shop}/poppy/tasks`;
    return company;
  });
  model.mockReset().mockResolvedValue("Done.");
});

describe("what the model is told of the account", () => {
  it("says a signed-in user is signed in, and which permission a change needs", async () => {
    await conversation("poppy:read");
    expect((await say("Something in my delivery was wrong.")).status).toBe(200);
    expect(told()).toBe(
      "Account note: the user is signed in at Juniper Market, with these permissions: poppy:read. Never ask them to sign in. They don't include proposing changes: when a request needs that, tell the user this permission is missing and that they can choose Request change permission in the chat.",
    );
  });

  it("says a user who isn't signed in isn't, and one whose sign-in the Company refused must sign in again", async () => {
    await conversation();
    await say("What do you sell?");
    expect(told()).toContain("the user is not signed in at Juniper Market");
    const run = await conversation("poppy:read poppy:write");
    run.connections[0]!.accountUnavailable = true;
    await seedRun("m".repeat(43), id, run);
    await say("What do you sell?");
    expect(told()).toContain(
      "Juniper Market no longer accepts the user's sign-in",
    );
  });
});

/** A model that files one feedback report, then answers. */
const reporting = () =>
  model.mockImplementationOnce(
    async (
      _provider: string,
      _turns: unknown,
      tools: Record<string, { execute: (input: unknown) => unknown }>,
    ) => {
      await tools.report_unsupported_task!.execute({
        task: "Report a wrong item in a delivery",
        description: "The delivery had another product than the one ordered.",
      });
      return "I reported it.";
    },
  );

describe("what a Company says, in a model's turn", () => {
  it("shows the alternative to a feedback report as the Company's own words", async () => {
    await conversation("poppy:read");
    reporting();
    const turn = await say("Something in my delivery was wrong.");
    expect(turn.status).toBe(200);
    expect(turn.answer.company).toEqual([
      {
        author: "Juniper Market",
        human: false,
        text: alternative.instructions,
        data: JSON.stringify({ references: alternative.references }),
        note: "Answered the feedback report with another way to do this.",
        from: { origin: shop, name: "Juniper Market" },
      },
    ]);
  });
});

describe("the Data under a model's answer", () => {
  it("is what each tool the model called answered, exactly and in order, as demo mode keeps its one", async () => {
    const run = await conversation("poppy:read");
    const products = {
      products: [{ id: "apples", name: "Apples", price_cents: 390 }],
    };
    transport.mockImplementation(async (url) => {
      const path = new URL(url).pathname;
      if (path === "/poppy/openapi.json") return api;
      if (path === "/poppy/tasks")
        return {
          excluded_tasks: [],
          feedback: { endpoint: `${shop}/poppy/feedback` },
        };
      if (path === "/poppy/feedback") return alternative;
      return products;
    });
    model.mockImplementationOnce(
      async (
        _provider: string,
        _turns: unknown,
        tools: Record<string, { execute: (input?: unknown) => unknown }>,
      ) => {
        await tools.list_products!.execute({});
        await tools.report_unsupported_task!.execute({
          task: "Report a wrong item in a delivery",
          description: "The delivery had another product than the one ordered.",
        });
        return "Apples are $3.90, and I reported it.";
      },
    );
    const turn = await say("What do apples cost? Also my delivery was wrong.");
    const data = [
      { tool: "list_products", output: products },
      {
        tool: "report_unsupported_task",
        output: { sent: true, untrusted_company_content: true, alternative },
      },
    ];
    expect(JSON.parse(turn.answer.data)).toEqual(data);
    // Kept with the answer, so a reload shows it too.
    expect(JSON.parse(run.transcript!.at(-1)!.data!)).toEqual(data);

    // An answer that called no tool has none.
    model.mockResolvedValueOnce("Hello.");
    expect(await say("Hi")).not.toHaveProperty("answer.data");
  });
});

describe("a turn the model wrote no answer to", () => {
  it("says what was done, in the User's language, and what they can do next", async () => {
    await conversation("poppy:read");
    model.mockImplementationOnce(
      async (
        _provider: string,
        _turns: unknown,
        tools: Record<string, { execute: (input?: unknown) => unknown }>,
        config: { unanswered: () => string },
      ) => {
        await tools.list_products!.execute({});
        // As `runModel` does when, asked again, the model still wrote none.
        return config.unanswered();
      },
    );
    const turn = await say("¿Qué productos tenéis hoy?");
    expect(turn.answer.text).toBe(
      "Lo he consultado en Juniper Market, pero no he podido darte una respuesta con eso. Pregúntamelo otra vez, o dime con otras palabras qué quieres hacer.",
    );
    expect(turn.answer.text).not.toMatch(/more specific question/);
  });
});

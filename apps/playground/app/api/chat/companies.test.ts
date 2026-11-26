/**
 * The chat route for a conversation with several Companies, or with none:
 * which Company a turn is for, what the answer says of it, and that a
 * request to one Company carries nothing of another's. The real runtime;
 * only the network and the model are replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      name.includes("visitor") ? { value: "v".repeat(43) } : undefined,
    set: vi.fn(),
  }),
}));
vi.mock("@/lib/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deployment")>()),
  serving: () => true,
  publicMode: () => false,
  isAccountCompany: () => true,
  proposalsAllowed: () => true,
}));
import { createIdentity, ProtocolError } from "@poppy-lab/pap-client";
import { connected, discovered } from "@/lib/company-fixture";
import { forgetCompany } from "@/lib/transcript";
import { RUN_LIMITS } from "@/lib/run-size";
import { readConversation, seedRun, visitorOf } from "@/lib/runs";
import type { Run } from "@/lib/runtime";
import { POST } from "./route";

const shop = "https://shop.papsandbox.com";
const food = "https://food.example";
const names: Record<string, string> = {
  [shop]: "Juniper Market",
  [food]: "Lantern Noodle Bar",
};
const juniper = { origin: shop, name: "Juniper Market" };
const lantern = { origin: food, name: "Lantern Noodle Bar" };
const api = (origin: string) => ({
  servers: [{ url: origin }],
  paths: {
    "/api/products": { get: { operationId: "list_products" } },
    "/api/account/orders": {
      get: { operationId: "my_orders", "x-poppy-scopes": ["poppy:read"] },
    },
  },
});

let count = 0;
let id = "";
/** A conversation with both, each signed in when it is given scopes. */
async function conversation(signedIn: string[] = [], origins = [shop, food]) {
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: origins.map((origin) =>
      connected(
        origin,
        names[origin]!,
        signedIn.includes(origin) ? "poppy:read" : undefined,
      ),
    ),
  };
  // A signed-in request is bound to the connection's own DPoP key.
  for (const c of run.connections)
    if (c.accountToken) c.dpop = (await createIdentity()).privateKey;
  id = `run_chat_several_${String(++count).padStart(4, "0")}`;
  await seedRun("v".repeat(43), id, run);
  return run;
}
const say = async (
  message: string,
  more: Record<string, unknown> = {},
  conversationId: string | undefined = id,
) => {
  const response = await POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        ...(conversationId ? { "X-Poppy-Conversation": conversationId } : {}),
      },
      body: JSON.stringify({
        message,
        provider: "demo",
        companies: true,
        ...more,
      }),
    }),
  );
  return {
    status: response.status,
    conversation: response.headers.get("X-Poppy-Conversation"),
    answer: await response.json(),
  };
};
/** Every request made, as its address and what it carried. */
const sent = () =>
  transport.mock.calls.map(([url, init]) => ({
    url,
    carried: JSON.stringify(init ?? {}),
  }));
const words = (run: Run) =>
  (run.transcript ?? []).map((e) => [e.role, e.content, e.company]);

// The route takes twenty turns a minute in one process: each test starts
// a minute after the last one.
let now = Date.now();
afterEach(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: (now += 61_000) });
  transport
    .mockReset()
    .mockImplementation(async (url) =>
      url.endsWith("/poppy/openapi.json")
        ? api(new URL(url).origin)
        : { ok: true },
    );
  discover
    .mockReset()
    .mockImplementation(async (url: string) =>
      discovered(new URL(url).origin, names[new URL(url).origin]!),
    );
  model.mockReset();
});

describe("a turn in a conversation with several Companies", () => {
  it("goes to the Company the request names, and the answer says where it came from", async () => {
    const run = await conversation();
    const turn = await say("What are your products?", { company: food });
    expect(turn.status).toBe(200);
    expect(turn.answer.from).toEqual(lantern);
    expect(turn.answer.mode).toBe("demo");
    expect(turn.answer.text).toContain("The company answered:");
    // Everything was asked of Lantern, and nothing of Juniper.
    expect(sent().length).toBeGreaterThan(0);
    for (const request of sent())
      expect(new URL(request.url).origin).toBe(food);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(words(run)).toEqual([
      ["user", "What are your products?", food],
      ["assistant", turn.answer.text, food],
    ]);
    // What it offers stays with its connection, for the next turn's choice.
    expect(run.connections[1]!.offered!.map((t) => t.name)).toContain(
      "list_products",
    );
    expect(run.connections[0]!.offered).toBeUndefined();
  });

  it("goes to the Company the last turn was with when the request names none", async () => {
    await conversation();
    await say("What are your products?", { company: shop });
    transport.mockClear();
    const next = await say("And again?");
    expect(next.answer.from).toEqual(juniper);
    for (const request of sent())
      expect(new URL(request.url).origin).toBe(shop);
  });

  it("asks which Company when nothing says, and sends nothing to any", async () => {
    const run = await conversation();
    const turn = await say("What are your products?");
    expect(turn.status).toBe(200);
    expect(turn.answer).toMatchObject({
      text: "Which company is this for? This conversation is connected to Juniper Market and Lantern Noodle Bar.",
      mode: "iris",
      trace: [],
      company: [],
      choices: [
        { label: "Juniper Market", answer: { company: shop } },
        { label: "Lantern Noodle Bar", answer: { company: food } },
      ],
    });
    expect(turn.answer).not.toHaveProperty("from");
    expect(transport).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
    // The page showed the question; the model is not told of it, and the
    // turn counts for nothing.
    expect(words(run)).toEqual([
      ["user", "What are your products?", undefined],
      ["assistant", turn.answer.text, undefined],
    ]);
    expect(run.history).toEqual([]);
    expect(run.calls).toBe(0);
    expect(run.waiting).toBe("What are your products?");
  });

  it("takes the name of a Company as the answer, and then asks that Company what was asked", async () => {
    const run = await conversation();
    await say("What are your products?");
    const turn = await say("Lantern, please");
    expect(turn.answer.from).toEqual(lantern);
    expect(turn.answer.text).toContain("The company answered:");
    for (const request of sent())
      expect(new URL(request.url).origin).toBe(food);
    // The page shows what was typed; the model gets the request itself.
    expect(words(run).slice(2)).toEqual([
      ["user", "Lantern, please", food],
      ["assistant", turn.answer.text, food],
    ]);
    expect(run.history.map((t) => [t.role, t.content, t.company])).toEqual([
      ["user", "What are your products?", food],
      ["assistant", turn.answer.text, food],
    ]);
    expect(run.waiting).toBeUndefined();
  });

  it("drops the request that waited when the next message isn't a Company's name", async () => {
    const run = await conversation();
    await say("What are your products?");
    const again = await say("Never mind, what are your hours?");
    expect(again.answer.text).toMatch(/^Which company is this for\?/);
    expect(run.waiting).toBe("Never mind, what are your hours?");
    // The name is the User's answer, whichever Company the page had chosen.
    const named = await say("Juniper Market", { company: food });
    expect(named.answer.from).toEqual(juniper);
    expect(run.history[0]!.content).toBe("Never mind, what are your hours?");
  });

  it("refuses a turn for a Company the conversation isn't connected to", async () => {
    const run = await conversation();
    const turn = await say("my balance", { company: "https://bank.example" });
    expect(turn.status).toBe(400);
    expect(turn.answer).toEqual({
      code: "company_not_connected",
      error: "This conversation isn't connected to that company.",
    });
    expect(transport).not.toHaveBeenCalled();
    expect(run.transcript).toBeUndefined();
    expect(turn.conversation).toBe(id);
  });

  it("sends a request to one Company with that Company's token, and nothing of the other's", async () => {
    await conversation([shop, food]);
    const turn = await say("my orders", { company: food });
    expect(turn.answer.from).toEqual(lantern);
    expect(turn.answer.signedIn).toBe(true);
    const asked = sent().find((r) => r.url === `${food}/api/account/orders`)!;
    expect(asked.carried).toContain("access-food.example");
    for (const request of sent()) {
      expect(new URL(request.url).origin).toBe(food);
      expect(request.carried).not.toMatch(/shop\.papsandbox\.com/);
    }
  });

  it("answers with the state of the Company the turn was with", async () => {
    const run = await conversation([shop]);
    run.connections[0]!.operations = {
      op_1: {
        operation_id: "op_1",
        revision: "r1",
        state: "proposed",
        expires_at: "2030-01-01T00:00:00Z",
      },
    };
    const turn = await say("What are your products?", { company: food });
    expect(turn.answer).toMatchObject({
      from: lantern,
      signedIn: false,
      operations: [],
      direct: false,
    });
    const other = await say("What are your products?", { company: shop });
    expect(other.answer).toMatchObject({
      from: juniper,
      signedIn: true,
      scopes: "poppy:read",
      operations: [{ operation_id: "op_1" }],
    });
  });

  it("refuses one of the User's own Direct Conversation actions that fits no one Company", async () => {
    await conversation();
    const turn = await say("Leave the direct conversation", {
      direct: "close",
    });
    expect(turn.status).toBe(400);
    expect(turn.answer.code).toBe("company_required");
    expect(transport).not.toHaveBeenCalled();
  });

  it("says which Company a turn that failed was with", async () => {
    await conversation([food]);
    transport.mockImplementation(async (url) => {
      if (url.endsWith("/poppy/openapi.json")) return api(new URL(url).origin);
      if (url.endsWith("/api/account/orders"))
        throw new ProtocolError(503, undefined);
      return { ok: true };
    });
    const turn = await say("my orders", { company: food });
    expect(turn.status).toBe(502);
    expect(turn.answer.from).toEqual(lantern);
    expect(turn.answer.error).toMatch(/^Lantern Noodle Bar answered HTTP 503/);
  });
});

describe("a model's turn with one Company, sent the turns with another", () => {
  it("is kept as holding the other Company's account, and goes when that one signs out", async () => {
    const run = await conversation([shop]);
    const asked = { provider: "anthropic", apiKey: "key" };
    model.mockResolvedValueOnce("Order 7 for Elena.");
    await say("my orders", { ...asked, company: shop });
    // The turn with Lantern: the model is sent what it read at Juniper.
    model.mockImplementationOnce(
      async (
        _provider: string,
        turns: Array<{ role: string; content: string }>,
      ) => {
        expect(turns.map((t) => t.content)).toEqual([
          "my orders",
          "Order 7 for Elena.",
          "Can I get that at Lantern?",
        ]);
        // Only the role and the words: not which Company, or whose account.
        for (const turn of turns)
          expect(Object.keys(turn).sort()).toEqual(["content", "role"]);
        return "Elena's order 7 isn't on Lantern's menu.";
      },
    );
    const turn = await say("Can I get that at Lantern?", {
      ...asked,
      company: food,
    });
    expect(turn.answer.from).toEqual(lantern);
    expect(turn.answer.signedIn).toBe(false);
    for (const kept of [run.transcript!.slice(-2), run.history.slice(-2)])
      for (const entry of kept) {
        expect(entry).toMatchObject({ company: food, accounts: [shop] });
        expect(entry).not.toHaveProperty("signedOut");
      }
    // The lines of Lantern's requests too: a path can carry what was read.
    const lines = run.log!.filter((line) => line.company === food);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.accounts).toEqual([shop]);
      expect(line).not.toHaveProperty("signedOut");
    }
    // The page is told none of that.
    expect(JSON.stringify(turn.answer)).not.toContain("accounts");

    forgetCompany(run, run.connections[0]!);
    expect(JSON.stringify([run.transcript, run.history, run.log])).not.toMatch(
      /Elena|order 7|Order 7/,
    );
  });
});

describe("a conversation with no Company", () => {
  it("answers a message by saying to connect one, and names the lab's", async () => {
    const run = await conversation([], []);
    const turn = await say("What's on the menu?");
    expect(turn.status).toBe(200);
    expect(turn.answer).toMatchObject({
      text: "This conversation isn't connected to a company yet, so nothing was sent. Connect one first: Juniper Market, Lantern Noodle Bar, Harborline Bank, Northwind Air or Fernwick Power & Light from the lab, or another company by typing its address in the address box.",
      mode: "iris",
      signedIn: false,
      operations: [],
      company: [],
    });
    expect(turn.answer).not.toHaveProperty("from");
    expect(transport).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
    // Its words stay, and it is listed under them.
    expect(words(run)).toEqual([
      ["user", "What's on the menu?", undefined],
      ["assistant", turn.answer.text, undefined],
    ]);
    expect(run.title).toBe("What's on the menu?");
  });

  it("starts one for a message that names no conversation and no Company", async () => {
    const turn = await say("hello", {}, "");
    expect(turn.status).toBe(200);
    expect(turn.conversation).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(turn.answer.text).toMatch(
      /^This conversation isn't connected to a company yet/,
    );
    const { cookies } = await import("next/headers");
    const stored = await readConversation(
      visitorOf((await cookies()) as never)!,
      turn.conversation,
    );
    expect(stored!.connections).toEqual([]);
    expect(stored!.transcript).toHaveLength(2);
  });
});

describe("a page that shows one Company", () => {
  it("still names it by its address, and gets the turn's Company with the answer", async () => {
    await conversation([], [shop]);
    const turn = await say("What are your products?", { url: shop });
    expect(turn.status).toBe(200);
    expect(turn.conversation).toBe(id);
    expect(turn.answer.from).toEqual(juniper);
  });

  it("goes on in a new conversation when its Company isn't the conversation's, as before", async () => {
    const run = await conversation([], [shop]);
    const turn = await say("What are your products?", { url: food });
    expect(turn.status).toBe(200);
    expect(turn.conversation).not.toBe(id);
    expect(turn.answer.from).toEqual(lantern);
    expect(run.transcript).toBeUndefined();
  });
});

describe("a conversation too large to store", () => {
  it("answers the turn as not saved, and isn't left locked", async () => {
    const run = await conversation([], [shop]);
    // More than a stored conversation can hold.
    run.connections[0]!.publicHistory = [
      { role: "user", content: "x".repeat(RUN_LIMITS.bytes) },
    ];
    const turn = await say("What are your products?", { url: shop });
    expect(turn.status).toBe(507);
    expect(turn.answer).toEqual({
      code: "conversation_too_large",
      error:
        "This conversation has grown too large to keep, so what this request did wasn't saved and a reload won't show it. Start a new conversation to go on.",
      stage: "save",
      trace: [],
    });
    expect(turn.conversation).toBe(id);
    // The next request isn't told to wait for the last one.
    expect(run.busy).toBe(false);
    const again = await say("What are your products?", { url: shop });
    expect(again.status).toBe(507);
  });

  it("takes no further Company on the User's words, and says why", async () => {
    const run = await conversation([], [shop]);
    discover.mockImplementation(async (url: string) => {
      const company = discovered(new URL(url).origin, "Lantern Noodle Bar");
      company.document.apis![0]!.description = "x".repeat(RUN_LIMITS.connect);
      return company;
    });
    const turn = await say("connect with Lantern");
    expect(turn.status).toBe(200);
    expect(turn.answer.text).toBe(
      "This conversation holds too much to take Lantern Noodle Bar as well. Remove a company, or start a new conversation to connect Lantern Noodle Bar.",
    );
    expect(turn.answer).not.toHaveProperty("connections");
    expect(run.connections.map((c) => c.url)).toEqual([shop]);
  });
});

/**
 * "connect with Lantern", typed in the chat: the User's own message
 * connects a Company to the conversation or removes one. The real runtime;
 * only the network, discovery and the model are replaced.
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
import { createIdentity } from "@poppy-lab/pap-client";
import { PapDiscoveryError } from "@poppy-lab/pap-core";
import { connected, discovered } from "@/lib/company-fixture";
import { seedRun } from "@/lib/runs";
import type { Run } from "@/lib/runtime";
import { recordTurn } from "@/lib/transcript";
import { POST } from "./route";

// The lab's own Companies, where they are for a playground on localhost.
const shop = "http://juniper.localhost:4100";
const food = "http://noodles.localhost:4200";
const bank = "http://harbor.localhost:4300";
const air = "http://northwind.localhost:4400";
const names: Record<string, string> = {
  [shop]: "Juniper Market",
  [food]: "Lantern Noodle Bar",
  [bank]: "Harborline Bank",
  [air]: "Northwind Air",
};
const juniper = { origin: shop, name: "Juniper Market" };
const lantern = { origin: food, name: "Lantern Noodle Bar" };
const api = (origin: string) => ({
  servers: [{ url: origin }],
  paths: { "/api/products": { get: { operationId: "list_products" } } },
});
const offers = (name: string) => `“What ${name} offers to agents.”`;

let count = 0;
let id = "";
/** A conversation with these Companies, signed in at the ones named. */
async function conversation(origins = [shop], signedIn: string[] = []) {
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
  for (const c of run.connections)
    if (c.accountToken) c.dpop = (await createIdentity()).privateKey;
  id = `run_chat_connect_${String(++count).padStart(4, "0")}`;
  await seedRun("v".repeat(43), id, run);
  return run;
}
const say = async (message: string, more: Record<string, unknown> = {}) => {
  const response = await POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Poppy-Conversation": id,
      },
      body: JSON.stringify({ message, provider: "demo", ...more }),
    }),
  );
  return { status: response.status, answer: await response.json() };
};
const sent = () =>
  transport.mock.calls.map(([url, init]) => ({
    url,
    carried: JSON.stringify(init ?? {}),
  }));
const shown = (run: Run) =>
  (run.transcript ?? []).map((e) => [e.role, e.content, e.company]);
const told = (run: Run) => run.history.map((t) => [t.role, t.content]);

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

describe("“connect with <Company>”, typed in the chat", () => {
  it("connects one of the lab's Companies, and says what it offers and what comes next", async () => {
    const run = await conversation();
    const turn = await say("connect with Lantern");
    expect(turn.status).toBe(200);
    const text = `Connected to Lantern Noodle Bar. It describes what it offers as ${offers("Lantern Noodle Bar")}. You can ask it something now. Signing in is offered when a request needs your account there.`;
    expect(turn.answer).toMatchObject({
      text,
      mode: "iris",
      company: [],
      trace: [
        "Connected to Lantern Noodle Bar · discovery read at /.well-known/poppy.json",
      ],
    });
    expect(turn.answer).not.toHaveProperty("from");
    // The conversation's Companies as they are now, for the page.
    expect(
      turn.answer.connections.map((c: { name: string; signedIn: boolean }) => [
        c.name,
        c.signedIn,
      ]),
    ).toEqual([
      ["Juniper Market", false],
      ["Lantern Noodle Bar", false],
    ]);
    expect(turn.answer.connections[1].company.requestedUrl).toBe(food);
    // Discovery of the lab's own address for it, and nothing else: no
    // Session, no request to either Company.
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith(food, { allowedPrivateOrigins: [] });
    expect(transport).not.toHaveBeenCalled();
    expect(run.connections.map((c) => c.url)).toEqual([shop, food]);
    expect(run.connections[1]!.accountToken).toBeUndefined();
    expect(run.connections[1]!.sessionId).toBeUndefined();
    expect(run.calls).toBe(0);
    // The page showed the turn as Lantern's; the model gets it without the
    // Company's own words.
    expect(shown(run)).toEqual([
      ["user", "connect with Lantern", food],
      ["assistant", text, food],
    ]);
    expect(told(run)).toEqual([
      ["user", "connect with Lantern"],
      [
        "assistant",
        "Connected to Lantern Noodle Bar. You can ask it something now. Signing in is offered when a request needs your account there.",
      ],
    ]);
    expect(run.log).toEqual([
      {
        at: expect.any(Number),
        text: turn.answer.trace[0],
        signedOut: true,
        company: food,
      },
    ]);
    // The next message is for the Company just connected.
    const next = await say("What are your products?");
    expect(next.answer.from).toEqual(lantern);
  });

  it("connects and then carries on with the rest of the message at that Company", async () => {
    const run = await conversation();
    const turn = await say("Connect with Lantern and what are your products?");
    expect(turn.status).toBe(200);
    const before = `Connected to Lantern Noodle Bar. It describes what it offers as ${offers("Lantern Noodle Bar")}. Signing in is offered when a request needs your account there.`;
    expect(turn.answer).toMatchObject({ before, from: lantern, mode: "demo" });
    expect(turn.answer.text).toContain("The company answered:");
    expect(turn.answer.connections).toHaveLength(2);
    // The rest was asked of Lantern, and nothing of Juniper.
    expect(sent().length).toBeGreaterThan(0);
    for (const request of sent())
      expect(new URL(request.url).origin).toBe(food);
    // The page shows the message once, Iris's line, then the answer.
    expect(shown(run)).toEqual([
      ["user", "Connect with Lantern and what are your products?", food],
      ["assistant", before, food],
      ["assistant", turn.answer.text, food],
    ]);
    expect(told(run).map(([, words]) => words)).toEqual([
      "Connect with Lantern and what are your products?",
      "Connected to Lantern Noodle Bar. Signing in is offered when a request needs your account there.",
      "what are your products?",
      turn.answer.text,
    ]);
    // Each line is kept once: the connection's, then the turn's own.
    const lines = run.log!.map((line) => line.text);
    expect(lines[0]).toBe(
      "Connected to Lantern Noodle Bar · discovery read at /.well-known/poppy.json",
    );
    expect(new Set(lines).size).toBe(lines.length);
    expect(turn.answer.trace).toEqual(lines);
    expect(run.calls).toBe(1);
  });

  it("connects the first Company of a conversation that has none", async () => {
    const run = await conversation([]);
    const none = await say("What's on the menu?");
    expect(none.answer.choices).toContainEqual({
      label: "Lantern Noodle Bar",
      say: "Connect with Lantern Noodle Bar",
    });
    const turn = await say("Connect with Lantern Noodle Bar");
    expect(turn.answer.text).toMatch(/^Connected to Lantern Noodle Bar\./);
    expect(run.connections.map((c) => c.url)).toEqual([food]);
    // The words from before it are still there.
    expect(shown(run)[0]).toEqual(["user", "What's on the menu?", undefined]);
  });

  it("connects several at once, up to three in the conversation", async () => {
    const run = await conversation();
    const turn = await say("add Lantern, the bank and the airline");
    expect(turn.answer.text).toBe(
      `Connected to Lantern Noodle Bar and Harborline Bank. Lantern Noodle Bar describes what it offers as ${offers("Lantern Noodle Bar")}. Harborline Bank describes what it offers as ${offers("Harborline Bank")}. A conversation works with at most 3 companies. Remove one to connect another. You can ask them something now. Signing in is offered when a request needs your account at one of them.`,
    );
    expect(run.connections.map((c) => c.url)).toEqual([shop, food, bank]);
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("says so when the Company is connected already, and connects nothing", async () => {
    const run = await conversation([shop, food]);
    const turn = await say("also Lantern");
    expect(turn.answer.text).toBe(
      "This conversation is already connected to Lantern Noodle Bar.",
    );
    expect(turn.answer).not.toHaveProperty("connections");
    expect(discover).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(2);
    // What else was asked is still asked there.
    const more = await say("connect with Lantern and what are your products?");
    expect(more.answer).toMatchObject({
      before: "This conversation is already connected to Lantern Noodle Bar.",
      from: lantern,
    });
  });

  it("says a name fits no Company, lists the lab's, and never makes an address of it", async () => {
    const run = await conversation();
    for (const [message, said] of [
      ["connect with Acme", "Acme"],
      ["connect with food-demo.poppylab.dev", "food-demo.poppylab.dev"],
      ["connect to https://evil.example/", "https://evil.example/"],
    ]) {
      const turn = await say(message!);
      expect(turn.answer.text).toBe(
        `There is no company called “${said}” among the lab's. The lab's companies are Juniper Market, Lantern Noodle Bar, Harborline Bank, Northwind Air and Fernwick Power & Light. To connect another company, type its address in the address box.`,
      );
      // A button for each one that isn't connected.
      expect(
        turn.answer.choices.map((c: { label: string }) => c.label),
      ).toEqual([
        "Lantern Noodle Bar",
        "Harborline Bank",
        "Northwind Air",
        "Fernwick Power & Light",
      ]);
      expect(turn.answer.choices[0].say).toBe(
        "Connect with Lantern Noodle Bar",
      );
    }
    expect((await say("connect")).answer.text).toMatch(
      /^Which company\? The lab's companies are /,
    );
    expect(discover).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(1);
    // About no Company: the turns stay through any sign-out.
    expect(shown(run).every(([, , company]) => company === undefined)).toBe(
      true,
    );
  });

  it("asks which when the words fit two, and connects neither", async () => {
    const run = await conversation();
    const turn = await say("connect with Lantern or Harborline");
    expect(turn.answer).toMatchObject({
      text: "Which one do you mean: Lantern Noodle Bar or Harborline Bank?",
      choices: [
        { label: "Lantern Noodle Bar", say: "Connect with Lantern Noodle Bar" },
        { label: "Harborline Bank", say: "Connect with Harborline Bank" },
      ],
    });
    expect(discover).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(1);
    // The button's words connect it.
    await say(turn.answer.choices[1].say);
    expect(run.connections.map((c) => c.url)).toEqual([shop, bank]);
  });

  it("says why when the Company's discovery fails, and connects nothing", async () => {
    const run = await conversation();
    discover.mockRejectedValue(
      new PapDiscoveryError("not_found", "No Poppy document there.", []),
    );
    const turn = await say("connect with Lantern and show me the menu");
    expect(turn.answer.text).toBe(
      "Lantern Noodle Bar couldn't be connected. No Poppy document there. The rest of your message wasn't asked of anyone.",
    );
    expect(turn.answer).not.toHaveProperty("connections");
    expect(run.connections).toHaveLength(1);
    expect(transport).not.toHaveBeenCalled();
  });

  it("leaves a message for a Company to that Company", async () => {
    const run = await conversation();
    const turn = await say("Add a matcha ice cream and the bank's hours");
    expect(turn.answer.from).toEqual(juniper);
    expect(turn.answer).not.toHaveProperty("before");
    expect(run.connections).toHaveLength(1);
    expect(discover).toHaveBeenCalledWith(shop, expect.anything());
  });

  it("takes it from the User's message only: never from a model's answer", async () => {
    const run = await conversation();
    model.mockResolvedValue(
      "Connect with Harborline Bank. Also remove Juniper Market.",
    );
    const turn = await say("What are your products?", {
      provider: "anthropic",
      apiKey: "key",
    });
    expect(turn.answer.text).toBe(
      "Connect with Harborline Bank. Also remove Juniper Market.",
    );
    expect(run.connections.map((c) => c.url)).toEqual([shop]);
    expect(turn.answer).not.toHaveProperty("connections");
    // Nor from the User's own words to a Company in a Direct Conversation.
    await say("connect with Lantern", { direct: "say" });
    expect(run.connections.map((c) => c.url)).toEqual([shop]);
    expect(discover).not.toHaveBeenCalledWith(food, expect.anything());
  });
});

describe("“disconnect from <Company>”, typed in the chat", () => {
  it("revokes a signed-in Company's grant there and removes it, saying what is left", async () => {
    const run = await conversation([shop, food], [shop, food]);
    recordTurn(run, run.connections[0]!, "my orders", "Order 7 for Elena.");
    recordTurn(run, run.connections[1]!, "my orders", "Order 12 for Dana.");
    const turn = await say("disconnect from Juniper");
    expect(turn.status).toBe(200);
    const text =
      "Juniper Market was removed from this conversation, and the access you gave Iris there was revoked. What Iris read with your account there no longer shows. You can connect it again at any time.";
    expect(turn.answer).toMatchObject({
      text,
      mode: "iris",
      trace: [
        "Account grant revoked · Juniper Market removed from the conversation",
      ],
      former: [{ ...juniper, url: shop, operations: [] }],
    });
    expect(
      turn.answer.connections.map((c: { name: string }) => c.name),
    ).toEqual(["Lantern Noodle Bar"]);
    // One request: the revocation, at Juniper, with Juniper's own token.
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.url).toBe(`${shop}/oauth/revoke`);
    expect(sent()[0]!.carried).toContain("token=refresh-juniper.localhost");
    expect(sent()[0]!.carried).not.toMatch(/noodles\.localhost/);
    // What the page still shows from before this turn.
    expect(
      turn.answer.history.map((e: { content: string }) => e.content),
    ).toEqual(["my orders", "Order 12 for Dana."]);
    expect(run.connections.map((c) => c.url)).toEqual([food]);
    expect(JSON.stringify(run)).not.toMatch(/Elena|refresh-juniper/);
    expect(shown(run).slice(-2)).toEqual([
      ["user", "disconnect from Juniper", shop],
      ["assistant", text, shop],
    ]);
    // The line is kept once.
    expect(
      run.log!.filter((line) => line.text === turn.answer.trace[0]),
    ).toHaveLength(1);
  });

  it("removes a signed-out Company without sending anything, and goes on with the rest", async () => {
    const run = await conversation([shop, food]);
    const turn = await say("remove Juniper and what are your products?");
    expect(turn.answer).toMatchObject({
      before:
        "Juniper Market was removed from this conversation. You can connect it again at any time.",
      from: lantern,
    });
    expect(turn.answer.connections).toHaveLength(1);
    expect(run.connections.map((c) => c.url)).toEqual([food]);
    for (const request of sent())
      expect(new URL(request.url).origin).toBe(food);
  });

  it("is refused while an approval sent there has an unknown outcome", async () => {
    const run = await conversation([shop, food], [shop]);
    run.connections[0]!.operations = {
      op_1: {
        operation_id: "op_1",
        revision: "r1",
        state: "uncertain",
        expires_at: "2030-01-01T00:00:00Z",
        approval: { approved_at: 1, reference: "apr_1" },
      },
    };
    const turn = await say("remove Juniper");
    expect(turn.answer.text).toBe(
      "An approval sent to Juniper Market has an unknown outcome, so Juniper Market can't be removed yet. Retry that approval first: it is performed at most once. Without Juniper Market there would be no way to retry it, and the same change could be asked for twice.",
    );
    expect(turn.answer).not.toHaveProperty("connections");
    expect(transport).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(2);
  });

  it("says so for a Company the conversation isn't connected to", async () => {
    const run = await conversation([shop, food]);
    expect((await say("remove the bank")).answer.text).toBe(
      "This conversation isn't connected to Harborline Bank.",
    );
    expect((await say("disconnect from Acme")).answer.text).toBe(
      "This conversation isn't connected to a company called “Acme”. It is connected to Juniper Market and Lantern Noodle Bar.",
    );
    expect(run.connections).toHaveLength(2);
    expect(transport).not.toHaveBeenCalled();
  });

  it("leaves a conversation with no Company when the last one goes", async () => {
    const run = await conversation();
    const turn = await say("disconnect from Juniper Market");
    expect(turn.answer.text).toBe(
      "Juniper Market was removed from this conversation. This conversation isn't connected to a company now. Connect one to go on.",
    );
    expect(turn.answer.connections).toEqual([]);
    expect(turn.answer.signedIn).toBe(false);
    expect(run.connections).toEqual([]);
  });
});

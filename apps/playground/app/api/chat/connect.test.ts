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
import { labCompanies as cards } from "@/app/playground/companies";
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
const power = "http://fernwick.localhost:4500";
const names: Record<string, string> = {
  [shop]: "Juniper Market",
  [food]: "Lantern Noodle Bar",
  [bank]: "Harborline Bank",
  [air]: "Northwind Air",
  [power]: "Fernwick Power & Light",
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
const post = async (body: Record<string, unknown>) => {
  const response = await POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Poppy-Conversation": id,
      },
      body: JSON.stringify({ provider: "demo", companies: true, ...body }),
    }),
  );
  return { status: response.status, answer: await response.json() };
};
const say = (message: string, more: Record<string, unknown> = {}) =>
  post({ message, ...more });
/** Presses one of the buttons under Iris's answer: its `answer` goes back. */
const press = (choice: { answer: unknown }) => post({ answer: choice.answer });
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
    // A button for each of the lab's, by its address.
    expect(none.answer.choices).toHaveLength(5);
    expect(none.answer.choices[1]).toEqual({
      label: "Lantern Noodle Bar",
      answer: { connect: food },
    });
    const turn = await press(none.answer.choices[1]);
    expect(turn.answer.text).toMatch(/^Connected to Lantern Noodle Bar\./);
    expect(run.connections.map((c) => c.url)).toEqual([food]);
    // The words from before it are still there, and the label of the
    // button is the User's line.
    expect(shown(run).slice(0, 3)).toEqual([
      ["user", "What's on the menu?", undefined],
      ["assistant", none.answer.text, undefined],
      ["user", "Lantern Noodle Bar", food],
    ]);
    // Typed, the same connects another.
    await say("Connect with Harborline Bank");
    expect(run.connections.map((c) => c.url)).toEqual([food, bank]);
  });

  it("connects several at once, up to three in the conversation", async () => {
    const run = await conversation();
    const turn = await say("connect with Lantern, the bank and the airline");
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
      expect(turn.answer.choices[0].answer).toEqual({ connect: food });
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
        { label: "Lantern Noodle Bar", answer: { connect: food } },
        { label: "Harborline Bank", answer: { connect: bank } },
      ],
    });
    expect(discover).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(1);
    // The button connects it, by the lab's address for it.
    await press(turn.answer.choices[1]);
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

  it("reads the words only for a page that shows several Companies", async () => {
    // A page that shows one Company doesn't say `companies`. It couldn't
    // show a second, so there the words connect nothing and go on as an
    // ordinary message.
    const run = await conversation();
    const typed = await say("connect with Lantern", { companies: undefined });
    expect(typed.answer.mode).not.toBe("iris");
    expect(typed.answer).not.toHaveProperty("before");
    expect(typed.answer.from).toEqual(juniper);
    expect(run.connections).toHaveLength(1);
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
  it("asks before it removes a signed-in Company, then revokes its grant there and removes it, saying what is left", async () => {
    const run = await conversation([shop, food], [shop, food]);
    recordTurn(run, run.connections[0]!, "my orders", "Order 7 for Elena.");
    recordTurn(run, run.connections[1]!, "my orders", "Order 12 for Dana.");
    const asked = await say("disconnect from Juniper");
    expect(asked.status).toBe(200);
    const question =
      "Remove Juniper Market from this conversation? That revokes the access you gave Iris there, and what Iris read with your account there no longer shows.";
    expect(asked.answer).toMatchObject({
      text: question,
      mode: "iris",
      trace: [],
      choices: [
        { label: "Remove Juniper Market", answer: { remove: [shop] } },
        { label: "Keep Juniper Market", answer: { keep: [shop] } },
      ],
    });
    expect(asked.answer).not.toHaveProperty("connections");
    // Nothing was sent, revoked or removed.
    expect(transport).not.toHaveBeenCalled();
    expect(run.connections.map((c) => c.url)).toEqual([shop, food]);
    expect(run.connections[0]!.accountToken).toBe(
      "refresh-juniper.localhost:4100",
    );
    expect(JSON.stringify(run.transcript)).toContain("Elena");

    // The User presses "Remove Juniper Market".
    const turn = await press(asked.answer.choices[0]);
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
    ).toEqual([
      "my orders",
      "Order 12 for Dana.",
      "disconnect from Juniper",
      question,
    ]);
    expect(run.connections.map((c) => c.url)).toEqual([food]);
    expect(JSON.stringify(run)).not.toMatch(/Elena|refresh-juniper/);
    // The page showed the button's label as the User's line.
    expect(shown(run).slice(-2)).toEqual([
      ["user", "Remove Juniper Market", shop],
      ["assistant", text, shop],
    ]);
    // The line is kept once.
    expect(
      run.log!.filter((line) => line.text === turn.answer.trace[0]),
    ).toHaveLength(1);
  });

  it("removes a signed-out Company without sending anything, and goes on with the rest", async () => {
    const run = await conversation([shop, food]);
    const turn = await say(
      "disconnect from Juniper and what are your products?",
    );
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

  it("asks which Company the rest is for when two are left, and shows the message once", async () => {
    const run = await conversation([shop, food, bank]);
    const turn = await say(
      "disconnect from Juniper and what are your products?",
    );
    expect(turn.answer).toMatchObject({
      before:
        "Juniper Market was removed from this conversation. You can connect it again at any time.",
      text: "Which company is this for? This conversation is connected to Lantern Noodle Bar and Harborline Bank.",
      mode: "iris",
    });
    expect(turn.answer).not.toHaveProperty("from");
    expect(turn.answer.connections).toHaveLength(2);
    expect(transport).not.toHaveBeenCalled();
    expect(shown(run)).toEqual([
      ["user", "disconnect from Juniper and what are your products?", shop],
      ["assistant", turn.answer.before, shop],
      ["assistant", turn.answer.text, undefined],
    ]);
    // The rest waits for the name of one of them.
    const answered = await say("Harborline");
    expect(answered.answer.from).toEqual({
      origin: bank,
      name: "Harborline Bank",
    });
    expect(run.history.at(-2)!.content).toBe("what are your products?");
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
    expect((await say("disconnect from the bank")).answer.text).toBe(
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

describe("words a person says to a Company about an order", () => {
  it.each([
    "remove the noodles",
    "remove noodles",
    "drop the noodles",
    "remove the takeaway",
    "remove groceries",
    "leave the restaurant",
    "remove the noodles and add an iced tea",
    "add noodles",
    "add groceries",
    "also noodles",
    "noodles too",
    "add flights",
  ])(
    "go to the Company: “%s” removes and connects nothing",
    async (message) => {
      const run = await conversation([shop, food], [food]);
      // The User is looking at Lantern, signed in there.
      const turn = await say(message, { company: food });
      expect(turn.status).toBe(200);
      expect(turn.answer.from).toEqual(lantern);
      expect(turn.answer.mode).toBe("demo");
      expect(turn.answer).not.toHaveProperty("before");
      expect(turn.answer).not.toHaveProperty("choices");
      expect(turn.answer).not.toHaveProperty("connections");
      // Lantern is still connected and signed in: nothing was revoked, and
      // no other Company was read.
      expect(run.connections.map((c) => c.url)).toEqual([shop, food]);
      expect(run.connections[1]!.accountToken).toBe(
        "refresh-noodles.localhost:4200",
      );
      expect(discover).not.toHaveBeenCalledWith(air, expect.anything());
      expect(sent().length).toBeGreaterThan(0);
      for (const request of sent()) {
        expect(new URL(request.url).origin).toBe(food);
        expect(request.url).not.toContain("/oauth/revoke");
      }
      expect(run.history.at(-2)).toMatchObject({ content: message });
    },
  );

  it("go to the Company for every request the page's cards suggest", async () => {
    for (const card of cards) {
      const run = await conversation(
        card.url === shop ? [shop] : [shop, card.url],
        [card.url],
      );
      for (const phrase of [...card.open, ...card.account, card.ask]) {
        vi.setSystemTime((now += 61_000));
        const turn = await say(phrase, { company: card.url });
        expect(turn.answer.from, phrase).toEqual({
          origin: card.url,
          name: card.name,
        });
        expect(turn.answer, phrase).not.toHaveProperty("before");
        expect(turn.answer, phrase).not.toHaveProperty("choices");
      }
      expect(run.connections.map((c) => c.url)).toContain(card.url);
      expect(run).not.toHaveProperty("removing");
    }
    expect(JSON.stringify(sent())).not.toContain("/oauth/revoke");
  });
});

describe("removing a Company on words that could also be about an order", () => {
  const question =
    "Remove Lantern Noodle Bar from this conversation? That revokes the access you gave Iris there, and what Iris read with your account there no longer shows.";
  const choices = [
    { label: "Remove Lantern Noodle Bar", answer: { remove: [food] } },
    { label: "Keep Lantern Noodle Bar", answer: { keep: [food] } },
  ];
  const removed =
    "Lantern Noodle Bar was removed from this conversation, and the access you gave Iris there was revoked. What Iris read with your account there no longer shows. You can connect it again at any time.";

  it.each(["remove Lantern", "drop Lantern Noodle Bar", "leave Lantern"])(
    "asks first for “%s”, and removes nothing until the User confirms",
    async (message) => {
      const run = await conversation([shop, food], [food]);
      const asked = await say(message);
      expect(asked.answer).toMatchObject({
        text: question,
        mode: "iris",
        choices,
      });
      expect(asked.answer).not.toHaveProperty("from");
      expect(asked.answer).not.toHaveProperty("connections");
      expect(transport).not.toHaveBeenCalled();
      expect(run.connections.map((c) => c.url)).toEqual([shop, food]);
      expect(run.connections[1]!.accountToken).toBe(
        "refresh-noodles.localhost:4200",
      );
      // The button removes it, by the Company's origin.
      const turn = await press(asked.answer.choices[0]);
      expect(turn.answer).toMatchObject({ text: removed, mode: "iris" });
      expect(run.connections.map((c) => c.url)).toEqual([shop]);
      expect(sent().map((request) => request.url)).toEqual([
        `${food}/oauth/revoke`,
      ]);
      expect(shown(run).slice(-4)).toEqual([
        ["user", message, food],
        ["assistant", question, food],
        ["user", "Remove Lantern Noodle Bar", food],
        ["assistant", removed, food],
      ]);
    },
  );

  it("asks for a signed-out Company too, and says it can be connected again", async () => {
    const run = await conversation([shop, food]);
    const asked = await say("remove Lantern");
    expect(asked.answer).toMatchObject({
      text: "Remove Lantern Noodle Bar from this conversation? You can connect it again at any time.",
      choices,
    });
    expect(run.connections).toHaveLength(2);
    const turn = await press(asked.answer.choices[0]);
    expect(turn.answer.text).toBe(
      "Lantern Noodle Bar was removed from this conversation. You can connect it again at any time.",
    );
    expect(run.connections.map((c) => c.url)).toEqual([shop]);
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps the Company when the User says so, with the button or in words", async () => {
    const run = await conversation([shop, food], [food]);
    const kept =
      "Lantern Noodle Bar stays connected. Nothing was removed or revoked.";
    const asked = await say("remove Lantern");
    const turn = await press(asked.answer.choices[1]);
    expect(turn.answer).toMatchObject({ text: kept, mode: "iris" });
    expect(turn.answer).not.toHaveProperty("choices");
    expect(shown(run).slice(-2)).toEqual([
      ["user", "Keep Lantern Noodle Bar", food],
      ["assistant", kept, food],
    ]);
    for (const no of ["no", "No, keep it.", "cancel"]) {
      await say("remove Lantern");
      expect((await say(no)).answer.text).toBe(kept);
    }
    expect(run.connections.map((c) => c.url)).toEqual([shop, food]);
    expect(run.connections[1]!.accountToken).toBe(
      "refresh-noodles.localhost:4200",
    );
    expect(transport).not.toHaveBeenCalled();
    expect(run).not.toHaveProperty("removing");
  });

  it.each(["yes", "Yes, remove it.", "remove it", "go ahead"])(
    "takes “%s”, typed, as the confirmation",
    async (yes) => {
      const run = await conversation([shop, food], [food]);
      await say("remove Lantern");
      const turn = await say(yes);
      expect(turn.answer.text).toBe(removed);
      expect(run.connections.map((c) => c.url)).toEqual([shop]);
      expect(shown(run).at(-2)).toEqual(["user", yes, food]);
    },
  );

  it("drops the question when the next message is something else", async () => {
    const run = await conversation([shop, food], [food]);
    await say("remove Lantern");
    const turn = await say("What are your products?", { company: shop });
    expect(turn.answer.from).toEqual(juniper);
    expect(run).not.toHaveProperty("removing");
    // "yes" now confirms nothing: it is a message like any other.
    const later = await say("yes", { company: shop });
    expect(later.answer.from).toEqual(juniper);
    expect(run.connections.map((c) => c.url)).toEqual([shop, food]);
    expect(JSON.stringify(sent())).not.toContain("/oauth/revoke");
  });

  it("asks again for a button pressed after its question was dropped", async () => {
    const run = await conversation([shop, food], [food]);
    const asked = await say("remove Lantern");
    await say("What are your products?", { company: shop });
    const turn = await press(asked.answer.choices[0]);
    expect(turn.answer).toMatchObject({ text: question, choices });
    expect(run.connections).toHaveLength(2);
    expect(JSON.stringify(sent())).not.toContain("/oauth/revoke");
  });

  it("says what a removal drops when a proposal waits there, and asks the rest after it", async () => {
    const run = await conversation([shop, food], [shop]);
    run.connections[0]!.operations = {
      op_1: {
        operation_id: "op_1",
        revision: "r1",
        state: "proposed",
        expires_at: "2030-01-01T00:00:00Z",
      },
    };
    const asked = await say(
      "disconnect from Juniper and what are your products?",
    );
    expect(asked.answer).toMatchObject({
      text: "Remove Juniper Market from this conversation? That revokes the access you gave Iris there, and what Iris read with your account there no longer shows. A proposal that waits for your approval is dropped with it. Iris asks the rest of your message after that.",
      mode: "iris",
    });
    expect(asked.answer).not.toHaveProperty("from");
    expect(transport).not.toHaveBeenCalled();
    const turn = await press(asked.answer.choices[0]);
    expect(turn.answer).toMatchObject({
      before:
        "Juniper Market was removed from this conversation, and the access you gave Iris there was revoked. What Iris read with your account there no longer shows. You can connect it again at any time.",
      from: lantern,
      mode: "demo",
    });
    expect(run.connections.map((c) => c.url)).toEqual([food]);
    expect(run.history.at(-2)!.content).toBe("what are your products?");
  });

  it("asks about several at once, and removes all of them or none", async () => {
    const run = await conversation([shop, food, bank], [food]);
    const asked = await say("remove Juniper and Lantern");
    expect(asked.answer).toMatchObject({
      text: "Remove Juniper Market and Lantern Noodle Bar from this conversation? That revokes the access you gave Iris at Lantern Noodle Bar, and what Iris read with your account there no longer shows.",
      choices: [
        {
          label: "Remove Juniper Market and Lantern Noodle Bar",
          answer: { remove: [shop, food] },
        },
        {
          label: "Keep Juniper Market and Lantern Noodle Bar",
          answer: { keep: [shop, food] },
        },
      ],
    });
    expect(run.connections).toHaveLength(3);
    await press(asked.answer.choices[0]);
    expect(run.connections.map((c) => c.url)).toEqual([bank]);
  });

  it("refuses a request that carries both a message and an answer, or an answer it doesn't know", async () => {
    const run = await conversation([shop, food]);
    for (const body of [
      { message: "hello", answer: { remove: [food] } },
      { answer: { remove: food } },
      { answer: { remove: [] } },
      { answer: { erase: [food] } },
      { answer: "Remove Lantern Noodle Bar" },
      {},
    ]) {
      const turn = await post(body);
      expect(turn.status, JSON.stringify(body)).toBe(400);
    }
    expect(run.connections).toHaveLength(2);
    expect(run.transcript).toBeUndefined();
  });
});

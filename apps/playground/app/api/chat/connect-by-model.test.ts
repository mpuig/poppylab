/**
 * Connecting or removing a Company in any language: "connect with …" is
 * read before any model in English, and in Spanish, Catalan and French
 * only in its plainest wordings with a name; otherwise, with a model
 * selected, the request reaches it, and it asks with Iris's
 * `connect_company` tool. A lab Company the message names, with one
 * other connected, is connected before anything is asked of that one.
 * And a Company only receives what was asked of it: no tool, a feedback
 * report included, sends the User's request to a Company they didn't
 * address.
 * The real runtime; only the network, discovery and the model are
 * replaced. The model is a fake that makes the tool calls a model would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() =>
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
);
const discover = vi.hoisted(() => vi.fn());
const model = vi.hoisted(() => vi.fn());
const choose = vi.hoisted(() => vi.fn(async () => "unsure"));
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: discover,
}));
vi.mock("@poppy-lab/llm-adapters/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/llm-adapters/server")>()),
  runModel: model,
  askModel: choose,
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
      name.includes("visitor") ? { value: "w".repeat(43) } : undefined,
    set: vi.fn(),
  }),
}));
vi.mock("@poppy-lab/pap-agent/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-agent/deployment")>()),
  serving: () => true,
  publicMode: () => false,
  isAccountCompany: () => true,
  proposalsAllowed: () => true,
  // Fernwick's feedback address is on this machine, as in development.
  localOrigins: ["http://fernwick.localhost:4500"],
}));
import { connected, discovered } from "@poppy-lab/pap-agent/company-fixture";
import { seedRun } from "@poppy-lab/pap-agent/runs";
import type { Run } from "@poppy-lab/pap-agent/runtime";
import { POST } from "./route";

// The lab's own Companies, where they are for a playground on localhost.
const food = "http://noodles.localhost:4200";
const bank = "http://harbor.localhost:4300";
const power = "http://fernwick.localhost:4500";
const names: Record<string, string> = {
  [food]: "Lantern Noodle Bar",
  [bank]: "Harborline Bank",
  [power]: "Fernwick Power & Light",
};
const fernwick = { origin: power, name: "Fernwick Power & Light" };
const lantern = { origin: food, name: "Lantern Noodle Bar" };
const api = (origin: string) => ({
  servers: [{ url: origin }],
  paths: { "/api/bills": { get: { operationId: "bills" } } },
});

type Tools = Record<
  string,
  { description: string; execute: (input?: unknown) => Promise<unknown> }
>;

let count = 0;
let id = "";
async function conversation(origins: string[]) {
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: origins.map((origin) => connected(origin, names[origin]!)),
  };
  id = `run_chat_words_${String(++count).padStart(4, "0")}`;
  await seedRun("w".repeat(43), id, run);
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
      body: JSON.stringify({
        provider: "anthropic",
        apiKey: "key",
        companies: true,
        ...body,
      }),
    }),
  );
  return { status: response.status, answer: await response.json() };
};
const say = (message: string) => post({ message });

/**
 * A model that makes these tool calls, in order, and answers with what
 * they returned, so a test reads it in the answer. Each call's result is
 * also kept in `results`.
 */
let results: unknown[] = [];
let offered: Tools = {};
const calls = (...made: Array<[string, Record<string, unknown>]>) =>
  model.mockImplementationOnce(
    async (_provider: string, _turns: unknown, tools: Tools) => {
      offered = tools;
      for (const [name, input] of made)
        results.push(await tools[name]!.execute(input));
      return "The model's answer.";
    },
  );
/** What discovery read besides the conversation's own Company. */
const discoveredElsewhere = () =>
  discover.mock.calls.filter(([url]) => new URL(url).origin !== power);
const sentTo = (origin: string) =>
  transport.mock.calls.filter(([url]) => new URL(url).origin === origin);

let now = Date.now();
afterEach(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: (now += 61_000) });
  results = [];
  offered = {};
  transport.mockReset().mockImplementation(async (url) => {
    const { origin, pathname } = new URL(url);
    if (pathname === "/poppy/openapi.json") return api(origin);
    if (pathname === "/poppy/tasks")
      return {
        excluded_tasks: [],
        feedback: { endpoint: `${origin}/poppy/feedback` },
      };
    if (pathname === "/poppy/feedback") return null;
    return { bills: [] };
  });
  // Each takes feedback reports in its tasks response (§9.3).
  discover.mockReset().mockImplementation(async (url: string) => {
    const { origin } = new URL(url);
    const company = discovered(origin, names[origin]!);
    company.profile!.tasksEndpoint = `${origin}/poppy/tasks`;
    return company;
  });
  model.mockReset().mockResolvedValue("The model's answer.");
  choose.mockClear();
});

describe("connecting a Company in the User's own language", () => {
  // The messages reach the model: none is "connect with" in English, and
  // the name is misspelt, so no rule of Iris's reads it as one of the
  // lab's (a name said right connects that Company before any turn).
  // What happened is said in the User's language, as the agent's own
  // lines are, and the model answers from it.
  const spanish =
    "He conectado Lantern Noodle Bar. Ya puedes preguntarle algo. Si alguna petición necesita tu cuenta allí, te ofreceré iniciar sesión.";
  const said: Array<[string, string, string, string]> = [
    ["Spanish", "conéctate con Lanturn", "Lantern Noodle Bar", spanish],
    [
      "Catalan",
      "connecta't amb el Lanturn, si us plau",
      "Lantern",
      "He connectat Lantern Noodle Bar. Ja li pots preguntar alguna cosa. Si alguna petició necessita el teu compte allà, t'oferiré iniciar sessió.",
    ],
    [
      "French",
      "connecte-toi à Lanturn",
      "lantern noodle bar",
      "J'ai connecté Lantern Noodle Bar. Vous pouvez lui demander quelque chose maintenant. Si une demande a besoin de votre compte là-bas, je vous proposerai de vous connecter.",
    ],
    // The User's typo, in the words and the name: the model gives the name.
    ["a typo", "connectate con lantren nodle", "Lantern Noodle Bar", spanish],
  ];
  it.each(said)(
    "connects it in %s, as “connect with” it does, and the model is told what happened there",
    async (_language, message, company, happened) => {
      const run = await conversation([power]);
      calls(["connect_company", { action: "connect", company }]);
      const turn = await say(message);
      expect(turn.status).toBe(200);
      // The model wrote the answer, in the User's language, from this.
      expect(results).toEqual([
        {
          done: "connected",
          what_happened: happened,
          companies_now: [
            { name: "Fernwick Power & Light", signed_in: false },
            { name: "Lantern Noodle Bar", signed_in: false },
          ],
          note: "Discovery was read and nothing else was sent: the user is signed out there, and signing in is offered on that company's own page when a request needs their account. Its tools aren't part of this turn: the user's next message can ask it.",
        },
      ]);
      expect(turn.answer.text).toBe("The model's answer.");
      // Discovery of the lab's own address for it and nothing else: no
      // Session there, no sign-in started, nothing sent to Lantern.
      expect(discoveredElsewhere().map(([url]) => url)).toEqual([food]);
      expect(sentTo(food)).toEqual([]);
      expect(run.connections.map((c) => c.url)).toEqual([power, food]);
      expect(run.connections[1]!.accountToken).toBeUndefined();
      expect(run.connections[1]!.sessionId).toBeUndefined();
      // The page gets the Companies as they are now, and the line for
      // Lantern under Lantern's name.
      expect(
        turn.answer.connections.map((c: { name: string }) => c.name),
      ).toEqual(["Fernwick Power & Light", "Lantern Noodle Bar"]);
      expect(turn.answer.traces[0]).toEqual({
        from: lantern,
        trace: [
          "Connected to Lantern Noodle Bar · discovery read at /.well-known/poppy.json",
        ],
      });
      expect(turn.answer.traces.at(-1).from).toEqual(fernwick);
      expect(run.log?.find((l) => l.company === food)?.text).toBe(
        "Connected to Lantern Noodle Bar · discovery read at /.well-known/poppy.json",
      );
    },
  );

  it.each([
    [
      "Ajoute la banque, s'il te plaît",
      bank,
      /je l'ai donc connectée à cette conversation/,
    ],
    [
      "my balance at Harborline",
      bank,
      /That's one for Harborline Bank, so I connected it/,
    ],
    [
      "conéctate con Lantern Noodle Bar",
      food,
      /Eso es cosa de Lantern Noodle Bar, así que la he conectado/,
    ],
  ])(
    "connects the lab's Company %j names before anything is asked of the connected one",
    async (message, origin, line) => {
      const run = await conversation([power]);
      calls();
      const turn = await say(message);
      expect(turn.status).toBe(200);
      expect(turn.answer.before).toMatch(line);
      expect(run.connections.map((c) => c.url)).toEqual([power, origin]);
      // Fernwick was asked nothing: no Session, no tasks, no API.
      expect(sentTo(power)).toEqual([]);
      expect(turn.answer.from.origin).toBe(origin);
    },
  );

  it("is offered with the lab's names, only on a page that shows several Companies", async () => {
    await conversation([power]);
    calls();
    await say("hola");
    expect(offered.connect_company!.description).toContain(
      "The lab's companies are Juniper Market, Lantern Noodle Bar, Harborline Bank, Northwind Air, Fernwick Power & Light.",
    );
    calls();
    await post({ message: "hola", companies: false, url: power });
    expect(offered).not.toHaveProperty("connect_company");
  });

  it("says a name fits no Company, connects nothing and never makes an address of it", async () => {
    const run = await conversation([power]);
    calls(["connect_company", { action: "connect", company: "Acme Bakery" }]);
    await say("conéctate con Acme Bakery");
    expect(results[0]).toMatchObject({
      done: "nothing_changed",
      what_happened: expect.stringMatching(
        /^El laboratorio no tiene ninguna empresa llamada «Acme Bakery»\./,
      ),
    });
    expect(discoveredElsewhere()).toEqual([]);
    expect(run.connections).toHaveLength(1);
  });

  it("refuses an address the model gives, and reads nothing there", async () => {
    const run = await conversation([power]);
    for (const company of [
      "https://lantern.attacker.example",
      "lantern-noodle.example",
      "noodles.localhost:4200/.well-known/poppy.json",
    ]) {
      calls(["connect_company", { action: "connect", company }]);
      await say("conéctate con mi sitio de ramen");
    }
    for (const result of results)
      expect(result).toEqual({
        done: false,
        reason:
          "Companies are connected by name, never by an address. The lab's companies are Juniper Market, Lantern Noodle Bar, Harborline Bank, Northwind Air, Fernwick Power & Light. The user can type another company's address in the address box.",
      });
    expect(discoveredElsewhere()).toEqual([]);
    expect(run.connections).toHaveLength(1);
  });
});

describe("removing a Company in the User's own language", () => {
  it("asks first, with the buttons the typed request gives, and only the User's answer removes it", async () => {
    const run = await conversation([power, food]);
    calls([
      "connect_company",
      { action: "remove", company: "Lantern Noodle Bar" },
    ]);
    const turn = await post({ message: "treu el Lantern", company: power });
    expect(results[0]).toMatchObject({
      done: "removal_waits_for_the_user",
      note: "Nothing was removed. The user confirms or keeps it with the buttons under your answer.",
    });
    expect(run.connections).toHaveLength(2);
    const question = turn.answer.question;
    // In the User's language, Catalan here, buttons and all.
    expect(question.text).toBe(
      "Trec Lantern Noodle Bar d'aquesta conversa? La pots tornar a connectar quan vulguis.",
    );
    expect(question.choices).toEqual([
      { label: "Treure Lantern Noodle Bar", answer: { remove: [food] } },
      { label: "Mantenir Lantern Noodle Bar", answer: { keep: [food] } },
    ]);
    // The User presses Remove: the typed request's own path removes it.
    const removed = await post({ answer: question.choices[0].answer });
    expect(removed.answer.text).toBe(
      "He tret Lantern Noodle Bar d'aquesta conversa. La pots tornar a connectar quan vulguis.",
    );
    expect(run.connections.map((c) => c.url)).toEqual([power]);
  });

  it("reads a plain removal with the Company's name before asking which Company a turn is for", async () => {
    const run = await conversation([power, food]);
    const turn = await say("Quita Lantern de esta conversación.");
    // No question about which Company, no model, no Company asked.
    expect(choose).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(turn.answer.text).toBe(
      "¿Quito Lantern Noodle Bar de esta conversación? Puedes volver a conectarla cuando quieras.",
    );
    expect(run.connections).toHaveLength(2);
  });
});

describe("the language of the agent's own lines", () => {
  // A Company and a model that answer in French, whatever the User wrote.
  const french = () => {
    transport.mockImplementation(async (url) => {
      const { origin, pathname } = new URL(url);
      if (pathname === "/poppy/openapi.json") return api(origin);
      if (pathname === "/poppy/tasks") return { excluded_tasks: [] };
      return {
        bills: [{ note: "Votre facture est prête. Merci de la payer." }],
      };
    });
    model.mockImplementationOnce(
      async (_provider: string, _turns: unknown, tools: Tools) => {
        for (const tool of Object.values(tools))
          if (/bills/i.test(tool.description)) await tool.execute({});
        return "Bonjour ! Votre facture est prête, et je vous la montre.";
      },
    );
  };

  it("is the User's, never a Company's or the model's", async () => {
    const run = await conversation([power]);
    french();
    await say("What do I owe this month?");
    // The answer was French; the User wrote English, and so does the agent.
    const connect = await post({ answer: { connect: food } });
    expect(connect.answer.text).toMatch(/^I've connected Lantern Noodle Bar\./);
    expect(run.language).toBeUndefined();
  });

  it("follows the User into Spanish, and stays there for a word of no language", async () => {
    const run = await conversation([power]);
    french();
    await say("Hola, ¿cuánto debo este mes?");
    // A button's label is the agent's, and says nothing of the language.
    const connect = await post({ answer: { connect: food } });
    expect(connect.answer.text).toMatch(/^He conectado Lantern Noodle Bar\./);
    // "Lantern" says no language: the next line is still Spanish.
    model.mockResolvedValueOnce("Lantern Noodle Bar is connected.");
    await say("Lantern");
    const removed = await post({ answer: { remove: [power] } });
    expect(removed.answer.text).toBe(
      "He quitado Fernwick Power & Light de esta conversación. Puedes volver a conectarla cuando quieras.",
    );
    expect(run.language).toBe("es");
  });
});

describe("a Company only receives what was asked of it", () => {
  it("sends Fernwick nothing for a request about Lantern, a feedback report included", async () => {
    await conversation([power]);
    // The model reaches for Fernwick's tools though the User spoke of
    // Lantern: each is refused, and the model reads why.
    calls(
      [
        "report_unsupported_task",
        {
          task: "Connect a restaurant",
          description: "The User asked to connect a restaurant.",
        },
      ],
      ["bills", {}],
    );
    const before = sentTo(power).length;
    // Two of the lab's, so no rule of Iris's connects either first.
    await say("connectate con lantern noodle bar y harborline");
    const why =
      "The user's request is about Lantern Noodle Bar, Harborline Bank, not Fernwick Power & Light. Fernwick Power & Light only receives what was asked of it, so nothing was sent to Fernwick Power & Light.";
    expect(results).toEqual([
      { sent: false, not_addressed: true, reason: why },
      { sent: false, not_addressed: true, reason: why },
    ]);
    // Discovery, the Session's tasks and the API description: nothing of
    // the User's request.
    expect(
      sentTo(power)
        .slice(before)
        .map(([url]) => new URL(url).pathname),
    ).toEqual(["/poppy/tasks", "/poppy/openapi.json"]);
  });

  it("reports nothing for a turn that connected a Company, even at one the User named", async () => {
    await conversation([power]);
    calls(
      ["connect_company", { action: "connect", company: "Lantern Noodle Bar" }],
      [
        "report_unsupported_task",
        {
          task: "Connect a restaurant",
          description: "The User asked to connect a restaurant.",
        },
      ],
    );
    await say("connecte Lantern à Fernwick");
    expect(results[1]).toEqual({
      sent: false,
      reason:
        "This turn is about which companies the conversation is connected to. That is no task Fernwick Power & Light can't do, so nothing was reported to Fernwick Power & Light.",
    });
    expect(
      sentTo(power).filter(([url]) => url.endsWith("/poppy/feedback")),
    ).toEqual([]);
  });

  it("reports a task the User asked of the Company, in any language", async () => {
    await conversation([power]);
    calls([
      "report_unsupported_task",
      {
        task: "Pay a bill with a gift card",
        description: "The User wanted to pay a bill with a gift card.",
      },
    ]);
    await say("¿puedo pagar la factura con una tarjeta regalo?");
    expect(results).toEqual([{ sent: true }]);
    expect(
      sentTo(power).filter(([url]) => url.endsWith("/poppy/feedback")),
    ).toHaveLength(1);
  });

  it("goes to the Company the User chose, whatever else the request names", async () => {
    await conversation([power, food]);
    calls(["bills", {}]);
    await post({ message: "is Lantern on my last bill?", company: power });
    expect(results).toEqual([{ bills: [] }]);
  });

  it("still asks both Companies a task spans, each what it needs", async () => {
    await conversation([power, bank]);
    choose.mockResolvedValueOnce(`${power} ${bank}`);
    model.mockImplementationOnce(
      async (_provider: string, _turns: unknown, tools: Tools) => {
        for (const name of Object.keys(tools).filter((n) =>
          n.endsWith("__bills"),
        ))
          results.push([name, await tools[name]!.execute({})]);
        return "Paid.";
      },
    );
    const turn = await say("Pay my Fernwick bill from Harborline.");
    expect(turn.answer.text).toBe("Paid.");
    expect(results).toHaveLength(2);
    for (const [, result] of results as Array<[string, unknown]>)
      expect(result).not.toHaveProperty("not_addressed");
  });
});

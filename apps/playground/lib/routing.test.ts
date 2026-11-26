import { describe, expect, it } from "vitest";
import type { ApiTool } from "@poppy-lab/pap-client";
import { connected } from "./company-fixture";
import {
  candidates,
  directConnection,
  lastTurnCompany,
  offeredTools,
  turnConnection,
} from "./routing";
import type { Run } from "./runtime";
import { recordOwn, recordTurn } from "./transcript";

const shop = "https://shop.example";
const food = "https://food.example";
const bank = "https://bank.example";
const conversation = (...origins: string[]): Run => ({
  protocol: "1.0",
  expires: Date.now() + 60000,
  calls: 0,
  busy: false,
  history: [],
  connections: origins.map((origin) =>
    connected(
      origin,
      { [shop]: "Juniper Market", [food]: "Lantern Noodle Bar" }[origin] ??
        "Harborline Bank",
    ),
  ),
});

describe("the Company a turn is for", () => {
  it("is the conversation's only one, whatever the message says", async () => {
    const run = conversation(shop);
    expect(await turnConnection(run, "What's on the menu at Lantern?")).toEqual(
      { connection: run.connections[0] },
    );
  });

  it("is the one the request names, by any address at its origin", async () => {
    const run = conversation(shop, food, bank);
    recordTurn(run, run.connections[0]!, "When do you deliver?", "Tuesday.");
    expect(await turnConnection(run, "my balance", `${bank}/accounts`)).toEqual(
      { connection: run.connections[2] },
    );
  });

  it("is otherwise the one the last turn was with", async () => {
    const run = conversation(shop, food);
    recordTurn(run, run.connections[0]!, "When do you deliver?", "Tuesday.");
    recordTurn(run, run.connections[1]!, "What's on the menu?", "Ramen.");
    expect(await turnConnection(run, "And for dessert?")).toEqual({
      connection: run.connections[1],
    });
    expect(lastTurnCompany(run)).toBe(run.connections[1]);
  });

  it("asks, with every Company to choose from, when nothing says which", async () => {
    const run = conversation(shop, food);
    expect(await turnConnection(run, "What do you sell?")).toEqual({
      ask: run.connections,
    });
    // The last turn was Iris's own, about no Company.
    recordTurn(run, run.connections[0]!, "When do you deliver?", "Tuesday.");
    recordOwn(run, undefined, "hello", "Which company is this for?", false);
    expect(lastTurnCompany(run)).toBeUndefined();
    expect(await turnConnection(run, "What do you sell?")).toEqual({
      ask: run.connections,
    });
    // Or with a Company that has left the conversation since.
    const three = conversation(shop, food, bank);
    recordTurn(three, three.connections[2]!, "my balance", "$12.");
    three.connections.pop();
    expect(await turnConnection(three, "And yesterday?")).toEqual({
      ask: three.connections,
    });
  });

  it("never follows a name that isn't one of the conversation's Companies", async () => {
    const run = conversation(shop, food);
    recordTurn(run, run.connections[0]!, "When do you deliver?", "Tuesday.");
    expect(await turnConnection(run, "my balance", bank)).toEqual({
      ask: run.connections,
    });
    expect(
      await turnConnection(conversation(shop), "my balance", bank),
    ).toMatchObject({ ask: [{ url: shop }] });
  });
});

describe("what a deduction has at hand for each Company", () => {
  const tool = (description: string, required?: unknown): ApiTool => ({
    description,
    schema: { type: "object", ...(required ? { required } : {}) },
    execute: async () => undefined,
  });

  it("keeps each tool's name, the start of its description and its required arguments", () => {
    expect(
      offeredTools({
        menu: tool("The dishes on today's menu."),
        change_order: tool("x".repeat(400), ["order_id", 7, "items"]),
      }),
    ).toEqual([
      {
        name: "menu",
        description: "The dishes on today's menu.",
        required: [],
      },
      {
        name: "change_order",
        description: `${"x".repeat(159)}…`,
        required: ["order_id", "items"],
      },
    ]);
    const many = Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`tool_${i}`, tool("")]),
    );
    expect(offeredTools(many)).toHaveLength(60);
  });

  it("lists every Company with its name, its sign-in, what it says it offers and the tools it loaded", () => {
    const run = conversation(shop, food);
    const [a, b] = run.connections;
    a!.accountToken = "refresh";
    a!.offered = offeredTools({ my_orders: tool("Your orders.") });
    b!.accountToken = "refresh";
    b!.accountUnavailable = true;
    b!.sessionId = "sid_1";
    b!.tasks = {
      sid: "sid_1",
      value: { excludedTasks: [{ task: "Book a table" }], skills: [] },
    } as NonNullable<Run["connections"][0]["tasks"]>;
    expect(candidates(run)).toEqual([
      {
        connection: a,
        origin: shop,
        name: "Juniper Market",
        signedIn: true,
        describes: ["What Juniper Market offers to agents."],
        tools: [
          { name: "my_orders", description: "Your orders.", required: [] },
        ],
        excluded: [],
      },
      {
        connection: b,
        origin: food,
        name: "Lantern Noodle Bar",
        signedIn: false,
        describes: ["What Lantern Noodle Bar offers to agents."],
        tools: [],
        excluded: ["Book a table"],
      },
    ]);
    // The tasks of an earlier Session aren't this one's (§9).
    b!.sessionId = "sid_2";
    expect(candidates(run)[1]!.excluded).toEqual([]);
  });
});

describe("the Company one of the User's own Direct Conversation actions is for (§8.10)", () => {
  const thread = (more: object = {}) => ({
    endpoint: `${food}/poppy/conversations`,
    id: "cnv_1",
    seen: [],
    ...more,
  });

  it("is the conversation's only one, as before", () => {
    const run = conversation(shop);
    for (const action of [
      "say",
      "start",
      "accept",
      "decline",
      "close",
    ] as const)
      expect(directConnection(run, action)).toBe(run.connections[0]);
  });

  it("is the one the request names, and no other when that one isn't connected", () => {
    const run = conversation(shop, food);
    expect(directConnection(run, "say", food)).toBe(run.connections[1]);
    expect(directConnection(run, "say", bank)).toMatchObject({
      code: "company_not_connected",
    });
  });

  it("is the only one that has what the action is about", () => {
    const run = conversation(shop, food);
    const [a, b] = run.connections;
    b!.conversation = thread({ direct: { id: "cnv_2", seen: [] } });
    expect(directConnection(run, "say")).toBe(b);
    expect(directConnection(run, "close")).toBe(b);
    // No Direct Conversation can start from one that is open, or from none.
    expect(directConnection(run, "start")).toMatchObject({
      code: "company_required",
    });
    a!.conversation = thread({ invitation: { event: "evt_1" } });
    expect(directConnection(run, "accept")).toBe(a);
    expect(directConnection(run, "decline")).toBe(a);
    expect(directConnection(run, "start")).toBe(a);
  });

  it("is never guessed: with two that fit, or none, the request has to say", () => {
    const run = conversation(shop, food);
    for (const action of ["say", "start", "accept", "close"] as const)
      expect(directConnection(run, action)).toMatchObject({
        code: "company_required",
      });
    for (const c of run.connections)
      c.conversation = thread({ direct: { id: "cnv_2", seen: [] } });
    expect(directConnection(run, "say")).toMatchObject({
      code: "company_required",
    });
    expect(directConnection(conversation(), "say")).toMatchObject({
      code: "no_company",
    });
  });
});

/**
 * Discovery for a conversation that is already going on: it adds the
 * Company to that conversation, where discovery with no conversation
 * named starts a new one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const discover = vi.hoisted(() => vi.fn());
const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  discoverCompany: discover,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.includes("visitor") ? { value: "v".repeat(43) } : undefined,
    set: jar.set,
  }),
}));
import { PapDiscoveryError } from "@poppy-lab/pap-core";
import { connected, discovered } from "@poppy-lab/pap-agent/company-fixture";
import { bytesOf, RUN_LIMITS } from "@poppy-lab/pap-agent/run-size";
import {
  configureBackend,
  memoryBackend,
  readConversation,
  seedRun,
} from "@poppy-lab/pap-agent/runs";
import type { Run } from "@poppy-lab/pap-agent/runtime";
import { recordTurn } from "@poppy-lab/pap-agent/transcript";
import { POST } from "./route";

const shop = "https://shop.example";
const food = "https://food.example";
const names: Record<string, string> = {
  [shop]: "Juniper Market",
  [food]: "Lantern Noodle Bar",
  "https://bank.example": "Harborline Bank",
  "https://air.example": "Northwind Air",
};

let count = 0;
let id = "";
let visitor = "";
/** A conversation with Juniper, signed in and with a sign-in under way. */
async function conversation(change: (run: Run) => void = () => {}) {
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: [connected(shop, names[shop]!, "poppy:read")],
  };
  recordTurn(run, run.connections[0]!, "my orders", "Order 7 for Elena.");
  change(run);
  id = `run_discover_${String(++count).padStart(4, "0")}`;
  visitor = await seedRun("v".repeat(43), id, run);
  return run;
}
const connect = (url: string, conversationId = id) =>
  POST(
    new Request("http://localhost:3000/api/discover", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        ...(conversationId ? { "X-Poppy-Conversation": conversationId } : {}),
      },
      body: JSON.stringify({ url }),
    }),
  );

beforeEach(() => {
  jar.set.mockReset();
  discover
    .mockReset()
    .mockImplementation(async (url: string) =>
      discovered(new URL(url).origin, names[new URL(url).origin]!),
    );
});

describe("discovery for a conversation that is going on", () => {
  it("adds the Company to it, signed out, and leaves what it holds as it is", async () => {
    const run = await conversation((r) => {
      r.connections[0]!.auth = {
        state: "state_1",
        verifier: "v",
        expires: Date.now() + 60000,
        issuer: shop,
        scopes: "poppy:read",
      };
    });
    const before = structuredClone([run.connections[0], run.transcript]);
    const added = await connect(`${food}/menu`);
    expect(added.status).toBe(200);
    // The same conversation, and the Company's discovery as the answer.
    expect(added.headers.get("X-Poppy-Conversation")).toBe(id);
    expect(added.headers.get("cache-control")).toBe("no-store");
    expect(await added.json()).toMatchObject({
      requestedUrl: food,
      document: { organization: { name: "Lantern Noodle Bar" } },
    });
    expect(run.connections).toHaveLength(2);
    expect(run.connections[1]).toEqual({
      url: food,
      user: "",
      visitor,
      company: {
        ...discovered(food, "Lantern Noodle Bar"),
        discoveredAt: expect.any(String),
      },
    });
    expect([run.connections[0], run.transcript]).toEqual(before);
    expect(run.busy).toBe(false);
    // The sign-in under way at Juniper can still complete: its cookie
    // isn't cleared, as it is when a new conversation starts.
    expect(jar.set).not.toHaveBeenCalled();
    expect(added.headers.getSetCookie()).toEqual([]);
  });

  it("refuses the same Company twice, before fetching anything", async () => {
    const run = await conversation();
    const again = await connect(`${shop}/other`);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      code: "already_connected",
      error: "This conversation is already connected to Juniper Market.",
    });
    expect(discover).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(1);
    expect(run.busy).toBe(false);
  });

  it("refuses the same Company under another address, once discovery says where it is", async () => {
    const run = await conversation();
    discover.mockResolvedValue(discovered(shop, "Juniper Market"));
    const again = await connect("https://www.shop.example");
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("already_connected");
    expect(run.connections).toHaveLength(1);
  });

  it("refuses a fourth Company, before fetching anything", async () => {
    const run = await conversation();
    expect((await connect(food)).status).toBe(200);
    expect((await connect("https://bank.example")).status).toBe(200);
    discover.mockClear();
    const fourth = await connect("https://air.example");
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toEqual({
      code: "too_many_companies",
      error:
        "A conversation works with at most 3 companies. Remove one to connect another.",
    });
    expect(discover).not.toHaveBeenCalled();
    expect(run.connections.map((c) => c.url)).toEqual([
      shop,
      food,
      "https://bank.example",
    ]);
  });

  it("refuses a Company whose documents the stored conversation has no room for", async () => {
    const run = await conversation();
    // Three Companies that each publish as much as a document can hold
    // would pass the size of the stored value: the second is refused.
    const large = (origin: string) => {
      const company = discovered(origin, names[origin]!);
      company.document.apis![0]!.description = "x".repeat(480_000);
      return company;
    };
    discover.mockImplementation(async (url: string) =>
      large(new URL(url).origin),
    );
    expect((await connect(food)).status).toBe(200);
    const third = await connect("https://bank.example");
    expect(third.status).toBe(409);
    expect(await third.json()).toEqual({
      code: "conversation_full",
      error:
        "This conversation holds too much to take Harborline Bank as well. Remove a company, or start a new conversation to connect Harborline Bank.",
    });
    expect(run.connections.map((c) => c.url)).toEqual([shop, food]);
    expect(bytesOf(run)).toBeLessThan(RUN_LIMITS.connect);
    // What is stored is the conversation without it, unlocked.
    const stored = await readConversation(visitor, id);
    expect(stored!.connections).toHaveLength(2);
    expect(stored!.busy).toBe(false);
  });

  it("says so when the conversation couldn't be saved with the Company, and not that it is connected", async () => {
    // A store that refuses the value the request ends with.
    const store = memoryBackend();
    let refuse = false;
    configureBackend({
      ...store,
      put: async (owner, key, value, expected) => {
        if (refuse && !(value as Run).busy)
          throw new Error("storage unavailable");
        return store.put(owner, key, value, expected);
      },
    });
    try {
      await conversation();
      refuse = true;
      const added = await connect(food);
      expect(added.status).toBe(503);
      expect(await added.json()).toEqual({
        code: "conversation_not_saved",
        error:
          "This conversation couldn't be saved just now, so what this request did wasn't kept and a reload won't show it. Try again in a moment.",
      });
      expect(added.headers.get("X-Poppy-Conversation")).toBeNull();
    } finally {
      configureBackend(memoryBackend());
    }
  });

  it("adds nothing when discovery fails, and answers as a failed connection does", async () => {
    const run = await conversation();
    discover.mockRejectedValue(
      new PapDiscoveryError("not_found", "No Poppy document there.", []),
    );
    const failed = await connect(food);
    expect(failed.status).toBe(422);
    expect(await failed.json()).toMatchObject({
      code: "not_found",
      error: "No Poppy document there.",
    });
    expect(run.connections).toHaveLength(1);
    expect(run.busy).toBe(false);
  });

  it("waits its turn while another request holds the conversation", async () => {
    const run = await conversation((r) => {
      r.busy = true;
      r.busyUntil = Date.now() + 60000;
    });
    const busy = await connect(food);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: "busy" });
    expect(discover).not.toHaveBeenCalled();
    expect(run.connections).toHaveLength(1);
  });

  it("connects the first Company of a conversation that has none", async () => {
    const run = await conversation((r) => r.connections.splice(0));
    expect((await connect(food)).status).toBe(200);
    expect(run.connections.map((c) => c.url)).toEqual([food]);
    // Its words are still there.
    expect(run.transcript).toHaveLength(2);
  });
});

describe("discovery that names no conversation, or one unknown here", () => {
  it("starts a new conversation with the Company, as before", async () => {
    const run = await conversation((r) => {
      r.connections[0]!.auth = {
        state: "state_under_way",
        verifier: "v",
        expires: Date.now() + 60000,
        issuer: shop,
        scopes: "poppy:read",
      };
    });
    for (const named of ["", "run_unknown_here_0001"]) {
      const started = await connect(food, named);
      expect(started.status).toBe(200);
      const fresh = started.headers.get("X-Poppy-Conversation")!;
      expect(fresh).not.toBe(id);
      expect(fresh).not.toBe(named);
      const stored = await readConversation(visitor, fresh);
      expect(stored!.connections.map((c) => c.url)).toEqual([food]);
      // A sign-in started before, in the conversation the page showed,
      // doesn't complete behind the new one: its cookie goes.
      expect(started.headers.getSetCookie()).toContainEqual(
        expect.stringMatching(
          /^pap_oauth_state_under_way=; Path=\/api\/account\/callback;.*Max-Age=0/,
        ),
      );
    }
    expect(run.connections).toHaveLength(1);
  });

  it("tells the page its conversation has ended, and starts none in its place", async () => {
    await conversation((r) => {
      r.expires = Date.now() - 1000;
    });
    const over = await connect(food);
    expect(over.status).toBe(410);
    expect(over.headers.get("X-Poppy-Conversation-Ended")).toBe(id);
    expect(over.headers.get("X-Poppy-Conversation")).toBeNull();
    expect(discover).not.toHaveBeenCalled();
  });
});

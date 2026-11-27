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
vi.mock("@/lib/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deployment")>()),
  serving: () => true,
  publicMode: () => false,
  isAccountCompany: () => true,
  proposalsAllowed: () => true,
}));
import { createIdentity } from "@poppy-lab/pap-client";
import { connected, discovered } from "@/lib/company-fixture";
import { seedRun } from "@/lib/runs";
import type { Run } from "@/lib/runtime";
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

let now = Date.now();
beforeEach(() => {
  // A minute apart, so the route's per-minute limit never counts.
  vi.useFakeTimers({ toFake: ["Date"], now: (now += 61_000) });
  transport
    .mockReset()
    .mockImplementation(async (url) =>
      url.endsWith("/poppy/openapi.json") ? api : { ok: true },
    );
  discover
    .mockReset()
    .mockImplementation(async () => discovered(shop, "Juniper Market"));
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

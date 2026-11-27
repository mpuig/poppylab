/**
 * Conversations stored by the playground as it was on 27 November 2026,
 * before the agent's core became a package of its own, read and continued
 * by the code of today. Each fixture is a run as the store held it, with
 * what a reload answered for it then: one Company signed in with a
 * transfer waiting, and two Companies, both signed in, each with a
 * proposal waiting and a Direct Conversation open at Lantern.
 *
 * The clock is set to the moment each was captured, so the run is still
 * running and nothing in it has expired. Nothing is sent to any Company:
 * what goes on is the User's own decline, which stays here, and a turn
 * Iris answers by itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  // As the fixtures were captured: the lab's Companies run locally.
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.includes("visitor") ? { value: "t".repeat(43) } : undefined,
    set: vi.fn(),
  }),
}));
import {
  configureBackend,
  memoryBackend,
  readConversation,
  seedRun,
} from "@poppy-lab/pap-agent/runs";
import type { Run } from "@poppy-lab/pap-agent/runtime";
import { POST as chat } from "../chat/route";
import { GET as list } from "../conversations/route";
import { GET, POST } from "./route";
import one from "./fixtures/stored-one-company.json";
import two from "./fixtures/stored-two-companies.json";

type Fixture = {
  capturedAt: number;
  id: string;
  visitor: string;
  run: unknown;
  view: Record<string, unknown>;
};
const agent = "http://localhost:3000";
const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  id: string,
  body: object,
) =>
  handler(
    new Request(`${agent}${path}`, {
      method: "POST",
      headers: {
        origin: agent,
        "Content-Type": "application/json",
        "X-Poppy-Conversation": id,
      },
      body: JSON.stringify(body),
    }),
  );
const reload = async (id: string) =>
  (
    await GET(new Request(`${agent}/api/account?conversation=${id}`))
  ).json() as Promise<Record<string, unknown>>;

beforeEach(() => {
  configureBackend(memoryBackend());
});
afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ["one Company, a transfer waiting", one as Fixture],
  [
    "two Companies, a proposal waiting at each, a Direct Conversation open",
    two as Fixture,
  ],
])("A conversation stored before the extraction: %s", (_, fixture) => {
  const seed = async () => {
    vi.useFakeTimers({ now: fixture.capturedAt, toFake: ["Date"] });
    const visitor = await seedRun(
      "t".repeat(43),
      fixture.id,
      structuredClone(fixture.run) as Run,
    );
    expect(visitor).toBe(fixture.visitor);
  };

  it("loads as it did: a reload is answered the same", async () => {
    await seed();
    expect(await reload(fixture.id)).toEqual(fixture.view);
    const listed = (await (await list()).json()) as {
      conversations: Array<{ id: string; active: boolean }>;
    };
    expect(listed.conversations).toMatchObject([
      { id: fixture.id, active: true },
    ]);
  });

  it("goes on: a waiting proposal is declined, and Iris answers a turn", async () => {
    await seed();
    const view = fixture.view as {
      connections: Array<{
        origin: string;
        operations: Array<{ operation_id: string; revision: string }>;
      }>;
    };
    const at = view.connections.at(-1)!;
    const op = at.operations[0]!;
    const declined = await post(POST, "/api/account", fixture.id, {
      action: "decline",
      company: at.origin,
      id: op.operation_id,
      revision: op.revision,
    });
    expect(declined.status).toBe(200);
    expect(
      ((await declined.json()) as { operation: { state: string } }).operation
        .state,
    ).toBe("declined");
    const turn = await post(chat, "/api/chat", fixture.id, {
      message: "What can you do here?",
      provider: "demo",
      companies: true,
    });
    expect(turn.status).toBe(200);
    expect(turn.headers.get("X-Poppy-Conversation")).toBe(fixture.id);
    expect(await turn.json()).toMatchObject({ mode: "iris" });
    // Saved in the shape it was read in, and read again.
    const after = await reload(fixture.id);
    const connections = after.connections as Array<{
      origin: string;
      operations: Array<{ state: string }>;
    }>;
    expect(connections.map((c) => c.origin)).toEqual(
      view.connections.map((c) => c.origin),
    );
    expect(connections.at(-1)!.operations[0]!.state).toBe("declined");
    expect((after.history as Array<{ content: string }>).at(-2)).toMatchObject({
      content: "What can you do here?",
    });
    const stored = await readConversation(fixture.visitor, fixture.id);
    expect(stored!.connections).toHaveLength(view.connections.length);
    expect(Object.keys(stored!).sort()).toEqual(
      expect.arrayContaining(
        Object.keys(fixture.run as object).filter((k) => k !== "busy"),
      ),
    );
  });
});

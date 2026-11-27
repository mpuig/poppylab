import { beforeEach, expect, it, vi } from "vitest";
// The chat route with the real runtime and the real OpenAPI adapter: only
// the network (discovery and the Company's answers) is replaced.
const transport = vi.hoisted(() =>
  vi.fn<(url: string, ...args: unknown[]) => Promise<unknown>>(),
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
    get: () => ({ value: "v".repeat(43) }),
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
import { createIdentity, ProtocolError } from "@poppy-lab/pap-client";
import { agentStep } from "@poppy-lab/pap-agent/agent-steps";
import { logEntry } from "@poppy-lab/pap-agent/protocol-log";
import { listConversations, seedRun } from "@/lib/runs";
import type { Connection, Run } from "@/lib/runtime";
import { onlyConnection as at } from "@/lib/connections";
import { POST } from "./route";

const origin = "https://shop.papsandbox.com";
const api = {
  servers: [{ url: origin }],
  paths: {
    "/api/products": { get: { operationId: "list_products" } },
    "/api/account/orders": {
      get: { operationId: "my_orders", "x-poppy-scopes": ["poppy:read"] },
    },
    "/api/account/delivery-change": {
      post: {
        operationId: "propose_delivery_change",
        "x-poppy-proposal": true,
        "x-poppy-scopes": ["poppy:write"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { day: { type: "string" } },
                required: ["day"],
              },
            },
          },
        },
        responses: { "403": {} },
      },
    },
  },
};
function shop(scopes?: string): Run {
  return {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: [connection(scopes)],
  };
}
/** The conversation's one Company, signed in when it has scopes. */
function connection(scopes?: string): Connection {
  return {
    url: origin,
    user: "",
    visitor: "",
    ...(scopes
      ? {
          token: "access-1",
          tokenType: "DPoP" as const,
          accountToken: "refresh-1",
          scopes,
          tokenExpires: Date.now() + 3600000,
        }
      : {}),
    company: {
      requestedUrl: origin,
      discoveryUrl: origin + "/.well-known/poppy.json",
      discoveredAt: new Date().toISOString(),
      trace: [],
      document: {
        protocol_version: "1.0",
        organization: { name: "Juniper Market", domain: "shop.papsandbox.com" },
        apis: [
          {
            type: "openapi",
            url: origin + "/poppy/openapi.json",
            description: "Test",
          },
        ],
        extensions: { operations: [{ version: "3" }] },
      },
      metadata: {
        issuer: origin,
        token_endpoint: origin + "/oauth/token",
        revocation_endpoint: origin + "/oauth/revoke",
        authorization_endpoint: origin + "/oauth/authorize",
        grant_types_supported: ["authorization_code", "refresh_token"],
        protected_resources: [origin],
        dpop_signing_alg_values_supported: ["ES256"],
      },
      profile: {
        version: "1.0",
        identifier: origin,
        issuer: origin,
        signIn: { direct: true, device: false },
        scopes: ["poppy:read", "poppy:write"],
        scopeDescriptions: {},
        scopeHints: {
          "poppy:read": { changes: "none", personal_data: true },
          "poppy:write": { changes: "irreversible", personal_data: true },
        },
        operations: true,
      },
    },
  };
}
let conversation = 0;
/** One demo turn in a new conversation; every request made is in `asked`. */
async function say(run: Run, message: string) {
  const id = `run_chat_fixture_${String(++conversation).padStart(4, "0")}`;
  await seedRun("v".repeat(43), id, run);
  discover.mockResolvedValue(at(run).company);
  const response = await POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Poppy-Conversation": id,
      },
      body: JSON.stringify({ url: origin, message, provider: "demo" }),
    }),
  );
  const answer = (await response.json()) as {
    text?: string;
    error?: string;
    data?: string;
    trace?: string[];
    excludedTasks?: Array<{ task: string; alternative?: string }>;
    skills?: Array<Record<string, string>>;
  };
  return {
    status: response.status,
    answer,
    steps: (answer.trace ?? []).map((line) => agentStep(logEntry(line)).text),
    asked: transport.mock.calls.map(([url]) => url),
  };
}
beforeEach(() => {
  transport.mockReset().mockImplementation(async (url) => {
    if (url === origin + "/poppy/openapi.json") return api;
    return { ok: true };
  });
});

it("says to sign in, and that the request wasn't sent, when a signed-out customer asks for their orders", async () => {
  const turn = await say(shop(), "my orders");
  expect(turn.status).toBe(200);
  expect(turn.answer.text).toBe(
    "Protocol demo (no LLM). This needs your account at Juniper Market, and you are not signed in. Iris didn't send this request to the Company. Press “Sign in to Juniper Market”, then ask again.",
  );
  // Nothing of the Company's to show under Data.
  expect(turn.answer).not.toHaveProperty("data");
  expect(turn.asked).not.toContain(origin + "/api/account/orders");
  expect(turn.answer.trace).toContain(
    "Not sent · GET /api/account/orders · sign-in needed",
  );
  expect(turn.steps).toContain(
    "Did not send a request to /api/account/orders (sign-in needed)",
  );
  expect(turn.steps.join("\n")).not.toMatch(/^(Read|Sent a request to) /m);
});

it("names the change permission, and says the request wasn't sent, when a read-only customer asks for a change", async () => {
  const turn = await say(
    shop("poppy:read"),
    "Move my recurring delivery to Saturday.",
  );
  expect(turn.status).toBe(200);
  expect(turn.answer.text).toBe(
    "Protocol demo (no LLM). This needs the change permission, which your sign-in to Juniper Market doesn't include. Iris didn't send this request to the Company. Press “Request change permission”, review the Company's consent, and ask again.",
  );
  expect(turn.answer).not.toHaveProperty("data");
  expect(turn.asked).not.toContain(origin + "/api/account/delivery-change");
  expect(turn.answer.trace).toContain(
    "Not sent · POST /api/account/delivery-change · permission not granted",
  );
  expect(turn.steps.join("\n")).not.toMatch(/^(Read|Sent a request to) /m);
});

/** The Company's error answer, as `protocolRequest` throws it. */
const refusal = (status: number, body?: Record<string, unknown>) =>
  new ProtocolError(
    status,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    body,
    typeof body?.error === "string" ? body.error : undefined,
  );
/** A change asked for with full permission, which the Company answers `error`. */
async function refusedChange(error: Error) {
  transport.mockImplementation(async (url) => {
    if (url === origin + "/poppy/openapi.json") return api;
    if (url === origin + "/api/account/delivery-change") throw error;
    return { ok: true };
  });
  const run = shop("poppy:read poppy:write");
  at(run).dpop = (await createIdentity()).privateKey;
  return say(run, "Move my recurring delivery to Saturday.");
}

it("answers a refused request with the Company's status, code and a number it gave, and the log line for it", async () => {
  const turn = await refusedChange(
    refusal(409, {
      error: "insufficient_funds",
      available_cents: 321055,
      message: "Words of the Company's own.",
    }),
  );
  expect(turn.status).toBe(502);
  expect(turn.answer).toMatchObject({
    error:
      "Juniper Market answered HTTP 409 insufficient_funds (available balance: 3,210.55). Nothing was retried; see the Inspector.",
    code: "company_error",
  });
  // What "see the Inspector" points at: the request, then its refusal.
  expect(turn.answer.trace!.slice(-2)).toEqual([
    "POST /api/account/delivery-change · Poppy Session",
    "POST /api/account/delivery-change · refused by the Company · HTTP 409 insufficient_funds",
  ]);
  expect(turn.steps.slice(-2)).toEqual([
    "Sent a request to /api/account/delivery-change",
    "The Company refused the request to /api/account/delivery-change (HTTP 409 insufficient_funds)",
  ]);
  expect(JSON.stringify(turn.answer)).not.toContain("Words of the Company");
});

it("says a limit the Company gave, and nothing of a body it doesn't know", async () => {
  const limited = await refusedChange(
    refusal(422, { error: "transfer_limit_exceeded", limit_cents: 250000 }),
  );
  expect(limited.answer.error).toBe(
    "Juniper Market answered HTTP 422 transfer_limit_exceeded (limit: 2,500.00). Nothing was retried; see the Inspector.",
  );
  expect(limited.answer.trace!.at(-1)).toBe(
    "POST /api/account/delivery-change · refused by the Company · HTTP 422 transfer_limit_exceeded",
  );
  // As money, in the currency the Company's answer names.
  const priced = await refusedChange(
    refusal(409, {
      error: "insufficient_funds",
      available_cents: 321055,
      currency: "USD",
    }),
  );
  expect(priced.answer.error).toBe(
    "Juniper Market answered HTTP 409 insufficient_funds (available balance: $3,210.55). Nothing was retried; see the Inspector.",
  );
  // Not a whole number, or under another key: left out.
  const odd = await refusedChange(
    refusal(409, {
      error: "account_inactive",
      available_cents: "plenty",
      limit_cents: 12.5,
      balance: 7,
      currency: "USD",
    }),
  );
  expect(odd.answer.error).toBe(
    "Juniper Market answered HTTP 409 account_inactive. Nothing was retried; see the Inspector.",
  );
  const bare = await refusedChange(refusal(503));
  expect(bare.answer.error).toBe(
    "Juniper Market answered HTTP 503. Nothing was retried; see the Inspector.",
  );
  expect(bare.answer.trace!.at(-1)).toBe(
    "POST /api/account/delivery-change · request failed · HTTP 503",
  );
});

it("still shows the Company's answer, and the request, for a read that was sent", async () => {
  transport.mockImplementation(async (url) =>
    url === origin + "/poppy/openapi.json"
      ? api
      : url === origin + "/api/products"
        ? { products: [{ name: "Cara cara oranges" }] }
        : { ok: true },
  );
  const turn = await say(shop(), "what do you sell?");
  expect(turn.answer.text).toContain("The company answered:");
  expect(turn.answer.text).toContain("Cara cara oranges");
  expect(turn.answer.data).toContain("Cara cara oranges");
  expect(turn.asked).toContain(origin + "/api/products");
  expect(turn.steps).toContain("Read /api/products");
});

it("keeps a turn's lines with the conversation, as the Inspector listed them and nothing more, even when the turn failed", async () => {
  transport.mockImplementation(async (url) => {
    if (url === origin + "/poppy/openapi.json") return api;
    if (url === origin + "/api/account/delivery-change")
      throw refusal(409, {
        error: "insufficient_funds",
        available_cents: 321055,
        message: "Words of the Company's own.",
      });
    return { ok: true };
  });
  const run = shop("poppy:read poppy:write");
  at(run).dpop = (await createIdentity()).privateKey;
  const turn = await say(run, "Move my recurring delivery to Saturday.");
  expect(turn.status).toBe(502);
  // What a reload or History lists: the lines the page was sent.
  expect(run.log!.map((line) => line.text)).toEqual(turn.answer.trace);
  expect(run.log!.at(-1)!.text).toBe(
    "POST /api/account/delivery-change · refused by the Company · HTTP 409 insufficient_funds",
  );
  // A time, the line's words and the Company it was written for: no
  // token, key, header, body or query.
  for (const line of run.log!) {
    expect(Object.keys(line).sort()).toEqual(["at", "company", "text"]);
    expect(line.company).toBe(origin);
  }
  const kept = JSON.stringify(run.log);
  for (const secret of [
    "access-1",
    "refresh-1",
    "Words of the Company",
    "321055",
    "Saturday",
    "eyJ",
    "DPoP ",
    "Bearer",
    "?",
  ])
    expect(kept).not.toContain(secret);

  // Signed out, the lines say so: they stay when a sign-in resets the rest.
  const visitor = shop();
  const asked = await say(visitor, "my orders");
  expect(visitor.log!.map((line) => line.text)).toEqual(asked.answer.trace);
  expect(visitor.log!.every((line) => line.signedOut)).toBe(true);
});

it("answers with the tasks the Company excludes, and says whether a feedback report was sent (§9)", async () => {
  transport.mockImplementation(async (url) => {
    if (url === origin + "/poppy/openapi.json") return api;
    if (url === origin + "/poppy/tasks")
      return {
        excluded_tasks: [
          { task: "Cancel an order by phone" },
          {
            task: "Change the delivery address",
            alternative: { instructions: "Use the website's account page." },
          },
        ],
        skill_index: {
          $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
          skills: [
            {
              name: "change-order",
              description: "Change a scheduled order.",
              type: "skill-md",
              url: "/poppy/skills/change-order/SKILL.md",
              digest: `sha256:${"0f".repeat(32)}`,
            },
          ],
        },
        feedback: { endpoint: origin + "/poppy/feedback" },
      };
    return { ok: true };
  });
  const run = shop();
  at(run).company!.document.tasks = { endpoint: origin + "/poppy/tasks" };
  at(run).company!.profile.tasksEndpoint = origin + "/poppy/tasks";
  const first = await say(run, "Can I pay with a gift card?");
  // For the Inspector's "Tasks not offered".
  expect(first.answer.excludedTasks).toEqual([
    { task: "Cancel an order by phone" },
    {
      task: "Change the delivery address",
      alternative: "Use the website's account page.",
    },
  ]);
  // For its "Skills published" (§9.4): listed, and the file never fetched.
  expect(first.answer.skills).toEqual([
    {
      name: "change-order",
      description: "Change a scheduled order.",
      url: origin + "/poppy/skills/change-order/SKILL.md",
      host: new URL(origin).host,
    },
  ]);
  expect(first.asked.filter((url) => url.includes("/poppy/skills/"))).toEqual(
    [],
  );
  expect(first.answer.trace).toContain(
    "POST /poppy/feedback · feedback · 202 accepted",
  );
  expect(first.answer.text).toContain(
    "Feedback report sent to the Company (§9.3):\n\nSent: yes",
  );
  // The same report in the same Session isn't sent, and the answer says so.
  const again = await say(run, "Can I pay with a gift card?");
  expect(again.answer.text).toContain(
    "Feedback report not sent to the Company (§9.3):\n\nSent: no",
  );
  expect(again.answer.text).toContain("Already reported in this Session");
  expect(again.answer.text).not.toContain("Feedback report sent");
  expect(
    again.asked.filter((url) => url === origin + "/poppy/feedback"),
  ).toHaveLength(1);
});

it("drops what it showed with the account once the Company no longer takes the sign-in, and keeps what it showed signed out", async () => {
  // The customer pressed Disconnect at the Company: the token is dead.
  transport.mockImplementation(async (url) => {
    if (url === origin + "/poppy/openapi.json") return api;
    if (url === origin + "/api/account/orders")
      throw new ProtocolError(401, "invalid_token");
    return { products: [{ name: "Cara cara oranges" }] };
  });
  const run = shop("poppy:read");
  at(run).dpop = (await createIdentity()).privateKey;
  const publicTurns = [
    { role: "user" as const, content: "What do you sell?" },
    { role: "assistant" as const, content: "Oranges and coffee." },
  ];
  const signedOut = [
    { role: "user" as const, content: "What do you sell?", signedOut: true },
    {
      role: "assistant" as const,
      content: "Oranges and coffee.",
      data: '{"products":2}',
      signedOut: true,
    },
  ] satisfies Run["transcript"];
  at(run).publicHistory = structuredClone(publicTurns);
  at(run).operations = {
    op_1: { operation_id: "op_1", summary: "Move Elena's delivery" },
  } as never;
  Object.assign(run, {
    title: "What do you sell?",
    history: [
      ...publicTurns,
      { role: "user", content: "my deliveries" },
      { role: "assistant", content: "Customer: Elena Maren" },
    ],
    transcript: [
      ...signedOut,
      { role: "user", content: "my deliveries" },
      {
        role: "assistant",
        content: "Customer: Elena Maren",
        data: '{"customer":"Elena Maren"}',
      },
    ],
  });

  const turn = await say(run, "my orders");
  expect(turn.status).toBe(401);
  // The message about the lost access, and what the page still shows.
  expect(turn.answer).toMatchObject({
    code: "account_unavailable",
    error:
      "The Company no longer accepts this access. It may have expired or been revoked. Sign in again to reconnect; no action has been retried.",
    history: signedOut,
  });
  expect(at(run).accountUnavailable).toBe(true);
  expect(run.transcript).toEqual(signedOut);
  expect(run.history).toEqual(publicTurns);
  expect(at(run).operations).toEqual({});
  expect(run.title).toBe("What do you sell?");
  expect(
    JSON.stringify([
      run.transcript,
      run.history,
      at(run).operations,
      turn.answer,
    ]),
  ).not.toContain("Elena");

  // Iris knows now. What is asked next isn't taken back by a later request.
  const next = await say(run, "what do you sell?");
  expect(next.status).toBe(200);
  expect(next.answer).not.toHaveProperty("history");
  const again = await say(run, "what do you sell?");
  expect(again.answer).not.toHaveProperty("history");
  expect(run.transcript!.map((entry) => entry.content)).toEqual([
    "What do you sell?",
    "Oranges and coffee.",
    "what do you sell?",
    next.answer.text,
    "what do you sell?",
    again.answer.text,
  ]);
});

it("leaves a signed-out conversation alone when the Company refuses its Session", async () => {
  transport.mockImplementation(async (url) => {
    if (url === origin + "/poppy/openapi.json") return api;
    throw new ProtocolError(401, "invalid_token");
  });
  const run = shop();
  run.history = [{ role: "user", content: "hello" }];
  const turn = await say(run, "what do you sell?");
  expect(turn.answer).not.toHaveProperty("history");
  expect(run.history).toEqual([{ role: "user", content: "hello" }]);
});

it("tells the page its conversation has ended, and starts no new one in its place", async () => {
  const ask = (id: string) =>
    POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
          "X-Poppy-Conversation": id,
        },
        body: JSON.stringify({
          url: origin,
          message: "what do you sell?",
          provider: "demo",
        }),
      }),
    );
  // Thirty minutes passed in a tab left open: History says read-only.
  const visitor = await seedRun("v".repeat(43), "run_chat_ended_0001", {
    ...shop(),
    expires: Date.now() - 1000,
    created: Date.now() - 1801000,
    title: "What do you sell?",
    transcript: [{ role: "user", content: "What do you sell?" }],
  });
  const before = (await listConversations(visitor)).length;
  transport.mockClear();
  const refused = await ask("run_chat_ended_0001");
  expect(refused.status).toBe(410);
  expect(refused.headers.get("X-Poppy-Conversation-Ended")).toBe(
    "run_chat_ended_0001",
  );
  // No conversation is named for the page to move to.
  expect(refused.headers.get("X-Poppy-Conversation")).toBeNull();
  expect(await refused.json()).toEqual({
    code: "conversation_ended",
    error:
      "This conversation has ended and is read-only, so nothing was sent to any company. Start a new conversation to go on.",
    keptUntil: expect.any(Number),
  });
  // Nothing was asked of the Company, and nothing new was started.
  expect(transport).not.toHaveBeenCalled();
  expect(await listConversations(visitor)).toHaveLength(before);
  // A conversation unknown here still goes on as a new one.
  discover.mockResolvedValue(connection().company);
  const fresh = await ask("run_chat_never_0001");
  expect(fresh.status).toBe(200);
  expect(fresh.headers.get("X-Poppy-Conversation")).toMatch(
    /^[A-Za-z0-9_-]{16,64}$/,
  );
  expect(fresh.headers.get("X-Poppy-Conversation")).not.toBe(
    "run_chat_never_0001",
  );
});

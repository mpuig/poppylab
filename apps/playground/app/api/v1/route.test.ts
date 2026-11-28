/**
 * `/api/v1`, the agent's channel-neutral API, held to its OpenAPI
 * description: every route the server has is described and every route
 * described is served, and the answers of real conversations (a new one in
 * demo mode, and the two stored before the core was a package) and of the
 * agent account (created and signed in to with a software passkey, from
 * the page and from an app) match their schemas, member by member.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
});
const papMocks = vi.hoisted(() => ({
  discoverCompany: undefined as
    ((...args: unknown[]) => Promise<unknown>) | undefined,
  protocolRequest: undefined as
    ((...args: unknown[]) => Promise<unknown>) | undefined,
}));
vi.mock("@poppy-lab/pap-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poppy-lab/pap-client")>();
  return {
    ...actual,
    discoverCompany: ((...args: Parameters<typeof actual.discoverCompany>) =>
      papMocks.discoverCompany
        ? papMocks.discoverCompany(...args)
        : actual.discoverCompany(...args)) as typeof actual.discoverCompany,
    protocolRequest: ((...args: Parameters<typeof actual.protocolRequest>) =>
      papMocks.protocolRequest
        ? papMocks.protocolRequest(...args)
        : actual.protocolRequest(...args)) as typeof actual.protocolRequest,
  };
});
// The browser's cookies: its visitor's, and an account's once one signs in.
const browser = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.includes("visitor")
        ? { value: "t".repeat(43) }
        : browser.has(name)
          ? { value: browser.get(name)! }
          : undefined,
    set: (name: string, value: string, options: { maxAge?: number }) => {
      if (options.maxAge === 0 || !value) browser.delete(name);
      else browser.set(name, value);
    },
  }),
}));
import { ROUTES } from "@poppy-lab/pap-agent/api-http";
import { openApiDocument } from "@poppy-lab/pap-agent/openapi";
import {
  configureBackend,
  memoryBackend,
  seedRun,
} from "@poppy-lab/pap-agent/runs";
import type { Run } from "@poppy-lab/pap-agent/runtime";
import { TRANSCRIPT_LIMITS } from "@poppy-lab/pap-agent/transcript";
import { softwareAuthenticator } from "@poppy-lab/pap-agent/testing";
import two from "../account/fixtures/stored-two-companies.json";
import { DELETE, GET, POST } from "./[...path]/route";

type Schema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  oneOf?: Schema[];
};
const document = openApiDocument();
const schemas = document.components.schemas as Record<string, Schema>;
/** Where `value` doesn't match `schema`, as paths; none when it does. */
function mismatches(value: unknown, schema: Schema, at = "$"): string[] {
  if (schema.$ref)
    return mismatches(value, schemas[schema.$ref.split("/").at(-1)!]!, at);
  if (schema.oneOf) {
    const fits = schema.oneOf.filter((s) => !mismatches(value, s, at).length);
    return fits.length === 1 ? [] : [`${at}: fits ${fits.length} of oneOf`];
  }
  if (schema.enum && !schema.enum.includes(value))
    return [`${at}: ${String(value)} not in enum`];
  const types = [schema.type ?? []].flat();
  const kind =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : Number.isInteger(value)
          ? "integer"
          : typeof value;
  if (
    types.length &&
    !types.includes(kind) &&
    !(kind === "integer" && types.includes("number"))
  )
    return [`${at}: ${kind}, not ${types.join("|")}`];
  if (kind === "array" && schema.items)
    return (value as unknown[]).flatMap((v, i) =>
      mismatches(v, schema.items!, `${at}[${i}]`),
    );
  if (kind === "object" && schema.properties) {
    const object = value as Record<string, unknown>;
    return [
      ...(schema.required ?? [])
        .filter((k) => !(k in object))
        .map((k) => `${at}.${k}: missing`),
      ...Object.entries(object).flatMap(([k, v]) =>
        schema.properties![k]
          ? mismatches(v, schema.properties![k]!, `${at}.${k}`)
          : [`${at}.${k}: not described`],
      ),
    ];
  }
  return [];
}
/** The schema of an operation's answer with this status. */
const answerOf = (operation: string, status: number) => {
  for (const methods of Object.values(document.paths))
    for (const op of Object.values(methods) as Array<{
      operationId: string;
      responses: Record<
        string,
        { content?: Record<string, { schema: Schema }> }
      >;
    }>)
      if (op.operationId === operation) {
        const content = op.responses[String(status)]?.content;
        expect(content, `${operation} ${status} is described`).toBeDefined();
        return Object.values(content!)[0]!.schema;
      }
  throw new Error(`No operation ${operation}`);
};

const agent = "http://localhost:3000";
const call = async (
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: object,
  headers: Record<string, string> = {},
) => {
  const request = new Request(`${agent}/api/v1${path}`, {
    method,
    headers: {
      ...(headers.authorization || headers.origin === ""
        ? {}
        : { origin: agent }),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...Object.fromEntries(
        Object.entries(headers).filter(([, value]) => value !== ""),
      ),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await { GET, POST, DELETE }[method](request);
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
};
const fits = (operation: string, answer: { status: number; data: unknown }) =>
  expect(mismatches(answer.data, answerOf(operation, answer.status))).toEqual(
    [],
  );

beforeEach(() => {
  configureBackend(memoryBackend());
  browser.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  papMocks.discoverCompany = undefined;
  papMocks.protocolRequest = undefined;
});

it("describes every route it serves, and serves every route it describes", async () => {
  const described = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods as Record<string, { operationId: string }>).map(
      ([method, op]) => `${method.toUpperCase()} ${path} ${op.operationId}`,
    ),
  );
  expect(described.sort()).toEqual(
    ROUTES.map((r) => `${r.method} /api/v1${r.path} ${r.operation}`).sort(),
  );
  const served = await GET(new Request(`${agent}/api/v1/openapi.json`));
  expect(await served.json()).toEqual(document);
});

it("returns one safe error shape for malformed conversation input", async () => {
  const created = await call("POST", "/conversations", {
    ignored: "unknown request members stay compatible",
  });
  expect(created.status).toBe(201);
  const id = created.data.id as string;

  const malformed = await call("POST", `/conversations/${id}/messages`, {
    text: "Hello",
    model: {
      provider: "openai-compatible",
      apiKey: { submitted: "sentinel-api-key-7a3f" },
    },
  });
  expect(malformed).toEqual({
    status: 400,
    data: {
      code: "invalid_request",
      error: "model.apiKey must be a string of at most 2,048 characters.",
    },
  });
  expect(JSON.stringify(malformed)).not.toContain("sentinel-api-key-7a3f");

  const tooLong = await call("POST", `/conversations/${id}/messages`, {
    text: "m".repeat(2001),
  });
  expect(tooLong).toEqual({
    status: 400,
    data: {
      code: "invalid_request",
      error: "text must be a string of at most 2,000 characters.",
    },
  });

  const access = await call("POST", `/conversations/${id}/sign-ins`, {
    company: "https://company.example",
    access: "admin",
  });
  expect(access).toEqual({
    status: 400,
    data: {
      code: "invalid_request",
      error: "access must be read or write.",
    },
  });
});

it("serves nothing, and reads no body, on a deployment that isn't configured", async () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    const refused = await call("GET", `/conversations/${"x".repeat(43)}`);
    expect(refused.status).toBe(403);
    expect(refused.data.code).toBe("disabled");
    const unread = await POST(
      new Request(`${agent}/api/v1/conversations`, {
        method: "POST",
        headers: { origin: agent, "Content-Type": "text/plain" },
        body: "not JSON",
      }),
    );
    expect(unread.status).toBe(403);
    expect(((await unread.json()) as { code: string }).code).toBe("disabled");
  } finally {
    vi.stubEnv("NODE_ENV", "development");
  }
});

describe("a new conversation in demo mode", () => {
  it("starts, takes a message and a choice, and answers as described", async () => {
    const started = await call("POST", "/conversations", {});
    expect(started.status).toBe(201);
    fits("startConversation", started);
    const id = started.data.id as string;
    expect(started.data).toMatchObject({
      active: true,
      companies: [],
      messages: [],
    });

    const said = await call("POST", `/conversations/${id}/messages`, {
      text: "hello there",
    });
    expect(said.status).toBe(200);
    fits("sendMessage", said);
    const messages = said.data.messages as Array<{
      from: string;
      text: string;
      choices?: unknown[];
    }>;
    expect(messages[0]).toEqual({ from: "user", text: "hello there" });
    expect(messages.at(-1)).toMatchObject({ from: "agent" });
    expect(messages.at(-1)!.choices!.length).toBeGreaterThan(0);

    // A choice names a Company by origin: one the conversation doesn't have is refused.
    const chose = await call("POST", `/conversations/${id}/answers`, {
      answer: { company: "https://bank.example" },
    });
    expect(chose.status).toBe(400);
    fits("answerChoice", chose);
    expect(chose.data.code).toBe("company_not_connected");

    const read = await call("GET", `/conversations/${id}`);
    fits("getConversation", read);
    expect((read.data.messages as unknown[]).length).toBe(messages.length);
  });

  it("streams a demo turn's answer in the same events as a model's, each as described", async () => {
    const started = await call("POST", "/conversations", {});
    const id = started.data.id as string;
    const response = await POST(
      new Request(`${agent}/api/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: {
          origin: agent,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ text: "hello there" }),
      }),
    );
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const [name, data] = block.split("\n");
        const event = JSON.parse(data!.slice(6)) as { type: string };
        expect(name).toBe(`event: ${event.type}`);
        return event as Record<string, unknown> & { type: string };
      });
    const schema = (
      document.paths["/api/v1/conversations/{id}/messages"] as {
        post: {
          responses: {
            "200": { content: Record<string, { schema: Schema }> };
          };
        };
      }
    ).post.responses["200"].content["text/event-stream"]!.schema;
    for (const event of events) expect(mismatches(event, schema)).toEqual([]);
    // Demo mode's answer is there at once: its sentences, all, then the turn.
    expect(events.at(-1)!.type).toBe("turn");
    const deltas = events.slice(0, -1);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((e) => e.type === "message.delta")).toBe(true);
    const result = events.at(-1)!.result as {
      messages: Array<{ from: string; text: string; id?: string }>;
    };
    const answer = result.messages.at(-1)!;
    expect(answer.from).toBe("agent");
    const own = deltas.filter((d) => d.message === answer.id);
    expect(own.map((d) => d.index)).toEqual(own.map((_, i) => i));
    expect(own.map((d) => d.text).join("")).toBe(answer.text);
  });

  it("returns and streams only the current turn's messages across multiple turns", async () => {
    const started = await call("POST", "/conversations", {});
    const id = started.data.id as string;

    const first = await call("POST", `/conversations/${id}/messages`, {
      text: "first turn question",
    });
    expect(first.status).toBe(200);
    fits("sendMessage", first);
    const firstMessages = first.data.messages as Array<{
      from: string;
      text: string;
    }>;
    expect(firstMessages).toHaveLength(2);
    expect(firstMessages[0]).toEqual({
      from: "user",
      text: "first turn question",
    });

    // Second turn over SSE: only the second turn's messages and deltas come back.
    const response = await POST(
      new Request(`${agent}/api/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: {
          origin: agent,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ text: "second turn question" }),
      }),
    );
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const [name, data] = block.split("\n");
        const event = JSON.parse(data!.slice(6)) as { type: string };
        expect(name).toBe(`event: ${event.type}`);
        return event as Record<string, unknown> & { type: string };
      });
    const schema = (
      document.paths["/api/v1/conversations/{id}/messages"] as {
        post: {
          responses: {
            "200": { content: Record<string, { schema: Schema }> };
          };
        };
      }
    ).post.responses["200"].content["text/event-stream"]!.schema;
    for (const event of events) expect(mismatches(event, schema)).toEqual([]);

    expect(events.at(-1)!.type).toBe("turn");
    const deltas = events.slice(0, -1);
    const result = events.at(-1)!.result as {
      replaced: boolean;
      messages: Array<{ from: string; text: string; id?: string }>;
      state: { messages: Array<{ from: string; text: string }> };
    };
    expect(result.replaced).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      from: "user",
      text: "second turn question",
    });
    expect(result.messages.some((m) => m.text === "first turn question")).toBe(
      false,
    );
    expect(result.state.messages).toHaveLength(4);

    const agentMessages = result.messages.filter((m) => m.from === "agent");
    expect(agentMessages).toHaveLength(1);
    expect(new Set(deltas.map((d) => d.message))).toEqual(
      new Set([agentMessages[0]!.id]),
    );
    expect(deltas.map((d) => d.text).join("")).toBe(agentMessages[0]!.text);
  });

  it("returns and streams only the current turn's messages for repeated identical lines, including at front-eviction cap", async () => {
    const started = await call("POST", "/conversations", {});
    const id = started.data.id as string;

    const first = await call("POST", `/conversations/${id}/messages`, {
      text: "yes",
    });
    expect(first.status).toBe(200);
    fits("sendMessage", first);
    const firstMessages = first.data.messages as Array<{
      from: string;
      text: string;
    }>;
    expect(firstMessages).toHaveLength(2);
    const repeatedReply = firstMessages[1]!.text;

    // Immediate identical second turn: returns only the 2 new messages.
    const second = await call("POST", `/conversations/${id}/messages`, {
      text: "yes",
    });
    expect(second.status).toBe(200);
    fits("sendMessage", second);
    const secondMessages = second.data.messages as Array<{
      from: string;
      text: string;
    }>;
    expect(secondMessages.map((m) => [m.from, m.text])).toEqual([
      ["user", "yes"],
      ["agent", repeatedReply],
    ]);
    expect(
      (second.data.state as { messages: unknown[] }).messages,
    ).toHaveLength(4);

    // Fill the transcript to the exact entry limit with identical user/agent pairs,
    // then send the same line again over SSE so front eviction drops the oldest pair.
    const cappedId = "c".repeat(43);
    await seedRun("t".repeat(43), cappedId, {
      protocol: "1.0",
      expires: Date.now() + 60_000,
      calls: 0,
      busy: false,
      connections: [],
      history: [],
      transcript: Array.from({ length: TRANSCRIPT_LIMITS.entries / 2 }, () => [
        {
          role: "user" as const,
          content: "yes",
          signedOut: true as const,
          accounts: [],
        },
        {
          role: "assistant" as const,
          content: repeatedReply,
          signedOut: true as const,
          accounts: [],
        },
      ]).flat(),
    });

    const response = await POST(
      new Request(`${agent}/api/v1/conversations/${cappedId}/messages`, {
        method: "POST",
        headers: {
          origin: agent,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ text: "yes" }),
      }),
    );
    expect(response.status).toBe(200);
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const [, data] = block.split("\n");
        return JSON.parse(data!.slice(6)) as Record<string, unknown> & {
          type: string;
        };
      });
    expect(events.at(-1)!.type).toBe("turn");
    const deltas = events.slice(0, -1);
    const result = events.at(-1)!.result as {
      replaced: boolean;
      messages: Array<{ from: string; text: string; id?: string }>;
      state: { messages: Array<{ from: string; text: string }> };
    };
    expect(result.replaced).toBe(false);
    expect(result.state.messages).toHaveLength(TRANSCRIPT_LIMITS.entries);
    expect(result.messages.map((m) => [m.from, m.text])).toEqual([
      ["user", "yes"],
      ["agent", repeatedReply],
    ]);
    expect(new Set(deltas.map((d) => d.message))).toEqual(
      new Set([result.messages[1]!.id]),
    );
    expect(deltas.map((d) => d.text).join("")).toBe(repeatedReply);
  });

  it("returns only the current turn's messages when front eviction drops older turns", async () => {
    const cappedId = "e".repeat(43);
    const pairs = TRANSCRIPT_LIMITS.entries / 2;
    await seedRun("t".repeat(43), cappedId, {
      protocol: "1.0",
      expires: Date.now() + 60_000,
      calls: 0,
      busy: false,
      connections: [],
      history: [],
      // Two identical early pairs at the front: evicting the first leaves an
      // identical entry at index 0, which fools a before/after head comparison.
      transcript: Array.from({ length: pairs }, (_, i) => [
        {
          role: "user" as const,
          content: i < 2 ? "yes" : `older user ${i}`,
          signedOut: true as const,
          accounts: [],
        },
        {
          role: "assistant" as const,
          content: i < 2 ? "Got it." : `older reply ${i}`,
          signedOut: true as const,
          accounts: [],
        },
      ]).flat(),
    });

    const sent = await call("POST", `/conversations/${cappedId}/messages`, {
      text: "fresh turn after cap",
    });
    expect(sent.status).toBe(200);
    fits("sendMessage", sent);
    const messages = sent.data.messages as Array<{
      from: string;
      text: string;
    }>;
    const state = sent.data.state as {
      messages: Array<{ from: string; text: string }>;
    };
    expect(sent.data.replaced).toBe(false);
    expect(state.messages).toHaveLength(TRANSCRIPT_LIMITS.entries);
    expect(state.messages[0]!.text).toBe("yes");
    expect(state.messages[2]!.text).toBe("older user 2");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      from: "user",
      text: "fresh turn after cap",
    });
    expect(messages[1]!.from).toBe("agent");
  });

  it("never counts another tab's concurrent turn finishing before the run lock is taken", async () => {
    const inner = memoryBackend();
    let reads = 0;
    let injected = false;
    let targetKey = "";
    const wrapped: typeof inner = {
      ...inner,
      async get(visitor, key) {
        if (targetKey && key === targetKey) {
          reads++;
          // First read is `api.ts`'s unlocked check; second read is `chatTurn`'s
          // `acquireRun`. Simulate another tab completing a turn in between.
          if (reads === 2 && !injected) {
            injected = true;
            await call("POST", `/conversations/${id}/messages`, {
              text: "other tab turn",
            });
          }
        }
        const current = await inner.get(visitor, key);
        return current ? structuredClone(current) : undefined;
      },
      async put(visitor, key, value, expected, expires) {
        return inner.put(
          visitor,
          key,
          structuredClone(value),
          expected,
          expires,
        );
      },
    };
    configureBackend(wrapped);

    const started = await call("POST", "/conversations", {});
    expect(started.status).toBe(201);
    const id = started.data.id as string;
    targetKey = `run:${id}`;

    const own = await call("POST", `/conversations/${id}/messages`, {
      text: "this tab turn",
    });
    expect(own.status).toBe(200);
    fits("sendMessage", own);
    const ownMessages = own.data.messages as Array<{
      from: string;
      text: string;
    }>;
    const stateMessages = (
      own.data.state as { messages: Array<{ from: string; text: string }> }
    ).messages;
    expect(injected).toBe(true);
    expect(stateMessages).toHaveLength(4);
    expect(ownMessages).toHaveLength(2);
    expect(ownMessages[0]).toEqual({ from: "user", text: "this tab turn" });
    expect(ownMessages.some((m) => m.text === "other tab turn")).toBe(false);
  });

  it("refuses what isn't the user's own, and what isn't there", async () => {
    expect(
      (
        await call(
          "POST",
          "/conversations",
          {},
          { origin: "https://elsewhere.example" },
        )
      ).status,
    ).toBe(403);
    const bearer = await call(
      "POST",
      "/conversations",
      {},
      { authorization: "Bearer x" },
    );
    expect(bearer).toMatchObject({
      status: 401,
      data: { code: "invalid_token" },
    });
    const missing = await call("GET", `/conversations/${"z".repeat(43)}`);
    expect(missing.status).toBe(404);
    fits("getConversation", missing);
    expect((await call("GET", "/nothing")).status).toBe(404);
  });
});

describe("a conversation stored before the core was a package", () => {
  const seed = async () => {
    vi.useFakeTimers({ now: two.capturedAt, toFake: ["Date"] });
    await seedRun(
      "t".repeat(43),
      two.id,
      structuredClone(two.run) as unknown as Run,
    );
  };

  it("reads as described: two Companies, a proposal at each, a Direct Conversation", async () => {
    await seed();
    const read = await call("GET", `/conversations/${two.id}`);
    expect(read.status).toBe(200);
    fits("getConversation", read);
    const state = read.data as {
      companies: Array<{
        name: string;
        signedIn: boolean;
        direct: { open: boolean };
      }>;
      proposals: Array<{
        company: { name: string };
        state: string;
        terms: object;
      }>;
    };
    expect(
      state.companies.map((c) => [c.name, c.signedIn, c.direct.open]),
    ).toEqual([
      ["Lantern Noodle Bar", true, true],
      ["Harborline Bank", true, false],
    ]);
    expect(state.proposals.map((p) => [p.company.name, p.state])).toEqual([
      ["Lantern Noodle Bar", "proposed"],
      ["Harborline Bank", "proposed"],
    ]);
    expect(state.proposals[1]!.terms).toMatchObject({ amount_cents: 2500 });
  });

  it("lists what waits for the user, and drops a proposal once it is decided", async () => {
    await seed();
    type Item = {
      conversation: string;
      kind: string;
      text: string;
      company?: { origin: string; name: string };
      proposal?: { id: string; revision: string };
    };
    const listed = await call("GET", "/pending");
    expect(listed.status).toBe(200);
    fits("listPending", listed);
    const items = listed.data.items as Item[];
    const proposals = items.filter((item) => item.kind === "proposal");
    expect(
      proposals.map((item) => [item.conversation, item.company?.name]),
    ).toEqual([
      [two.id, "Lantern Noodle Bar"],
      [two.id, "Harborline Bank"],
    ]);
    // In the agent's words, from the terms: never the Company's summary.
    expect(proposals[1]!.text).toBe("Approve or decline the $25.00 transfer");
    // Nothing secret rides along: no token, code, verifier or OAuth state.
    expect(JSON.stringify(listed.data)).not.toMatch(
      /verifier|access_?token|refresh|"state"|request_uri/i,
    );

    const transfer = proposals[1]!;
    const declined = await call(
      "POST",
      `/conversations/${two.id}/proposals/${transfer.proposal!.id}/decision`,
      {
        company: transfer.company!.origin,
        revision: transfer.proposal!.revision,
        decision: "decline",
      },
    );
    expect(declined.status).toBe(200);
    const after = (await call("GET", "/pending")).data.items as Item[];
    expect(
      after
        .filter((item) => item.kind === "proposal")
        .map((item) => item.company?.name),
    ).toEqual(["Lantern Noodle Bar"]);
  });

  it("lists nothing for a visitor with no conversation", async () => {
    const listed = await call("GET", "/pending");
    expect(listed).toEqual({ status: 200, data: { items: [] } });
  });

  it("declines a proposal, and streams its events from the state they start at", async () => {
    await seed();
    const { proposals } = (await call("GET", `/conversations/${two.id}`))
      .data as {
      proposals: Array<{
        id: string;
        revision: string;
        company: { origin: string };
      }>;
    };
    const transfer = proposals[1]!;
    const declined = await call(
      "POST",
      `/conversations/${two.id}/proposals/${transfer.id}/decision`,
      {
        company: transfer.company.origin,
        revision: transfer.revision,
        decision: "decline",
      },
    );
    expect(declined.status).toBe(200);
    fits("decideProposal", declined);
    expect(declined.data.proposal).toMatchObject({
      id: transfer.id,
      state: "declined",
    });

    const stop = new AbortController();
    const stream = await GET(
      new Request(`${agent}/api/v1/conversations/${two.id}/events`, {
        signal: stop.signal,
      }),
    );
    expect(stream.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    let text = "";
    while (!text.includes("event: state")) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    stop.abort();
    void reader.cancel();
    const data = JSON.parse(
      text.split("event: state\ndata: ")[1]!.split("\n\n")[0]!,
    );
    expect(mismatches(data, answerOf("conversationEvents", 200))).toEqual([]);
    expect(data.state.id).toBe(two.id);
  });

  it("returns and streams only current-turn messages when a turn adds no user line", async () => {
    vi.useFakeTimers({ now: two.capturedAt, toFake: ["Date"] });
    const run = structuredClone(two.run) as unknown as Run;
    const lantern = run.connections[0]!;
    const company = lantern.company!;
    const origin = "http://noodles.localhost:4200";
    delete lantern.conversation!.direct;
    lantern.conversation!.invitation = {
      event: "evt_invite_1",
      reason: "Check your delivery slot",
    };
    await seedRun("t".repeat(43), two.id, run);

    papMocks.discoverCompany = async () => company;
    papMocks.protocolRequest = async (url) => {
      const target = String(url);
      if (target.endsWith("/poppy/tasks")) return { tasks: [] };
      if (target.endsWith("/openapi.json"))
        return {
          openapi: "3.1.0",
          paths: {
            "/api/menu": {
              get: {
                operationId: "menu",
                summary: "Menu",
                responses: { "200": { description: "OK" } },
              },
            },
          },
        };
      if (target.includes("/poppy/conversations"))
        return {
          conversation_id: "cnv_direct_new",
          working: false,
          handoff: "none",
          responder: "human",
          closed: false,
          cursor: "evt_direct_1",
          events: [
            {
              id: "evt_direct_1",
              type: "message",
              message: {
                role: "assistant",
                author: { type: "human", name: "Maya" },
                text: "Hi! I can update your delivery slot directly.",
              },
            },
          ],
        };
      throw new Error(`Unexpected protocolRequest: ${target}`);
    };

    const priorCount = (
      (await call("GET", `/conversations/${two.id}`)).data.messages as unknown[]
    ).length;

    const response = await POST(
      new Request(`${agent}/api/v1/conversations/${two.id}/answers`, {
        method: "POST",
        headers: {
          origin: agent,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          answer: {
            invitation: {
              company: origin,
              accept: true,
            },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const [name, data] = block.split("\n");
        const event = JSON.parse(data!.slice(6)) as { type: string };
        expect(name).toBe(`event: ${event.type}`);
        return event as Record<string, unknown> & { type: string };
      });
    const schema = (
      document.paths["/api/v1/conversations/{id}/answers"] as {
        post: {
          responses: {
            "200": { content: Record<string, { schema: Schema }> };
          };
        };
      }
    ).post.responses["200"].content["text/event-stream"]!.schema;
    for (const event of events) expect(mismatches(event, schema)).toEqual([]);

    expect(events.at(-1)!.type).toBe("turn");
    const deltas = events.slice(0, -1);
    const result = events.at(-1)!.result as {
      replaced: boolean;
      messages: Array<{ from: string; text: string; id?: string }>;
      state: { messages: Array<{ from: string; text: string }> };
    };
    expect(result.replaced).toBe(false);
    // Accepting an invitation adds no user line: prior turns must not repeat.
    expect(result.messages.map((m) => m.from)).toEqual(["company", "agent"]);
    expect(result.messages[0]!.text).toContain("delivery slot directly");
    expect(result.messages[1]!.text).toContain("Lantern Noodle Bar");
    expect(result.state.messages).toHaveLength(
      priorCount + result.messages.length,
    );
    expect(new Set(deltas.map((d) => d.message))).toEqual(
      new Set([result.messages[1]!.id]),
    );
    expect(deltas.map((d) => d.text).join("")).toBe(result.messages[1]!.text);
  });

  it("returns and streams only current-turn messages when earlier history is replaced", async () => {
    vi.useFakeTimers({ now: two.capturedAt, toFake: ["Date"] });
    const run = structuredClone(two.run) as unknown as Run;
    run.removing = { remove: ["http://noodles.localhost:4200"] };
    await seedRun("t".repeat(43), two.id, run);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    const response = await POST(
      new Request(`${agent}/api/v1/conversations/${two.id}/answers`, {
        method: "POST",
        headers: {
          origin: agent,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          answer: { remove: ["http://noodles.localhost:4200"] },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const [name, data] = block.split("\n");
        const event = JSON.parse(data!.slice(6)) as { type: string };
        expect(name).toBe(`event: ${event.type}`);
        return event as Record<string, unknown> & { type: string };
      });
    const schema = (
      document.paths["/api/v1/conversations/{id}/answers"] as {
        post: {
          responses: {
            "200": { content: Record<string, { schema: Schema }> };
          };
        };
      }
    ).post.responses["200"].content["text/event-stream"]!.schema;
    for (const event of events) expect(mismatches(event, schema)).toEqual([]);

    expect(events.at(-1)!.type).toBe("turn");
    const deltas = events.slice(0, -1);
    const result = events.at(-1)!.result as {
      replaced: boolean;
      messages: Array<{ from: string; text: string; id?: string }>;
      state: { messages: Array<{ from: string; text: string }> };
    };
    expect(result.replaced).toBe(true);
    // Surviving signed-out messages stay in `state.messages`, never in the turn delta.
    expect(result.state.messages.length).toBeGreaterThan(
      result.messages.length,
    );
    expect(result.messages.map((m) => m.from)).toEqual(["user", "agent"]);
    expect(result.messages.some((m) => m.text === "What's on the menu?")).toBe(
      false,
    );
    expect(deltas.some((d) => String(d.text).includes("Shoyu ramen"))).toBe(
      false,
    );
    expect(new Set(deltas.map((d) => d.message))).toEqual(
      new Set([result.messages[1]!.id]),
    );
    expect(deltas.map((d) => d.text).join("")).toBe(result.messages[1]!.text);
  });
});

describe("the agent account", () => {
  /** A new account's ceremony, from the page (`origin`) or an app (none). */
  async function create(app: boolean) {
    const authenticator = softwareAuthenticator(agent);
    const from = app ? { origin: "" } : {};
    const options = await call(
      "POST",
      "/accounts/options",
      { label: "Home" },
      from,
    );
    fits("accountOptions", options);
    const { ceremony } = options.data as { ceremony: string };
    const created = await call(
      "POST",
      "/accounts",
      {
        ceremony,
        credential: await authenticator.create(
          options.data.options as Parameters<typeof authenticator.create>[0],
        ),
        device: app ? "iPhone" : "Chrome on macOS",
      },
      from,
    );
    fits("createAccount", created);
    return { authenticator, created };
  }

  it("answers the page and an app as described, both ways", async () => {
    const { authenticator, created } = await create(false);
    expect(created.status).toBe(201);
    expect(created.data).not.toHaveProperty("tokens");
    const read = await call("GET", "/account");
    expect(read.status).toBe(200);
    fits("getAccount", read);

    // The same account, signed in from an app.
    const options = await call("POST", "/sessions/options", {}, { origin: "" });
    fits("signInOptions", options);
    const signedIn = await call(
      "POST",
      "/sessions",
      {
        ceremony: options.data.ceremony as string,
        credential: await authenticator.get(
          options.data.options as { challenge: string },
        ),
        device: "iPhone",
      },
      { origin: "" },
    );
    expect(signedIn.status).toBe(201);
    fits("signIn", signedIn);
    const tokens = signedIn.data.tokens as Record<string, string>;
    const bearer = { authorization: `Bearer ${tokens.accessToken}` };
    fits("getAccount", await call("GET", "/account", undefined, bearer));
    const sessions = await call("GET", "/account/sessions", undefined, bearer);
    fits("listSessions", sessions);
    expect((sessions.data.sessions as unknown[]).length).toBe(2);
    const refreshed = await call(
      "POST",
      "/sessions/refresh",
      { refreshToken: tokens.refreshToken },
      { origin: "" },
    );
    fits("refreshSession", refreshed);
    const reused = await call(
      "POST",
      "/sessions/refresh",
      { refreshToken: tokens.refreshToken },
      { origin: "" },
    );
    expect(reused.status).toBe(401);
    fits("refreshSession", reused);

    const code = await call("POST", "/account/link-codes", {});
    expect(code.status).toBe(201);
    fits("createLinkCode", code);
    const passkeyOptions = await call("POST", "/account/passkeys/options", {});
    fits("passkeyOptions", passkeyOptions);
    const passkeys = (read.data.passkeys as Array<{ id: string }>).map(
      (p) => p.id,
    );
    const last = await call("DELETE", `/account/passkeys/${passkeys[0]}`);
    expect(last.status).toBe(409);
    fits("removePasskey", last);
    const out = await call("POST", "/account/sign-out", {});
    fits("signOut", out);
    expect((await call("GET", "/account")).status).toBe(401);
  });

  it("brings a conversation stored before the core was a package into the account, where an app reads it", async () => {
    vi.useFakeTimers({ now: two.capturedAt, toFake: ["Date"] });
    await seedRun(
      "t".repeat(43),
      two.id,
      structuredClone(two.run) as unknown as Run,
    );
    const { authenticator, created } = await create(false);
    expect(created.data.account).toMatchObject({ unclaimed: 1 });
    const claimed = await call("POST", "/account/claim", {});
    fits("claimConversations", claimed);
    expect(claimed.data).toMatchObject({ moved: 1 });

    const options = await call("POST", "/sessions/options", {}, { origin: "" });
    const signedIn = await call(
      "POST",
      "/sessions",
      {
        ceremony: options.data.ceremony as string,
        credential: await authenticator.get(
          options.data.options as { challenge: string },
        ),
      },
      { origin: "" },
    );
    const token = (signedIn.data.tokens as { accessToken: string }).accessToken;
    const read = await call("GET", `/conversations/${two.id}`, undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(read.status).toBe(200);
    fits("getConversation", read);
    expect(
      (read.data.companies as Array<{ name: string }>).map((c) => c.name),
    ).toEqual(["Lantern Noodle Bar", "Harborline Bank"]);
  });
});

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
import { softwareAuthenticator } from "@poppy-lab/pap-agent/webauthn-fixture";
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

it("serves nothing, and reads no body, on a deployment that isn't configured", async () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    const refused = await call("GET", "/conversations/run_unknown_0001");
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
    const missing = await call("GET", "/conversations/run_not_here_000001");
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

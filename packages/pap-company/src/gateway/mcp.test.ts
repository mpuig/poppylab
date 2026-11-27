/**
 * The gateway's MCP server (section 7): discovery and metadata, the
 * transport, and tool calls that are the API's own requests, through the
 * same Session, token, scope and Operations v3 checks.
 */
import { describe, expect, it } from "vitest";
import { newSessionId } from "@poppy-lab/pap-client/core";
import { mcpToolsOf } from "./mcp.ts";
import { origin, setup } from "./test-company.ts";
import type { CompanyDefinition } from "./types.ts";

const mcp = `${origin}/mcp`;
const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
const OPERATIONS = '"operations";v="3"';

/** A Company whose `poppy.json` lists the MCP server, with four operations. */
const company: Partial<CompanyDefinition> = {
  discovery: (o) => ({
    apis: [
      { type: "openapi", url: `${o}/openapi.json`, description: "Things" },
      { type: "mcp", url: `${o}/mcp`, description: "Things, as tools" },
    ],
  }),
  requiredExtension: ({ path }) =>
    path === "/api/extra"
      ? { name: "example.com/extra", version: "1" }
      : undefined,
  paths: {
    "/api/things": {
      get: { operationId: "list_things", summary: "List the things." },
    },
    "/api/account/things/{id}": {
      get: {
        operationId: "thing",
        summary: "Read one of your things.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
      },
    },
    "/api/account/things": {
      post: {
        operationId: "add_thing",
        summary: "Propose adding a thing.",
        "x-poppy-proposal": true,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        },
      },
    },
    "/api/extra": {
      get: { operationId: "extra", summary: "Needs an extension." },
    },
  },
  mount: (app, ctx) => {
    const state = ctx.state as { added?: string[] };
    app.get("/api/things", (c) => c.json({ things: ["lamp"] }));
    app.get("/api/extra", (c) => c.json({ extra: true }));
    app.get("/api/account/things/:id", (c) =>
      c.json({
        id: c.req.param("id"),
        q: c.req.query("q") ?? null,
        account: ctx.sessionFor(c).account,
        added: state.added ?? [],
      }),
    );
    app.post("/api/account/things", async (c) => {
      const { name } = (await c.req.json()) as { name: string };
      return ctx.gate(c, {
        key: `add:${name}`,
        terms: { name },
        summary: `Add ${name} to your things.`,
        perform: () => {
          (state.added ??= []).push(name);
          return { summary: `Added ${name}.`, data: { name } };
        },
      });
    });
  },
};

/** The test Company with MCP, and JSON-RPC over its endpoint. */
async function withMcp(deploy: Parameters<typeof setup>[0] = {}) {
  const x = await setup(deploy, company);
  let next = 0;
  /** A JSON-RPC request with the User's Session, and the token when given. */
  const rpc = (
    method: string,
    params: Record<string, unknown> = {},
    options: Omit<NonNullable<Parameters<typeof x.call>[1]>, "body"> = {},
  ) =>
    x.call("/mcp", {
      method: "POST",
      ...options,
      body: { jsonrpc: "2.0", id: ++next, method, params },
    });
  /** The same, without a Session header, as any MCP client sends it. */
  const bare = (body: unknown, headers: Record<string, string> = {}) =>
    x.app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  /** Elena signed in with `scope`, and a token for the MCP server. */
  const signedIn = async (scope = "things:read things:write") => {
    const tokens = await x.signIn(scope);
    if ("refused" in tokens) throw new Error("refused");
    const server = await x.token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      resource: mcp,
    });
    return { default: tokens.access_token, mcp: server.access_token };
  };
  /** A tool call, with `_meta` when given. */
  const tool = (
    name: string,
    args: Record<string, unknown>,
    options: Parameters<typeof rpc>[2] = {},
    meta?: Record<string, unknown>,
  ) =>
    rpc(
      "tools/call",
      { name, arguments: args, ...(meta ? { _meta: meta } : {}) },
      options,
    );
  return { ...x, rpc, bare, signedIn, tool };
}

type Rpc = {
  id: number;
  result?: Record<string, unknown> & {
    isError?: boolean;
    content?: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
  };
  error?: { code: number; message: string; data?: unknown };
};
const json = async (r: Response) => (await r.json()) as Rpc;

describe("discovery", () => {
  it("lists the MCP server as a protected resource and publishes its metadata", async () => {
    const x = await withMcp();
    const server = await (
      await x.app.request("/.well-known/oauth-authorization-server")
    ).json();
    expect(server.protected_resources).toEqual([origin, mcp]);
    const r = await x.app.request("/.well-known/oauth-protected-resource/mcp");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      resource: mcp,
      resource_name: "Test Company MCP server",
      authorization_servers: [origin],
      scopes_supported: ["things:read", "things:write"],
      bearer_methods_supported: ["header"],
      dpop_signing_alg_values_supported: ["ES256"],
      dpop_bound_access_tokens_required: true,
    });
    // The domain's own metadata is unchanged (§3.2).
    expect(
      (
        await (
          await x.app.request("/.well-known/oauth-protected-resource")
        ).json()
      ).resource,
    ).toBe(origin);
  });

  it("has no MCP server where poppy.json lists none", async () => {
    const x = await setup();
    expect((await x.app.request("/mcp", { method: "POST" })).status).toBe(404);
    expect(
      (await x.app.request("/.well-known/oauth-protected-resource/mcp")).status,
    ).toBe(404);
    const server = await (
      await x.app.request("/.well-known/oauth-authorization-server")
    ).json();
    expect(server.protected_resources).toEqual([origin]);
    const tokens = await x.signIn();
    if ("refused" in tokens) throw new Error("refused");
    await expect(
      x.token({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        resource: mcp,
      }),
    ).rejects.toThrow(/invalid_target/);
  });
});

describe("transport", () => {
  it("initializes, lists the tools and takes a notification without a Session", async () => {
    const x = await withMcp();
    // Reading what the server offers changes nothing to save.
    const saves = x.store.saves;
    const init = await x.bare({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    expect(init.status).toBe(200);
    expect(init.headers.get("content-type")).toContain("application/json");
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect(await init.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "Test Company", version: "1.0.0" },
      },
    });
    const note = await x.bare(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { "mcp-protocol-version": "2025-06-18" },
    );
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");
    // So does a response from the client: the server asks nothing.
    expect((await x.bare({ jsonrpc: "2.0", id: 9, result: {} })).status).toBe(
      202,
    );
    const list = await json(
      await x.bare(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { "mcp-protocol-version": "2025-06-18" },
      ),
    );
    expect(list.result).toEqual({
      tools: [
        {
          name: "list_things",
          description: "List the things.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
        },
        {
          name: "thing",
          description: "Read one of your things.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" }, q: { type: "string" } },
            required: ["id"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
        },
        {
          name: "add_thing",
          description:
            "Propose adding a thing. Returns an operation for the User to approve; nothing changes until they approve it.",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
        },
        {
          name: "extra",
          description: "Needs an extension.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
        },
      ],
    });
    expect(x.store.saves).toBe(saves);
  });

  it("answers a client that takes only SSE with one event", async () => {
    const x = await withMcp();
    const r = await x.bare(
      { jsonrpc: "2.0", id: 7, method: "ping" },
      { accept: "text/event-stream" },
    );
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    expect(await r.text()).toBe(
      'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{}}\n\n',
    );
  });

  it("refuses another MCP version, batches, bad JSON and unknown methods", async () => {
    const x = await withMcp();
    const newer = await x.bare(
      { jsonrpc: "2.0", id: 1, method: "server/discover" },
      { "mcp-protocol-version": "2026-07-28" },
    );
    expect(newer.status).toBe(400);
    expect((await json(newer)).error).toEqual({
      code: -32600,
      message: "Unsupported MCP-Protocol-Version",
      data: { supported: ["2025-06-18"] },
    });
    const batch = await x.bare([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(batch.status).toBe(400);
    const bad = await x.app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error?.code).toBe(-32700);
    const unknown = await json(
      await x.bare({ jsonrpc: "2.0", id: 3, method: "resources/list" }),
    );
    expect(unknown.error?.code).toBe(-32601);
    expect(
      (await x.app.request("/mcp", { method: "GET" })).headers.get("allow"),
    ).toBe("POST");
  });

  it("pages tools/list only with its own cursors", async () => {
    const x = await withMcp();
    const r = await json(await x.rpc("tools/list", { cursor: "50" }));
    expect(r.error?.code).toBe(-32602);
  });
});

describe("Sessions and tokens", () => {
  it("needs the Session header for a tool call, and checks it as the API does", async () => {
    const x = await withMcp();
    const r = await x.bare({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_things", arguments: {} },
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_session" });
    // A Session header for another URL (htu) is refused.
    const elsewhere = await x.app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Poppy-Version": "1.0",
        "Poppy-Session": "not-a-jwt",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(elsewhere.status).toBe(400);
    expect(await elsewhere.json()).toEqual({ error: "invalid_session" });
  });

  it("refuses an invented token, and the default token, with its metadata", async () => {
    const x = await withMcp();
    const invented = await x.bare(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { authorization: "Bearer invented" },
    );
    expect(invented.status).toBe(401);
    expect(invented.headers.get("www-authenticate")).toBe(
      `DPoP error="invalid_token", resource_metadata="${metadata}"`,
    );
    const tokens = await x.signedIn();
    const wrong = await x.tool("list_things", {}, { access: tokens.default });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toBe(
      `DPoP error="invalid_token", resource_metadata="${metadata}"`,
    );
    // Without a Session header, a token of the server's is no help.
    const known = await x.bare(
      { jsonrpc: "2.0", id: 2, method: "ping" },
      { authorization: `DPoP ${tokens.mcp}` },
    );
    expect(known.status).toBe(400);
    expect(await known.json()).toEqual({ error: "invalid_session" });
    // The server's token works nowhere else (§4.5); the default one does.
    const api = await x.call("/api/account/things/1", { access: tokens.mcp });
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toBe(
      `DPoP error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    );
    expect(
      (await x.call("/api/account/things/1", { access: tokens.default }))
        .status,
    ).toBe(200);
  });

  it("issues a token for the MCP server only to a known resource", async () => {
    const x = await withMcp();
    const tokens = await x.signIn();
    if ("refused" in tokens) throw new Error("refused");
    await expect(
      x.token({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        resource: `${origin}/other`,
      }),
    ).rejects.toThrow(/invalid_target/);
    // Naming the domain gets the default token, as before.
    const domain = await x.token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      resource: origin,
    });
    expect(
      (await x.call("/api/account/things/1", { access: domain.access_token }))
        .status,
    ).toBe(200);
  });

  it("checks Poppy-Version and the Session header as the API does", async () => {
    const x = await withMcp();
    const version = await x.app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "Poppy-Session": "x" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(version.status).toBe(400);
    expect(await version.json()).toEqual({ error: "version_unsupported" });
    // A Session the API started goes on at the MCP server, one account.
    const first = await x.signedIn("things:read");
    expect(
      (await x.tool("thing", { id: "1" }, { access: first.mcp })).status,
    ).toBe(200);
    expect(
      (await x.call("/api/account/things/1", { access: first.default })).status,
    ).toBe(200);
  });
});

describe("tool calls", () => {
  it("calls a read signed out, as the API answers it", async () => {
    const x = await withMcp();
    const r = await json(await x.tool("list_things", {}));
    expect(r.result).toEqual({
      content: [{ type: "text", text: '{"things":["lamp"]}' }],
      structuredContent: { things: ["lamp"] },
    });
  });

  it("asks for sign-in, then scopes, as the API does, with the server's metadata", async () => {
    const x = await withMcp();
    const out = await x.tool("thing", { id: "7" });
    expect(out.status).toBe(401);
    expect(out.headers.get("www-authenticate")).toBe(
      `DPoP scope="things:read", resource_metadata="${metadata}"`,
    );
    // The API's answer to the same request, without the metadata.
    const api = await x.call("/api/account/things/7");
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toBe(
      'DPoP scope="things:read"',
    );

    const read = await x.signedIn("things:read");
    const short = await x.tool(
      "add_thing",
      { name: "lamp" },
      { access: read.mcp, extensions: OPERATIONS },
    );
    expect(short.status).toBe(403);
    expect(await short.json()).toEqual({ error: "insufficient_scope" });
    expect(short.headers.get("www-authenticate")).toBe(
      `DPoP error="insufficient_scope", scope="things:write", resource_metadata="${metadata}"`,
    );
  });

  it("calls a read signed in, with its path and query arguments", async () => {
    const x = await withMcp();
    const tokens = await x.signedIn();
    const r = await json(
      await x.tool("thing", { id: "a b", q: "x" }, { access: tokens.mcp }),
    );
    expect(r.result?.structuredContent).toEqual({
      id: "a b",
      q: "x",
      account: "elena",
      added: [],
    });
  });

  it("returns a proposal's operation, and performs it once, only with the approval", async () => {
    const x = await withMcp();
    const tokens = await x.signedIn();
    const options = { access: tokens.mcp, extensions: OPERATIONS };
    // Without Operations v3: a tool error, not a refusal of the server.
    const undeclared = await json(
      await x.tool("add_thing", { name: "lamp" }, { access: tokens.mcp }),
    );
    expect(undeclared.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: "extension_required",
        extension: "operations",
      },
    });

    const proposed = await json(
      await x.tool("add_thing", { name: "lamp" }, options),
    );
    expect(proposed.result?.isError).toBe(true);
    expect(proposed.result?.content).toEqual([
      {
        type: "text",
        text: "Not done yet. This needs approval: Add lamp to your things.",
      },
    ]);
    const operation = proposed.result?.structuredContent?.operation as {
      operation_id: string;
      revision: string;
    };
    expect(operation).toMatchObject({
      summary: "Add lamp to your things.",
      terms: { name: "lamp" },
    });
    // The API proposes the same operation for the same request.
    const api = await x.call("/api/account/things", {
      method: "POST",
      access: tokens.default,
      extensions: OPERATIONS,
      body: { name: "lamp" },
    });
    expect(api.status).toBe(403);
    expect((await api.json()).operation.operation_id).toBe(
      operation.operation_id,
    );
    // Nothing was done.
    const before = await json(await x.tool("thing", { id: "1" }, options));
    expect(before.result?.structuredContent?.added).toEqual([]);

    const approval = {
      "personalagentprotocol.org/approval": {
        operation_id: operation.operation_id,
        revision: operation.revision,
        approver: "user",
        approved_at: Math.floor(Date.now() / 1000),
        input_type: "tap",
      },
    };
    const done = await json(
      await x.tool("add_thing", { name: "lamp" }, options, approval),
    );
    expect(done.result?.isError).toBeUndefined();
    expect(done.result?.structuredContent).toMatchObject({
      operation_id: operation.operation_id,
      summary: "Added lamp.",
      data: { name: "lamp" },
    });
    // A retry gets the first response, and nothing is done again.
    const again = await json(
      await x.tool("add_thing", { name: "lamp" }, options, approval),
    );
    expect(again.result?.structuredContent).toEqual(
      done.result?.structuredContent,
    );
    const after = await json(await x.tool("thing", { id: "1" }, options));
    expect(after.result?.structuredContent?.added).toEqual(["lamp"]);
  });

  it("doesn't perform an approval of other terms", async () => {
    const x = await withMcp();
    const tokens = await x.signedIn();
    const options = { access: tokens.mcp, extensions: OPERATIONS };
    const proposed = await json(
      await x.tool("add_thing", { name: "lamp" }, options),
    );
    const operation = proposed.result?.structuredContent?.operation as {
      operation_id: string;
      revision: string;
    };
    const other = await json(
      await x.tool("add_thing", { name: "rug" }, options, {
        "personalagentprotocol.org/approval": {
          operation_id: operation.operation_id,
          revision: operation.revision,
          approver: "user",
        },
      }),
    );
    expect(other.result?.isError).toBe(true);
    const after = await json(await x.tool("thing", { id: "1" }, options));
    expect(after.result?.structuredContent?.added).toEqual([]);
  });

  it("refuses one tool whose route needs an undeclared extension", async () => {
    const x = await withMcp();
    const r = await json(await x.tool("extra", {}));
    expect(r.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: "extension_required",
        extension: "example.com/extra",
      },
    });
    const declared = await json(
      await x.tool("extra", {}, { extensions: '"example.com/extra";v="1"' }),
    );
    expect(declared.result?.structuredContent).toEqual({ extra: true });
  });

  it("refuses unknown tools and arguments the tool doesn't take", async () => {
    const x = await withMcp();
    for (const [name, args] of [
      ["nothing", {}],
      ["thing", {}],
      ["thing", { id: "1", other: 1 }],
      ["thing", { id: "../x" }],
      ["thing", { id: { nested: true } }],
    ] as const) {
      const r = await json(await x.tool(name, args));
      expect(r.error?.code).toBe(-32602);
    }
  });

  it("keeps each agent user's copy apart, as the API does", async () => {
    const x = await withMcp({ isolation: "visitor" });
    const tokens = await x.signedIn();
    const options = { access: tokens.mcp, extensions: OPERATIONS };
    const proposed = await json(
      await x.tool("add_thing", { name: "lamp" }, options),
    );
    const operation = proposed.result?.structuredContent?.operation as {
      operation_id: string;
      revision: string;
    };
    await x.tool("add_thing", { name: "lamp" }, options, {
      "personalagentprotocol.org/approval": {
        operation_id: operation.operation_id,
        revision: operation.revision,
        approver: "user",
      },
    });
    const mine = await json(await x.tool("thing", { id: "1" }, options));
    expect(mine.result?.structuredContent?.added).toEqual(["lamp"]);
    // The API of the same copy agrees with its MCP server.
    const api = await x.call("/api/account/things/1", {
      access: tokens.default,
    });
    expect((await api.json()).added).toEqual(["lamp"]);
    // Another agent user, signed in to the same customer, has its own copy.
    const theirs = await x.signIn("things:read");
    if ("refused" in theirs) throw new Error("refused");
    const token = await x.token({
      grant_type: "refresh_token",
      refresh_token: theirs.refresh_token,
      resource: mcp,
    });
    const seen = await json(
      await x.tool(
        "thing",
        { id: "1" },
        {
          user: "usr_other",
          session: newSessionId(),
          access: token.access_token,
        },
      ),
    );
    expect(seen.result?.structuredContent?.added).toEqual([]);
  });
});

describe("tools from the OpenAPI operations", () => {
  it("offers every operation with the scopes its route checks, or doesn't start", () => {
    const def = {
      ...company,
      readScope: "r",
      writeScope: "w",
    } as CompanyDefinition;
    expect(mcpToolsOf(def).map((t) => [t.name, t.scopes])).toEqual([
      ["list_things", undefined],
      ["thing", ["r"]],
      ["add_thing", ["w"]],
      ["extra", undefined],
    ]);
    expect(() =>
      mcpToolsOf({
        ...def,
        paths: { "/api/x": { get: { summary: "No operationId" } } },
      }),
    ).toThrow(/GET \/api\/x needs a unique operationId/);
    expect(() =>
      mcpToolsOf({
        ...def,
        paths: {
          "/api/x/{id}": { get: { operationId: "x", summary: "Unbound" } },
        },
      }),
    ).toThrow(/no parameter for \{id\}/);
  });
});

import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  discover: vi.fn(),
  request: vi.fn(),
  protocol: vi.fn(),
  excluded: vi.fn(async () => [{ task: "Cancel an order" }]),
}));
vi.mock("@poppy-lab/pap-client", async (original) => ({
  ...(await original<typeof import("@poppy-lab/pap-client")>()),
  discoverCompany: state.discover,
  mcpRequest: state.request,
  protocolRequest: state.protocol,
  fetchExcludedTasks: state.excluded,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture"), { code: "ENOENT" });
  }),
}));
import { verifySessionHeader } from "@poppy-lab/pap-client";
import { connect, identity, type Run } from "./runtime";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const mcp = "https://mcp.example/mcp";
function run(issuer: string | null = "https://mcp.example") {
  state.discover.mockResolvedValue({
    requestedUrl: "https://mcp.example",
    discoveryUrl: "https://mcp.example/.well-known/poppy.json",
    trace: [],
    discoveredAt: "",
    document: {
      protocol_version: "0.3",
      organization: { name: "Fixture", domain: "mcp.example" },
      apis: [{ type: "mcp", url: mcp, description: "Fixture MCP" }],
    },
    profile: {
      version: "0.3",
      identifier: issuer ?? "https://mcp.example",
      ...(issuer ? { issuer } : {}),
      signIn: { direct: false, device: false },
      scopes: [],
      scopeDescriptions: {},
      scopeHints: {},
    },
  });
  state.protocol.mockResolvedValue({
    resource: mcp,
    authorization_servers: ["https://mcp.example"],
  });
  state.request.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} } }
        : body.method === "tools/list"
          ? {
              tools: [
                {
                  name: "get_catalog",
                  inputSchema: { type: "object", properties: {} },
                  annotations: { readOnlyHint: true },
                },
              ],
            }
          : { content: [{ type: "text", text: "Fictional apples" }] };
    return {
      message:
        body.method === "notifications/initialized"
          ? null
          : { jsonrpc: "2.0", id: body.id, result },
      sessionId: null,
    };
  });
  return {
    protocol: "0.3",
    url: "https://mcp.example",
    user: "",
    visitor: "visitor-fixture",
    history: [],
    expires: Date.now() + 60000,
    calls: 0,
    busy: false,
  } as Run;
}
const allow = () =>
  vi.stubEnv(
    "PAP_MCP_READ_TOOLS",
    JSON.stringify({ "https://mcp.example": ["get_catalog"] }),
  );

it("calls signed-out MCP tools with a per-request Session header and no token", async () => {
  allow();
  const r = run();
  const tools = await connect(r, []);
  expect(await tools.get_catalog!.execute()).toMatchObject({
    content: [{ text: "Fictional apples" }],
  });
  for (const [url, init] of state.request.mock.calls) {
    expect(url).toBe(mcp);
    expect(init.headers).not.toHaveProperty("Authorization");
    const session = await verifySessionHeader(init.headers["Poppy-Session"], {
      audience: "https://mcp.example",
      method: "POST",
      url: mcp,
      keysFor: async () => [(await identity()).publicKey],
    });
    expect(session).toMatchObject({
      userId: expect.stringMatching(/^usr_[A-Za-z0-9_-]{32}$/),
      sessionId: r.sessionId,
    });
  }
});

it("works for a Company without an issuer, skipping resource metadata", async () => {
  allow();
  const r = run(null);
  await connect(r, []);
  expect(state.protocol).not.toHaveBeenCalled();
});

it("fails closed without an exact-origin local read policy", async () => {
  vi.stubEnv(
    "PAP_MCP_READ_TOOLS",
    JSON.stringify({ "https://other.example": ["get_catalog"] }),
  );
  await expect(connect(run(), [])).rejects.toThrow("allowlist");
  expect(state.request).not.toHaveBeenCalled();
});

it("rejects mismatched resource metadata before calling the server", async () => {
  allow();
  const r = run();
  state.protocol.mockResolvedValue({
    resource: "https://mcp.example/other",
    authorization_servers: ["https://mcp.example"],
  });
  await expect(connect(r, [])).rejects.toThrow("metadata");
  expect(state.request).not.toHaveBeenCalled();
});

it("does not send the account's access token to MCP", async () => {
  allow();
  const r = run();
  r.accountToken = "refresh";
  r.token = "access";
  r.scopes = "read";
  await expect(connect(r, [])).rejects.toThrow("Signed-in MCP");
  expect(state.request).not.toHaveBeenCalled();
});

it("offers excluded tasks as an untrusted, token-free read tool", async () => {
  allow();
  const r = run();
  const discovered = await state.discover();
  discovered.profile.excludedTasksUrl = "https://mcp.example/excluded.json";
  state.discover.mockResolvedValue(discovered);
  const tools = await connect(r, []);
  expect(await tools.excluded_tasks!.execute()).toEqual({
    untrusted_company_content: true,
    tasks: [{ task: "Cancel an order" }],
  });
});

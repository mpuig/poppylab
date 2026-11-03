import { expect, it, vi } from "vitest";
import { mcpTools, mcpResourcePolicy } from "./mcp";
import { sseRpc } from "./mcp-wire";
const schema = {
  type: "object",
  properties: { id: { type: "string" } },
  additionalProperties: false,
};
const read = {
  name: "get_catalog",
  description: "Read catalog",
  inputSchema: schema,
  annotations: { readOnlyHint: true },
};
function fixture(list: unknown[] = [read]) {
  const request = vi.fn(
    async (
      body: unknown,
      _headers: Record<string, string>,
    ): Promise<{ message: unknown; sessionId: string | null }> => {
      const rpc = body as { method: string; id: number };
      const result =
        rpc.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: { tools: {} } }
          : rpc.method === "tools/list"
            ? { tools: list }
            : { content: [{ type: "text", text: "Fictional catalog" }] };
      return {
        message:
          rpc.method === "notifications/initialized"
            ? null
            : { jsonrpc: "2.0", id: rpc.id, result },
        sessionId: rpc.method === "initialize" ? "test-session" : null,
      };
    },
  );
  return { request, trace: vi.fn(), readTools: ["get_catalog"] };
}
it("validates exact resource and issuer and selects only advertised DPoP or Bearer", () => {
  const metadata = {
    resource: "https://mcp.example/mcp",
    authorization_servers: ["https://mcp.example"],
  };
  expect(
    mcpResourcePolicy(metadata, metadata.resource, "https://mcp.example"),
  ).toBe("Bearer");
  expect(
    mcpResourcePolicy(
      { ...metadata, dpop_signing_alg_values_supported: ["ES256"] },
      metadata.resource,
      "https://mcp.example",
    ),
  ).toBe("DPoP");
  expect(() =>
    mcpResourcePolicy(
      metadata,
      "https://mcp.example/other",
      "https://mcp.example",
    ),
  ).toThrow("metadata");
  expect(() =>
    mcpResourcePolicy(metadata, metadata.resource, "https://other.example"),
  ).toThrow("metadata");
  expect(() =>
    mcpResourcePolicy(
      { ...metadata, dpop_signing_alg_values_supported: ["RS256"] },
      metadata.resource,
      "https://mcp.example",
    ),
  ).toThrow("algorithms");
});
it("negotiates, lists and calls a read tool with session and version headers", async () => {
  const f = fixture();
  const tools = await mcpTools(f);
  expect(Object.keys(tools)).toEqual(["get_catalog"]);
  expect(await tools.get_catalog!.execute({ id: "apple" })).toEqual({
    content: [{ type: "text", text: "Fictional catalog" }],
    isError: false,
  });
  expect(
    f.request.mock.calls.map(([body]) => (body as { method: string }).method),
  ).toEqual([
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
  ]);
  expect(f.request.mock.calls[3]![1]).toMatchObject({
    "Mcp-Session-Id": "test-session",
    "MCP-Protocol-Version": "2025-06-18",
  });
});
it("does not authorize tools from annotations alone or local names alone", async () => {
  const f = fixture([
    read,
    { ...read, name: "get_other" },
    { ...read, name: "get_private", annotations: {} },
    { ...read, name: "delete_server" },
  ]);
  f.readTools = ["get_private", "delete_server"];
  expect(await mcpTools(f)).toEqual({});
});
it("validates tool arguments before making a call", async () => {
  const f = fixture();
  const tools = await mcpTools(f);
  await expect(tools.get_catalog!.execute({ id: 2 })).rejects.toThrow("input");
  await expect(tools.get_catalog!.execute({ extra: true })).rejects.toThrow(
    "input",
  );
  expect(f.request).toHaveBeenCalledTimes(3);
});
it("skips unsupported schemas and rejects duplicate names", async () => {
  expect(
    await mcpTools(fixture([{ ...read, inputSchema: { $ref: "#/other" } }])),
  ).toEqual({});
  await expect(mcpTools(fixture([read, read]))).rejects.toThrow("duplicate");
});
it("rejects incorrect response ids without exposing remote messages", async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce({
    message: {
      jsonrpc: "2.0",
      id: 999,
      error: { message: "secret remote text" },
    },
    sessionId: null,
  });
  await expect(mcpTools(f)).rejects.toThrow("Invalid or rejected");
});
it("rejects unsupported protocol versions", async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce({
    message: {
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "future", capabilities: { tools: {} } },
    },
    sessionId: null,
  });
  await expect(mcpTools(f)).rejects.toThrow("version");
});
it("never retries an uncertain tool response", async () => {
  const f = fixture();
  const tools = await mcpTools(f);
  f.request.mockRejectedValueOnce(new Error("Lost response"));
  await expect(tools.get_catalog!.execute()).rejects.toThrow("Lost");
  expect(f.request).toHaveBeenCalledTimes(4);
});
it("rejects rich result content instead of following resource URLs", async () => {
  const f = fixture();
  const tools = await mcpTools(f);
  f.request.mockResolvedValueOnce({
    message: {
      jsonrpc: "2.0",
      id: 4,
      result: {
        content: [{ type: "resource_link", uri: "http://127.0.0.1/secret" }],
      },
    },
    sessionId: null,
  });
  await expect(tools.get_catalog!.execute()).rejects.toThrow(
    "Unsupported MCP content",
  );
});
it("parses bounded SSE frames and refuses server initiated requests", () => {
  expect(
    sseRpc('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'),
  ).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  expect(sseRpc('data: {"id":1')).toBeUndefined();
  expect(() =>
    sseRpc(
      'data: {"jsonrpc":"2.0","id":2,"method":"sampling/createMessage"}\n\n',
    ),
  ).toThrow("server requests");
});

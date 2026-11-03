import { boundedToolInput, type ApiTool } from "./openapi.ts";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const version = "2025-06-18";
export function mcpResourcePolicy(
  value: unknown,
  endpoint: string,
  issuer: string,
) {
  if (
    !object(value) ||
    value.resource !== endpoint ||
    !Array.isArray(value.authorization_servers) ||
    !value.authorization_servers.includes(issuer)
  )
    throw Error("Invalid MCP protected resource metadata");
  const algorithms = value.dpop_signing_alg_values_supported;
  if (
    algorithms !== undefined &&
    (!Array.isArray(algorithms) || !algorithms.includes("ES256"))
  )
    throw Error("Unsupported MCP DPoP algorithms");
  return algorithms === undefined ? ("Bearer" as const) : ("DPoP" as const);
}
/** Streamable HTTP subset. Local exact tool policy AND read-only annotations required. */
export async function mcpTools(options: {
  request: (
    body: unknown,
    headers: Record<string, string>,
  ) => Promise<{ message: unknown; sessionId: string | null }>;
  readTools: readonly string[];
  trace: (message: string) => void;
}): Promise<Record<string, ApiTool>> {
  let nextId = 0,
    sessionId: string | undefined,
    initialized = false;
  const headers = () => ({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(initialized ? { "MCP-Protocol-Version": version } : {}),
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
  });
  async function send(method: string, params: unknown, notification = false) {
    const id = ++nextId;
    const reply = await options.request(
      { jsonrpc: "2.0", ...(notification ? {} : { id }), method, params },
      headers(),
    );
    if (reply.sessionId) {
      if (
        !/^[\x21-\x7e]{1,256}$/.test(reply.sessionId) ||
        (sessionId && reply.sessionId !== sessionId)
      )
        throw Error("Invalid MCP session");
      sessionId = reply.sessionId;
    }
    if (notification) {
      if (reply.message !== null)
        throw Error("Invalid MCP notification response");
      return {};
    }
    const message = reply.message;
    if (
      !object(message) ||
      message.jsonrpc !== "2.0" ||
      message.id !== id ||
      "error" in message ||
      !object(message.result)
    )
      throw Error("Invalid or rejected MCP response");
    return message.result;
  }
  const init = await send("initialize", {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: "Poppy Lab", version: "0.1.0" },
  });
  if (
    init.protocolVersion !== version ||
    !object(init.capabilities) ||
    !object(init.capabilities.tools)
  )
    throw Error("Unsupported MCP version or capabilities");
  initialized = true;
  await send("notifications/initialized", {}, true);
  options.trace("MCP initialized · Streamable HTTP · read-only local policy");
  const tools: Record<string, ApiTool> = {},
    seen = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined,
    scanned = 0;
  for (let page = 0; page < 4; page++) {
    const listing = await send("tools/list", cursor ? { cursor } : {});
    if (!Array.isArray(listing.tools) || listing.tools.length > 100)
      throw Error("Invalid MCP tool listing");
    for (const item of listing.tools) {
      if (++scanned > 100) throw Error("MCP tool limit exceeded");
      if (
        !object(item) ||
        typeof item.name !== "string" ||
        !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(item.name) ||
        ["constructor", "prototype", "__proto__"].includes(item.name) ||
        seen.has(item.name)
      )
        throw Error("Invalid or duplicate MCP tool");
      const name = item.name;
      seen.add(name);
      if (
        !options.readTools.includes(name) ||
        !object(item.annotations) ||
        item.annotations.readOnlyHint !== true
      )
        continue;
      // Annotations alone never authorize a tool, even when they claim it is safe.
      if (
        /(?:confirm|cancel|approve|delete|create|exec|deploy|token|secret|password)/i.test(
          name,
        )
      )
        continue;
      let input;
      try {
        input = boundedToolInput(item.inputSchema);
      } catch {
        continue;
      }
      if (Object.keys(tools).length >= 24)
        throw Error("MCP exposed tool limit exceeded");
      tools[name] = {
        description:
          typeof item.description === "string"
            ? item.description.slice(0, 1000)
            : name,
        schema: input.schema,
        execute: async (args = {}) => {
          if (!input.validate(args)) throw Error("Invalid MCP tool input");
          const result = await send("tools/call", { name, arguments: args });
          if (!Array.isArray(result.content) || result.content.length > 40)
            throw Error("Invalid MCP tool result");
          const content = result.content.map((part) => {
            if (
              !object(part) ||
              part.type !== "text" ||
              typeof part.text !== "string" ||
              part.text.length > 16000
            )
              throw Error("Unsupported MCP content");
            return { type: "text", text: part.text };
          });
          if (JSON.stringify(content).length > 32000)
            throw Error("MCP result exceeds bounds");
          if (
            result.isError !== undefined &&
            typeof result.isError !== "boolean"
          )
            throw Error("Invalid MCP tool result");
          options.trace(`MCP read tool completed: ${name}`);
          return { content, isError: result.isError === true };
        },
      };
    }
    if (listing.nextCursor === undefined) {
      options.trace(
        `Loaded ${Object.keys(tools).length} locally approved MCP read tools`,
      );
      return tools;
    }
    if (
      typeof listing.nextCursor !== "string" ||
      listing.nextCursor.length > 512 ||
      cursors.has(listing.nextCursor)
    )
      throw Error("Invalid MCP pagination");
    cursor = listing.nextCursor;
    cursors.add(cursor);
  }
  throw Error("MCP pagination limit exceeded");
}

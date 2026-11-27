/**
 * TEST ONLY. A cross-check of a Company's MCP server against its API: every
 * OpenAPI operation has its tool, and each tool, called signed out with the
 * Session header, gets what the operation's request gets at the API. For
 * an account route that is the same sign-in challenge, so the tool needs
 * the same scopes; for any other route, the same answer from the same
 * handler.
 */
import { isDeepStrictEqual } from "node:util";
import { mcpToolsOf } from "./mcp.ts";
import { setup } from "./test-company.ts";
import type { CompanyDefinition } from "./types.ts";

type Json = Record<string, unknown>;

/** An argument the schema accepts, or at least one of its type. */
function sample(schema: Json, path: boolean): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  switch (schema.type) {
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return path ? "x1" : "x";
  }
}

/** The challenge's scopes, whatever else it names. */
const scopeOf = (r: Response) =>
  /scope="([^"]*)"/.exec(r.headers.get("www-authenticate") ?? "")?.[1];

/**
 * What differs between `def`'s MCP server and its API, one line each, or
 * none. `def` must list the MCP server in `poppy.json` (`MCP_PATH`).
 */
export async function mcpMismatches(def: CompanyDefinition) {
  const x = await setup({}, def);
  const problems: string[] = [];
  const tools = mcpToolsOf(def);
  for (const [path, item] of Object.entries(def.paths))
    for (const [verb, op] of Object.entries(item as Json))
      if (
        ["get", "post", "put", "patch", "delete"].includes(verb) &&
        !tools.some(
          (tool) =>
            tool.name === (op as Json).operationId &&
            tool.path === path &&
            tool.method === verb.toUpperCase(),
        )
      )
        problems.push(`${verb.toUpperCase()} ${path} has no tool`);
  let id = 0;
  for (const tool of tools) {
    const properties = tool.inputSchema.properties as Record<string, Json>;
    const required = (tool.inputSchema.required as string[] | undefined) ?? [];
    const args = Object.fromEntries(
      required.map((name) => [
        name,
        sample(
          properties[name]!,
          tool.params.some((p) => p.in === "path" && p.name === name),
        ),
      ]),
    );
    let route = tool.path;
    const query = new URLSearchParams();
    for (const p of tool.params)
      if (Object.hasOwn(args, p.name)) {
        if (p.in === "path")
          route = route.replaceAll(
            `{${p.name}}`,
            encodeURIComponent(String(args[p.name])),
          );
        else query.set(p.name, String(args[p.name]));
      }
    const body = Object.fromEntries(
      tool.body.filter((k) => Object.hasOwn(args, k)).map((k) => [k, args[k]]),
    );
    const extensions = '"operations";v="3"';
    const api = await x.call(`${route}${query.size ? `?${query}` : ""}`, {
      method: tool.method as "GET" | "POST",
      extensions,
      ...(tool.method !== "GET" ? { body } : {}),
    });
    const mcp = await x.call("/mcp", {
      method: "POST",
      extensions,
      body: {
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name: tool.name, arguments: args },
      },
    });
    const where = `${tool.name} (${tool.method} ${tool.path})`;
    if (api.status === 401) {
      if (mcp.status !== 401 || scopeOf(mcp) !== scopeOf(api))
        problems.push(
          `${where}: the API asks for "${scopeOf(api)}", the tool answers ${mcp.status} "${scopeOf(mcp)}"`,
        );
      if (scopeOf(api) !== (tool.scopes ?? []).join(" ") && tool.scopes?.length)
        problems.push(`${where}: the tool lists ${tool.scopes.join(" ")}`);
      continue;
    }
    if (tool.scopes)
      problems.push(`${where}: an account route answered ${api.status}`);
    const text = await api.text();
    let expected: unknown;
    try {
      expected = JSON.parse(text);
    } catch {
      expected = text;
    }
    const answer = (await mcp.json()) as {
      result?: { isError?: boolean; structuredContent?: unknown };
    };
    const result = answer.result;
    if (!result) {
      problems.push(`${where}: no tool result (${JSON.stringify(answer)})`);
      continue;
    }
    if (api.ok === (result.isError === true))
      problems.push(
        `${where}: the API answered ${api.status}, the tool ${result.isError ? "an error" : "a result"}`,
      );
    if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      !isDeepStrictEqual(result.structuredContent, expected)
    )
      problems.push(`${where}: the tool's content isn't the API's`);
  }
  return problems;
}

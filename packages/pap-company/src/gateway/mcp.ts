/**
 * The Company's MCP server (section 7), when its `poppy.json` lists one at
 * `MCP_PATH`: Streamable HTTP, MCP 2025-06-18, one JSON-RPC message per
 * POST, answered as JSON (or one SSE event for a client that takes only
 * SSE). It has no `Mcp-Session-Id`: the Poppy Session is the Session.
 *
 * Its tools are the Company's OpenAPI operations (`paths`), one each, with
 * the operation's name, summary and parameters. A call is the operation's
 * request, made by the gateway and answered by the same business route of
 * the same tenant, after the same checks as at the API: the Session header
 * and token (`sessions.verify`, with a token issued for this server only,
 * §4.5, DPoP-bound or a Bearer token that the Session header's `ath` binds
 * instead), the route's extension, its scopes, Operations v3 and the replay of
 * a performed operation (`sessions.route`). So a proposal returns the same
 * operation, and nothing is done until the User approves it, with the
 * approval in `_meta` (Operations §6).
 *
 * `initialize`, `ping` and `tools/list` need no Session header, so MCP
 * clients that don't implement Poppy can read what the server offers, as
 * they read `/openapi.json`. A tool call always does (§5.3).
 */
import type { Context, Hono } from "hono";
import {
  approvalFrom,
  approvalHeader,
  tokenHash,
} from "@poppy-lab/pap-client/core";
import { escapeHtml } from "../html.ts";
import type { Ctx } from "./context.ts";
import { challengeFor, routeScopes, type Sessions } from "./sessions.ts";
import type { Tenancy } from "./tenancy.ts";
import { declares, MCP_PATH, type CompanyDefinition } from "./types.ts";

/** The MCP version this server speaks (section 7 needs 2025-06-18 or later). */
export const MCP_VERSION = "2025-06-18";
/** Operations §6: where an MCP tool call carries the approval. */
export const APPROVAL_META = "personalagentprotocol.org/approval";
/** Tools per `tools/list` page; every Company here has fewer. */
const PAGE = 50;
/** Headers a Personal Agent sets itself (§3.4, §5.2), never a tool argument. */
const PROTOCOL_HEADERS = new Set([
  "poppy-version",
  "poppy-extensions",
  "poppy-session",
  "poppy-approval",
  "authorization",
  "dpop",
]);

type Json = Record<string, unknown>;
const object = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** One OpenAPI operation as an MCP tool. */
export type McpTool = {
  name: string;
  description: string;
  inputSchema: Json;
  annotations: { readOnlyHint: boolean };
  method: string;
  /** The operation's path, with `{name}` for each path parameter. */
  path: string;
  params: Array<{ name: string; in: "path" | "query" }>;
  /** The arguments that go in the JSON body. */
  body: string[];
  /** The scopes the account route checks, or `undefined` for another route. */
  scopes?: string[];
  /** Returns an operation for the User to approve (Operations v3). */
  proposal: boolean;
};

/**
 * The tools of a Company's MCP server: every operation in `paths`, or an
 * error naming the one that can't be a tool, so the server never offers
 * less than the API.
 */
export function mcpToolsOf(def: CompanyDefinition): McpTool[] {
  const tools: McpTool[] = [];
  const names = new Set<string>();
  for (const [path, item] of Object.entries(def.paths)) {
    if (!object(item)) continue;
    for (const [verb, op] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(verb)) continue;
      const where = `${verb.toUpperCase()} ${path}`;
      if (!object(op)) throw new Error(`MCP: ${where} isn't an operation`);
      const name = op.operationId;
      if (
        typeof name !== "string" ||
        !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) ||
        names.has(name)
      )
        throw new Error(`MCP: ${where} needs a unique operationId`);
      names.add(name);
      const properties: Json = {},
        required: string[] = [],
        params: McpTool["params"] = [],
        body: string[] = [];
      const take = (key: string, schema: unknown) => {
        if (Object.hasOwn(properties, key) || !object(schema))
          throw new Error(`MCP: ${where} has an unusable argument ${key}`);
        properties[key] = schema;
      };
      for (const p of Array.isArray(op.parameters) ? op.parameters : []) {
        if (!object(p) || typeof p.name !== "string")
          throw new Error(`MCP: ${where} has an unusable parameter`);
        if (p.in === "header" && PROTOCOL_HEADERS.has(p.name.toLowerCase()))
          continue;
        if (p.in !== "path" && p.in !== "query")
          throw new Error(`MCP: ${where} has a ${String(p.in)} parameter`);
        take(p.name, {
          ...(object(p.schema) ? p.schema : {}),
          ...(typeof p.description === "string"
            ? { description: p.description }
            : {}),
        });
        params.push({ name: p.name, in: p.in });
        if (p.in === "path" || p.required === true) required.push(p.name);
      }
      for (const [, slot] of path.matchAll(/\{([^{}]+)\}/g))
        if (!params.some((p) => p.in === "path" && p.name === slot))
          throw new Error(`MCP: ${where} has no parameter for {${slot}}`);
      if (op.requestBody !== undefined) {
        const content = object(op.requestBody)
          ? op.requestBody.content
          : undefined;
        const schema = object(content)
          ? (content["application/json"] as Json | undefined)?.schema
          : undefined;
        if (!object(schema) || !object(schema.properties))
          throw new Error(`MCP: ${where} needs a JSON object body`);
        for (const [key, value] of Object.entries(schema.properties)) {
          take(key, value);
          body.push(key);
        }
        if (Array.isArray(schema.required))
          required.push(
            ...schema.required.filter(
              (n): n is string => typeof n === "string",
            ),
          );
      }
      const proposal = op["x-poppy-proposal"] === true;
      const summary = [op.summary, op.description]
        .filter((text): text is string => typeof text === "string")
        .map((text) => text.trim())
        .join(" ");
      const scopes = routeScopes(def, path, verb.toUpperCase());
      tools.push({
        name,
        description: proposal
          ? `${summary} Returns an operation for the User to approve; nothing changes until they approve it.`.trim()
          : summary || name,
        inputSchema: {
          type: "object",
          properties,
          ...(required.length ? { required } : {}),
          additionalProperties: false,
        },
        annotations: { readOnlyHint: verb === "get" },
        method: verb.toUpperCase(),
        path,
        params,
        body,
        ...(scopes ? { scopes } : {}),
        proposal,
      });
    }
  }
  return tools;
}

/**
 * The MCP server's tools as table rows for a Company's page for agents:
 * each name, the description the server lists, and the scopes its account
 * route checks. Written from the same definition the server serves.
 */
export const mcpToolRowsHtml = (def: CompanyDefinition) =>
  mcpToolsOf(def)
    .map(
      (tool) =>
        `<tr><th scope="row"><code>${escapeHtml(tool.name)}</code></th><td>${escapeHtml(tool.description)}</td><td>${tool.scopes?.length ? tool.scopes.map((scope) => `<code>${escapeHtml(scope)}</code>`).join(" ") : "Signed out"}</td></tr>`,
    )
    .join("");

/** What a call's arguments ask of the route, or why they can't. */
function target(tool: McpTool, args: Json) {
  const properties = tool.inputSchema.properties as Json;
  const required = (tool.inputSchema.required as string[] | undefined) ?? [];
  if (Object.keys(args).some((key) => !Object.hasOwn(properties, key)))
    return "Unknown argument";
  if (required.some((key) => !Object.hasOwn(args, key)))
    return "Missing argument";
  let path = tool.path;
  const query = new URLSearchParams();
  for (const p of tool.params) {
    if (!Object.hasOwn(args, p.name)) continue;
    const value = args[p.name];
    if (!["string", "number", "boolean"].includes(typeof value))
      return `${p.name} must be a string, number or boolean`;
    const text = String(value);
    if (p.in === "query") query.set(p.name, text);
    else if (!text || /[/\\]/.test(text) || text === "." || text === "..")
      return `${p.name} isn't a usable path segment`;
    else path = path.replaceAll(`{${p.name}}`, encodeURIComponent(text));
  }
  const body = Object.fromEntries(
    tool.body
      .filter((key) => Object.hasOwn(args, key))
      .map((k) => [k, args[k]]),
  );
  return { path, query: query.size ? `?${query}` : "", body };
}

/** `_meta`'s approval as the `Poppy-Approval` header the gate reads. */
function approvalOf(meta: unknown) {
  const approval = approvalFrom(object(meta) ? meta[APPROVAL_META] : undefined);
  if (!approval) return undefined;
  try {
    return approvalHeader(approval);
  } catch {
    // An `input_type` the header can't carry is ignored, not the approval.
    const rest = { ...approval };
    delete rest.input_type;
    try {
      return approvalHeader(rest);
    } catch {
      return undefined;
    }
  }
}

export function mountMcp(
  app: Hono,
  ctx: Ctx,
  sessions: Sessions,
  tenancy: Tenancy,
) {
  const { def, origin, state, mcp: url } = ctx;
  if (!url) return;
  const metadataPath = `/.well-known/oauth-protected-resource${MCP_PATH}`;
  const metadata = `${origin}${metadataPath}`;
  const tools = mcpToolsOf(def);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const listed = tools.map(
    ({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      annotations,
    }),
  );
  /** What this server takes: its own tokens, DPoP-bound or Bearer (§4.5). */
  const service = { resource: url, metadata, bearer: true };
  /** A challenge for each scheme, naming this server's metadata (§7). */
  const challenge = (params?: string) => challengeFor(service, params);
  const used = new Set(tools.flatMap((tool) => tool.scopes ?? []));

  // RFC 9728: `resource` is the server's URL, and the issuer the
  // Company's (§7). It takes DPoP-bound tokens, and Bearer ones (§4.5).
  app.get(metadataPath, (c) =>
    c.json(
      {
        resource: url,
        resource_name: `${def.name} MCP server`,
        authorization_servers: [origin],
        scopes_supported: ctx.both.filter((scope) => used.has(scope)),
        bearer_methods_supported: ["header"],
        dpop_signing_alg_values_supported: ["ES256"],
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    ),
  );
  // No stream of the server's own messages, and no MCP session to end.
  app.on(["GET", "DELETE"], MCP_PATH, (c) =>
    c.body(null, 405, { Allow: "POST" }),
  );

  /**
   * Whether a token without a Session header is one of this server's
   * DPoP-bound ones. A Bearer token never is: without the header, nothing
   * binds it.
   */
  const known = (authorization: string) => {
    if (!authorization.startsWith("DPoP ")) return false;
    const record = state.tokens[tokenHash(authorization.slice(5))];
    const grant = record && state.grants[record.grant];
    const now = Date.now();
    return (
      !!record &&
      record.resource === url &&
      record.expires >= now &&
      !!grant &&
      grant.expires >= now
    );
  };

  app.post(MCP_PATH, async (c) => {
    // JSON, unless the client takes only SSE (Streamable HTTP).
    const accept = c.req.header("accept") ?? "";
    const sse =
      accept.includes("text/event-stream") &&
      !/application\/json|application\/\*|\*\/\*/.test(accept);
    const send = (
      message: Json,
      status: 200 | 400 = 200,
    ): Response | Promise<Response> =>
      sse
        ? c.body(
            `event: message\ndata: ${JSON.stringify(message)}\n\n`,
            status,
            {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-store",
            },
          )
        : c.json(message, status, { "Cache-Control": "no-store" });
    const failure = (
      id: unknown,
      status: 200 | 400,
      code: number,
      message: string,
      data?: Json,
    ) =>
      send(
        {
          jsonrpc: "2.0",
          id: id ?? null,
          error: { code, message, ...(data ? { data } : {}) },
        },
        status,
      );
    let message: unknown;
    try {
      message = await c.req.json();
    } catch {
      return failure(null, 400, -32700, "Parse error");
    }
    const id =
      object(message) &&
      (typeof message.id === "string" || Number.isSafeInteger(message.id))
        ? message.id
        : undefined;
    // Streamable HTTP: a version this server doesn't speak is a 400.
    const version = c.req.header("mcp-protocol-version");
    if (version !== undefined && version !== MCP_VERSION)
      return failure(id, 400, -32600, "Unsupported MCP-Protocol-Version", {
        supported: [MCP_VERSION],
      });
    // MCP 2025-06-18 has no batches.
    if (Array.isArray(message))
      return failure(null, 400, -32600, "Batches are not supported");
    if (
      !object(message) ||
      message.jsonrpc !== "2.0" ||
      (Object.hasOwn(message, "id") && id === undefined)
    )
      return failure(id, 400, -32600, "Invalid Request");
    const method = typeof message.method === "string" ? message.method : "";

    // §5.3: verified as at the API, with a token for this server only.
    const authorization = c.req.header("authorization");
    if (c.req.header("poppy-session")) {
      const refused = await sessions.verify(c, service);
      if (refused) return refused;
    } else if (authorization && !known(authorization))
      return c.json({ error: "invalid_token" }, 401, {
        "WWW-Authenticate": challenge('error="invalid_token"'),
      });
    else if (authorization || method === "tools/call")
      return c.json({ error: "invalid_session" }, 400);

    // A notification, or a response to the server: nothing to answer.
    if (id === undefined || typeof message.method !== "string")
      return c.body(null, 202);
    const params = object(message.params) ? message.params : {};
    const result = (value: Json) => send({ jsonrpc: "2.0", id, result: value });
    switch (method) {
      case "initialize":
        return result({
          protocolVersion: MCP_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: def.name, version: "1.0.0" },
        });
      case "ping":
        return result({});
      case "tools/list": {
        const cursor = params.cursor;
        const start = cursor === undefined ? 0 : Number(cursor);
        if (
          cursor !== undefined &&
          (typeof cursor !== "string" ||
            !/^[1-9]\d{0,3}$/.test(cursor) ||
            start % PAGE ||
            start >= listed.length)
        )
          return failure(id, 200, -32602, "Invalid cursor");
        return result({
          tools: listed.slice(start, start + PAGE),
          ...(start + PAGE < listed.length
            ? { nextCursor: String(start + PAGE) }
            : {}),
        });
      }
      case "tools/call":
        return call(c, id, params, result, failure);
      default:
        return failure(id, 200, -32601, "Method not found");
    }
  });

  /** A tool call: the operation's request, through the API's checks. */
  async function call(
    c: Context,
    id: unknown,
    params: Json,
    result: (value: Json) => Response | Promise<Response>,
    failure: (
      id: unknown,
      status: 200,
      code: number,
      message: string,
    ) => Response | Promise<Response>,
  ) {
    const tool =
      typeof params.name === "string" ? byName.get(params.name) : undefined;
    if (!tool) return failure(id, 200, -32602, "Unknown tool");
    const args = params.arguments ?? {};
    if (!object(args))
      return failure(id, 200, -32602, "Arguments must be an object");
    const asked = target(tool, args);
    if (typeof asked === "string") return failure(id, 200, -32602, asked);
    const outer = c.req.raw;
    const session = ctx.sessions.get(outer)!;
    /** A tool error: nothing was done, and why (spec 7, Operations §4). */
    const refusal = (text: string, structured?: unknown) =>
      result({
        isError: true,
        content: [{ type: "text", text }],
        ...(object(structured) ? { structuredContent: structured } : {}),
      });
    // §3.3: a route's extension refuses this tool, not the whole server.
    const extension = def.requiredExtension?.({
      path: asked.path,
      method: tool.method,
    });
    if (extension && !declares(session.extensions, extension))
      return refusal(
        `${tool.method === "GET" ? "" : "Not done. "}${tool.name} needs the ${extension.name} extension, version ${extension.version}, declared in Poppy-Extensions.`,
        { error: "extension_required", extension: extension.name },
      );
    const approval = approvalOf(params._meta);
    const answer = sessions.route(outer, asked.path, tool.method, approval);
    // Account access is OAuth's, at the HTTP level, as MCP has it (§7).
    if (answer?.kind === "sign_in")
      return c.body(null, 401, {
        "WWW-Authenticate": challenge(
          answer.scopes.length
            ? `scope="${answer.scopes.join(" ")}"`
            : undefined,
        ),
      });
    if (answer?.kind === "insufficient_scope")
      return c.json({ error: "insufficient_scope" }, 403, {
        "WWW-Authenticate": challenge(
          `error="insufficient_scope", scope="${answer.scopes.join(" ")}"`,
        ),
      });
    if (answer?.kind === "extension_required")
      return refusal(
        `Not done. ${tool.name} proposes a change, which needs Operations version 3 declared in Poppy-Extensions.`,
        { error: "extension_required", extension: answer.extension },
      );
    if (answer?.kind === "replay")
      return result({
        content: [{ type: "text", text: JSON.stringify(answer.body) }],
        ...(object(answer.body) ? { structuredContent: answer.body } : {}),
      });

    // The operation's own request, to the same tenant's routes.
    const inner = new Request(`${origin}${asked.path}${asked.query}`, {
      method: tool.method,
      headers: {
        accept: "application/json",
        "poppy-version": c.req.header("poppy-version") ?? "1.0",
        ...(c.req.header("poppy-extensions")
          ? { "poppy-extensions": c.req.header("poppy-extensions")! }
          : {}),
        ...(approval ? { "poppy-approval": approval } : {}),
        ...(tool.method !== "GET"
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(tool.method !== "GET" ? { body: JSON.stringify(asked.body) } : {}),
    });
    ctx.sessions.set(inner, session);
    const sid = ctx.sessionKeys.get(outer);
    if (sid) ctx.sessionKeys.set(inner, sid);
    const tenant = ctx.tenantKeys.get(outer);
    if (tenant) ctx.tenantKeys.set(inner, tenant);
    const response = await tenancy.forward(inner);
    // What the route changed is saved with this request.
    const touched = ctx.tenantsTouched.get(inner);
    if (touched) ctx.tenantsTouched.set(outer, touched);
    if (ctx.dirty.has(inner)) ctx.markDirty(outer);

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    // Not finished, or too many: as the API answers, with Retry-After.
    if (response.status === 503 || response.status === 429)
      return new Response(text || null, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "",
          "retry-after": response.headers.get("retry-after") ?? "60",
        },
      });
    // A route's own token challenge, with this server's metadata.
    const www = response.headers.get("www-authenticate");
    if ((response.status === 401 || response.status === 403) && www)
      return new Response(text || null, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "",
          "www-authenticate": www.startsWith("DPoP")
            ? challenge(www.slice(4).trim() || undefined)
            : www,
        },
      });
    if (response.ok)
      return result({
        content: [{ type: "text", text }],
        ...(object(body) ? { structuredContent: body } : {}),
      });
    // Operations §4: the operation, for the User to approve.
    if (
      response.status === 403 &&
      object(body) &&
      body.error === "approval_required" &&
      object(body.operation)
    )
      return refusal(
        `Not done yet. This needs approval: ${String(body.operation.summary ?? "")}`.trim(),
        { operation: body.operation },
      );
    // Operations §6: declined, with the members the API sends.
    if (
      response.status === 403 &&
      object(body) &&
      body.error === "approval_declined"
    )
      return refusal(
        typeof body.reason === "string"
          ? `Not done. The approval was declined: ${body.reason}`
          : "Not done. The approval was declined.",
        body,
      );
    // Any other answer of the route, as the API gives it.
    return refusal(
      `${tool.method === "GET" ? "" : "Not done. "}The Company answered ${response.status}: ${text}`,
      body,
    );
  }
}

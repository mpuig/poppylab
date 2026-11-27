/**
 * Juniper's MCP server (section 7): the same operations as its API, with
 * the same checks, and Poppy Lab's own MCP reader (`pap-client`) using it
 * over a real socket, as Iris does with a read-only allowlist.
 */
import { once } from "node:events";
import { afterAll, beforeAll, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import {
  mcpRequest,
  mcpResourcePolicy,
  mcpTools,
  protocolRequest,
} from "@poppy-lab/pap-client";
import {
  createIdentity,
  createSessionKey,
  newSessionId,
  signSessionHeader,
} from "@poppy-lab/pap-client/core";
import { createCompany, mcpToolsOf } from "@poppy-lab/pap-company";
import {
  mcpMismatches,
  origin as testOrigin,
  setup,
} from "@poppy-lab/pap-company/testing";
import { juniperCompany } from "./juniper.js";
import { memory } from "./test-app.js";
import { accountPaths } from "./openapi.js";

it("offers every operation as a tool, needing what the API needs", async () => {
  expect(await mcpMismatches(juniperCompany({ portal: false }))).toEqual([]);
  const tools = mcpToolsOf(juniperCompany({ portal: false }));
  // Proposals change nothing until the customer approves.
  for (const item of Object.values(accountPaths))
    for (const op of Object.values(item))
      expect(
        tools.find((tool) => tool.name === op.operationId)?.annotations,
      ).toEqual({ readOnlyHint: !("x-poppy-proposal" in op) });
});

it("lists the MCP server and each of its tools on the page for agents", async () => {
  const def = juniperCompany({ portal: false });
  const html = await (
    await (await setup({}, def)).app.request("/for-agents")
  ).text();
  expect(html).toContain(`${testOrigin}/mcp · Streamable HTTP, MCP 2025-06-18`);
  for (const tool of mcpToolsOf(def))
    expect(html).toContain(`<code>${tool.name}</code>`);
});

// A port of the lab's own range for local servers.
const port = 5537;
const origin = `http://juniper.localhost:${port}`;
const client = "https://agent.test/client.json";
let server: ServerType;
let keys: Awaited<ReturnType<typeof createIdentity>>;

beforeAll(async () => {
  keys = await createIdentity();
  const app = createCompany(juniperCompany({ portal: false }), {
    origin,
    store: memory(),
    isolation: "visitor",
    fetchJson: async (url) =>
      url === client
        ? {
            client_id: client,
            client_name: "Agent",
            jwks_uri: "https://agent.test/jwks.json",
            redirect_uris: ["https://agent.test/callback"],
          }
        : { keys: [keys.publicKey] },
  });
  server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  await once(server, "listening");
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it("lists and calls the read tools Poppy Lab's MCP reader allows", async () => {
  // What discovery reads: the entry, and the issuer's protected_resources
  // with the server in it. (Discovery itself takes plain HTTP only at the
  // five local Companies' own ports.)
  const url = `${origin}/mcp`;
  const document = (await protocolRequest(
    `${origin}/.well-known/poppy.json`,
    {},
    [origin],
  )) as { apis: unknown[] };
  expect(document.apis).toContainEqual(
    expect.objectContaining({ type: "mcp", url }),
  );
  const issuer = (await protocolRequest(
    `${origin}/.well-known/oauth-authorization-server`,
    {},
    [origin],
  )) as { protected_resources: string[] };
  expect(issuer.protected_resources).toEqual([origin, url]);
  const metadata = await protocolRequest(
    `${origin}/.well-known/oauth-protected-resource/mcp`,
    {},
    [origin],
  );
  // The server's tokens are DPoP-bound.
  expect(mcpResourcePolicy(metadata, url, origin)).toBe("DPoP");

  const sessionKey = await createSessionKey(keys.privateKey, client);
  const sessionId = newSessionId();
  const trace: string[] = [];
  const tools = await mcpTools({
    readTools: [
      "list_products",
      "delivery_info",
      "store_policies",
      "search_help",
      "my_basket",
      "propose_checkout",
    ],
    trace: (message) => trace.push(message),
    request: async (body, headers) =>
      mcpRequest(
        url,
        {
          method: "POST",
          headers: {
            ...headers,
            "Poppy-Version": "1.0",
            "Poppy-Session": await signSessionHeader({
              key: sessionKey,
              clientId: client,
              audience: origin,
              sessionId,
              userId: "usr_reader",
              method: "POST",
              url,
            }),
          },
          body: JSON.stringify(body),
        },
        [origin],
      ),
  });
  // Allowed and read only; a proposal is never a read tool, whatever the list.
  expect(Object.keys(tools).sort()).toEqual([
    "delivery_info",
    "list_products",
    "my_basket",
    "search_help",
    "store_policies",
  ]);
  const products = await tools.list_products!.execute({});
  const listed = JSON.parse(
    (products as { content: Array<{ text: string }> }).content[0]!.text,
  ) as { products: Array<{ id: string }> };
  expect(listed.products.map((p) => p.id)).toContain("oranges");
  const delivery = (await tools.delivery_info!.execute({})) as {
    isError: boolean;
  };
  expect(delivery.isError).toBe(false);
  // Signed out, an account read is a sign-in challenge, as at the API.
  await expect(tools.my_basket!.execute({})).rejects.toMatchObject({
    status: 401,
  });
  expect(trace).toContain("MCP read tool completed: list_products");
});

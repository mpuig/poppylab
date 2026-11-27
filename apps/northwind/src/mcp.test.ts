/** Northwind's MCP server (section 7): its operations, with the API's checks. */
import { expect, it } from "vitest";
import { mcpToolsOf } from "@poppy-lab/pap-company";
import { mcpMismatches, origin, setup } from "@poppy-lab/pap-company/testing";
import { northwind } from "./northwind.js";

it("offers every operation as a tool, needing what the API needs", async () => {
  expect(await mcpMismatches(northwind)).toEqual([]);
});

it("lists the MCP server and each of its tools on the page for agents", async () => {
  const html = await (
    await (await setup({}, northwind)).app.request("/for-agents")
  ).text();
  expect(html).toContain(`${origin}/mcp · Streamable HTTP, MCP 2025-06-18`);
  for (const tool of mcpToolsOf(northwind))
    expect(html).toContain(`<code>${tool.name}</code>`);
});

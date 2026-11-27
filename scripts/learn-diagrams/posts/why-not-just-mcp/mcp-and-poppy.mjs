import { compare } from "../../draw.mjs";

/**
 * MCP alone and MCP inside Poppy (the fourth post): the same tool server,
 * and the four things around it that plain MCP leaves to each company. The
 * MCP column stays neutral; Poppy's side is green.
 */
const spec = {
  heads: ["MCP alone", "MCP with Poppy"],
  rows: [
    {
      head: "The tools",
      without: "an MCP server at a URL",
      with: "the same MCP server, listed in poppy.json; all five Poppy Lab companies serve one at /mcp",
    },
    {
      head: "Finding it",
      without: "someone pastes the server's URL into a config",
      with: "found from the company's domain, beside its OpenAPI, conversation and website entries",
    },
    {
      head: "Before sign-in",
      without: "no standard signed-out identity",
      with: "a Session header names the agent and a User ID for this company only",
    },
    {
      head: "Across channels",
      without: "a tool call stands alone",
      with: "one Session ID across the API, MCP, conversations and a joined browser",
    },
    {
      head: "Approving a change",
      without: "a local “Allow tool?” prompt the server never sees",
      with: "the company writes the terms and a revision, and runs the change at most once",
    },
  ],
};

export default {
  name: "mcp-and-poppy",
  alt: "A comparison of MCP alone with MCP inside Poppy. The tools are the same MCP server either way; with Poppy it is listed in poppy.json, and all five Poppy Lab companies serve one at /mcp. Alone, someone pastes the server's URL into a config; with Poppy the agent finds it from the company's domain, beside its OpenAPI, conversation and website entries. Alone, there is no standard signed-out identity; with Poppy a Session header names the agent and a User ID for this company only. Alone, a tool call stands alone; with Poppy one Session ID runs across the API, MCP, conversations and a joined browser. Alone, approving a change is a local Allow tool prompt the server never sees; with Poppy the company writes the terms and a revision, and runs the change at most once.",
  caption:
    "The same MCP server either way; Poppy adds how it is found, who is calling before sign-in, one Session across channels, and approvals the company writes.",
  draw: (variant) => compare(spec, variant),
};

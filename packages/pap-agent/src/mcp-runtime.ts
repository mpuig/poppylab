import {
  mcpRequest,
  mcpResourcePolicy,
  mcpTools,
  protocolRequest,
} from "@poppy-lab/pap-client";
import { companyProfile } from "@poppy-lab/pap-core";
import { localOrigins } from "./deployment";
import type { Connection } from "./run-types";
import { sessionHeaders } from "./session";
import { UserFacingError } from "./user-error";

/** MCP over Streamable HTTP with a local read-only allowlist (signed out). */
export async function mcpConnect(
  connection: Connection,
  url: string,
  trace: string[],
) {
  const profile = companyProfile(connection.company!);
  let policies: unknown;
  try {
    policies = JSON.parse(process.env.PAP_MCP_READ_TOOLS ?? "{}");
  } catch {
    throw Error("Invalid PAP_MCP_READ_TOOLS policy");
  }
  const approved =
    policies && typeof policies === "object" && !Array.isArray(policies)
      ? (policies as Record<string, unknown>)[new URL(url).origin]
      : undefined;
  if (
    !Array.isArray(approved) ||
    !approved.length ||
    approved.length > 24 ||
    approved.some(
      (name) =>
        typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name),
    )
  )
    throw new UserFacingError(
      "MCP endpoint found. Configure an exact-origin PAP_MCP_READ_TOOLS read-only allowlist before calling tools.",
    );
  if (connection.accountToken)
    throw new UserFacingError(
      "Signed-in MCP needs a token for its resource, which Poppy Lab doesn't request yet. Sign out to use read-only MCP tools.",
    );
  if (profile.issuer) {
    // Validate the server's own resource metadata before calling it.
    const metadataUrl = new URL(url);
    metadataUrl.pathname = `/.well-known/oauth-protected-resource${metadataUrl.pathname === "/" ? "" : metadataUrl.pathname}`;
    metadataUrl.search = "";
    metadataUrl.hash = "";
    mcpResourcePolicy(
      await protocolRequest(metadataUrl.href, {}, localOrigins),
      url,
      profile.issuer,
    );
  }
  const tools = await mcpTools({
    readTools: approved as string[],
    trace: (message) => trace.push(message),
    request: async (body, headers) =>
      mcpRequest(
        url,
        {
          method: "POST",
          headers: {
            ...headers,
            ...(await sessionHeaders(connection, url, "POST")),
          },
          body: JSON.stringify(body),
        },
        localOrigins,
      ),
  });
  if (!Object.keys(tools).length)
    throw new UserFacingError(
      "MCP has no tools matching the local read-only policy and supported schemas.",
    );
  return tools;
}

/** Harborline's MCP server (section 7): its operations, with the API's checks. */
import { expect, it } from "vitest";
import { mcpMismatches } from "@poppy-lab/pap-company/testing";
import { harborline } from "./harborline.js";

it("offers every operation of /openapi.json as a tool, needing what the API needs", async () => {
  expect(await mcpMismatches(harborline)).toEqual([]);
});

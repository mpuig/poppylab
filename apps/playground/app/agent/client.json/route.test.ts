import { it, expect, vi } from "vitest";
vi.mock("@poppy-lab/pap-agent/runtime", () => ({
  agentOrigin: "https://identity.example",
}));
import { GET } from "./route";
it("keeps Juniper localhost registration unchanged when a public identity is configured", async () => {
  const data = await GET(
    new Request("http://localhost:3000/agent/client.json"),
  ).json();
  expect(data.client_id).toBe("http://localhost:3000/agent/client.json");
  expect(data.redirect_uris).toEqual([
    "http://localhost:3000/api/account/callback",
  ]);
  // §3.4: extensions are declared per request, never in client metadata.
  expect(data).not.toHaveProperty("extensions");
  expect(data.client_name).toBe("Iris");
});
it("serves a separate public identity to the relay", async () => {
  const data = await GET(
    new Request("http://localhost:3000/agent/client.json", {
      headers: { "x-pap-public-identity": "1" },
    }),
  ).json();
  expect(data.client_id).toBe("https://identity.example/agent/client.json");
  expect(data.redirect_uris).toEqual([
    "https://identity.example/api/account/callback",
  ]);
});

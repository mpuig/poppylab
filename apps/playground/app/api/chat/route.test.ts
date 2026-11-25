import { beforeEach, expect, it, vi } from "vitest";
// The chat route with the real runtime and the real OpenAPI adapter: only
// the network (discovery and the Company's answers) is replaced.
const transport = vi.hoisted(() =>
  vi.fn<(url: string, ...args: unknown[]) => Promise<unknown>>(),
);
const discover = vi.hoisted(() => vi.fn());
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: discover,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: "v".repeat(43) }),
    set: vi.fn(),
  }),
}));
vi.mock("@/lib/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deployment")>()),
  serving: () => true,
  publicMode: () => false,
  isAccountCompany: () => true,
  proposalsAllowed: () => true,
}));
import { agentStep } from "@/lib/agent-steps";
import { logEntry } from "@/lib/protocol-log";
import { seedRun } from "@/lib/runs";
import type { Run } from "@/lib/runtime";
import { POST } from "./route";

const origin = "https://shop.papsandbox.com";
const api = {
  servers: [{ url: origin }],
  paths: {
    "/api/products": { get: { operationId: "list_products" } },
    "/api/account/orders": {
      get: { operationId: "my_orders", "x-poppy-scopes": ["poppy:read"] },
    },
    "/api/account/delivery-change": {
      post: {
        operationId: "propose_delivery_change",
        "x-poppy-proposal": true,
        "x-poppy-scopes": ["poppy:write"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { day: { type: "string" } },
                required: ["day"],
              },
            },
          },
        },
        responses: { "403": {} },
      },
    },
  },
};
function shop(scopes?: string): Run {
  return {
    protocol: "1.0",
    url: origin,
    user: "",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    ...(scopes
      ? {
          token: "access-1",
          tokenType: "DPoP" as const,
          accountToken: "refresh-1",
          scopes,
          tokenExpires: Date.now() + 3600000,
        }
      : {}),
    company: {
      requestedUrl: origin,
      discoveryUrl: origin + "/.well-known/poppy.json",
      discoveredAt: new Date().toISOString(),
      trace: [],
      document: {
        protocol_version: "1.0",
        organization: { name: "Juniper Market", domain: "shop.papsandbox.com" },
        apis: [
          {
            type: "openapi",
            url: origin + "/poppy/openapi.json",
            description: "Test",
          },
        ],
        extensions: { operations: [{ version: "3" }] },
      },
      metadata: {
        issuer: origin,
        token_endpoint: origin + "/oauth/token",
        revocation_endpoint: origin + "/oauth/revoke",
        authorization_endpoint: origin + "/oauth/authorize",
        grant_types_supported: ["authorization_code", "refresh_token"],
        protected_resources: [origin],
        dpop_signing_alg_values_supported: ["ES256"],
      },
      profile: {
        version: "1.0",
        identifier: origin,
        issuer: origin,
        signIn: { direct: true, device: false },
        scopes: ["poppy:read", "poppy:write"],
        scopeDescriptions: {},
        scopeHints: {
          "poppy:read": { changes: "none", personal_data: true },
          "poppy:write": { changes: "irreversible", personal_data: true },
        },
        operations: true,
      },
    },
  };
}
let conversation = 0;
/** One demo turn in a new conversation; every request made is in `asked`. */
async function say(run: Run, message: string) {
  const id = `run_chat_fixture_${String(++conversation).padStart(4, "0")}`;
  await seedRun("v".repeat(43), id, run);
  discover.mockResolvedValue(run.company);
  const response = await POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Poppy-Conversation": id,
      },
      body: JSON.stringify({ url: origin, message, provider: "demo" }),
    }),
  );
  const answer = (await response.json()) as {
    text?: string;
    error?: string;
    data?: string;
    trace?: string[];
  };
  return {
    status: response.status,
    answer,
    steps: (answer.trace ?? []).map((line) => agentStep(logEntry(line)).text),
    asked: transport.mock.calls.map(([url]) => url),
  };
}
beforeEach(() => {
  transport.mockReset().mockImplementation(async (url) => {
    if (url === origin + "/poppy/openapi.json") return api;
    return { ok: true };
  });
});

it("says to sign in, and that nothing was sent, when a signed-out customer asks for their orders", async () => {
  const turn = await say(shop(), "my orders");
  expect(turn.status).toBe(200);
  expect(turn.answer.text).toBe(
    "Protocol demo (no LLM). This needs your account at Juniper Market, and you are not signed in. Iris did not ask: nothing was sent to the Company. Press “Sign in to Juniper Market”, then ask again.",
  );
  // Nothing of the Company's to show under Data.
  expect(turn.answer).not.toHaveProperty("data");
  expect(turn.asked).not.toContain(origin + "/api/account/orders");
  expect(turn.answer.trace).toContain(
    "Not sent · GET /api/account/orders · sign-in needed",
  );
  expect(turn.steps).toContain(
    "Did not ask for /api/account/orders (sign-in needed); nothing was sent",
  );
  expect(turn.steps.join("\n")).not.toMatch(/^(Read|Sent a request to) /m);
});

it("names the change permission, and says nothing was sent, when a read-only customer asks for a change", async () => {
  const turn = await say(
    shop("poppy:read"),
    "Move my recurring delivery to Saturday.",
  );
  expect(turn.status).toBe(200);
  expect(turn.answer.text).toBe(
    "Protocol demo (no LLM). This needs the change permission, which your sign-in to Juniper Market doesn't include. Iris did not ask: nothing was sent to the Company. Press “Request change permission”, review the Company's consent, and ask again.",
  );
  expect(turn.answer).not.toHaveProperty("data");
  expect(turn.asked).not.toContain(origin + "/api/account/delivery-change");
  expect(turn.answer.trace).toContain(
    "Not sent · POST /api/account/delivery-change · permission not granted",
  );
  expect(turn.steps.join("\n")).not.toMatch(/^(Read|Sent a request to) /m);
});

it("still shows the Company's answer, and the request, for a read that was sent", async () => {
  transport.mockImplementation(async (url) =>
    url === origin + "/poppy/openapi.json"
      ? api
      : url === origin + "/api/products"
        ? { products: [{ name: "Cara cara oranges" }] }
        : { ok: true },
  );
  const turn = await say(shop(), "what do you sell?");
  expect(turn.answer.text).toContain("The company answered:");
  expect(turn.answer.text).toContain("Cara cara oranges");
  expect(turn.answer.data).toContain("Cara cara oranges");
  expect(turn.asked).toContain(origin + "/api/products");
  expect(turn.steps).toContain("Read /api/products");
});

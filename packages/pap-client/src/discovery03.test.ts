import { describe, expect, it, vi } from "vitest";
import { parseExcludedTasks } from "@poppy-lab/pap-core";
import { discoverCompany } from "./index";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const issuer = "https://auth.company.example";
const document = {
  protocol_version: "0.3",
  organization: { name: "Test Company", domain: "company.example" },
  auth: {
    scopes: {
      "orders:read": "See your orders",
      "orders:write": "Change orders",
    },
    scope_hints: {
      "orders:read": { changes: "none", personal_data: true },
      "orders:write": { changes: "refundable-later", personal_data: true },
      addresses: { changes: "reversible" },
      "ignored:field": { changes: "none", personal_data: false, extra: 1 },
    },
  },
  apis: [
    {
      type: "openapi",
      url: "https://api.company.example/openapi.json",
      description: "Orders",
    },
    {
      type: "graphql",
      url: "https://api.company.example/graphql",
      description: "Future type",
    },
  ],
  excluded_tasks: { url: "https://company.example/poppy/excluded-tasks.json" },
};
const resource = {
  resource: "https://company.example",
  authorization_servers: [issuer],
};
const metadata = {
  issuer,
  token_endpoint: `${issuer}/token`,
  revocation_endpoint: `${issuer}/revoke`,
  authorization_endpoint: `${issuer}/authorize`,
  grant_types_supported: ["refresh_token", "authorization_code"],
  scopes_supported: ["orders:read", "orders:write"],
  protected_resources: [
    "https://COMPANY.example",
    "https://mcp.company.example/mcp",
  ],
};
function fetcher(...responses: Response[]) {
  return vi.fn<typeof fetch>().mockImplementation(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
}
const discover = (...responses: Response[]) => {
  const fetchImpl = fetcher(...responses);
  return {
    fetchImpl,
    result: discoverCompany("company.example", { fetchImpl }),
  };
};

describe("PAP 0.3 discovery profile", () => {
  it("finds the issuer through protected resource metadata and normalizes the profile", async () => {
    const { fetchImpl, result } = discover(
      Response.json(document),
      Response.json(resource),
      Response.json(metadata),
    );
    const company = await result;
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "https://company.example/.well-known/poppy.json",
      "https://company.example/.well-known/oauth-protected-resource",
      "https://auth.company.example/.well-known/oauth-authorization-server",
    ]);
    expect(company.profile).toEqual({
      version: "0.3",
      identifier: issuer,
      issuer,
      signIn: { direct: true, device: false },
      scopes: ["orders:read", "orders:write"],
      scopeDescriptions: document.auth.scopes,
      scopeHints: {
        "orders:read": { changes: "none", personal_data: true },
        // Unknown change classes are never treated as safer than irreversible.
        "orders:write": { changes: "irreversible", personal_data: true },
        "ignored:field": { changes: "none", personal_data: false },
      },
      excludedTasksUrl: "https://company.example/poppy/excluded-tasks.json",
    });
    expect(company.document.apis).toHaveLength(2);
  });

  it("offers no sign-in when auth.disabled is set, keeping the issuer as identifier (§3.2)", async () => {
    const { result } = discover(
      Response.json({
        ...document,
        auth: { ...document.auth, disabled: true },
      }),
      Response.json(resource),
      Response.json(metadata),
    );
    const company = await result;
    expect(company.profile).toMatchObject({
      identifier: issuer,
      signIn: { direct: false, device: false },
    });
  });

  it("treats an explicit 404 as a signed-out Company identified by its domain", async () => {
    const { result } = discover(
      Response.json({ ...document, auth: { scopes: {} } }),
      new Response(null, { status: 404 }),
    );
    const company = await result;
    expect(company.profile).toMatchObject({
      identifier: "https://company.example",
      signIn: { direct: false, device: false },
      scopes: [],
    });
    expect(company.profile).not.toHaveProperty("issuer");
    expect(company.metadata).toBeUndefined();
  });

  it("accepts metadata without authorization servers as signed-out", async () => {
    const { result } = discover(
      Response.json(document),
      Response.json({ resource: "https://company.example" }),
    );
    expect((await result).profile?.identifier).toBe("https://company.example");
  });

  it.each([500, 401])(
    "never falls back to signed-out after HTTP %s",
    async (status) => {
      const { result } = discover(
        Response.json(document),
        Response.json({ error: "server_error" }, { status }),
      );
      await expect(result).rejects.toThrow();
    },
  );

  it("rejects resource metadata for another resource", async () => {
    const { result } = discover(
      Response.json(document),
      Response.json({ ...resource, resource: "https://company.example/api" }),
    );
    await expect(result).rejects.toThrow("different resource");
  });

  it("requires a two-way issuer link through protected_resources", async () => {
    const { result } = discover(
      Response.json(document),
      Response.json(resource),
      Response.json({
        ...metadata,
        protected_resources: ["https://other.example"],
      }),
    );
    await expect(result).rejects.toThrow("protected_resources");
  });

  it("ignores legacy poppy_domains in 0.3", async () => {
    const withoutResources: Partial<typeof metadata> = { ...metadata };
    delete withoutResources.protected_resources;
    const { result } = discover(
      Response.json(document),
      Response.json(resource),
      Response.json({
        ...withoutResources,
        poppy_domains: ["company.example"],
      }),
    );
    await expect(result).rejects.toThrow("protected_resources");
  });

  it("requires grant_types_supported with refresh_token", async () => {
    const { result } = discover(
      Response.json(document),
      Response.json(resource),
      Response.json({
        ...metadata,
        grant_types_supported: ["authorization_code"],
      }),
    );
    await expect(result).rejects.toThrow("refresh_token");
  });

  it("requires the endpoint of each advertised sign-in grant", async () => {
    const withoutAuthorize: Partial<typeof metadata> = { ...metadata };
    delete withoutAuthorize.authorization_endpoint;
    const { result } = discover(
      Response.json(document),
      Response.json(resource),
      Response.json(withoutAuthorize),
    );
    await expect(result).rejects.toThrow("authorization_endpoint");
  });

  it("requires auth.issuer to choose among several authorization servers", async () => {
    const several = {
      ...resource,
      authorization_servers: ["https://staff.example", issuer],
    };
    await expect(
      discover(Response.json(document), Response.json(several)).result,
    ).rejects.toThrow("must choose");
    const chosen = discover(
      Response.json({ ...document, auth: { ...document.auth, issuer } }),
      Response.json(several),
      Response.json(metadata),
    );
    expect((await chosen.result).profile?.issuer).toBe(issuer);
  });

  it("rejects an auth.issuer the domain does not name", async () => {
    const { result } = discover(
      Response.json({
        ...document,
        auth: { issuer: "https://attacker.example" },
      }),
      Response.json(resource),
    );
    await expect(result).rejects.toThrow("not an authorization server");
  });

  it("requires an issuer for conversations declared as signed_in", async () => {
    const { result } = discover(
      Response.json({
        ...document,
        agent: {
          protocols: [
            {
              type: "poppy",
              endpoint: "https://api.company.example/c",
              access: "signed_in",
            },
          ],
        },
      }),
      new Response(null, { status: 404 }),
    );
    await expect(result).rejects.toThrow("needs an OAuth issuer");
  });

  it("ignores unknown access hints", async () => {
    const { result } = discover(
      Response.json({
        ...document,
        agent: {
          protocols: [
            {
              type: "poppy",
              endpoint: "https://api.company.example/c",
              access: "future",
            },
          ],
        },
      }),
      new Response(null, { status: 404 }),
    );
    expect((await result).profile?.signIn.direct).toBe(false);
  });

  it("does not follow a redirect of the resource metadata", async () => {
    const { result } = discover(
      Response.json(document),
      new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.example/resource" },
      }),
    );
    await expect(result).rejects.toThrow("redirects");
  });
});

describe("discovery redirects (all versions)", () => {
  it("follows a redirect to another host that ends at the well-known path", async () => {
    const { result } = discover(
      new Response(null, {
        status: 307,
        headers: {
          location: "https://api.company.example/.well-known/poppy.json",
        },
      }),
      Response.json({
        ...document,
        organization: {
          ...document.organization,
          domain: "api.company.example",
        },
      }),
      new Response(null, { status: 404 }),
    );
    expect((await result).profile?.identifier).toBe(
      "https://api.company.example",
    );
  });

  it.each([
    "https://company.example/uploads/poppy.json",
    "https://company.example/.well-known/poppy.json?file=1",
  ])("refuses a document reached at %s", async (location) => {
    const { result } = discover(
      new Response(null, { status: 302, headers: { location } }),
      Response.json(document),
    );
    await expect(result).rejects.toThrow("redirect did not end");
  });

  it.each(["0.1", "0.2"])(
    "rejects PAP %s documents",
    async (protocol_version) => {
      const { result } = discover(
        Response.json({ ...document, protocol_version }),
      );
      await expect(result).rejects.toThrow(
        `Unsupported PAP version ${protocol_version}`,
      );
    },
  );
});

describe("PAP 0.3 excluded tasks", () => {
  const doc = {
    ...document,
    apis: [
      ...document.apis,
      {
        type: "mcp",
        url: "https://api.company.example/mcp",
        description: "Tools",
      },
    ],
  } as Parameters<typeof parseExcludedTasks>[1];
  it("keeps tasks and safe references, dropping foreign or unknown ones", () => {
    const tasks = parseExcludedTasks(
      {
        tasks: [
          {
            task: "Cancel an order",
            alternative: {
              instructions: "Phone the kitchen.",
              references: [
                { type: "web", url: "https://company.example/policies" },
                { type: "web", url: "https://help.company.example/cancel" },
                { type: "web", url: "https://phish.example/company.example" },
                { type: "web", url: "http://company.example/insecure" },
                {
                  type: "openapi",
                  url: "https://api.company.example/openapi.json",
                  operation_id: "moveOrder",
                },
                {
                  type: "openapi",
                  url: "https://other.example/openapi.json",
                  operation_id: "steal",
                },
                {
                  type: "mcp",
                  url: "https://api.company.example/mcp",
                  tool: "move_order",
                },
                { type: "agent", url: "https://company.example/future" },
              ],
              extra: true,
            },
          },
          { task: "Change the delivery address" },
          { task: "" },
          "not a task",
        ],
      },
      doc,
    );
    expect(tasks).toEqual([
      {
        task: "Cancel an order",
        alternative: {
          instructions: "Phone the kitchen.",
          references: [
            { type: "web", url: "https://company.example/policies" },
            { type: "web", url: "https://help.company.example/cancel" },
            {
              type: "openapi",
              url: "https://api.company.example/openapi.json",
              operation_id: "moveOrder",
            },
            {
              type: "mcp",
              url: "https://api.company.example/mcp",
              tool: "move_order",
            },
          ],
        },
      },
      { task: "Change the delivery address" },
    ]);
  });
  it("rejects a document without a tasks list", () => {
    expect(() => parseExcludedTasks({ items: [] }, doc)).toThrow("Invalid");
  });
  it("bounds the number and length of entries", () => {
    const tasks = parseExcludedTasks(
      { tasks: Array.from({ length: 100 }, () => ({ task: "x".repeat(500) })) },
      doc,
    );
    expect(tasks).toHaveLength(64);
    expect(tasks[0]!.task).toHaveLength(200);
  });
});

import { describe, expect, it, vi } from "vitest";
import { discoverCompany } from "./index";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const issuer = "https://auth.company.example";
const document = {
  protocol_version: "1.0",
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
  tasks: { endpoint: "https://company.example/poppy/tasks" },
  extensions: {
    operations: [{ version: "3" }],
    "example.com/x": [{ version: "1" }],
  },
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

describe("Poppy 1.0 discovery profile", () => {
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
      version: "1.0",
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
      tasksEndpoint: "https://company.example/poppy/tasks",
      operations: true,
      // §3.3: only the supported version of a supported extension.
      extensions: { operations: { version: "3" } },
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

  it("ignores legacy poppy_domains", async () => {
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
              description: "Orders",
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
              description: "Orders",
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

  it.each(["0.1", "0.2", "0.3", "0.4", "2.0"])(
    "rejects Poppy %s documents",
    async (protocol_version) => {
      const { result } = discover(
        Response.json({ ...document, protocol_version }),
      );
      await expect(result).rejects.toThrow(
        `Unsupported Poppy version ${protocol_version}`,
      );
    },
  );
});

describe("versions (§3.4)", () => {
  const old = {
    ...document,
    protocol_version: "0.4",
    agent: {
      protocols: [{ type: "poppy", endpoint: "https://company.example/c" }],
    },
  };
  it("uses a compatible document from supported_versions on the same host, without redirects", async () => {
    const { fetchImpl, result } = discover(
      Response.json({
        ...old,
        supported_versions: {
          "1.0": "https://company.example/poppy/1.0.json",
          "0.3": "https://company.example/poppy/0.3.json",
        },
      }),
      Response.json(document),
      Response.json(resource),
      Response.json(metadata),
    );
    const company = await result;
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      "https://company.example/poppy/1.0.json",
    );
    expect(fetchImpl.mock.calls[1]![1]?.redirect).toBe("manual");
    expect(company.profile.version).toBe("1.0");
  });
  it("chooses the newest compatible minor version", async () => {
    const { fetchImpl, result } = discover(
      Response.json({
        ...document,
        supported_versions: { "1.2": "https://company.example/poppy/1.2.json" },
      }),
      Response.json({ ...document, protocol_version: "1.2" }),
      Response.json(resource),
      Response.json(metadata),
    );
    expect((await result).profile.version).toBe("1.2");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it.each([
    ["another host", { "1.0": "https://evil.example/poppy/1.0.json" }],
    ["no compatible version", { "0.3": "https://company.example/0.3.json" }],
  ])("refuses %s", async (_label, supported_versions) => {
    const { result } = discover(Response.json({ ...old, supported_versions }));
    await expect(result).rejects.toThrow("Unsupported Poppy version 0.4");
  });
  it("refuses a linked document with another version or its own supported_versions", async () => {
    const link = { "1.0": "https://company.example/poppy/1.0.json" };
    await expect(
      discover(
        Response.json({ ...old, supported_versions: link }),
        Response.json({ ...document, protocol_version: "1.1" }),
      ).result,
    ).rejects.toThrow("says protocol_version 1.1");
    await expect(
      discover(
        Response.json({ ...old, supported_versions: link }),
        Response.json({ ...document, supported_versions: link }),
      ).result,
    ).rejects.toThrow("must not list supported_versions");
  });
});

describe("ports and sign-in options (§3.1, §4.2)", () => {
  it("refuses a Company on another port unless configured on purpose", async () => {
    const fetchImpl = fetcher(
      Response.json({
        ...document,
        organization: { name: "x", domain: "company.example:8443" },
      }),
    );
    await expect(
      discoverCompany("https://company.example:8443", { fetchImpl }),
    ).rejects.toThrow("non-standard port");
  });
  it("reads PAR and scopes from either metadata list", async () => {
    const { result } = discover(
      Response.json(document),
      Response.json({ ...resource, scopes_supported: ["addresses"] }),
      Response.json({
        ...metadata,
        pushed_authorization_request_endpoint: `${issuer}/par`,
        require_pushed_authorization_requests: true,
      }),
    );
    const company = await result;
    expect(company.profile.pushedAuthorization).toEqual({
      endpoint: `${issuer}/par`,
      required: true,
    });
    expect(company.profile.scopes).toEqual([
      "orders:read",
      "orders:write",
      "addresses",
    ]);
  });
  it("requires the PAR endpoint when PAR is required", async () => {
    const { result } = discover(
      Response.json(document),
      Response.json(resource),
      Response.json({
        ...metadata,
        require_pushed_authorization_requests: true,
      }),
    );
    await expect(result).rejects.toThrow(
      "pushed_authorization_request_endpoint",
    );
  });
});

describe("poppylab.dev/fdx in the profile (§3.3)", () => {
  const fdx = {
    version: "1",
    fdx_version: "6.4",
    base_url: "https://company.example/fdx/v6",
    resources: ["customer", "accounts", "transactions"],
    consent_endpoint: "https://company.example/fdx/v6/consents",
  };
  const withFdx = (entry: unknown) => ({
    ...document,
    extensions: { ...document.extensions, "poppylab.dev/fdx": [entry] },
  });
  it("keeps a valid v1 entry next to Operations, with a trace step", async () => {
    const { result } = discover(
      Response.json(withFdx(fdx)),
      Response.json(resource),
      Response.json(metadata),
    );
    const company = await result;
    expect(company.profile.operations).toBe(true);
    expect(company.profile.extensions).toEqual({
      operations: { version: "3" },
      "poppylab.dev/fdx": fdx,
    });
    expect(company.trace).toContainEqual({
      id: "extension",
      label: "Extension poppylab.dev/fdx v1",
      detail: "https://company.example/fdx/v6",
      status: "passed",
    });
  });
  it("treats an entry on another host as not listed, and says why", async () => {
    const { result } = discover(
      Response.json(
        withFdx({ ...fdx, base_url: "https://evil.example/fdx/v6" }),
      ),
      Response.json(resource),
      Response.json(metadata),
    );
    const company = await result;
    expect(company.profile.extensions).toEqual({
      operations: { version: "3" },
    });
    expect(company.trace).toContainEqual({
      id: "extension",
      label: "Extension poppylab.dev/fdx v1 ignored",
      detail: "base_url is not an HTTPS URL on company.example",
      status: "failed",
    });
  });
  it("accepts plain HTTP only for a configured local origin", async () => {
    const local = "http://harbor.localhost:4300";
    const doc = {
      ...withFdx({
        ...fdx,
        base_url: `${local}/fdx/v6`,
        consent_endpoint: `${local}/fdx/v6/consents`,
      }),
      organization: { name: "Harborline", domain: "harbor.localhost:4300" },
      auth: undefined,
    };
    const run = (allowedPrivateOrigins: string[]) =>
      discoverCompany(local, {
        fetchImpl: fetcher(
          Response.json(doc),
          new Response(null, { status: 404 }),
        ),
        allowedPrivateOrigins,
      });
    expect(
      (await run([local])).profile.extensions?.["poppylab.dev/fdx"],
    ).toMatchObject({ base_url: `${local}/fdx/v6` });
    // Without the exception the port alone stops discovery.
    await expect(run([])).rejects.toThrow();
  });
});

describe("poppylab.dev/espi in the profile (§3.3)", () => {
  const espi = {
    version: "1",
    espi_version: "4.0",
    resource_endpoint: "https://company.example/espi/1_1/resource",
    resources: ["UsagePoint", "MeterReading"],
    function_blocks: [1, 3, 4],
  };
  const withEspi = (entry: unknown) => ({
    ...document,
    extensions: { ...document.extensions, "poppylab.dev/espi": [entry] },
  });
  it("keeps a valid v1 entry next to Operations, with a trace step", async () => {
    const { result } = discover(
      Response.json(withEspi(espi)),
      Response.json(resource),
      Response.json(metadata),
    );
    const company = await result;
    expect(company.profile.extensions).toEqual({
      operations: { version: "3" },
      "poppylab.dev/espi": espi,
    });
    expect(company.trace).toContainEqual({
      id: "extension",
      label: "Extension poppylab.dev/espi v1",
      detail: "https://company.example/espi/1_1/resource",
      status: "passed",
    });
  });
  it("treats an entry on another host as not listed, and says why", async () => {
    const { result } = discover(
      Response.json(
        withEspi({ ...espi, resource_endpoint: "https://evil.example/espi" }),
      ),
      Response.json(resource),
      Response.json(metadata),
    );
    const company = await result;
    expect(company.profile.extensions).toEqual({
      operations: { version: "3" },
    });
    expect(company.trace).toContainEqual({
      id: "extension",
      label: "Extension poppylab.dev/espi v1 ignored",
      detail: "resource_endpoint is not an HTTPS URL on company.example",
      status: "failed",
    });
  });
});

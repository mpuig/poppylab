import { describe, expect, it } from "vitest";
import {
  companyExtensions,
  compatibleVersion,
  ESPI_EXTENSION,
  espiExtension,
  fdxExtension,
  SUPPORTED_EXTENSIONS,
  listsExtension,
  parseTasks,
  poppyDocumentSchema,
} from "./index";

const base = {
  protocol_version: "1.0",
  organization: { name: "Test", domain: "test.example" },
  web: {},
};

describe("Poppy 1.0 document boundary", () => {
  it("accepts 1.0, and later 1.x minor versions as compatible (§3.4)", () => {
    expect(poppyDocumentSchema.parse(base).protocol_version).toBe("1.0");
    expect(compatibleVersion("1.0")).toBe(true);
    expect(compatibleVersion("1.1")).toBe(true);
    for (const v of ["0.3", "0.4", "2.0", "1", "v1.0"])
      expect(compatibleVersion(v)).toBe(false);
  });
  it("allows website-only adoption", () =>
    expect(poppyDocumentSchema.safeParse(base).success).toBe(true));
  it("allows signed-out APIs without an issuer (§3.2)", () =>
    expect(
      poppyDocumentSchema.safeParse({
        ...base,
        apis: [
          { type: "future", url: "https://api.test.example", description: "x" },
        ],
      }).success,
    ).toBe(true));
  it("requires a description for every conversation endpoint (§8.1)", () => {
    const entry = {
      type: "poppy",
      endpoint: "https://test.example/poppy/conversations",
    };
    expect(
      poppyDocumentSchema.safeParse({ ...base, agent: { protocols: [entry] } })
        .success,
    ).toBe(false);
    expect(
      poppyDocumentSchema.safeParse({
        ...base,
        agent: { protocols: [{ ...entry, description: "Orders and refunds" }] },
      }).success,
    ).toBe(true);
  });
  it("reads extensions as one entry per version (§3.3)", () => {
    const doc = poppyDocumentSchema.parse({
      ...base,
      extensions: {
        operations: [{ version: "3" }, { version: "2", endpoint: "x" }, 7],
      },
    });
    expect(listsExtension(doc, "operations", "3")).toBe(true);
    expect(listsExtension(doc, "operations", "4")).toBe(false);
    expect(listsExtension(doc, "links", "1")).toBe(false);
    // The 0.3 form (an object) is not a list of versions.
    expect(
      poppyDocumentSchema.safeParse({
        ...base,
        extensions: { operations: { version: "2" } },
      }).success,
    ).toBe(false);
  });
  it("ignores removed earlier fields instead of trusting them", () => {
    const parsed = poppyDocumentSchema.parse({
      ...base,
      auth: { direct: { scopes: ["x"] }, custom_scopes: { x: "y" } },
      excluded_tasks: { url: "https://test.example/x.json" },
    });
    expect(parsed.auth).toEqual({});
    expect("excluded_tasks" in parsed).toBe(false);
  });
  it.each(["test.example:4100", "juniper.localhost:4100"])(
    "accepts a domain with a port other than 443: %s",
    (domain) =>
      expect(
        poppyDocumentSchema.safeParse({
          ...base,
          organization: { name: "Test", domain },
        }).success,
      ).toBe(true),
  );
  it.each([
    "localhost",
    "https://test.example",
    "test.example:443",
    "test.example:0",
    "test.example/path",
  ])("rejects malformed domain %s", (domain) => {
    expect(
      poppyDocumentSchema.safeParse({
        ...base,
        organization: { name: "Test", domain },
      }).success,
    ).toBe(false);
  });
  it.each([
    "http://auth.example",
    "https://user:secret@auth.example",
    "https://auth.example/#fragment",
  ])("rejects unsafe issuer %s", (issuer) => {
    expect(
      poppyDocumentSchema.safeParse({ ...base, auth: { issuer } }).success,
    ).toBe(false);
  });
});

describe("poppylab.dev/fdx v1 entry (§3.3)", () => {
  const entry = {
    version: "1",
    fdx_version: "6.4",
    base_url: "https://test.example/fdx/v6",
    resources: ["customer", "accounts", "transactions"],
    consent_endpoint: "https://test.example/fdx/v6/consents",
  };
  const doc = (...entries: unknown[]) =>
    poppyDocumentSchema.parse({
      ...base,
      extensions: { "poppylab.dev/fdx": entries },
    });
  it("reads a valid entry, keeping only its known fields", () => {
    expect(
      fdxExtension(doc({ ...entry, base_url: entry.base_url + "/", x: 1 })),
    ).toEqual({ entry });
  });
  it("is not listed without a version 1 entry", () => {
    expect(fdxExtension(doc({ ...entry, version: "2" }))).toBeUndefined();
    expect(fdxExtension(doc())).toBeUndefined();
    expect(fdxExtension(poppyDocumentSchema.parse(base))).toBeUndefined();
  });
  it.each([
    ["base_url", undefined, "base_url is missing"],
    ["consent_endpoint", undefined, "consent_endpoint is missing"],
    ["base_url", 7, "base_url is not"],
    ["base_url", "not a url", "base_url is not"],
    ["base_url", "http://test.example/fdx/v6", "base_url is not"],
    ["base_url", "https://api.test.example/fdx/v6", "base_url is not"],
    ["base_url", "https://test.example.evil/fdx", "base_url is not"],
    ["base_url", "https://test.example:8443/fdx", "base_url is not"],
    ["base_url", "https://user:pw@test.example/fdx", "base_url is not"],
    ["base_url", "https://test.example/fdx?x=1", "base_url is not"],
    ["base_url", "https://test.example/fdx?", "base_url is not"],
    ["base_url", "https://test.example/fdx#x", "base_url is not"],
    ["base_url", "https://test.example/fdx%2Fv6", "base_url is not"],
    ["consent_endpoint", "https://other.example/c", "consent_endpoint is not"],
  ])("rejects %s = %s", (field, value, reason) => {
    const check = fdxExtension(doc({ ...entry, [field]: value }));
    expect(check?.entry).toBeUndefined();
    expect(check?.reason).toContain(reason);
  });
  it("allows plain HTTP only on a given local origin that is the domain", () => {
    const local = "http://harbor.localhost:4300";
    const document = poppyDocumentSchema.parse({
      ...base,
      organization: { name: "Harborline", domain: "harbor.localhost:4300" },
      extensions: {
        "poppylab.dev/fdx": [
          {
            ...entry,
            base_url: `${local}/fdx/v6`,
            consent_endpoint: `${local}/fdx/v6/consents`,
          },
        ],
      },
    });
    expect(fdxExtension(document, [local])?.entry?.base_url).toBe(
      `${local}/fdx/v6`,
    );
    expect(fdxExtension(document)?.entry).toBeUndefined();
    // A local origin that isn't the Company's own is still another origin.
    expect(
      fdxExtension(
        {
          ...document,
          organization: { ...document.organization, domain: "x.example" },
        },
        [local],
      )?.entry,
    ).toBeUndefined();
  });
  it("drops malformed informational fields instead of the entry", () => {
    expect(
      fdxExtension(
        doc({
          ...entry,
          fdx_version: "<b>6</b>",
          resources: ["accounts", 3, "A B"],
        }),
      ),
    ).toEqual({
      entry: {
        version: "1",
        base_url: entry.base_url,
        consent_endpoint: entry.consent_endpoint,
        resources: ["accounts"],
      },
    });
  });
  it("lists the supported extensions by name, with rejected ones apart", () => {
    const document = poppyDocumentSchema.parse({
      ...base,
      extensions: {
        operations: [{ version: "2" }, { version: "3", extra: true }],
        "poppylab.dev/fdx": [{ ...entry, base_url: "https://x.example" }],
        "example.com/other": [{ version: "1" }],
      },
    });
    expect(companyExtensions(document)).toEqual({
      extensions: { operations: { version: "3" } },
      rejected: [
        {
          name: "poppylab.dev/fdx",
          version: "1",
          reason: "base_url is not an HTTPS URL on test.example",
        },
      ],
    });
  });
});

describe("poppylab.dev/espi v1 entry (§3.3)", () => {
  const entry = {
    version: "1",
    espi_version: "4.0",
    resource_endpoint: "https://test.example/espi/1_1/resource",
    resources: ["UsagePoint", "MeterReading", "IntervalBlock"],
    function_blocks: [1, 3, 4],
  };
  const doc = (...entries: unknown[]) =>
    poppyDocumentSchema.parse({
      ...base,
      extensions: { "poppylab.dev/espi": entries },
    });
  it("reads a valid entry, keeping only its known fields", () => {
    expect(
      espiExtension(
        doc({
          ...entry,
          resource_endpoint: entry.resource_endpoint + "/",
          x: 1,
        }),
      ),
    ).toEqual({ entry });
    expect(SUPPORTED_EXTENSIONS).toMatchObject({
      [ESPI_EXTENSION]: "1",
      "poppylab.dev/fdx": "1",
      operations: "3",
    });
  });
  it("is not listed without a version 1 entry", () => {
    expect(espiExtension(doc({ ...entry, version: "2" }))).toBeUndefined();
    expect(espiExtension(doc())).toBeUndefined();
    expect(espiExtension(poppyDocumentSchema.parse(base))).toBeUndefined();
  });
  it.each([
    [undefined, "resource_endpoint is missing"],
    [7, "resource_endpoint is not"],
    ["not a url", "resource_endpoint is not"],
    ["http://test.example/espi", "resource_endpoint is not"],
    ["https://api.test.example/espi", "resource_endpoint is not"],
    ["https://test.example.evil/espi", "resource_endpoint is not"],
    ["https://test.example:8443/espi", "resource_endpoint is not"],
    ["https://user:pw@test.example/espi", "resource_endpoint is not"],
    ["https://test.example/espi?x=1", "resource_endpoint is not"],
    ["https://test.example/espi?", "resource_endpoint is not"],
    ["https://test.example/espi#x", "resource_endpoint is not"],
    ["https://test.example/espi%2F1_1", "resource_endpoint is not"],
  ])("rejects resource_endpoint = %s", (value, reason) => {
    const check = espiExtension(doc({ ...entry, resource_endpoint: value }));
    expect(check?.entry).toBeUndefined();
    expect(check?.reason).toContain(reason);
  });
  it("allows plain HTTP only on a given local origin that is the domain", () => {
    const local = "http://fernwick.localhost:4500";
    const document = poppyDocumentSchema.parse({
      ...base,
      organization: { name: "Fernwick", domain: "fernwick.localhost:4500" },
      extensions: {
        "poppylab.dev/espi": [
          { ...entry, resource_endpoint: `${local}/espi/1_1/resource` },
        ],
      },
    });
    expect(espiExtension(document, [local])?.entry?.resource_endpoint).toBe(
      `${local}/espi/1_1/resource`,
    );
    expect(espiExtension(document)?.entry).toBeUndefined();
    expect(
      espiExtension(
        {
          ...document,
          organization: { ...document.organization, domain: "x.example" },
        },
        [local],
      )?.entry,
    ).toBeUndefined();
  });
  it("drops malformed informational fields instead of the entry", () => {
    expect(
      espiExtension(
        doc({
          ...entry,
          espi_version: "<b>4</b>",
          resources: ["UsagePoint", 3, "usage point", "<x>"],
          function_blocks: [1, "3", 2.5, -1, 0, 1000, 15],
        }),
      ),
    ).toEqual({
      entry: {
        version: "1",
        resource_endpoint: entry.resource_endpoint,
        resources: ["UsagePoint"],
        function_blocks: [1, 15],
      },
    });
  });
  it("is listed with the other supported extensions, and rejected apart", () => {
    const fdx = {
      version: "1",
      base_url: "https://test.example/fdx/v6",
      consent_endpoint: "https://test.example/fdx/v6/consents",
    };
    const both = companyExtensions(
      poppyDocumentSchema.parse({
        ...base,
        extensions: {
          operations: [{ version: "3" }],
          "poppylab.dev/fdx": [fdx],
          "poppylab.dev/espi": [entry],
        },
      }),
    );
    expect(both).toEqual({
      extensions: {
        operations: { version: "3" },
        "poppylab.dev/fdx": fdx,
        "poppylab.dev/espi": entry,
      },
      rejected: [],
    });
    expect(
      companyExtensions(
        poppyDocumentSchema.parse({
          ...base,
          extensions: {
            "poppylab.dev/espi": [
              { ...entry, resource_endpoint: "https://x.example/espi" },
            ],
          },
        }),
      ),
    ).toEqual({
      extensions: {},
      rejected: [
        {
          name: "poppylab.dev/espi",
          version: "1",
          reason: "resource_endpoint is not an HTTPS URL on test.example",
        },
      ],
    });
  });
});

describe("tasks response (§9)", () => {
  const doc = poppyDocumentSchema.parse({
    ...base,
    apis: [
      {
        type: "openapi",
        url: "https://test.example/openapi.json",
        description: "x",
      },
    ],
  });
  it("reads excluded tasks, alternatives, feedback and the skill count", () => {
    const tasks = parseTasks(
      {
        excluded_tasks: [
          {
            task: "Cancel an order",
            alternative: {
              instructions: "Move it instead.",
              references: [
                {
                  type: "openapi",
                  url: "https://test.example/openapi.json",
                  operation_id: "change_order",
                },
                {
                  type: "openapi",
                  url: "https://evil.example/o.json",
                  operation_id: "x",
                },
                { type: "web", url: "https://evil.example/help" },
                { type: "web", url: "https://help.test.example/cancel" },
                { type: "future", url: "https://test.example/x" },
              ],
            },
          },
          { task: "" },
          { task: "Close an account" },
        ],
        feedback: { endpoint: "https://test.example/poppy/feedback" },
        skill_index: { skills: [{}, {}] },
      },
      doc,
    );
    expect(tasks).toEqual({
      excludedTasks: [
        {
          task: "Cancel an order",
          alternative: {
            instructions: "Move it instead.",
            references: [
              {
                type: "openapi",
                url: "https://test.example/openapi.json",
                operation_id: "change_order",
              },
              { type: "web", url: "https://help.test.example/cancel" },
            ],
          },
        },
        { task: "Close an account" },
      ],
      feedbackEndpoint: "https://test.example/poppy/feedback",
      skills: 2,
    });
    expect(parseTasks({}, doc)).toEqual({ excludedTasks: [], skills: 0 });
    expect(() => parseTasks([], doc)).toThrow();
  });
});

import { labBarHtml, labLineHtml, labSites } from "./lab.ts";
it("links the Poppy Lab sites, locally to localhost and the current one as text", () => {
  expect(labSites("https://food-demo.poppylab.dev").map((s) => s.url)).toEqual([
    "https://poppylab.dev",
    "https://poppylab.dev/playground",
    "https://grocery-demo.poppylab.dev",
    "https://food-demo.poppylab.dev",
    "https://bank-demo.poppylab.dev",
    "https://airline-demo.poppylab.dev",
  ]);
  expect(labSites("http://juniper.localhost:4100")[3]!.url).toBe(
    "http://noodles.localhost:4200",
  );
  expect(labSites("http://juniper.localhost:4100")[4]!.url).toBe(
    "http://harbor.localhost:4300",
  );
  expect(labSites("http://juniper.localhost:4100")[5]!.url).toBe(
    "http://northwind.localhost:4400",
  );
  const bar = labBarHtml(
    "https://food-demo.poppylab.dev",
    "Lantern <Noodle> Bar",
  );
  expect(bar).toContain("Lantern &#60;Noodle&#62; Bar is a fictional company");
  expect(bar).toContain(
    'href="https://poppylab.dev/playground?company=https%3A%2F%2Ffood-demo.poppylab.dev"',
  );
  expect(bar).not.toContain("<script");
  expect(
    labBarHtml("http://harbor.localhost:4300", "Harborline Bank"),
  ).toContain("http://localhost:3000/playground?company=");
  const line = labLineHtml("https://food-demo.poppylab.dev", "lantern");
  expect(line).toContain(
    '<span aria-current="page">Lantern&nbsp;Noodle&nbsp;Bar</span>',
  );
  expect(line).toContain(
    '<a href="https://grocery-demo.poppylab.dev">Juniper&nbsp;Market</a>',
  );
  expect(line).toContain(
    '<a href="https://bank-demo.poppylab.dev">Harborline&nbsp;Bank</a>',
  );
  expect(line).toContain(
    '<a href="https://airline-demo.poppylab.dev">Northwind&nbsp;Air</a>',
  );
  expect(line).toContain("https://github.com/mpuig/poppylab");
});

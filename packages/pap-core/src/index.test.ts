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
  SKILL_INDEX_SCHEMA,
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
  it("reads excluded tasks, alternatives and feedback, and no skills from an index it doesn't know", () => {
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
      // §9.4: without `$schema` the index is ignored; the rest is used.
      skills: [],
    });
    expect(parseTasks({}, doc)).toEqual({ excludedTasks: [], skills: [] });
    expect(() => parseTasks([], doc)).toThrow();
  });

  it("reads a skill index it knows, each URL resolved against tasks.endpoint (§9.4)", () => {
    const listed = poppyDocumentSchema.parse({
      ...base,
      tasks: { endpoint: "https://test.example/poppy/tasks" },
    });
    const digest = `sha256:${"a1".repeat(32)}`;
    const entry = {
      name: "manage-bookings",
      description: "Manage the User's bookings with this Company.",
      type: "skill-md",
      url: "skills/manage-bookings/SKILL.md",
      digest,
    };
    const index = (skills: unknown[], schema: unknown = SKILL_INDEX_SCHEMA) =>
      parseTasks({ skill_index: { $schema: schema, skills } }, listed).skills;
    expect(SKILL_INDEX_SCHEMA).toBe(
      "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    );
    // A relative reference, one from the origin and a full URL elsewhere.
    expect(
      index([
        { ...entry, later_field: true },
        { ...entry, name: "from-origin", url: "/skills/x/SKILL.md" },
        {
          ...entry,
          name: "elsewhere",
          type: "archive",
          url: "https://cdn.example/skills/x.tar.gz",
        },
      ]),
    ).toEqual([
      {
        name: "manage-bookings",
        description: "Manage the User's bookings with this Company.",
        type: "skill-md",
        url: "https://test.example/poppy/skills/manage-bookings/SKILL.md",
        digest,
      },
      {
        ...entry,
        name: "from-origin",
        url: "https://test.example/skills/x/SKILL.md",
      },
      {
        ...entry,
        name: "elsewhere",
        type: "archive",
        url: "https://cdn.example/skills/x.tar.gz",
      },
    ]);
    // Skipped: an unknown type, a missing field, a digest that isn't one,
    // and a URL that isn't HTTPS once resolved or carries credentials.
    expect(
      index([
        { ...entry, type: "plugin" },
        { ...entry, name: "" },
        { ...entry, name: "n".repeat(65) },
        { ...entry, description: undefined },
        { ...entry, url: "" },
        { ...entry, digest: "sha256:abc" },
        { ...entry, digest: digest.toUpperCase() },
        { ...entry, url: "http://test.example/skills/x/SKILL.md" },
        { ...entry, url: "javascript:alert(1)" },
        { ...entry, url: "https://user:secret@test.example/SKILL.md" },
        "manage-bookings",
        null,
      ]),
    ).toEqual([]);
    // An absent or unknown `$schema`: the whole index is ignored.
    expect(
      parseTasks({ skill_index: { skills: [entry] } }, listed).skills,
    ).toEqual([]);
    expect(
      index([entry], "https://schemas.agentskills.io/discovery/9.0.0/x.json"),
    ).toEqual([]);
    // Without a tasks endpoint there is nothing to resolve against.
    expect(
      parseTasks(
        { skill_index: { $schema: SKILL_INDEX_SCHEMA, skills: [entry] } },
        doc,
      ).skills,
    ).toEqual([]);
  });
});

import {
  DEMOS_URL,
  LAB_REPOSITORY,
  labBarHtml,
  labFootGroups,
  labFootHtml,
  labSites,
} from "./lab.ts";
import { SPEC_URL } from "./spec-links.ts";
import { isLocalCompany } from "./index";
it("lets only the lab Companies' exact local origins use plain HTTP", () => {
  expect(isLocalCompany("http://fernwick.localhost:4500")).toBe(true);
  for (const origin of [
    "https://fernwick.localhost:4500",
    "http://fernwick.localhost:4501",
    "http://fernwick.localhost",
    "http://evil.fernwick.localhost:4500",
    "http://fernwick.localhost:4500/",
  ])
    expect(isLocalCompany(origin)).toBe(false);
});
it("links the Poppy Lab sites, locally to localhost", () => {
  expect(labSites("https://food-demo.poppylab.dev").map((s) => s.url)).toEqual([
    "https://poppylab.dev",
    "https://poppylab.dev/playground",
    "https://grocery-demo.poppylab.dev",
    "https://food-demo.poppylab.dev",
    "https://bank-demo.poppylab.dev",
    "https://airline-demo.poppylab.dev",
    "https://energy-demo.poppylab.dev",
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
  expect(labSites("http://juniper.localhost:4100")[6]!.url).toBe(
    "http://fernwick.localhost:4500",
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
});
it("builds a Company's footer in the order of the lab's own, the current site as text", () => {
  const origin = "https://food-demo.poppylab.dev";
  // What the lab's own footer reads, with its links relative.
  expect(
    labFootGroups(origin, "").map((g) => [g.title, g.links.map((l) => l.href)]),
  ).toEqual([
    ["Poppy Lab", ["/playground", "/learn", "/developers", LAB_REPOSITORY]],
    [
      "Demos",
      [
        "https://grocery-demo.poppylab.dev",
        "https://food-demo.poppylab.dev",
        "https://bank-demo.poppylab.dev",
        "https://airline-demo.poppylab.dev",
        "https://energy-demo.poppylab.dev",
      ],
    ],
    ["Protocol", [SPEC_URL, DEMOS_URL]],
  ]);
  const foot = labFootHtml(origin, "lantern", {
    name: "Lantern <Noodle> Bar",
    notice: ["A <strong>fictional</strong> restaurant.", "A second notice."],
    unaffiliated: ["any real <bank>", "NAESB"],
  });
  // The about block first: name, notices, independence, signature.
  const about = foot.slice(0, foot.indexOf("<nav"));
  expect(about).toContain(
    '<p class="lab-foot-name">Lantern &#60;Noodle&#62; Bar</p><p>A <strong>fictional</strong> restaurant.</p><p>A second notice.</p><p>Part of <a href="https://poppylab.dev">Poppy&nbsp;Lab</a>, an independent experiment that is not affiliated with or endorsed by any real &#60;bank&#62;, by NAESB or by the authors of the Personal Agent Protocol.',
  );
  expect(about).toMatch(
    /With <svg [^>]*aria-hidden="true"[^>]*>.*<\/svg><span class="lab-foot-sr">love<\/span> by <a href="https:\/\/x\.com\/mpuig" rel="noopener">@mpuig<\/a><\/p><\/div>$/,
  );
  // Then the three groups, with the lab's titles and labels in its order.
  const text = (html: string) => html.replace(/<svg.*?<\/svg>|<[^>]+>/g, "|");
  expect(
    text(foot.slice(about.length))
      .split("|")
      .filter((word) => word),
  ).toEqual([
    "Poppy Lab",
    "Playground",
    "Learn",
    "Developers",
    "Source on GitHub",
    "Demos",
    "Juniper Market",
    "Lantern Noodle Bar",
    "Harborline Bank",
    "Northwind Air",
    "Fernwick Power &#38; Light",
    "Protocol",
    "Specification",
    "Community demos",
  ]);
  expect(foot).toContain(
    `<a href="https://poppylab.dev/playground?company=${encodeURIComponent(origin)}">Playground</a><a href="https://poppylab.dev/learn">Learn</a><a href="https://poppylab.dev/developers">Developers</a>`,
  );
  expect(foot).toContain(
    '<a href="https://grocery-demo.poppylab.dev">Juniper Market</a><span aria-current="page">Lantern Noodle Bar</span>',
  );
  expect(foot).not.toContain(`href="${origin}"`);
  expect(foot).toContain(
    `<a href="${SPEC_URL}" target="_blank" rel="noopener noreferrer">Specification<svg`,
  );
  expect(foot).not.toContain("<script");
  // Without anyone else to name, only the protocol's authors.
  expect(
    labFootHtml("http://harbor.localhost:4300", "harborline", {
      name: "Harborline Bank",
      notice: [],
    }),
  ).toContain(
    'Part of <a href="http://localhost:3000">Poppy&nbsp;Lab</a>, an independent experiment that is not affiliated with or endorsed by the authors of the Personal Agent Protocol. “Personal Agent Protocol” and “Poppy” are their names.',
  );
});

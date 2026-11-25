import { describe, expect, it } from "vitest";
import {
  compatibleVersion,
  listsExtension,
  parseTasks,
  poppyDocumentSchema,
} from "./index";

const base = {
  protocol_version: "1.0",
  organization: { name: "Test", domain: "test.example" },
  web: {},
};

describe("PAP 1.0 document boundary", () => {
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

import { labLineHtml, labSites } from "./lab.ts";
it("links the Poppy Lab sites, locally to localhost and the current one as text", () => {
  expect(labSites("https://noodles.poppylab.dev").map((s) => s.url)).toEqual([
    "https://poppylab.dev",
    "https://poppylab.dev/playground",
    "https://juniper.poppylab.dev",
    "https://noodles.poppylab.dev",
    "https://harborline.poppylab.dev",
    "https://northwind.poppylab.dev",
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
  const line = labLineHtml("https://noodles.poppylab.dev", "lantern");
  expect(line).toContain(
    '<span aria-current="page">Lantern&nbsp;Noodle&nbsp;Bar</span>',
  );
  expect(line).toContain(
    '<a href="https://juniper.poppylab.dev">Juniper&nbsp;Market</a>',
  );
  expect(line).toContain(
    '<a href="https://harborline.poppylab.dev">Harborline&nbsp;Bank</a>',
  );
  expect(line).toContain(
    '<a href="https://northwind.poppylab.dev">Northwind&nbsp;Air</a>',
  );
  expect(line).toContain("https://github.com/mpuig/poppylab");
});

import { describe, expect, it } from "vitest";
import { poppyDocumentSchema } from "./index";

const base = {
  protocol_version: "0.3",
  organization: { name: "Test", domain: "test.example" },
  web: {},
};

describe("PAP document boundary", () => {
  it("accepts draft 0.3", () =>
    expect(poppyDocumentSchema.parse(base).protocol_version).toBe("0.3"));
  it.each(["0.1", "0.2", "0.4", "1.0"])(
    "rejects version %s",
    (protocol_version) =>
      expect(
        poppyDocumentSchema.safeParse({ ...base, protocol_version }).success,
      ).toBe(false),
  );
  it("allows website-only adoption", () =>
    expect(poppyDocumentSchema.safeParse(base).success).toBe(true));
  it("allows signed-out APIs without an issuer (0.3 §3.2)", () =>
    expect(
      poppyDocumentSchema.safeParse({
        ...base,
        apis: [
          { type: "future", url: "https://api.test.example", description: "x" },
        ],
      }).success,
    ).toBe(true));
  it("ignores removed 0.2 fields instead of trusting them", () => {
    const parsed = poppyDocumentSchema.parse({
      ...base,
      auth: { direct: { scopes: ["x"] }, custom_scopes: { x: "y" } },
    });
    expect(parsed.auth).toEqual({});
  });
  it.each([
    "localhost",
    "https://test.example",
    "test.example:4100",
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

import { labLineHtml, labSites } from "./lab.ts";
it("links the Poppy Lab sites, locally to localhost and the current one as text", () => {
  expect(labSites("https://noodles.poppylab.dev").map((s) => s.url)).toEqual([
    "https://poppylab.dev",
    "https://poppylab.dev/playground",
    "https://juniper.poppylab.dev",
    "https://noodles.poppylab.dev",
  ]);
  expect(labSites("http://juniper.localhost:4100")[3]!.url).toBe(
    "http://noodles.localhost:4200",
  );
  const line = labLineHtml("https://noodles.poppylab.dev", "lantern");
  expect(line).toContain(
    '<span aria-current="page">Lantern&nbsp;Noodle&nbsp;Bar</span>',
  );
  expect(line).toContain(
    '<a href="https://juniper.poppylab.dev">Juniper&nbsp;Market</a>',
  );
  expect(line).toContain("https://github.com/mpuig/poppylab");
});

import { expect, it } from "vitest";
import { extensionsHeader, parseExtensionsHeader } from "./headers";

it("builds and parses Poppy-Extensions as an RFC 9651 List of Strings (§3.4)", () => {
  const header = extensionsHeader({ operations: "3", links: "1" });
  expect(header).toBe('"links";v="1", "operations";v="3"');
  expect(parseExtensionsHeader(header)).toEqual({
    links: "1",
    operations: "3",
  });
  // Unknown parameters are ignored; an entry without v declares nothing.
  expect(
    parseExtensionsHeader('"operations";x=1;v="3", "example.com/gift-wrap"'),
  ).toEqual({ operations: "3" });
  // A header that fails to parse declares no extensions.
  for (const bad of [
    "operations;v=3",
    '"operations";v="3",',
    '"operations";v="3" "links"',
    '"operations";v="3',
    "",
    undefined,
  ])
    expect(parseExtensionsHeader(bad)).toEqual({});
});

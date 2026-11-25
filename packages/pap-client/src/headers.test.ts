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

it("declares Operations and the FDX extension together, symmetrically", () => {
  const declared = { "poppylab.dev/fdx": "1", operations: "3" };
  const header = extensionsHeader(declared);
  expect(header).toBe('"operations";v="3", "poppylab.dev/fdx";v="1"');
  expect(parseExtensionsHeader(header)).toEqual(declared);
  // Code-unit order, whatever the locale: uppercase sorts first.
  expect(extensionsHeader({ b: "1", B: "1", a: "1" })).toBe(
    '"B";v="1", "a";v="1", "b";v="1"',
  );
  // Names or versions that would need escaping are left out.
  expect(extensionsHeader({ 'a"b': "1", ok: 'x"' })).toBe("");
  expect(extensionsHeader({})).toBe("");
  for (const value of [
    { operations: "3" },
    { "example.com/gift-wrap": "2", links: "1", "poppylab.dev/fdx": "1" },
  ])
    expect(parseExtensionsHeader(extensionsHeader(value))).toEqual(value);
});

it("parses the RFC 9651 List grammar, not just the members it uses", () => {
  // Whitespace around members, a tab between them, SP after ";".
  expect(
    parseExtensionsHeader(' "operations"; v="3",\t"poppylab.dev/fdx";v="1" '),
  ).toEqual({ operations: "3", "poppylab.dev/fdx": "1" });
  // Other bare items are valid syntax but declare nothing; the rest stands.
  expect(
    parseExtensionsHeader(
      'token;v="1", 42, -1.5, ?1, :aGk=:, @1700000000, %"caf%c3%a9", ("a" "b");v="1", "links";v="1"',
    ),
  ).toEqual({ links: "1" });
  // v must be a String; the last v of a member wins.
  expect(
    parseExtensionsHeader(
      '"a";v=1, "b";v, "c";v=tok, "d";v="1";v="2", "e";v="2";v',
    ),
  ).toEqual({ d: "2" });
  // Escapes in Strings.
  expect(
    parseExtensionsHeader('"links";v="1";note="say \\"hi\\" \\\\"'),
  ).toEqual({ links: "1" });
  for (const bad of [
    '"operations";v=@@',
    '"operations";V="3"',
    '"operations";v="3";',
    '"operations";\tv="3"',
    '"operations";v=1234567890123456',
    '"operations";v=1234567890123.5',
    '"operations";v=1.2345',
    '"operations";v="é"',
    '"operations";v="a\\b"',
    '"operations";v=%"%zz"',
    '"operations";v=%"%ff"',
    '"operations";v="3" ,',
    ', "operations";v="3"',
    '("a" "b"',
    '("a""b")',
    '"links";v="1", -',
    '"x"'.repeat(1000),
  ])
    expect(parseExtensionsHeader(bad), bad).toEqual({});
});

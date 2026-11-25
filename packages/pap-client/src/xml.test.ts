import { describe, expect, it } from "vitest";
import {
  parseXml,
  XML_LIMITS,
  XML_NAMESPACE,
  xmlChild,
  xmlChildren,
  XmlError,
  type XmlElement,
} from "./xml.ts";

const ATOM = "http://www.w3.org/2005/Atom";
const ESPI = "http://naesb.org/espi";

/** The tree without null prototypes, for readable comparisons. */
const plain = (e: XmlElement): unknown => ({
  ns: e.ns,
  name: e.name,
  attributes: { ...e.attributes },
  text: e.text,
  children: e.children.map(plain),
});
const refused = (input: string | Uint8Array, message?: string) => {
  let error: unknown;
  try {
    parseXml(input);
  } catch (e) {
    error = e;
  }
  expect(error, String(input).slice(0, 80)).toBeInstanceOf(XmlError);
  if (message) expect((error as Error).message).toContain(message);
  return error as XmlError;
};

describe("strict XML parser: what it reads", () => {
  it("reads an Atom entry with ESPI content into a small tree", () => {
    const root = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="${ATOM}" xmlns:espi="${ESPI}">
  <title type="text">Usage &amp; cost</title>
  <entry>
    <link rel="self" href="https://u.example/r/UsagePoint/1"/>
    <content>
      <espi:UsagePoint>
        <espi:ServiceCategory><espi:kind>0</espi:kind></espi:ServiceCategory>
      </espi:UsagePoint>
    </content>
  </entry>
</feed>`);
    expect(plain(root)).toEqual({
      ns: ATOM,
      name: "feed",
      attributes: {},
      text: "",
      children: [
        {
          ns: ATOM,
          name: "title",
          attributes: { type: "text" },
          text: "Usage & cost",
          children: [],
        },
        {
          ns: ATOM,
          name: "entry",
          attributes: {},
          text: "",
          children: [
            {
              ns: ATOM,
              name: "link",
              attributes: {
                rel: "self",
                href: "https://u.example/r/UsagePoint/1",
              },
              text: "",
              children: [],
            },
            {
              ns: ATOM,
              name: "content",
              attributes: {},
              text: "",
              children: [
                {
                  ns: ESPI,
                  name: "UsagePoint",
                  attributes: {},
                  text: "",
                  children: [
                    {
                      ns: ESPI,
                      name: "ServiceCategory",
                      attributes: {},
                      text: "",
                      children: [
                        {
                          ns: ESPI,
                          name: "kind",
                          attributes: {},
                          text: "0",
                          children: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const entry = xmlChild(root, ATOM, "entry");
    expect(xmlChildren(entry, ATOM, "link")).toHaveLength(1);
    expect(xmlChild(entry, ESPI, "link")).toBeUndefined();
    expect(xmlChildren(undefined, ATOM, "link")).toEqual([]);
  });

  it("accepts a document without a declaration, and with standalone", () => {
    expect(parseXml("<a/>").name).toBe("a");
    expect(
      parseXml(`<?xml version='1.0' encoding='utf-8' standalone='yes' ?><a/>`)
        .name,
    ).toBe("a");
    expect(parseXml(`<?xml version="1.0"?>\n<a></a>\n`).name).toBe("a");
  });

  it("skips one byte order mark, in bytes or in a string", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('<?xml version="1.0"?><a>x</a>'),
    ]);
    expect(parseXml(bytes).text).toBe("x");
    expect(parseXml("\uFEFF<a>x</a>").text).toBe("x");
    // A second one is not a BOM: then the declaration isn't first.
    refused('\uFEFF\uFEFF<?xml version="1.0"?><a/>', "text outside");
  });

  it("decodes the predefined entities and character references", () => {
    expect(
      parseXml("<a>&lt;&gt;&amp;&quot;&apos; &#65;&#x42;&#x1F600;&#10;</a>")
        .text,
    ).toBe(`<>&"' AB\u{1F600}\n`);
    expect(parseXml(`<a v="&lt;b&gt; &amp; &#x9;"/>`).attributes.v).toBe(
      "<b> & \t",
    );
  });

  it("keeps text, leaving out whitespace-only runs between children", () => {
    const root = parseXml("<a>\n  <b> 5 </b>\n  <c/>\n</a>");
    expect(root.text).toBe("");
    expect(root.children.map((c) => c.text)).toEqual([" 5 ", ""]);
    // Mixed content keeps what isn't only whitespace.
    expect(parseXml("<a>x <b/> y</a>").text).toBe("x  y");
    // A whitespace character reference is text, not indentation.
    expect(parseXml("<a>&#32;</a>").text).toBe(" ");
  });

  it("normalizes line ends and attribute whitespace", () => {
    expect(parseXml("<a>1\r\n2\r3</a>").text).toBe("1\n2\n3");
    expect(parseXml('<a v="x\ty\nz&#10;"/>').attributes.v).toBe("x y z\n");
  });

  it("allows comments around and inside elements", () => {
    const root = parseXml(
      "<!-- before --><a><!-- inside -->x<!----></a><!-- after -->\n",
    );
    expect(root.text).toBe("x");
  });

  it("resolves prefixes in scope, including a nested rebinding", () => {
    const root = parseXml(
      `<p:a xmlns:p="urn:one" xmlns="urn:default" p:x="1" y="2">` +
        `<p:b xmlns:p="urn:two"><c xmlns=""/></p:b><p:d/><e/></p:a>`,
    );
    expect(root.ns).toBe("urn:one");
    expect({ ...root.attributes }).toEqual({ "{urn:one}x": "1", y: "2" });
    const [b, d, e] = root.children;
    expect(b!.ns).toBe("urn:two");
    expect(b!.children[0]!.ns).toBe("");
    expect(d!.ns).toBe("urn:one");
    expect(e!.ns).toBe("urn:default");
    // The xml prefix is built in, and may be declared with its own URI.
    const lang = parseXml(
      `<a xmlns:xml="${XML_NAMESPACE}" xml:lang="en"><xml:b/></a>`,
    );
    expect(lang.attributes[`{${XML_NAMESPACE}}lang`]).toBe("en");
    expect(lang.children[0]!.ns).toBe(XML_NAMESPACE);
  });

  it("allows the same local attribute name in two namespaces", () => {
    const root = parseXml(
      `<a xmlns:p="urn:p" xmlns:q="urn:q" p:x="1" q:x="2" x="3"/>`,
    );
    expect({ ...root.attributes }).toEqual({
      "{urn:p}x": "1",
      "{urn:q}x": "2",
      x: "3",
    });
  });

  it("gives attributes a prototype-free record", () => {
    const root = parseXml(`<a __proto__="x" constructor="y"/>`);
    expect(Object.getPrototypeOf(root.attributes)).toBeNull();
    expect(root.attributes.__proto__).toBe("x");
    expect(root.attributes.constructor).toBe("y");
  });

  it("reads up to its bounds exactly", () => {
    const depth = XML_LIMITS.depth;
    expect(() =>
      parseXml("<a>".repeat(depth) + "</a>".repeat(depth)),
    ).not.toThrow();
    expect(() =>
      parseXml(`<a>${"x".repeat(XML_LIMITS.text)}</a>`),
    ).not.toThrow();
    expect(() =>
      parseXml(`<a v="${"x".repeat(XML_LIMITS.attributeLength)}"/>`),
    ).not.toThrow();
    const attributes = Array.from(
      { length: XML_LIMITS.attributes },
      (_, i) => `a${i}="1"`,
    ).join(" ");
    expect(() => parseXml(`<a ${attributes}/>`)).not.toThrow();
    expect(() =>
      parseXml(`<a>${"<b/>".repeat(XML_LIMITS.elements - 1)}</a>`),
    ).not.toThrow();
  });
});

describe("strict XML parser: what it refuses", () => {
  it("refuses any DOCTYPE, so no entity can be defined (billion laughs)", () => {
    const laughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<lolz>&lol3;</lolz>`;
    refused(laughs, "DOCTYPE");
    refused(`<!DOCTYPE a SYSTEM "file:///etc/passwd"><a/>`, "DOCTYPE");
    refused(`<!doctype a><a/>`, "DOCTYPE");
    refused(`<a><!DOCTYPE a></a>`, "DOCTYPE");
    refused(`<a><!ENTITY x "y"></a>`, "DOCTYPE");
    refused(`<a><!ELEMENT a ANY></a>`, "DOCTYPE");
  });

  it("refuses entities other than the predefined five, and bad references", () => {
    refused("<a>&lol;</a>", "predefined");
    refused("<a>&nbsp;</a>", "predefined");
    refused("<a>&AMP;</a>", "predefined");
    refused('<a v="&ext;"/>', "predefined");
    refused("<a>&#xZZ;</a>", "predefined");
    refused("<a>&#;</a>", "predefined");
    refused("<a>&#-1;</a>", "predefined");
    refused("<a>&</a>", "unterminated reference");
    refused("<a>& amp;</a>", "predefined");
    refused("<a>&amp</a>", "unterminated reference");
    refused(`<a>&${"a".repeat(40)};</a>`, "unterminated reference");
    // References to characters XML doesn't allow.
    for (const ref of [
      "&#0;",
      "&#x0;",
      "&#8;",
      "&#xD800;",
      "&#xFFFE;",
      "&#x110000;",
      "&#99999999;",
    ])
      refused(`<a>${ref}</a>`);
  });

  it("refuses processing instructions other than the declaration", () => {
    refused(`<?xml-stylesheet href="x.xsl"?><a/>`, "processing instruction");
    refused(`<a><?php echo 1 ?></a>`, "processing instruction");
    refused(`<a/><?pi?>`, "processing instruction");
    // The declaration only opens the document, once.
    refused(` <?xml version="1.0"?><a/>`, "processing instruction");
    refused(
      `<?xml version="1.0"?><?xml version="1.0"?><a/>`,
      "processing instruction",
    );
    refused(`<a><?xml version="1.0"?></a>`, "processing instruction");
  });

  it("refuses a malformed declaration, another version or encoding", () => {
    refused(`<?xml?><a/>`, "malformed XML declaration");
    refused(`<?xml version="1.1"?><a/>`, "malformed XML declaration");
    refused(`<?xml version="1.0" encoding="ISO-8859-1"?><a/>`, "UTF-8");
    refused(`<?xml version="1.0" encoding="UTF-16"?><a/>`, "UTF-8");
    refused(`<?xml encoding="UTF-8" version="1.0"?><a/>`, "malformed");
    refused(`<?xml version="1.0" standalone="maybe"?><a/>`, "malformed");
    refused(`<?xml version="1.0'?><a/>`, "malformed");
  });

  it("refuses CDATA sections", () => {
    refused("<a><![CDATA[<b>]]></a>", "CDATA");
    refused("<a><![CDATA[x]]></a>", "CDATA");
    refused("<a>]]></a>", "']]>'");
  });

  it("refuses mismatched, unclosed and stray tags", () => {
    refused("<a><b></a></b>", "mismatched");
    refused("<a></b>", "mismatched");
    refused("<a><b></b>", "unclosed");
    refused("<a>", "unclosed");
    refused("</a>", "mismatched");
    refused("<a></a></a>", "mismatched");
    refused("<p:a xmlns:p='urn:p'></q:a>", "mismatched");
    // The same namespace under another prefix is still another tag name.
    refused("<p:a xmlns:p='urn:p' xmlns:q='urn:p'></q:a>", "mismatched");
    refused("<a></a >x", "text outside");
    refused("<a/><b/>", "content after the root");
    refused("x<a/>", "text outside");
    refused("", "no root");
    refused("   \n ", "no root");
    refused("<!-- only a comment -->", "no root");
    refused("<a", "unterminated start tag");
    refused("<a b='1'", "unterminated start tag");
    refused("< a/>", "expected a name");
    refused("<1a/>", "expected a name");
    refused("<a></ a>", "expected a name");
    refused("<a></a", "malformed end tag");
    refused("<a:b:c/>", "attributes need whitespace");
    refused(`<${"a".repeat(65)}/>`, "attributes need whitespace");
    refused("<é/>", "expected a name");
  });

  it("refuses unbalanced, unquoted, duplicate or unspaced attributes", () => {
    refused(`<a b="1/>`, "unterminated attribute");
    refused(`<a b='1"/>`, "unterminated attribute");
    refused(`<a b=1/>`, "unquoted");
    refused(`<a b/>`, "without a value");
    refused(`<a b="1" b="2"/>`, "duplicate attribute");
    refused(`<a b="1" b='1'/>`, "duplicate attribute");
    refused(`<a b="1"c="2"/>`, "whitespace between");
    refused(`<a b="<"/>`, "'<' in an attribute");
    refused(`<a b="&x;"/>`, "predefined");
    // Duplicates once namespaces are resolved.
    refused(
      `<a xmlns:p="urn:x" xmlns:q="urn:x" p:b="1" q:b="2"/>`,
      "duplicate attribute",
    );
    refused(`<a xmlns:p="urn:x" xmlns:p="urn:y"/>`, "duplicate attribute");
    refused(`<a xmlns="urn:x" xmlns="urn:y"/>`, "duplicate attribute");
  });

  it("refuses a huge attribute, or too many", () => {
    refused(
      `<a v="${"x".repeat(XML_LIMITS.attributeLength + 1)}"/>`,
      "attribute too long",
    );
    const many = Array.from(
      { length: XML_LIMITS.attributes + 1 },
      (_, i) => `a${i}="1"`,
    ).join(" ");
    refused(`<a ${many}/>`, "too many attributes");
  });

  it("refuses undeclared prefixes and reserved namespace misuse", () => {
    refused("<p:a/>", "undeclared prefix");
    refused("<a p:b='1'/>", "undeclared prefix");
    // A prefix declared on an ancestor is in scope, and still resolves.
    expect(
      parseXml("<a xmlns:p='urn:p'><b><p:c/></b></a>").children[0]!.children[0]!
        .ns,
    ).toBe("urn:p");
    // A prefix declared on a sibling isn't in scope.
    refused("<r><a xmlns:p='urn:p'/><p:b/></r>", "undeclared prefix");
    refused("<a xmlns:p=''/>", "undeclared");
    refused("<a xmlns:xmlns='urn:x'/>", "xmlns prefix");
    refused("<a xmlns:xml='urn:x'/>", "xml prefix is reserved");
    refused(`<a xmlns:p='${XML_NAMESPACE}'/>`, "xml prefix is reserved");
    refused(`<a xmlns='${XML_NAMESPACE}'/>`, "reserved namespace");
    refused(`<a xmlns:p='http://www.w3.org/2000/xmlns/'/>`, "reserved");
    refused("<xmlns:a/>", "undeclared prefix");
  });

  it("refuses characters XML doesn't allow, raw or as bytes", () => {
    refused("<a>\u0000</a>", "character not allowed");
    refused("<a>\u0008</a>", "character not allowed");
    refused("<a>\uFFFF</a>", "character not allowed");
    refused("<a>\uD800</a>", "character not allowed");
    refused('<a v="\u001B"/>', "character not allowed");
    // Invalid UTF-8 (an overlong encoding, a lone continuation byte).
    refused(
      new Uint8Array([0x3c, 0x61, 0x3e, 0xc0, 0xaf, 0x3c, 0x2f, 0x61, 0x3e]),
      "UTF-8",
    );
    refused(
      new Uint8Array([0x3c, 0x61, 0x3e, 0x80, 0x3c, 0x2f, 0x61, 0x3e]),
      "UTF-8",
    );
    // UTF-16 with its BOM is not UTF-8.
    refused(
      new Uint8Array([
        0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00, 0x2f, 0x00, 0x3e, 0x00,
      ]),
    );
  });

  it("refuses comments XML doesn't allow", () => {
    refused("<a><!-- x -- y --></a>", "comment");
    refused("<a><!-- x ---></a>", "comment");
    refused("<a><!-- x </a>", "comment");
    refused("<a><!--></a>", "comment");
  });

  it("bounds input bytes, depth, elements and text", () => {
    refused(`<a>${"x".repeat(XML_LIMITS.bytes)}</a>`, "too large");
    refused(new Uint8Array(XML_LIMITS.bytes + 1), "too large");
    // Multi-byte characters count as their UTF-8 bytes.
    refused(`<a>${"é".repeat(XML_LIMITS.bytes / 2)}</a>`, "too large");
    const depth = XML_LIMITS.depth + 1;
    refused("<a>".repeat(depth) + "</a>".repeat(depth), "nested too deeply");
    // Deep nesting that never closes stops at the depth, not at the end.
    refused("<a>".repeat(100_000), "nested too deeply");
    refused(
      `<a>${"<b/>".repeat(XML_LIMITS.elements)}</a>`,
      "too many elements",
    );
    refused(`<a>${"x".repeat(XML_LIMITS.text + 1)}</a>`, "text too long");
    // Text split by children still counts as one element's text.
    refused(
      `<a>${`${"x".repeat(XML_LIMITS.text / 2)}<b/>`.repeat(3)}</a>`,
      "text too long",
    );
    // Entity-free expansion: references grow nothing beyond the bound.
    refused(`<a>${"&amp;".repeat(XML_LIMITS.text + 1)}</a>`, "text too long");
  });

  it("takes tighter limits from the caller", () => {
    expect(() => parseXml("<a><b/></a>", { elements: 1 })).toThrow(XmlError);
    expect(() => parseXml("<a><b/></a>", { depth: 1 })).toThrow(XmlError);
    expect(() => parseXml("<a>xyz</a>", { text: 2 })).toThrow(XmlError);
    expect(() => parseXml("<a/>", { bytes: 3 })).toThrow(XmlError);
    expect(() => parseXml("<a b='1' c='2'/>", { attributes: 1 })).toThrow(
      XmlError,
    );
  });

  it("never quotes the input in its errors", () => {
    const error = refused("<a>&secret-token-value;</a>");
    expect(error.message).not.toContain("secret");
    expect(refused("<p:a/>").message).not.toContain("p:a");
  });

  it("refuses inputs that are neither text nor bytes", () => {
    expect(() => parseXml(42 as unknown as string)).toThrow(XmlError);
  });
});

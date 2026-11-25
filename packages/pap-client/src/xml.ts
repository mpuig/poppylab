/**
 * A strict XML 1.0 parser for the subset an ESPI-shaped Atom feed uses,
 * with no dependency. Company XML is untrusted input (§10.1), so anything
 * outside the subset is refused rather than skipped:
 *
 * - No `<!DOCTYPE` or other `<!` declaration, so no DTD, internal subset or
 *   entity definition can exist. References are only the five predefined
 *   entities (`&lt;` `&gt;` `&amp;` `&quot;` `&apos;`) and numeric character
 *   references to characters XML allows.
 * - No processing instruction other than the XML declaration, which may only
 *   open the document (after an optional byte order mark), with version 1.0
 *   and, when given, encoding UTF-8.
 * - No CDATA section: ESPI content is numbers, codes and short text, so
 *   escaped character data is enough.
 * - Well-formed elements: matching end tags, one root, nothing but
 *   whitespace and comments around it, quoted attribute values without `<`,
 *   whitespace between attributes, and no duplicate attribute, either as
 *   written or once namespaces are resolved.
 * - Namespaces: every prefix used is declared in scope (`xml` is built in);
 *   `xmlns:p=""` and redeclaring `xml` or `xmlns` are refused. A prefix may
 *   be bound again to another URI in a nested element, as XML allows.
 * - Bounds: input bytes, depth, element count, attributes per element,
 *   attribute value length and text length per element (`XML_LIMITS`).
 *
 * Errors are `XmlError`, whose message never quotes the input.
 */

export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

export type XmlLimits = {
  /** UTF-8 bytes of the whole document. */
  bytes: number;
  /** Elements open at once, the root included. */
  depth: number;
  /** Elements in the document. */
  elements: number;
  /** Characters of text kept for one element. */
  text: number;
  /** Attributes on one element, namespace declarations included. */
  attributes: number;
  /** Characters of one attribute value, as written. */
  attributeLength: number;
};
export const XML_LIMITS: XmlLimits = {
  bytes: 1_000_000,
  depth: 32,
  elements: 50_000,
  text: 4096,
  attributes: 16,
  attributeLength: 2048,
};

export interface XmlElement {
  /** The namespace URI, or "" for none. */
  ns: string;
  /** The local name, without a prefix. */
  name: string;
  /**
   * Attribute values by local name for unprefixed attributes, and as
   * `{uri}local` for namespaced ones. Namespace declarations aren't kept.
   */
  attributes: Record<string, string>;
  children: XmlElement[];
  /**
   * The character data directly inside, references decoded. A run of
   * whitespace only, such as indentation between children, is left out.
   */
  text: string;
}

export class XmlError extends Error {
  constructor(message: string) {
    super(`Refused XML: ${message}`);
    this.name = "XmlError";
  }
}
function fail(message: string): never {
  throw new XmlError(message);
}

/** Characters XML 1.0 doesn't allow, lone surrogates included. */
const INVALID_CHAR = /[^\t\n\x20-퟿-�\u{10000}-\u{10FFFF}]/u;
const NAME =
  /(?:([A-Za-z_][A-Za-z0-9._-]{0,63}):)?([A-Za-z_][A-Za-z0-9._-]{0,63})/y;
const SPACE = /[ \t\n]+/y;
const DECLARATION =
  /^<\?xml[ \t\n]+version[ \t\n]*=[ \t\n]*(["'])1\.0\1(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(["'])([A-Za-z][A-Za-z0-9._-]{0,39})\2)?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(["'])(?:yes|no)\4)?[ \t\n]*\?>/;
const PREDEFINED: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};
const allowedChar = (code: number) =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  (code >= 0x10000 && code <= 0x10ffff);

/** Decodes the references in character data or an attribute value. */
function references(raw: string): string {
  if (!raw.includes("&")) return raw;
  let out = "";
  let at = 0;
  for (;;) {
    const amp = raw.indexOf("&", at);
    if (amp === -1) return out + raw.slice(at);
    out += raw.slice(at, amp);
    const semi = raw.indexOf(";", amp);
    if (semi === -1 || semi - amp > 10) fail("unterminated reference");
    const ref = raw.slice(amp + 1, semi);
    const named = Object.hasOwn(PREDEFINED, ref) ? PREDEFINED[ref] : undefined;
    if (named !== undefined) out += named;
    else {
      const code = /^#[0-9]{1,7}$/.test(ref)
        ? Number.parseInt(ref.slice(1), 10)
        : /^#x[0-9A-Fa-f]{1,6}$/.test(ref)
          ? Number.parseInt(ref.slice(2), 16)
          : fail("only the predefined entities and character references");
      if (!allowedChar(code)) fail("character reference not allowed");
      out += String.fromCodePoint(code);
    }
    at = semi + 1;
  }
}

type Open = {
  element: XmlElement;
  qname: string;
  scope: ReadonlyMap<string, string>;
};

/**
 * Parses a whole document into its root element, or throws `XmlError`.
 * Bytes are decoded as UTF-8, refusing invalid sequences.
 */
export function parseXml(
  input: string | Uint8Array,
  options: Partial<XmlLimits> = {},
): XmlElement {
  const limits = { ...XML_LIMITS, ...options };
  let source: string;
  if (typeof input === "string") {
    if (
      input.length > limits.bytes ||
      new TextEncoder().encode(input).byteLength > limits.bytes
    )
      fail("document too large");
    source = input;
  } else {
    if (!(input instanceof Uint8Array)) fail("not text");
    if (input.byteLength > limits.bytes) fail("document too large");
    try {
      source = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(input);
    } catch {
      return fail("not UTF-8");
    }
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  // §2.11: line ends become a single line feed before parsing.
  source = source.replace(/\r\n?/g, "\n");
  if (INVALID_CHAR.test(source)) fail("character not allowed");

  let pos = 0;
  const declaration = source.startsWith("<?xml")
    ? DECLARATION.exec(source)
    : null;
  if (declaration) {
    if (
      declaration[3] !== undefined &&
      declaration[3].toLowerCase() !== "utf-8"
    )
      fail("encoding other than UTF-8");
    pos = declaration[0].length;
  } else if (/^<\?xml[ \t\n?]/.test(source)) fail("malformed XML declaration");

  const stack: Open[] = [];
  let root: XmlElement | undefined;
  let elements = 0;
  const rootScope: ReadonlyMap<string, string> = new Map([
    ["xml", XML_NAMESPACE],
  ]);
  const space = () => {
    SPACE.lastIndex = pos;
    if (!SPACE.test(source)) return false;
    pos = SPACE.lastIndex;
    return true;
  };
  const name = () => {
    NAME.lastIndex = pos;
    const m = NAME.exec(source);
    if (!m) return fail("expected a name");
    pos = NAME.lastIndex;
    return { qname: m[0], prefix: m[1], local: m[2]! };
  };

  while (pos < source.length) {
    if (source.charCodeAt(pos) !== 0x3c /* < */) {
      let end = source.indexOf("<", pos);
      if (end === -1) end = source.length;
      const raw = source.slice(pos, end);
      pos = end;
      const top = stack.at(-1);
      if (!top) {
        if (!/^[ \t\n]*$/.test(raw)) fail("text outside the root element");
        continue;
      }
      if (raw.includes("]]>")) fail("']]>' in text");
      const text = references(raw);
      if (/^[ \t\n]*$/.test(raw)) continue;
      top.element.text += text;
      if (top.element.text.length > limits.text) fail("text too long");
      continue;
    }
    if (source.startsWith("<!--", pos)) {
      const end = source.indexOf("--", pos + 4);
      if (end === -1 || source[end + 2] !== ">")
        fail("malformed or unterminated comment");
      pos = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", pos)) fail("CDATA section");
    if (source.startsWith("<!", pos)) fail("DOCTYPE or other declaration");
    if (source.startsWith("<?", pos)) fail("processing instruction");
    if (source.startsWith("</", pos)) {
      pos += 2;
      const { qname } = name();
      space();
      if (source[pos] !== ">") fail("malformed end tag");
      pos += 1;
      const open = stack.pop();
      if (!open || open.qname !== qname) fail("mismatched end tag");
      continue;
    }

    // A start tag.
    if (root && stack.length === 0) fail("content after the root element");
    pos += 1;
    const tag = name();
    const written: Array<{
      qname: string;
      prefix: string | undefined;
      local: string;
      value: string;
    }> = [];
    let selfClosing = false;
    for (;;) {
      const spaced = space();
      if (source[pos] === ">") {
        pos += 1;
        break;
      }
      if (source.startsWith("/>", pos)) {
        pos += 2;
        selfClosing = true;
        break;
      }
      if (pos >= source.length) fail("unterminated start tag");
      if (!spaced) fail("attributes need whitespace between them");
      const attribute = name();
      space();
      if (source[pos] !== "=") fail("attribute without a value");
      pos += 1;
      space();
      const quote = source[pos];
      if (quote !== '"' && quote !== "'") fail("unquoted attribute value");
      const end = source.indexOf(quote!, pos + 1);
      if (end === -1) fail("unterminated attribute value");
      const raw = source.slice(pos + 1, end);
      pos = end + 1;
      if (raw.length > limits.attributeLength) fail("attribute too long");
      if (raw.includes("<")) fail("'<' in an attribute value");
      if (written.some((a) => a.qname === attribute.qname))
        fail("duplicate attribute");
      if (written.length >= limits.attributes) fail("too many attributes");
      // §3.3.3: literal whitespace becomes a space; references stay.
      written.push({
        ...attribute,
        value: references(raw.replace(/[\t\n]/g, " ")),
      });
    }

    elements += 1;
    if (elements > limits.elements) fail("too many elements");
    if (stack.length + 1 > limits.depth) fail("nested too deeply");

    // Namespace declarations first, then names resolved in the new scope.
    const parent = stack.at(-1)?.scope ?? rootScope;
    let scope: Map<string, string> | undefined;
    const declare = (prefix: string, uri: string) => {
      scope ??= new Map(parent);
      scope.set(prefix, uri);
    };
    for (const a of written) {
      if (a.prefix === undefined && a.local === "xmlns") {
        if (a.value === XML_NAMESPACE || a.value === XMLNS_NAMESPACE)
          fail("reserved namespace as default");
        declare("", a.value);
      } else if (a.prefix === "xmlns") {
        if (a.local === "xmlns") fail("the xmlns prefix can't be declared");
        if (a.value === "") fail("a prefix can't be undeclared");
        if ((a.local === "xml") !== (a.value === XML_NAMESPACE))
          fail("the xml prefix is reserved");
        if (a.value === XMLNS_NAMESPACE) fail("reserved namespace");
        declare(a.local, a.value);
      }
    }
    const inScope: ReadonlyMap<string, string> = scope ?? parent;
    const resolve = (prefix: string | undefined, element: boolean) => {
      if (prefix === undefined) return element ? (inScope.get("") ?? "") : "";
      const uri = inScope.get(prefix);
      if (uri === undefined || uri === "") return fail("undeclared prefix");
      return uri;
    };
    const attributes: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    for (const a of written) {
      if (
        a.prefix === "xmlns" ||
        (a.prefix === undefined && a.local === "xmlns")
      )
        continue;
      const uri = resolve(a.prefix, false);
      const key = uri ? `{${uri}}${a.local}` : a.local;
      if (Object.hasOwn(attributes, key)) fail("duplicate attribute");
      attributes[key] = a.value;
    }
    const element: XmlElement = {
      ns: resolve(tag.prefix, true),
      name: tag.local,
      attributes,
      children: [],
      text: "",
    };
    const top = stack.at(-1);
    if (top) top.element.children.push(element);
    else root = element;
    if (!selfClosing) stack.push({ element, qname: tag.qname, scope: inScope });
  }
  if (stack.length) fail("unclosed element");
  if (!root) fail("no root element");
  return root!;
}

/** The first child with this namespace and local name. */
export const xmlChild = (
  parent: XmlElement | undefined,
  ns: string,
  name: string,
) => parent?.children.find((c) => c.ns === ns && c.name === name);
/** Every child with this namespace and local name, in document order. */
export const xmlChildren = (
  parent: XmlElement | undefined,
  ns: string,
  name: string,
) => parent?.children.filter((c) => c.ns === ns && c.name === name) ?? [];

/**
 * A small writer for the Atom documents of the ESPI-shaped API: elements
 * built from escaped text, never from strings spliced into markup, and the
 * feed and entry shapes ESPI uses. Each entry has `id` (a `urn:uuid:`
 * derived from what it describes, so it never changes), `title`,
 * `published`, `updated`, `self` and `up` links (and `related` ones) whose
 * `type` names the ESPI resource, and a bare `content` whose one child is
 * the ESPI object. No `author`, no feed-level `published`, as ESPI feeds.
 */
import { createHash } from "node:crypto";
import { rfc3339 } from "./time.ts";

export const ATOM_NS = "http://www.w3.org/2005/Atom";
export const ESPI_NS = "http://naesb.org/espi";
export const CUSTOMER_NS = "http://naesb.org/espi/customer";
export const ATOM_TYPE = "application/atom+xml";

/** Serialized markup. Only `el` makes it, so text is always escaped. */
export type Xml = { readonly xml: string };
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
/** Whether XML 1.0 can carry a character (tab, newlines, and from space). */
const allowed = (c: string) => {
  const code = c.codePointAt(0)!;
  return (
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 32 && code !== 0xfffe && code !== 0xffff)
  );
};
export const escapeXml = (text: string) =>
  // Characters XML 1.0 can't carry are dropped rather than escaped.
  [...text]
    .filter(allowed)
    .join("")
    .replace(/[&<>"']/g, (c) => ESCAPES[c]!);
type Child = Xml | string | number | undefined | false;
/** An element: its attributes, then children (text is escaped). */
export function el(
  name: string,
  attributes: Record<string, string> | null,
  ...children: Child[]
): Xml {
  const attrs = Object.entries(attributes ?? {})
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
  const body = children
    .filter((child) => child !== undefined && child !== false)
    .map((child) =>
      typeof child === "object" ? child.xml : escapeXml(String(child)),
    )
    .join("");
  return {
    xml: body ? `<${name}${attrs}>${body}</${name}>` : `<${name}${attrs}/>`,
  };
}
/** An ESPI element (`espi:` prefix) with children or one text value. */
export const espi = (name: string, ...children: Child[]) =>
  el(`espi:${name}`, null, ...children);
export const cust = (name: string, ...children: Child[]) =>
  el(`cust:${name}`, null, ...children);

/** A name-based UUID (RFC 9562 version 5 layout, from SHA-256). */
export function uuidFor(name: string) {
  const hex = createHash("sha256").update(name).digest("hex").slice(0, 32);
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type Link = {
  rel: "self" | "up" | "related";
  type: string;
  href: string;
};
export type Entry = {
  /** What the ID is derived from: stable for the same resource. */
  key: string;
  title: string;
  published: number;
  updated: number;
  links: Link[];
  content: Xml;
};
const link = ({ rel, type, href }: Link) => el("link", { href, rel, type });
const entryBody = (entry: Entry) => [
  el("id", null, `urn:uuid:${uuidFor(entry.key)}`),
  el("title", null, entry.title),
  el("published", null, rfc3339(entry.published)),
  el("updated", null, rfc3339(entry.updated)),
  ...entry.links.map(link),
  el("content", null, entry.content),
];
type Namespaces = "usage" | "customer";
const namespaces = (kind: Namespaces) => ({
  xmlns: ATOM_NS,
  ...(kind === "usage"
    ? { "xmlns:espi": ESPI_NS }
    : { "xmlns:cust": CUSTOMER_NS }),
});
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** A whole feed document. `updated` is its newest entry's (or `empty`). */
export function feedDocument(input: {
  key: string;
  title: string;
  self: { href: string; type: string };
  entries: Entry[];
  empty: number;
  rights: string;
  kind?: Namespaces;
}) {
  const updated = input.entries.reduce(
    (latest, entry) => Math.max(latest, entry.updated),
    input.entries.length ? 0 : input.empty,
  );
  const feed = el(
    "feed",
    namespaces(input.kind ?? "usage"),
    el("id", null, `urn:uuid:${uuidFor(input.key)}`),
    el("title", null, input.title),
    el("updated", null, rfc3339(updated)),
    el("rights", null, input.rights),
    link({ rel: "self", ...input.self }),
    ...input.entries.map((entry) => ({
      xml: `\n${el("entry", null, ...entryBody(entry)).xml}`,
    })),
  );
  return `${DECLARATION}${feed.xml}\n`;
}
/** One entry as a whole document. */
export function entryDocument(entry: Entry, rights: string, kind?: Namespaces) {
  return `${DECLARATION}${el("entry", namespaces(kind ?? "usage"), ...entryBody(entry), el("rights", null, rights)).xml}\n`;
}

/**
 * Test-only: a small, strict XML reader for the Atom documents Fernwick
 * writes. It throws on anything that isn't well-formed (mismatched tags,
 * unquoted attributes, unknown entities, text outside the root, a DOCTYPE)
 * and resolves namespaces, so tests check elements by namespace and local
 * name rather than by prefix.
 */
export type XmlElement = {
  ns: string;
  local: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
};
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decode = (raw: string) =>
  raw.replace(/&([a-z]+|#\d+|#x[0-9a-f]+);|&/gi, (match, name?: string) => {
    if (!name) throw new Error("bare &");
    if (name.startsWith("#x"))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#"))
      return String.fromCodePoint(Number(name.slice(1)));
    const value = ENTITIES[name];
    if (value === undefined) throw new Error(`unknown entity ${match}`);
    return value;
  });
const NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;

export function parseXml(source: string): XmlElement {
  let i = 0;
  if (source.startsWith("<?xml")) {
    const end = source.indexOf("?>");
    if (end < 0) throw new Error("unterminated declaration");
    i = end + 2;
  }
  if (/<!DOCTYPE|<\?(?!xml )/i.test(source.slice(i)))
    throw new Error("DOCTYPE or PI");
  type Open = { el: XmlElement; raw: string; scope: Record<string, string> };
  const stack: Open[] = [];
  let root: XmlElement | undefined;
  const resolve = (
    qname: string,
    scope: Record<string, string>,
    attr: boolean,
  ) => {
    const [prefix, local] = qname.includes(":")
      ? qname.split(":")
      : ["", qname];
    if (attr && !prefix) return { ns: "", local: local! };
    const ns = scope[prefix!];
    if (ns === undefined) throw new Error(`unbound prefix ${prefix}`);
    return { ns, local: local! };
  };
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const text = source.slice(i, lt < 0 ? source.length : lt);
    if (text) {
      if (!stack.length) {
        if (text.trim()) throw new Error("text outside the root");
      } else stack.at(-1)!.el.text += decode(text);
    }
    if (lt < 0) break;
    const gt = source.indexOf(">", lt);
    if (gt < 0) throw new Error("unterminated tag");
    const tag = source.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith("!--")) {
      const end = source.indexOf("-->", lt);
      if (end < 0) throw new Error("unterminated comment");
      i = end + 3;
      continue;
    }
    if (tag.startsWith("/")) {
      const open = stack.pop();
      if (!open || open.raw !== tag.slice(1).trim())
        throw new Error(`mismatched </${tag.slice(1)}>`);
      if (!stack.length) root = open.el;
      continue;
    }
    if (root) throw new Error("content after the root");
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch || !NAME.test(nameMatch[1]!))
      throw new Error(`bad name in <${tag}>`);
    const raw = nameMatch[1]!;
    const rest = body.slice(raw.length);
    const attrs: Record<string, string> = {};
    const attrRe = /\s+([^\s=]+)="([^"<]*)"/y;
    let pos = 0;
    while (pos < rest.trimEnd().length) {
      attrRe.lastIndex = pos;
      const m = attrRe.exec(rest);
      if (!m) throw new Error(`bad attributes in <${tag}>`);
      if (Object.hasOwn(attrs, m[1]!)) throw new Error("duplicate attribute");
      attrs[m[1]!] = decode(m[2]!);
      pos = attrRe.lastIndex;
    }
    const scope = { ...(stack.at(-1)?.scope ?? {}) };
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "xmlns") scope[""] = value;
      else if (name.startsWith("xmlns:")) scope[name.slice(6)] = value;
    }
    const { ns, local } = resolve(raw, scope, false);
    const plain: Record<string, string> = {};
    for (const [name, value] of Object.entries(attrs))
      if (name !== "xmlns" && !name.startsWith("xmlns:"))
        plain[resolve(name, scope, true).local] = value;
    const el: XmlElement = { ns, local, attrs: plain, children: [], text: "" };
    stack.at(-1)?.el.children.push(el);
    if (selfClosing) {
      if (!stack.length) root = el;
    } else stack.push({ el, raw, scope });
  }
  if (stack.length || !root) throw new Error("unclosed element");
  return root;
}

/** Children of `el` with a local name (and namespace, when given). */
export const kids = (el: XmlElement, local: string, ns?: string) =>
  el.children.filter(
    (c) => c.local === local && (ns === undefined || c.ns === ns),
  );
export const kid = (el: XmlElement, local: string, ns?: string) => {
  const found = kids(el, local, ns);
  if (found.length !== 1)
    throw new Error(`expected one ${local}, found ${found.length}`);
  return found[0]!;
};
/** The text of a path of single children, such as `["timePeriod", "start"]`. */
export const textAt = (el: XmlElement, ...path: string[]) =>
  path.reduce((node, name) => kid(node, name), el).text;

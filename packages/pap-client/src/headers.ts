/**
 * PAP 1.0 §3.4: `Poppy-Version` and `Poppy-Extensions`, sent on every
 * request with the Session header and the same throughout a Session.
 * `Poppy-Extensions` is an RFC 9651 List of Strings, each an extension name
 * with the version used in a String `v` parameter.
 */
export const POPPY_VERSION = "1.0";

const NAME = /^[A-Za-z0-9._~/-]{1,128}$/;
const VERSION = /^[A-Za-z0-9._-]{1,16}$/;

/**
 * Builds the header from extension name → version, one List member per
 * extension, in code-unit order so the value doesn't depend on the locale.
 * Names and versions outside the safe character sets are left out; the ones
 * kept need no escaping in an RFC 9651 String.
 */
export function extensionsHeader(declared: Record<string, string>) {
  return Object.entries(declared)
    .filter(([name, v]) => NAME.test(name) && VERSION.test(v))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, v]) => `"${name}";v="${v}"`)
    .join(", ");
}

/** RFC 9651 §4.2.3.1 bare items other than Strings, matched at the start. */
const BARE = [
  /^-?\d+(?:\.\d+)?/, // Integer or Decimal, lengths checked below
  /^[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*/, // Token
  /^:[A-Za-z0-9+/=]*:/, // Byte Sequence
  /^\?[01]/, // Boolean
  /^@-?\d{1,15}/, // Date
  /^%"(?:[\x20\x21\x23\x24\x26-\x7e]|%[0-9a-f]{2})*"/, // Display String
];
const numberFits = (n: string) => {
  const [whole, fraction] = n.replace(/^-/, "").split(".");
  return fraction === undefined
    ? whole!.length <= 15
    : whole!.length <= 12 && fraction.length <= 3;
};

/**
 * Parses `Poppy-Extensions`. A header that fails to parse as an RFC 9651
 * List declares no extensions (§3.4). Members that aren't Strings, such as
 * Tokens or Inner Lists, and parameters other than a String `v`, declare
 * nothing but don't stop the rest; the last `v` of a member wins (RFC 9651 §4.2.3.2).
 */
export function parseExtensionsHeader(value: unknown): Record<string, string> {
  if (typeof value !== "string" || value.length > 2048) return {};
  // HTTP strips surrounding whitespace from a field value.
  const input = value.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!input) return {};
  const out: Record<string, string> = {};
  let i = 0;
  const fail = (): never => {
    throw Error();
  };
  const string = () => {
    let s = "";
    for (i++; i < input.length; i++) {
      const ch = input[i]!;
      if (ch === "\\") {
        const next = input[++i];
        if (next !== '"' && next !== "\\") fail();
        s += next;
      } else if (ch === '"') {
        i++;
        return s;
      } else if (ch < " " || ch > "~") fail();
      else s += ch;
    }
    return fail();
  };
  /** A String's value; other bare items are checked and give undefined. */
  const bareItem = (): string | undefined => {
    if (input[i] === '"') return string();
    const rest = input.slice(i);
    const kind = BARE.findIndex((re) => re.test(rest));
    const item = kind < 0 ? fail() : BARE[kind]!.exec(rest)![0];
    if (kind === 0 && !numberFits(item)) fail();
    if (kind === BARE.length - 1)
      try {
        decodeURIComponent(item.slice(2, -1));
      } catch {
        fail();
      }
    i += item.length;
    return undefined;
  };
  /** Parameters; returns the String value of the last `v`, if any. */
  const parameters = () => {
    let version: string | undefined;
    while (input[i] === ";") {
      i++;
      while (input[i] === " ") i++;
      const key = /^[a-z*][a-z0-9_.*-]*/.exec(input.slice(i)) ?? fail();
      i += key[0].length;
      let param: string | undefined;
      if (input[i] === "=") {
        i++;
        param = bareItem();
      }
      if (key[0] === "v") version = param;
    }
    return version;
  };
  try {
    while (i < input.length) {
      if (input[i] === "(") {
        // An Inner List is valid syntax but not a String: it declares nothing.
        i++;
        while (true) {
          while (input[i] === " ") i++;
          if (input[i] === ")") {
            i++;
            break;
          }
          if (i >= input.length) fail();
          bareItem();
          parameters();
          if (input[i] !== " " && input[i] !== ")") fail();
        }
        parameters();
      } else {
        const name = input[i] === '"' ? string() : (bareItem(), undefined);
        const version = parameters();
        if (
          name !== undefined &&
          NAME.test(name) &&
          version &&
          VERSION.test(version)
        )
          out[name] = version;
      }
      while (input[i] === " " || input[i] === "\t") i++;
      if (i >= input.length) break;
      if (input[i] !== ",") fail();
      i++;
      while (input[i] === " " || input[i] === "\t") i++;
      if (i >= input.length) fail();
    }
  } catch {
    return {};
  }
  return out;
}

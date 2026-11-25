/**
 * PAP 1.0 §3.4: `Poppy-Version` and `Poppy-Extensions`, sent on every
 * request with the Session header and the same throughout a Session.
 * `Poppy-Extensions` is an RFC 9651 List of Strings, each an extension name
 * with the version used in a String `v` parameter.
 */
export const POPPY_VERSION = "1.0";

const NAME = /^[A-Za-z0-9._~/-]{1,128}$/;
const VERSION = /^[A-Za-z0-9._-]{1,16}$/;

/** Builds the header from extension name → version, in a stable order. */
export function extensionsHeader(declared: Record<string, string>) {
  return Object.entries(declared)
    .filter(([name, v]) => NAME.test(name) && VERSION.test(v))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, v]) => `"${name}";v="${v}"`)
    .join(", ");
}

/**
 * Parses `Poppy-Extensions`. A header that fails to parse declares no
 * extensions (§3.4); unknown parameters are ignored.
 */
export function parseExtensionsHeader(value: unknown): Record<string, string> {
  if (typeof value !== "string" || !value.trim() || value.length > 2048)
    return {};
  const out: Record<string, string> = {};
  let i = 0;
  const ows = () => {
    while (value[i] === " " || value[i] === "\t") i++;
  };
  const string = () => {
    if (value[i] !== '"') throw Error();
    let s = "";
    for (i++; i < value.length; i++) {
      const ch = value[i]!;
      if (ch === "\\") {
        const next = value[++i];
        if (next !== '"' && next !== "\\") throw Error();
        s += next;
      } else if (ch === '"') {
        i++;
        return s;
      } else if (ch < " " || ch > "~") throw Error();
      else s += ch;
    }
    throw Error();
  };
  const bareValue = () => {
    if (value[i] === '"') return string();
    const m = /^[^,;\s]+/.exec(value.slice(i));
    if (!m) throw Error();
    i += m[0].length;
    return undefined;
  };
  try {
    ows();
    while (i < value.length) {
      const name = string();
      let version: string | undefined;
      while (value[i] === ";") {
        i++;
        ows();
        const key = /^[a-z*][a-z0-9_.*-]*/.exec(value.slice(i));
        if (!key) throw Error();
        i += key[0].length;
        let param: string | undefined;
        if (value[i] === "=") {
          i++;
          param = bareValue();
        }
        if (key[0] === "v") version = param;
      }
      if (NAME.test(name) && version && VERSION.test(version))
        out[name] = version;
      ows();
      if (i >= value.length) break;
      if (value[i] !== ",") throw Error();
      i++;
      ows();
      if (i >= value.length) throw Error();
    }
  } catch {
    return {};
  }
  return out;
}

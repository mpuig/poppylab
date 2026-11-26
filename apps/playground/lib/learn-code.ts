/**
 * The code on the Learn pages: a little colour, and numbered notes.
 *
 * Colour is a small closed set of token kinds, not a theme. The stylesheet
 * (`learn.css`) gives each kind one of the site's own inks, so the colour
 * says what a piece of the code is and never decorates it:
 *
 *   k  a name: a JSON key, a header, a tag
 *   s  a value written as a string, an attribute's value
 *   n  a number, a literal, an attribute's name
 *   p  punctuation, an ellipsis
 *   c  a comment
 *   m  the method of a request, the status of a response
 *
 * It is done at build time on our own Markdown. Nothing here runs in the
 * browser, and every piece of text is escaped before it is put in a span.
 *
 * A block can carry numbered notes. A line that ends in a comment holding a
 * number in brackets (`// (1)`, `# (1)`, `<!-- (1) -->`) is a line a note is
 * about; the comment is not shown, a mark is drawn in its place, and the
 * ordered list that follows the block is the legend of the marks. The notes
 * read the same on GitHub, where the comment is just a comment.
 */
type Kind = "k" | "s" | "n" | "p" | "c" | "m";

const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A span of one kind. A token that crosses lines is a span on each line. */
const tk = (kind: Kind, text: string) =>
  text
    .split("\n")
    .map((part) => (part ? `<span class="tk-${kind}">${esc(part)}</span>` : ""))
    .join("\n");

/** Walks `code` with a pattern; `token` colours a match, the rest is plain. */
function walk(
  code: string,
  pattern: RegExp,
  token: (match: RegExpMatchArray) => string,
) {
  let out = "";
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    out += esc(code.slice(last, match.index));
    out += token(match);
    last = match.index + match[0].length;
  }
  return out + esc(code.slice(last));
}

/** JSON, with the `//` comments and the `…` that our samples use. */
function json(code: string) {
  const pattern =
    /(\/\/[^\n]*)|("(?:\\.|[^"\\\n])*")([ \t]*:)?|(?<![\w.])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w.])|\b(true|false|null)\b|([{}[\],:])|(…)/g;
  return walk(code, pattern, (m) => {
    if (m[1] !== undefined) return tk("c", m[1]);
    if (m[2] !== undefined)
      return m[3]
        ? tk("k", m[2]) + esc(m[3].slice(0, -1)) + tk("p", ":")
        : tk("s", m[2]);
    if (m[4] !== undefined || m[5] !== undefined) return tk("n", m[0]);
    return tk("p", m[0]);
  });
}

/** The value of a header: quoted strings are values, the rest is plain. */
function headerValue(text: string) {
  return walk(text, /"[^"\n]*"|…/g, (m) =>
    m[0] === "…" ? tk("p", "…") : tk("s", m[0]),
  );
}

const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

/** An HTTP request or response: its first line, its headers, then its body. */
function http(code: string) {
  const lines = code.split("\n");
  const blank = lines.indexOf("");
  const head = blank < 0 ? lines : lines.slice(0, blank);
  const body = blank < 0 ? [] : lines.slice(blank + 1);
  const out = head.map((line) => {
    // Groups that are not optional in a pattern are always there.
    const g = (m: RegExpExecArray, i: number) => m[i] ?? "";
    let m = new RegExp(`^(${METHODS})(\\s+)(\\S+)(.*)$`).exec(line);
    if (m) return tk("m", g(m, 1)) + esc(g(m, 2) + g(m, 3)) + tk("p", g(m, 4));
    m = /^(HTTP\/\d(?:\.\d)?)(\s+)(\d{3})(.*)$/.exec(line);
    if (m)
      return tk("p", g(m, 1)) + esc(g(m, 2)) + tk("m", g(m, 3)) + esc(g(m, 4));
    m = /^([A-Za-z][\w-]*)(:)(.*)$/.exec(line);
    if (m) return tk("k", g(m, 1)) + tk("p", ":") + headerValue(g(m, 3));
    return esc(line);
  });
  if (blank >= 0) {
    out.push("");
    const text = body.join("\n");
    out.push(/^\s*[{[]/.test(text) ? json(text) : esc(text));
  }
  return out.join("\n");
}

/** XML: tags, attributes and comments; text between tags is plain. */
function xml(code: string) {
  const pattern =
    /(<!--[\s\S]*?-->)|(<\?[\s\S]*?\?>)|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  return walk(code, pattern, (m) => {
    if (m[1] !== undefined) return tk("c", m[1]);
    if (m[2] !== undefined) return tk("p", m[2]);
    const attributes = walk(
      m[5] ?? "",
      /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g,
      (a) => tk("n", a[1] ?? "") + tk("p", a[2] ?? "") + tk("s", a[3] ?? ""),
    );
    return (
      tk("p", `<${m[3]}`) + tk("k", m[4]!) + attributes + tk("p", `${m[6]}>`)
    );
  });
}

const TS_WORDS =
  "const|let|var|function|return|await|async|if|else|for|of|in|new|import|from|export|type|interface|class|throw|try|catch|true|false|null|undefined";

/** Shell and TypeScript: comments, strings, numbers, and the words that matter. */
function script(code: string, lang: "sh" | "ts") {
  const comment =
    lang === "sh" ? "#[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const words =
    lang === "sh" ? "\\$\\w+|--?[A-Za-z][\\w-]*" : `\\b(?:${TS_WORDS})\\b`;
  const pattern = new RegExp(
    `(${comment})|("(?:\\\\.|[^"\\\\\\n])*"|'[^'\\n]*'|\`[^\`]*\`)|(?<![\\w.])(\\d+(?:\\.\\d+)?)(?![\\w.])|(${words})`,
    "g",
  );
  return walk(code, pattern, (m) => {
    if (m[1] !== undefined) return tk("c", m[1]);
    if (m[2] !== undefined) return tk("s", m[2]);
    if (m[3] !== undefined) return tk("n", m[3]);
    return tk(lang === "sh" && m[4]!.startsWith("-") ? "n" : "k", m[4]!);
  });
}

/** The code as HTML, coloured by language. Other languages stay plain. */
export function highlight(code: string, language?: string) {
  switch ((language ?? "").toLowerCase()) {
    case "json":
    case "jsonc":
      return json(code);
    case "http":
      return http(code);
    case "xml":
    case "html":
      return xml(code);
    case "sh":
    case "bash":
    case "shell":
      return script(code, "sh");
    case "ts":
    case "typescript":
      return script(code, "ts");
    default:
      return esc(code);
  }
}

/** A line's trailing note: `// (1)`, `# (1)` or `<!-- (1) -->`. */
const NOTE = /[ \t]*(?:\/\/|#|<!--)[ \t]*\((\d{1,2})\)[ \t]*(?:-->)?[ \t]*$/;

/** The notes in a block: the code without them, and the line of each. */
export function readNotes(code: string) {
  const notes: { line: number; n: number }[] = [];
  const lines = code.split("\n").map((line, i) => {
    const m = NOTE.exec(line);
    if (!m) return line;
    notes.push({ line: i, n: Number(m[1]) });
    return line.slice(0, m.index);
  });
  return { code: lines.join("\n"), notes };
}

/** A fenced block as HTML; `annotated` draws the marks of its notes. */
export function codeBlock(code: string, language?: string, annotated = false) {
  const lang = (language ?? "").split(/\s+/)[0];
  if (!annotated)
    return `<pre class="learn-code"><code>${highlight(code, lang)}</code></pre>\n`;
  const { code: bare, notes } = readNotes(code);
  const at = new Map(notes.map((note) => [note.line, note.n]));
  const lines = highlight(bare, lang)
    .split("\n")
    .map((html, i) => {
      const n = at.get(i);
      const mark = n
        ? `<span class="mk" data-n="${n}" role="img" aria-label="Note ${n}"></span>`
        : "";
      return `<span class="ln${n ? " has-note" : ""}">${mark}${html}</span>`;
    });
  return `<pre class="learn-code learn-annotated"><code>${lines.join("")}</code></pre>\n`;
}

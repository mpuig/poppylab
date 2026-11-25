/**
 * The Learn pages (`/learn`), rendered at build time from `docs/learn/**.md`
 * so the repository and the site show the same text. Links between pages
 * become `/learn/...`; links into the code become GitHub URLs; a screenshot
 * kept under the playground's `public/` is served from there. Only our own
 * Markdown goes through this, never Company or user content.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Marked, type Token, type Tokens } from "marked";
import { SPEC_LINK_ATTRIBUTES } from "@poppy-lab/pap-core";
import { LAB_REPOSITORY } from "@poppy-lab/pap-core";

/**
 * Every page, in reading order. A page with a `parent` is one of that
 * page's subsections: its address and its file sit one level down.
 */
export const LEARN_PAGES: readonly LearnPage[] = [
  { slug: "", file: "README.md", label: "Overview" },
  {
    slug: "how-it-works",
    file: "how-it-works/README.md",
    label: "How it works",
  },
  {
    slug: "how-it-works/changing-an-order",
    file: "how-it-works/changing-an-order.md",
    label: "Changing an order",
    parent: "how-it-works",
  },
  {
    slug: "one-task",
    file: "one-task.md",
    label: "One task, request by request",
  },
  { slug: "compared", file: "compared.md", label: "Poppy compared" },
  {
    slug: "conversations",
    file: "conversations.md",
    label: "Conversations",
  },
  { slug: "operations", file: "operations.md", label: "Approvals" },
  { slug: "extensions", file: "extensions.md", label: "Domain extensions" },
  {
    slug: "build-a-company",
    file: "build-a-company.md",
    label: "Build a Company",
  },
  {
    slug: "build-an-agent",
    file: "build-an-agent.md",
    label: "Build a Personal Agent",
  },
  { slug: "pitfalls", file: "pitfalls.md", label: "Pitfalls and interop" },
  { slug: "validator", file: "validator.md", label: "Validator results" },
  { slug: "glossary", file: "glossary.md", label: "Glossary" },
];

export type LearnPage = {
  /** The address under `/learn`, without a leading slash. */
  slug: string;
  /** The Markdown file under `docs/learn`. */
  file: string;
  label: string;
  /** The slug of the page this one is a subsection of. */
  parent?: string;
};

/** Where a page's own relative links start from, under `docs/learn`. */
const folderOf = (page: Pick<LearnPage, "file">) =>
  path.posix.dirname(page.file).replace(/^\.$/, "");

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens. */
export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z0-9#]+;/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** What the playground serves as files, by its path in the repository. */
const PUBLIC = "apps/playground/public/";

/**
 * Where a Markdown link in docs/learn points on the site. `from` is the
 * folder of the page that has the link, under `docs/learn`.
 */
export function learnHref(href: string, from = "") {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [target, hash] = href.split("#") as [string, string | undefined];
  const anchor = hash ? `#${hash}` : "";
  const file = path.posix.normalize(path.posix.join(from, target));
  const page = LEARN_PAGES.find((p) => p.file === file);
  if (page) return `/learn${page.slug ? `/${page.slug}` : ""}${anchor}`;
  // Anything else is a file or folder in the repository.
  const resolved = path.posix.normalize(path.posix.join("docs/learn", file));
  if (resolved.startsWith(PUBLIC))
    return `/${resolved.slice(PUBLIC.length)}${anchor}`;
  const kind = path.posix.extname(resolved) ? "blob" : "tree";
  return `${LAB_REPOSITORY}/${kind}/main/${resolved}${anchor}`;
}

/**
 * The pixel size of a PNG or WebP, read from its first bytes, so a
 * screenshot reserves its place before it loads.
 */
export function imageSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length > 24 && tag(12) === "IHDR")
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length < 30 || tag(0) !== "RIFF" || tag(8) !== "WEBP")
    return undefined;
  if (tag(12) === "VP8X")
    return {
      width: 1 + (view.getUint32(24, true) & 0xffffff),
      height: 1 + (view.getUint32(27, true) & 0xffffff),
    };
  if (tag(12) === "VP8 ")
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  if (tag(12) === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return undefined;
}

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const PROTOCOL_SITE = "https://personalagentprotocol.org/";

/** The Markdown renderer for a page in `from` (a folder under docs/learn). */
function markdownIn(from: string) {
  return new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        return `<h${depth} id="${slugify(html)}">${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const target = learnHref(href, from);
        const external = /^https?:/.test(target) && !target.startsWith("/");
        // A link into the protocol's published text opens in a new tab, so the
        // reader keeps their place in the page that cites it.
        const published = target.startsWith(PROTOCOL_SITE);
        const attributes = published
          ? ` ${SPEC_LINK_ATTRIBUTES}`
          : external
            ? ' rel="noopener"'
            : "";
        return `<a href="${escape(target)}"${title ? ` title="${escape(title)}"` : ""}${attributes}>${this.parser.parseInline(tokens)}</a>`;
      },
      // A screenshot: a figure with the image's title as its caption. It is
      // one of our own files under the playground's public folder, linked by
      // its path in the repository so GitHub shows it too.
      image({ href, title, text }) {
        const file = path.posix.normalize(
          path.posix.join("docs/learn", from, href),
        );
        if (!file.startsWith(PUBLIC))
          throw new Error(`Learn image outside ${PUBLIC}: ${href}`);
        const size = imageSize(
          readFileSync(path.join(process.cwd(), "..", "..", file)),
        );
        const box = size
          ? ` width="${size.width}" height="${size.height}"`
          : "";
        return `<figure class="learn-shot"><img src="/${escape(file.slice(PUBLIC.length))}" alt="${escape(text)}"${box} loading="lazy" decoding="async">${title ? `<figcaption>${escape(title)}</figcaption>` : ""}</figure>\n`;
      },
      // An image on a line of its own is the figure, not a paragraph.
      paragraph({ tokens }) {
        const html = this.parser.parseInline(tokens);
        return tokens.length === 1 && tokens[0]!.type === "image"
          ? html
          : `<p>${html}</p>\n`;
      },
      table(token) {
        // Wide tables scroll inside their own box on small screens.
        const head = token.header
          .map((cell) => `<th>${this.parser.parseInline(cell.tokens)}</th>`)
          .join("");
        const rows = token.rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`,
          )
          .join("");
        return `<div class="table-scroll" role="region" aria-label="Table" tabindex="0"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
}

export function findPage(slug: string | undefined) {
  return LEARN_PAGES.find((p) => p.slug === (slug ?? ""));
}

/** The pages that are subsections of `page`, in reading order. */
export function subsections(page: LearnPage) {
  return LEARN_PAGES.filter((p) => p.parent === page.slug);
}

/** One step of a walk-through: its heading and what follows it. */
export type LearnStep = { id: string; title: string; html: string };

/** The heading that opens a page's walk-through. */
const STEPS_HEADING = "Step by step";

/**
 * A page's Markdown as HTML. A page with a "Step by step" section also
 * comes in parts: what precedes its steps (the section's heading included),
 * each step under its own third-level heading, and what follows the
 * section. The site shows the steps one at a time; `html` has everything
 * in order, as GitHub shows it.
 */
export function renderMarkdown(markdown: string, from = "") {
  const marked = markdownIn(from);
  const tokens = marked.lexer(markdown);
  const parse = (part: Token[]) =>
    marked.parser(Object.assign(part, { links: tokens.links }));
  const heading = (token: Token | undefined, depth: number) =>
    token?.type === "heading" && (token as Tokens.Heading).depth <= depth;
  const start = tokens.findIndex(
    (token) =>
      heading(token, 2) &&
      (token as Tokens.Heading).text.trim() === STEPS_HEADING,
  );
  const html = parse([...tokens]);
  if (start < 0) return { html };
  let end = tokens.findIndex((token, i) => i > start && heading(token, 2));
  if (end < 0) end = tokens.length;
  // Each step runs from its heading to the next one.
  const starts = tokens.flatMap((token, i) =>
    i > start &&
    i < end &&
    token.type === "heading" &&
    (token as Tokens.Heading).depth === 3
      ? [i]
      : [],
  );
  const first = starts[0] ?? end;
  const steps: LearnStep[] = starts.map((at, n) => {
    const title = marked.parseInline(
      // "3. Sign in at the company" reads as a numbered list on GitHub; the
      // site counts the steps itself.
      (tokens[at] as Tokens.Heading).text.replace(/^\d+\.\s+/, ""),
    ) as string;
    return {
      id: slugify(
        marked.parseInline((tokens[at] as Tokens.Heading).text) as string,
      ),
      title,
      html: parse(tokens.slice(at + 1, starts[n + 1] ?? end)),
    };
  });
  return {
    html,
    parts: {
      before: parse(tokens.slice(0, first)),
      steps,
      after: parse(tokens.slice(end)),
    },
  };
}

/** The page's title (its first heading), a one-line description, and HTML. */
export async function renderPage(page: LearnPage) {
  const file = path.join(process.cwd(), "..", "..", "docs", "learn", page.file);
  const markdown = await readFile(file, "utf8");
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? page.label;
  const description =
    markdown
      .split(/\n\n+/)
      .find(
        (block) =>
          block &&
          !block.startsWith("#") &&
          !block.startsWith("|") &&
          !block.startsWith("!["),
      )
      ?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 200) ?? "";
  // The page heading is drawn by the layout.
  const body = markdown.replace(/^# .+\n/m, "");
  return { title, description, ...renderMarkdown(body, folderOf(page)) };
}

/**
 * The Learn pages (`/learn`), rendered at build time from `docs/learn/**.md`
 * so the repository and the site show the same text. Links between pages
 * become `/learn/...`; links into the code become GitHub URLs; a screenshot
 * kept under the playground's `public/` is served from there. Only our own
 * Markdown goes through this, never Company or user content.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Marked, type Token, type Tokens } from "marked";
import { SPEC_LINK_ATTRIBUTES } from "@poppy-lab/pap-core";
import { LAB_REPOSITORY } from "@poppy-lab/pap-core";
import { codeBlock, readNotes } from "./learn-code";

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
    group: "follow",
  },
  {
    slug: "how-it-works/connecting-to-a-company",
    file: "how-it-works/connecting-to-a-company.md",
    label: "Connecting to a company",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/signing-in-and-giving-permission",
    file: "how-it-works/signing-in-and-giving-permission.md",
    label: "Signing in and giving permission",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/changing-an-order",
    file: "how-it-works/changing-an-order.md",
    label: "Changing an order",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/moving-money",
    file: "how-it-works/moving-money.md",
    label: "Moving money",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/changing-a-trip",
    file: "how-it-works/changing-a-trip.md",
    label: "Changing a trip",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/letting-the-agent-approve-for-you",
    file: "how-it-works/letting-the-agent-approve-for-you.md",
    label: "Letting the agent approve for you",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/getting-help-from-the-company",
    file: "how-it-works/getting-help-from-the-company.md",
    label: "Getting help from the company",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/talking-to-the-company-yourself",
    file: "how-it-works/talking-to-the-company-yourself.md",
    label: "Talking to the company yourself",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/when-the-company-cant-do-it",
    file: "how-it-works/when-the-company-cant-do-it.md",
    label: "When the company can't do it",
    parent: "how-it-works",
  },
  {
    slug: "how-it-works/when-something-goes-wrong",
    file: "how-it-works/when-something-goes-wrong.md",
    label: "When something goes wrong",
    parent: "how-it-works",
  },
  {
    slug: "one-task",
    file: "one-task.md",
    label: "One task, request by request",
    group: "follow",
  },
  {
    slug: "compared",
    file: "compared.md",
    label: "Poppy compared",
    group: "understand",
  },
  {
    slug: "conversations",
    file: "conversations.md",
    label: "Conversations",
    group: "understand",
  },
  {
    slug: "operations",
    file: "operations.md",
    label: "Approvals",
    group: "understand",
  },
  {
    slug: "sign-in",
    file: "sign-in.md",
    label: "Signing in",
    group: "understand",
  },
  {
    slug: "extensions",
    file: "extensions/README.md",
    label: "Domain extensions",
    group: "understand",
  },
  {
    slug: "extensions/fdx",
    file: "extensions/fdx.md",
    label: "FDX: bank data",
    parent: "extensions",
  },
  {
    slug: "extensions/espi",
    file: "extensions/espi.md",
    label: "ESPI: energy data",
    parent: "extensions",
  },
  {
    slug: "build-a-company",
    file: "build-a-company.md",
    label: "Build a Company",
    group: "build",
  },
  {
    slug: "build-an-agent",
    file: "build-an-agent.md",
    label: "Build a Personal Agent",
    group: "build",
  },
  {
    slug: "write-an-extension",
    file: "write-an-extension.md",
    label: "Write a domain extension",
    group: "build",
  },
  {
    slug: "validator",
    file: "validator.md",
    label: "Validator results",
    group: "look-up",
  },
  {
    slug: "agent-api",
    file: "agent-api.md",
    label: "The agent's API",
    group: "look-up",
  },
  {
    slug: "glossary",
    file: "glossary.md",
    label: "Glossary",
    group: "look-up",
  },
];

/**
 * The kinds of page, as the navigation groups them. Each is one of the four
 * kinds of documentation (Diátaxis): a process to follow, an idea to
 * understand, a task to build and a fact to look up. A page belongs to
 * exactly one, so its voice and its shape stay the same from page to page.
 */
export const LEARN_GROUPS = [
  { id: "follow", label: "Follow a process" },
  { id: "understand", label: "Understand" },
  { id: "build", label: "Build" },
  { id: "look-up", label: "Look up" },
] as const;

export type LearnGroupId = (typeof LEARN_GROUPS)[number]["id"];

export type LearnPage = {
  /** The address under `/learn`, without a leading slash. */
  slug: string;
  /** The Markdown file under `docs/learn`. */
  file: string;
  label: string;
  /** The slug of the page this one is a subsection of. */
  parent?: string;
  /** The kind of page, for a page with no parent; Overview has none. */
  group?: LearnGroupId;
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
  // An address on the site itself, such as a post's link to /playground.
  if (/^(https?:|mailto:|#|\/)/.test(href)) return href;
  const [target, hash] = href.split("#") as [string, string | undefined];
  const anchor = hash ? `#${hash}` : "";
  const resolved = path.posix.normalize(
    path.posix.join("docs/learn", from, target),
  );
  // By its path in the repository, so a post outside docs/learn finds it too.
  const page = LEARN_PAGES.find((p) => `docs/learn/${p.file}` === resolved);
  if (page) return `/learn${page.slug ? `/${page.slug}` : ""}${anchor}`;
  // Anything else is a file or folder in the repository.
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

/** The repository root, from the playground's working directory. */
const repoFile = (file: string) => path.join(process.cwd(), "..", "..", file);

/**
 * A drawn figure: an SVG file under the playground's public folder, put into
 * the page itself so it takes the page's typeface. A file `name.narrow.svg`
 * beside `name.svg` is the upright drawing for narrow screens; the figure is
 * never hidden, only redrawn. GitHub shows `name.svg` as an ordinary image.
 * The alt text becomes the figure's accessible name. Several figures share a
 * page, so a drawing may not carry ids, scripts or event handlers.
 */
export function svgFigure(file: string, alt: string, caption?: string | null) {
  const inline = (source: string, kind: "wide" | "narrow") => {
    const svg = readFileSync(repoFile(source), "utf8")
      .replace(/<\?xml[^>]*\?>\s*/, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    if (!svg.startsWith("<svg"))
      throw new Error(`Learn figure is not an SVG: ${source}`);
    if (/<script|<foreignObject|\son[a-z]+\s*=|\sid\s*=/i.test(svg))
      throw new Error(
        `Learn figure ${source} may not carry ids, scripts or handlers`,
      );
    return svg.replace(
      /^<svg\b/,
      `<svg class="${kind}" role="img" aria-label="${escape(alt)}"`,
    );
  };
  const narrowFile = file.replace(/\.svg$/, ".narrow.svg");
  const narrow = existsSync(repoFile(narrowFile))
    ? inline(narrowFile, "narrow")
    : "";
  return `<figure class="learn-figure">${inline(file, "wide")}${narrow}${caption ? `<figcaption>${escape(caption)}</figcaption>` : ""}</figure>\n`;
}

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
      // A screenshot or a drawn figure: a figure with the image's title as its
      // caption. It is one of our own files under the playground's public
      // folder, linked by its path in the repository so GitHub shows it too.
      image({ href, title, text }) {
        const file = path.posix.normalize(
          path.posix.join("docs/learn", from, href),
        );
        if (!file.startsWith(PUBLIC))
          throw new Error(`Learn image outside ${PUBLIC}: ${href}`);
        if (file.endsWith(".svg")) return svgFigure(file, text, title);
        const size = imageSize(readFileSync(repoFile(file)));
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
      // A fenced block, coloured. One that has numbered notes and is followed
      // by an ordered list is annotated: see `markLegends`.
      code(token) {
        const { lang, text } = token as Tokens.Code;
        return codeBlock(text, lang, (token as Annotated).annotated);
      },
      // The ordered list that explains an annotated block is its legend.
      list(token) {
        if (!(token as Annotated).legend) return false;
        const items = token.items.map((item) => this.listitem(item)).join("");
        return `<ol class="learn-legend">\n${items}</ol>\n`;
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

/** A token that `markLegends` has marked as part of an annotated block. */
type Annotated = Token & { annotated?: boolean; legend?: boolean };

/**
 * A code block whose lines carry numbered notes (`// (1)`) is annotated, and
 * the ordered list right after it is its legend. The notes and the list must
 * agree, 1 to n in order, or the page doesn't build: a mark that points at
 * nothing, or a legend entry that points at no line, is a wrong explanation.
 */
export function markLegends(tokens: Token[]) {
  tokens.forEach((token, i) => {
    if (token.type !== "code") return;
    const { notes } = readNotes((token as Tokens.Code).text);
    if (notes.length === 0) return;
    const where = `A code block with ${notes.length} numbered notes`;
    const next = tokens.slice(i + 1).find((t) => t.type !== "space");
    if (next?.type !== "list" || !(next as Tokens.List).ordered)
      throw new Error(`${where} is not followed by an ordered list`);
    const items = (next as Tokens.List).items.length;
    if (items !== notes.length)
      throw new Error(`${where} is followed by a list of ${items} items`);
    notes.forEach(({ n }, k) => {
      if (n !== k + 1)
        throw new Error(`${where}: note ${k + 1} is numbered ${n}`);
    });
    (token as Annotated).annotated = true;
    (next as Annotated).legend = true;
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
  markLegends(tokens);
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
      .replace(/\s+/g, " ") ?? "";
  // The page heading is drawn by the layout.
  const body = markdown.replace(/^# .+\n/m, "");
  return {
    title,
    description: clip(description),
    ...renderMarkdown(body, folderOf(page)),
  };
}

/**
 * A description short enough for a search result or a shared link: whole
 * sentences when they fit, otherwise whole words and an ellipsis.
 */
export function clip(text: string, max = 200) {
  if (text.length <= max) return text;
  const sentences = text.slice(0, max + 1).match(/^.*[.!?](?=\s)/)?.[0];
  if (sentences && sentences.length >= max / 2) return sentences;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

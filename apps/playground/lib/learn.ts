/**
 * The Learn pages (`/learn`), rendered at build time from `docs/learn/*.md`
 * so the repository and the site show the same text. Links between pages
 * become `/learn/...`; links into the code become GitHub URLs. Only our own
 * Markdown goes through this, never Company or user content.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";
import { LAB_REPOSITORY } from "@poppy-lab/pap-core";

export const LEARN_PAGES = [
  { slug: "", file: "README.md", label: "Overview" },
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
] as const;

export type LearnPage = (typeof LEARN_PAGES)[number];

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

/** Where a Markdown link in docs/learn points on the site. */
export function learnHref(href: string) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [target, hash] = href.split("#") as [string, string | undefined];
  const anchor = hash ? `#${hash}` : "";
  const page = LEARN_PAGES.find((p) => p.file === target);
  if (page) return `/learn${page.slug ? `/${page.slug}` : ""}${anchor}`;
  // Anything else is a file or folder in the repository.
  const resolved = path.posix.normalize(path.posix.join("docs/learn", target));
  const kind = path.posix.extname(resolved) ? "blob" : "tree";
  return `${LAB_REPOSITORY}/${kind}/main/${resolved}${anchor}`;
}

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const marked = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(html)}">${html}</h${depth}>\n`;
    },
    link({ href, title, tokens }) {
      const target = learnHref(href);
      const external = /^https?:/.test(target) && !target.startsWith("/");
      return `<a href="${escape(target)}"${title ? ` title="${escape(title)}"` : ""}${external ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
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

export function findPage(slug: string | undefined) {
  return LEARN_PAGES.find((p) => p.slug === (slug ?? ""));
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
        (block) => block && !block.startsWith("#") && !block.startsWith("|"),
      )
      ?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 200) ?? "";
  // The page heading is drawn by the layout.
  const body = markdown.replace(/^# .+\n/m, "");
  return { title, description, html: await marked.parse(body) };
}

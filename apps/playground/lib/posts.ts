/**
 * The posts (`/posts`), read at build time from Markdown files in one
 * tracked folder, `apps/playground/content/posts`, and rendered with the
 * same Markdown pipeline as Learn. A post is a file named
 * `YYYY-MM-DD-slug.md` directly in that folder, with front matter; nothing
 * else is read, so a draft kept anywhere else is never published.
 */
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderMarkdown } from "./learn";
import { absolute } from "./site";

/** The folder the site publishes, from the playground's working directory. */
export const POSTS_DIR = path.join(process.cwd(), "content", "posts");

/** Where the posts folder sits under `docs/learn`, for its relative links. */
const FROM_LEARN = "../../apps/playground/content/posts";

const FILE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

export type Post = {
  slug: string;
  /** The file's name in the posts folder. */
  file: string;
  title: string;
  subtitle: string;
  /** `YYYY-MM-DD`, the same as the file name's. */
  date: string;
  tags: string[];
  /** A Learn page that goes deeper, as `/learn/...`. */
  learn?: string;
  /** The post's own address, or the original's when it was published elsewhere first. */
  canonical: string;
  /** The Markdown after the front matter. */
  body: string;
};

const KEYS = new Set([
  "title",
  "subtitle",
  "date",
  "tags",
  "learn",
  "canonical",
]);

/**
 * The front matter between the two `---` lines: one `key: value` a line,
 * a value optionally in quotes, tags as `[a, b]` or `a, b`. An unknown key
 * is a mistake, so it stops the build rather than being dropped.
 */
export function readFrontMatter(source: string, file = "post") {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) throw new Error(`${file}: no front matter`);
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${file}: unreadable front matter line "${line}"`);
    const [, key, raw] = kv as unknown as [string, string, string];
    if (!KEYS.has(key))
      throw new Error(`${file}: unknown front matter "${key}"`);
    fields[key] = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { fields, body: source.slice(match[0].length) };
}

const tagsOf = (value: string | undefined) =>
  (value ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter(Boolean);

/** One post from its file's name and text. */
export function readPost(file: string, source: string): Post {
  const name = FILE.exec(file);
  if (!name) throw new Error(`${file}: not named YYYY-MM-DD-slug.md`);
  const [, day, slug] = name as unknown as [string, string, string];
  const { fields, body } = readFrontMatter(source, file);
  if (!fields.title) throw new Error(`${file}: no title`);
  const date = fields.date ?? day;
  if (date !== day)
    throw new Error(`${file}: date ${date} is not the file's ${day}`);
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    throw new Error(`${file}: ${date} is not a date`);
  if (
    fields.learn &&
    !/^\/learn(\/[a-z0-9/-]*)?(#[a-z0-9-]+)?$/.test(fields.learn)
  )
    throw new Error(`${file}: learn is not a /learn address`);
  if (fields.canonical && !/^https:\/\/\S+$/.test(fields.canonical))
    throw new Error(`${file}: canonical is not an https URL`);
  return {
    slug,
    file,
    title: fields.title,
    subtitle: fields.subtitle ?? "",
    date,
    tags: tagsOf(fields.tags),
    ...(fields.learn ? { learn: fields.learn } : {}),
    canonical: fields.canonical ?? absolute(`/posts/${slug}`),
    body,
  };
}

/**
 * Every post in `dir`, oldest first: the order of the series. Only regular
 * files named as posts, directly in the folder; a subfolder, a link to a
 * file elsewhere and any other name are left out.
 */
export function loadPosts(dir = POSTS_DIR): Post[] {
  // Read only while the pages are built, so the server bundle needn't
  // carry the folder: the comments keep the build from tracing it.
  const file = (name: string) => path.join(/*turbopackIgnore: true*/ dir, name);
  let names: string[];
  try {
    names = readdirSync(/*turbopackIgnore: true*/ dir);
  } catch {
    return [];
  }
  const posts = names
    .filter((name) => FILE.test(name) && lstatSync(file(name)).isFile())
    .map((name) => readPost(name, readFileSync(file(name), "utf8")))
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug),
    );
  const seen = new Set<string>();
  for (const post of posts) {
    if (seen.has(post.slug))
      throw new Error(`Two posts are called ${post.slug}`);
    seen.add(post.slug);
  }
  return posts;
}

/** A post's HTML, from the same renderer as Learn's pages. */
export function renderPost(post: Post) {
  return renderMarkdown(post.body.replace(/^\s*# .+\n/, ""), FROM_LEARN).html;
}

/** "27 November 2026", the same for every reader. */
export const postDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

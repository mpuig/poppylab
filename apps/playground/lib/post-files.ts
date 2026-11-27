/**
 * Which files in the posts folder are posts: those named
 * `YYYY-MM-DD-slug.md`, regular files directly in the folder. Kept apart
 * from `posts.ts`, with nothing but the file system, so next.config can
 * count them at build time.
 */
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

/** The folder the site publishes, from the playground's working directory. */
export const POSTS_DIR = path.join(process.cwd(), "content", "posts");

export const POST_FILE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/**
 * The posts' paths in `dir`. A subfolder, a link to a file elsewhere and
 * any other name are left out; a missing folder has none. Read only while
 * the pages are built, so the server bundle needn't carry the folder: the
 * comments keep the build from tracing it.
 */
export function postFiles(dir = POSTS_DIR): string[] {
  const file = (name: string) => path.join(/*turbopackIgnore: true*/ dir, name);
  let names: string[];
  try {
    names = readdirSync(/*turbopackIgnore: true*/ dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => POST_FILE.test(name) && lstatSync(file(name)).isFile())
    .map(file);
}

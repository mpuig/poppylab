import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

/**
 * The site is a personal project: no page names the author's employer.
 * This reads every text file a page is built from (the app, its library,
 * the posts, the Learn pages and the public files) and fails on the name.
 * The name is spelled out here only in pieces, so this file passes too.
 */
const EMPLOYER = new RegExp(`\\b${["B", "C", "G"].join("")}\\b`, "i");
const TEXT = /\.(tsx?|mjs|css|md|json|svg|txt|html|xml|toml)$/;
const SKIP = new Set(["node_modules", ".next", ".open-next", ".wrangler"]);

const playground = path.join(__dirname, "..");
const roots = [
  "app",
  "lib",
  "content",
  "public",
  "scripts",
  "../../docs/learn",
].map((dir) => path.join(playground, dir));
roots.push(path.join(playground, "wrangler.toml"));

function* files(entry: string): Generator<string> {
  let names: string[];
  try {
    names = readdirSync(entry);
  } catch {
    if (TEXT.test(entry)) yield entry;
    return;
  }
  for (const name of names)
    if (!SKIP.has(name)) yield* files(path.join(entry, name));
}

it("never names the author's employer on a page", () => {
  const found = roots
    .flatMap((root) => [...files(root)])
    .filter((file) => EMPLOYER.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(playground, file));
  expect(found).toEqual([]);
});

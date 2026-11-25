/**
 * Every relative link in the repository's Markdown points at a file or
 * folder that exists, and a link with an anchor into another Markdown file
 * names one of its headings. docs/learn is also checked page by page in
 * learn.test.ts; this covers everything else (docs/, history, READMEs).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { slugify } from "./learn";

const root = path.resolve(process.cwd(), "..", "..");
const skip = new Set([
  "node_modules",
  ".git",
  ".next",
  ".open-next",
  ".wrangler",
  ".turbo",
  "dist",
  "spec",
  ".poppy",
  ".impeccable",
]);

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return name.endsWith(".md") ? [full] : [];
  });
}

const headings = (file: string) =>
  new Set(
    [...readFileSync(file, "utf8").matchAll(/^#{1,6} (.+)$/gm)].map((m) =>
      slugify(m[1]!.replace(/`/g, "")),
    ),
  );

it("finds no broken relative links in the repository's Markdown", () => {
  const broken: string[] = [];
  const files = markdownFiles(root);
  expect(files.length).toBeGreaterThan(20);
  for (const file of files) {
    const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^([a-z]+:|#|\/)/.test(target!)) continue;
      const [rel, anchor] = target!.split("#");
      const resolved = path.resolve(path.dirname(file), rel!);
      const where = `${path.relative(root, file)} → ${target}`;
      if (!existsSync(resolved)) broken.push(where);
      else if (
        anchor &&
        resolved.endsWith(".md") &&
        !headings(resolved).has(anchor)
      )
        broken.push(`${where} (no such heading)`);
    }
  }
  expect(broken).toEqual([]);
});

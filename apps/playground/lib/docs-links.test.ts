/**
 * Every relative link in the repository's Markdown points at a file or
 * folder that exists, and a link with an anchor into another Markdown file
 * names one of its headings. docs/learn is also checked page by page in
 * learn.test.ts; this covers everything else (docs/, history, READMEs).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import {
  GUIDES_ANCHORS,
  OPERATIONS_ANCHORS,
  OPERATIONS_EXTRA_ANCHORS,
  SPEC_ANCHORS,
  SPEC_EXTRA_ANCHORS,
} from "@poppy-lab/pap-core";
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
  // Other branches' checkouts live here on a developer's machine.
  ".claude",
]);

function filesEnding(dir: string, endings: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesEnding(full, endings);
    return endings.some((ending) => name.endsWith(ending)) ? [full] : [];
  });
}

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

/**
 * A link into the protocol's published text names a heading by the id that
 * page gives it, which is not the title's slug ("The Session header" is
 * `#session-header`). A wrong id opens the top of the document.
 */
it("links into the published spec by headings that exist, in pages and in code", () => {
  const published: Record<string, Set<string>> = {
    spec: new Set([...Object.values(SPEC_ANCHORS), ...SPEC_EXTRA_ANCHORS]),
    "extensions/operations": new Set([
      ...Object.values(OPERATIONS_ANCHORS),
      ...OPERATIONS_EXTRA_ANCHORS,
    ]),
    guides: new Set(GUIDES_ANCHORS),
  };
  const broken: string[] = [];
  let checked = 0;
  for (const file of filesEnding(root, [".md", ".ts", ".tsx"])) {
    const text = readFileSync(file, "utf8");
    for (const [, page, anchor] of text.matchAll(
      /https:\/\/personalagentprotocol\.org\/docs\/1\.0\/([a-z/-]+)#([\w-]+)/g,
    )) {
      const known = published[page!];
      if (!known) continue;
      checked++;
      if (!known.has(anchor!))
        broken.push(`${path.relative(root, file)} → ${page}#${anchor}`);
    }
  }
  expect(checked).toBeGreaterThan(20);
  expect(broken).toEqual([]);
});

it("links a numbered Operations section to the extension's own page", () => {
  const vague: string[] = [];
  for (const file of markdownFiles(root)) {
    const text = readFileSync(file, "utf8");
    for (const [link] of text.matchAll(
      /\[Operations §[^\]]*\]\(https:\/\/personalagentprotocol\.org\/docs\/1\.0\/extensions\)/g,
    ))
      vague.push(`${path.relative(root, file)} → ${link}`);
  }
  expect(vague).toEqual([]);
});

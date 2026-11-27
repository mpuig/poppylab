/**
 * Draws the figures of the Learn pages and of the posts as standalone SVG
 * files. A figure is one file that exports { name, alt, caption, draw(variant) };
 * the primitives and the grammar of DESIGN.md are in ./draw.mjs.
 *
 * - ./figures/NAME.mjs draws apps/playground/public/learn-media/diagrams/NAME.svg,
 *   for a page in docs/learn.
 * - ./posts/SLUG/NAME.mjs draws apps/playground/public/posts/SLUG/NAME.svg, for
 *   the post published at /posts/SLUG (apps/playground/content/posts). A post's
 *   figures are drawn before the post is published, so publishing it takes
 *   only its Markdown.
 *
 *   node scripts/learn-diagrams/index.mjs                     write the files
 *   node scripts/learn-diagrams/index.mjs --check             exit 1 if a file is
 *                                                             not what the figures
 *                                                             draw, or has no figure
 *   node scripts/learn-diagrams/index.mjs --only a,b         draw (or --check) just
 *                                                             the figures a and b
 *   node scripts/learn-diagrams/index.mjs --markdown NAME [DIR]
 *                                                             print the Markdown
 *                                                             line that embeds NAME
 *                                                             in a page in DIR
 *                                                             (default docs/learn
 *                                                             for a Learn figure,
 *                                                             the posts' folder for
 *                                                             a post's)
 *
 * Each figure comes as two drawings. The wide one is 720 units, read at about
 * its own size in the article; `name.narrow.svg` is 360 units for screens
 * under 640px and carries the same facts on shorter lines.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const LEARN_OUT = `${root}apps/playground/public/learn-media/diagrams/`;
const POSTS_OUT = `${root}apps/playground/public/posts/`;
const FIGURES = fileURLToPath(new URL("./figures/", import.meta.url));
const POSTS = fileURLToPath(new URL("./posts/", import.meta.url));

/** Where each folder of figures is drawn, and where its pages live. */
function groups() {
  const out = [{ src: FIGURES, out: LEARN_OUT, from: "docs/learn" }];
  if (existsSync(POSTS))
    for (const slug of readdirSync(POSTS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort())
      out.push({
        src: `${POSTS}${slug}/`,
        out: `${POSTS_OUT}${slug}/`,
        from: "apps/playground/content/posts",
      });
  return out;
}

export async function figures(only) {
  const found = [];
  const names = new Set();
  for (const group of groups())
    for (const file of readdirSync(group.src)
      .filter((f) => f.endsWith(".mjs"))
      .filter((f) => !only || only.includes(f.replace(/\.mjs$/, "")))
      .sort()) {
      const { default: figure } = await import(
        pathToFileURL(`${group.src}${file}`).href
      );
      if (figure.name !== file.replace(/\.mjs$/, ""))
        throw new Error(`${file} exports a figure named ${figure.name}`);
      for (const key of ["alt", "caption"])
        if (!figure[key]) throw new Error(`${figure.name} has no ${key}`);
      // `--only` and `--markdown` find a figure by its name alone.
      if (names.has(figure.name))
        throw new Error(`Two figures are named ${figure.name}`);
      names.add(figure.name);
      found.push({ ...figure, out: group.out, from: group.from });
    }
  return found;
}

/** Every file the figures draw: its path and its text. */
export async function files(only) {
  const out = [];
  for (const figure of await figures(only))
    for (const [variant, suffix] of [
      ["wide", ""],
      ["narrow", ".narrow"],
    ]) {
      const text = figure.draw(variant);
      // The renderer sets a drawing into the page, where ids would collide.
      if (
        /<script|<foreignObject|\son[a-z]+\s*=|\sid\s*=|<style|\sclass\s*=/i.test(
          text,
        )
      )
        throw new Error(
          `${figure.name} (${variant}) has an id, a class, a style or a script`,
        );
      out.push({ file: `${figure.out}${figure.name}${suffix}.svg`, text });
    }
  return out;
}

/** The Markdown line that embeds a figure in a page in `from` (under the repository root). */
export function markdown(figure, from = figure.from) {
  const target = `${figure.out}${figure.name}.svg`.slice(root.length);
  const href = path.posix.relative(from, target);
  return `![${figure.alt}](${href} "${figure.caption}")`;
}

/** The folders a figure may be drawn into: Learn's, and one for each post. */
function outputFolders() {
  const out = [LEARN_OUT];
  if (existsSync(POSTS_OUT))
    for (const entry of readdirSync(POSTS_OUT, { withFileTypes: true }))
      if (entry.isDirectory()) out.push(`${POSTS_OUT}${entry.name}/`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--markdown") {
    const figure = (await figures()).find((f) => f.name === args[1]);
    if (!figure) throw new Error(`No figure named ${args[1]}`);
    console.log(markdown(figure, args[2]));
  } else {
    const check = args.includes("--check");
    // `--only a,b` draws just those figures, so one author is not stopped by
    // another's figure that is half written.
    const only = args.includes("--only")
      ? args[args.indexOf("--only") + 1].split(",")
      : undefined;
    const drawn = await files(only);
    let stale = 0;
    for (const { file, text } of drawn) {
      const short = file.slice(root.length);
      if (check) {
        if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
          console.log(`stale    ${short}`);
          stale++;
        } else console.log(`current  ${short}`);
      } else {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, text);
        console.log(`wrote    ${short}`);
      }
    }
    if (check && !only) {
      // A drawing no figure draws any more. A post's folder also holds its
      // screenshots, which are not drawings.
      const known = new Set(drawn.map((d) => d.file));
      for (const folder of outputFolders().filter((f) => existsSync(f)))
        for (const file of readdirSync(folder).filter((f) =>
          f.endsWith(".svg"),
        ))
          if (!known.has(`${folder}${file}`)) {
            console.log(`orphan   ${`${folder}${file}`.slice(root.length)}`);
            stale++;
          }
    }
    if (stale) {
      console.log("Run `pnpm learn:diagrams` and commit the files.");
      process.exit(1);
    }
  }
}

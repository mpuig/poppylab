/**
 * Draws the figures of the Learn pages as standalone SVG files in
 * apps/playground/public/learn-media/diagrams/. A figure is one file under
 * ./figures/ that exports { name, alt, caption, draw(variant) }; the
 * primitives and the grammar of DESIGN.md are in ./draw.mjs.
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
 *                                                             (default docs/learn)
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
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const OUT = `${root}apps/playground/public/learn-media/diagrams/`;
const FIGURES = fileURLToPath(new URL("./figures/", import.meta.url));

export async function figures(only) {
  const found = [];
  for (const file of readdirSync(FIGURES)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => !only || only.includes(f.replace(/\.mjs$/, "")))
    .sort()) {
    const { default: figure } = await import(`./figures/${file}`);
    if (figure.name !== file.replace(/\.mjs$/, ""))
      throw new Error(`${file} exports a figure named ${figure.name}`);
    for (const key of ["alt", "caption"])
      if (!figure[key]) throw new Error(`${figure.name} has no ${key}`);
    found.push(figure);
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
      out.push({ file: `${OUT}${figure.name}${suffix}.svg`, text });
    }
  return out;
}

/** The Markdown line that embeds a figure in a page in `from` (under the repository root). */
export function markdown(figure, from = "docs/learn") {
  const target = `${OUT}${figure.name}.svg`.slice(root.length);
  const href = path.posix.relative(from, target);
  return `![${figure.alt}](${href} "${figure.caption}")`;
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
        mkdirSync(OUT, { recursive: true });
        writeFileSync(file, text);
        console.log(`wrote    ${short}`);
      }
    }
    if (check && !only && existsSync(OUT)) {
      const known = new Set(drawn.map((d) => path.basename(d.file)));
      for (const file of readdirSync(OUT).filter((f) => f.endsWith(".svg")))
        if (!known.has(file)) {
          console.log(
            `orphan   apps/playground/public/learn-media/diagrams/${file}`,
          );
          stale++;
        }
    }
    if (stale) {
      console.log("Run `pnpm learn:diagrams` and commit the files.");
      process.exit(1);
    }
  }
}

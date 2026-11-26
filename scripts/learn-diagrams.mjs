/**
 * Draws the sequence figures of the Learn pages as standalone SVG files in
 * apps/playground/public/learn-media/diagrams/, in the figure grammar of
 * DESIGN.md: You is the solid ink node, the agent an outline on paper, the
 * company an outline on tint; a request is a solid green line and a reply a
 * dashed one; amber marks only what waits for the person or what only the
 * person does. Drawings use plain attributes, with no classes or ids, so
 * several can share one page when the Learn renderer sets them inline.
 *
 *   node scripts/learn-diagrams.mjs           write the files
 *   node scripts/learn-diagrams.mjs --check   exit 1 if a file is not what
 *                                             this script draws
 *
 * Each figure comes as two drawings. The wide one is 720 units, read at about
 * its own size in the article; `name.narrow.svg` is 360 units for screens
 * under 640px and carries the same facts on shorter lines. A figure is added
 * by describing it in FIGURES below and running the script.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const OUT = `${root}apps/playground/public/learn-media/diagrams/`;

// DESIGN.md's tokens, as literal values: a standalone file has no stylesheet.
const INK = "#171a1f";
const MUTED = "#5b626c";
const PAPER = "#ffffff";
const TINT = "#f4f6f7";
const GREEN = "#0d5c4a";
const LINE = "#e3e6ea";
const LINE_STRONG = "#c9ced5";
const AMBER = "#f2b705";
const AMBER_WASH = "#fff6d6";
const SANS = "'Hanken Grotesk','Helvetica Neue',Arial,sans-serif";

/** Two decimals at most, and none when the number is whole. */
const n = (value) => String(Number(value.toFixed(2)));
const esc = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A generous estimate of a line's width in this face, for label grounds. */
const textWidth = (text, size, weight = 500) =>
  text.length * size * (weight >= 600 ? 0.56 : 0.54);

/** The same facts for both widths: `[wide, narrow]`. */
const pair = (wide, narrow = wide) => ({ wide, narrow });

const WIDE = {
  width: 720,
  font: 15,
  x: { user: 96, agent: 360, company: 624 },
  head: [168, 48],
  edge: 8,
  // A label sits centred over its line.
  anchor: () => "mid",
};
const NARROW = {
  width: 360,
  font: 14,
  x: { user: 56, agent: 180, company: 304 },
  head: [100, 44],
  edge: 12,
  // A label starts at the left edge on the user's rows and ends at the right
  // edge on the others, so a line of text never runs off the drawing.
  anchor: (message) =>
    message.from === "user" || message.to === "user" ? "start" : "end",
};
const VARIANTS = { wide: WIDE, narrow: NARROW };

const msg = (from, to, lines, extra = {}) => ({
  kind: "msg",
  from,
  to,
  lines,
  ...extra,
});

/**
 * The life of an operation (docs/learn/operations.md): one request, an answer
 * that holds the terms, an approval of exactly those terms, and a change made
 * once. The amber gate and the amber label are the person's: what waits for
 * them, and the one thing only they do.
 */
const FIGURES = {
  "operation-lifecycle": {
    parties: {
      user: { kind: "you", label: pair("The user", "User") },
      agent: { kind: "agent", label: pair("Personal Agent", "Agent") },
      company: { kind: "company", label: pair("Company") },
    },
    items: [
      msg("agent", "company", pair(["1 · Request the change"])),
      msg(
        "company",
        "agent",
        pair(
          ["2 · approval_required, with the terms and a revision"],
          ["2 · approval_required, with", "the terms and a revision"],
        ),
        { reply: true },
      ),
      { kind: "gate", text: pair("Waiting for approval of this revision") },
      msg(
        "user",
        "agent",
        pair(
          ["3 · The user approves these terms"],
          ["3 · The user approves", "these terms"],
        ),
        { tag: true },
      ),
      msg(
        "agent",
        "company",
        pair(
          ["4 · The same request, with the approval"],
          ["4 · The same request,", "with the approval"],
        ),
      ),
      { kind: "frame-start" },
      { kind: "guard", text: pair("If the terms still match") },
      msg(
        "company",
        "agent",
        pair(
          ["5 · The change is made once, or declined"],
          ["5 · The change is made", "once, or declined"],
        ),
        { reply: true },
      ),
      { kind: "rule" },
      { kind: "guard", text: pair("If the terms have changed") },
      msg(
        "company",
        "agent",
        pair(
          ["5 · A new revision; the old approval no longer applies"],
          ["5 · A new revision; the old", "approval no longer applies"],
        ),
        { reply: true },
      ),
      { kind: "frame-end" },
    ],
  },
};

/** One drawing of a figure: `variant` is "wide" or "narrow". */
export function draw(figure, variant) {
  const v = VARIANTS[variant];
  const pick = (value) => value[variant];
  const { width: W, font: fs, x: at } = v;
  const [headW, headH] = v.head;
  const lineHeight = Math.round(fs * 1.25);
  const out = [];

  // Where each row sits, from the top down.
  let y = headH + 14;
  const rows = [];
  for (const item of figure.items) {
    if (item.kind === "msg") {
      const height = pick(item.lines).length * lineHeight + 10;
      y += height + 8;
      rows.push({ item, y, height });
      y += 22;
    } else if (item.kind === "gate") {
      y += 6;
      rows.push({ item, y, height: 46 });
      y += 46 + 14;
    } else if (item.kind === "frame-start") {
      y += 4;
      rows.push({ item, y, height: 0 });
      y += 14;
    } else if (item.kind === "guard") {
      rows.push({ item, y, height: lineHeight + 4 });
      y += lineHeight + 4;
    } else if (item.kind === "rule") {
      y += 8;
      rows.push({ item, y, height: 0 });
      y += 8;
    } else if (item.kind === "frame-end") {
      y += 2;
      rows.push({ item, y, height: 0 });
      y += 10;
    }
  }
  const H = y;

  for (const x of Object.values(at))
    out.push(
      `<line x1="${x}" y1="${headH}" x2="${x}" y2="${H - 4}" stroke="${LINE_STRONG}" stroke-width="1.2"/>`,
    );

  for (const [name, x] of Object.entries(at)) {
    const { kind, label } = figure.parties[name];
    const fill = { you: INK, agent: PAPER, company: TINT }[kind];
    out.push(
      `<rect x="${n(x - headW / 2)}" y="0.6" width="${headW}" height="${n(headH - 1.2)}" rx="6" fill="${fill}" stroke="${INK}" stroke-width="1.2"/>`,
      `<text x="${x}" y="${n(headH / 2 + fs * 0.35)}" text-anchor="middle" font-size="${fs + 1}" font-weight="600" fill="${kind === "you" ? PAPER : INK}">${esc(pick(label))}</text>`,
    );
  }

  let frameTop = 0;
  for (const { item, y: ry, height } of rows) {
    if (item.kind === "gate") {
      out.push(
        `<rect x="12" y="${ry}" width="${W - 24}" height="${height}" rx="8" fill="${AMBER_WASH}" stroke="${AMBER}" stroke-width="1"/>`,
        `<circle cx="32" cy="${n(ry + height / 2)}" r="4" fill="${AMBER}"/>`,
        `<text x="46" y="${n(ry + height / 2 + fs * 0.35)}" font-size="${fs}" font-weight="600" fill="${INK}">${esc(pick(item.text))}</text>`,
      );
    } else if (item.kind === "frame-start") {
      frameTop = ry;
    } else if (item.kind === "frame-end") {
      out.push(
        `<rect x="12" y="${frameTop}" width="${W - 24}" height="${ry - frameTop}" rx="8" fill="none" stroke="${LINE_STRONG}" stroke-width="1" stroke-dasharray="5 4"/>`,
      );
    } else if (item.kind === "guard") {
      out.push(
        `<text x="28" y="${n(ry + fs * 0.9)}" font-size="${fs - 1}" fill="${MUTED}">${esc(pick(item.text))}</text>`,
      );
    } else if (item.kind === "rule") {
      out.push(
        `<line x1="12" y1="${ry}" x2="${W - 12}" y2="${ry}" stroke="${LINE}" stroke-width="1"/>`,
      );
    } else if (item.kind === "msg") {
      const from = at[item.from];
      const tip = at[item.to];
      const base = tip > from ? tip - 8 : tip + 8;
      const dash = item.reply ? ' stroke-dasharray="5 4"' : "";
      out.push(
        `<line x1="${from}" y1="${ry}" x2="${base}" y2="${ry}" stroke="${GREEN}" stroke-width="1.5"${dash}/>`,
        `<path d="M${tip} ${ry}L${base} ${ry - 4.5}L${base} ${ry + 4.5}Z" fill="${GREEN}"/>`,
      );
      const lines = pick(item.lines);
      const labelWidth = Math.max(...lines.map((t) => textWidth(t, fs)));
      const anchor = v.anchor(item);
      let tx = (from + tip) / 2;
      let textAnchor = "middle";
      let ground = tx - labelWidth / 2 - 7;
      if (anchor === "start") {
        tx = v.edge;
        textAnchor = "start";
        ground = tx - 7;
      } else if (anchor === "end") {
        tx = W - v.edge;
        textAnchor = "end";
        ground = tx - labelWidth - 7;
      }
      const top = ry - height - 4;
      const tagged = item.tag
        ? ` fill="${AMBER_WASH}" stroke="${AMBER}" stroke-width="1"`
        : ` fill="${PAPER}"`;
      out.push(
        `<rect x="${n(ground)}" y="${top}" width="${n(labelWidth + 14)}" height="${height}" rx="4"${tagged}/>`,
      );
      lines.forEach((text, i) =>
        out.push(
          `<text x="${n(tx)}" y="${n(top + 5 + (i + 1) * lineHeight - 3)}" text-anchor="${textAnchor}" font-size="${fs}" font-weight="${item.tag ? 600 : 500}" fill="${INK}">${esc(text)}</text>`,
        ),
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${SANS}">\n  ${out.join("\n  ")}\n</svg>\n`;
}

/** Every file this script draws: its path and its text. */
export function files() {
  return Object.entries(FIGURES).flatMap(([name, figure]) => [
    { file: `${OUT}${name}.svg`, text: draw(figure, "wide") },
    { file: `${OUT}${name}.narrow.svg`, text: draw(figure, "narrow") },
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { file, text } of files()) {
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
  if (stale) {
    console.log("Run `pnpm learn:diagrams` and commit the files.");
    process.exit(1);
  }
}

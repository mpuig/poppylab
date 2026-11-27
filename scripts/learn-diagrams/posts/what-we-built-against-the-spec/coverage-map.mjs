import {
  GREEN,
  GREEN_WASH,
  INK,
  LINE_STRONG,
  MUTED,
  card,
  lines,
  rect,
  svg,
  text,
  textWidth,
  wrap,
} from "../../draw.mjs";

/**
 * What was built against the spec (the seventeenth post), as docs/coverage.md
 * records it: what works between Iris and all five companies, what only the
 * companies' side has, and what neither side has. Green is what is built.
 */

const BOTH = [
  "Discovery",
  "Agent identity",
  "Direct Sign-In",
  "DPoP tokens",
  "Revocation",
  "Sessions",
  "OpenAPI",
  "MCP",
  "Conversations",
  "Handoff",
  "Direct Conversations",
  "Tasks and feedback",
  "Operations v3",
  "Standing instructions",
  "FDX and ESPI extensions",
];
const COMPANIES_ONLY = [
  {
    title: "Browser join",
    sub: "on all five websites; Iris drives no browser",
  },
  {
    title: "Skills",
    sub: "published by all five; Iris lists them without loading them",
  },
  {
    title: "Device Sign-In",
    sub: "at all but Harborline; the playground uses Direct Sign-In",
  },
];
const NEITHER = [
  { title: "Mediated Sign-In", sub: "retires on 17 March 2027" },
  { title: "Operations on website forms", sub: "joined browsers only read" },
  { title: "Several protocol versions", sub: "the companies serve 1.0 only" },
];
const NOTE =
  "Checked on the live companies by the official implementation kit's validator, and by the lab's own suites where it doesn't reach, such as consent pages and the extensions.";

/** Names as small cells that wrap onto new lines. Returns { parts, h }. */
function cells(names, { x, y, w, size }) {
  const parts = [];
  const h = size + 17;
  let cx = x;
  let cy = y;
  for (const name of names) {
    const cw = textWidth(name, size) + 20;
    if (cx > x && cx + cw > x + w) {
      cx = x;
      cy += h + 8;
    }
    parts.push(
      rect({ x: cx, y: cy, w: cw, h, rx: 4, stroke: GREEN, sw: 1 }),
      text(name, {
        x: cx + cw / 2,
        y: cy + h / 2 + size * 0.35,
        size,
        weight: 500,
        anchor: "middle",
      }),
    );
    cx += cw + 8;
  }
  return { parts, h: cy + h - y };
}

/** A band: a titled panel whose body `draw(top)` returns { parts, h }. */
function band({ y, w, title, fill, stroke, head, size, dash, body }) {
  const inner = body(y + 40);
  const h = 40 + inner.h + 16;
  return {
    parts: [
      rect({ x: 1, y, w, h, rx: 8, fill, stroke, sw: 1, dash }),
      text(title, {
        x: 17,
        y: y + 26,
        size: size + 1,
        weight: 600,
        fill: head,
      }),
      ...inner.parts,
    ],
    h,
  };
}

/** Cards in `cols` columns of equal height. */
function grid(items, { x, y, w, cols, kind, ...style }) {
  const gap = 10;
  const cw = (w - (cols - 1) * gap) / cols;
  const rows = Math.ceil(items.length / cols);
  const parts = [];
  let top = y;
  for (let r = 0; r < rows; r++) {
    const row = items.slice(r * cols, r * cols + cols);
    const h = Math.max(
      ...row.map((it) => card({ ...style, ...it, x: 0, y: 0, w: cw }).h),
    );
    row.forEach((it, i) =>
      parts.push(
        card({ ...style, ...it, kind, x: x + i * (cw + gap), y: top, w: cw, h })
          .svg,
      ),
    );
    top += h + gap;
  }
  return { parts, h: top - gap - y };
}

function draw({ W, cols, size, subSize, pad }) {
  const out = [];
  const w = W - 2;
  const inner = w - 32;
  let y = 1;
  const first = band({
    y,
    w,
    title: "Built in Iris and all five companies",
    fill: GREEN_WASH,
    stroke: GREEN,
    head: GREEN,
    size,
    body: (top) => cells(BOTH, { x: 17, y: top, w: inner, size: size - 1 }),
  });
  out.push(...first.parts);
  y += first.h + 12;
  const second = band({
    y,
    w,
    title: "Built on the companies' side",
    fill: "none",
    stroke: GREEN,
    head: INK,
    size,
    body: (top) =>
      grid(COMPANIES_ONLY, {
        x: 17,
        y: top,
        w: inner,
        cols,
        kind: "green",
        size,
        subSize,
        pad,
      }),
  });
  out.push(...second.parts);
  y += second.h + 12;
  const third = band({
    y,
    w,
    title: "Left out on both sides",
    fill: "none",
    stroke: LINE_STRONG,
    dash: "5 4",
    head: INK,
    size,
    body: (top) =>
      grid(NEITHER, {
        x: 17,
        y: top,
        w: inner,
        cols,
        kind: "plain",
        size,
        subSize,
        pad,
      }),
  });
  out.push(...third.parts);
  y += third.h + 24;
  const note = wrap(NOTE, subSize, 400, w);
  out.push(
    ...lines(note, {
      x: 1,
      y,
      size: subSize,
      fill: MUTED,
      lineHeight: subSize + 4,
    }),
  );
  y += (note.length - 1) * (subSize + 4) + 6;
  return svg(W, y, out);
}

export default {
  name: "coverage-map",
  alt: "What Poppy Lab built against PAP 1.0 and Operations v3. Built in Iris and all five companies: discovery, agent identity, Direct Sign-In, DPoP tokens, revocation, Sessions, OpenAPI, MCP, Conversations, handoff, Direct Conversations, tasks and feedback, Operations v3, standing instructions, and the FDX-shaped and ESPI-shaped extensions. Built on the companies' side only: browser join, on all five websites, while Iris drives no browser; skills, published by all five, which Iris lists without loading; and Device Sign-In, at every company but Harborline, while the playground uses Direct Sign-In. Left out on both sides: Mediated Sign-In, which retires on 17 March 2027; operations on website forms, since joined browsers only read; and several protocol versions, since the companies serve 1.0 only. The official implementation kit's validator checks the live companies, and the lab's own suites cover what it doesn't reach, such as consent pages and the extensions.",
  caption:
    "What works end to end, what only the companies' side has, and what neither side has, as the coverage map records it.",
  draw: (variant) =>
    variant === "wide"
      ? draw({ W: 720, cols: 3, size: 15, subSize: 14, pad: 14 })
      : draw({ W: 360, cols: 1, size: 14, subSize: 13, pad: 12 }),
};

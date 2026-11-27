import {
  GREEN,
  GREEN_WASH,
  MUTED,
  arrow,
  card,
  centred,
  lines,
  rect,
  svg,
  text,
  wrap,
} from "../../draw.mjs";

/**
 * Extensions (the eighth post): the same Poppy core at every company, with a
 * sector's shape on top where an industry already has one, FDX at Harborline
 * and ESPI at Fernwick, and nothing on top at Lantern, whose menu needs no
 * standard. Both extensions only read; changes stay behind Operations v3.
 */

const COLUMNS = [
  {
    company: "Harborline Bank",
    kind: "green",
    title: "poppylab.dev/fdx v1",
    sub: [
      "FDX consent clusters as scopes, such as fdx:TRANSACTIONS",
      "accounts chosen at consent, with a consent_id tied to the grant",
      "JSON at /fdx/v6",
    ],
  },
  {
    company: "Fernwick Power & Light",
    kind: "green",
    title: "poppylab.dev/espi v1",
    sub: [
      "espi:usage, espi:summary and espi:customer as scopes",
      "meters chosen at consent",
      "Atom XML, with no OpenAPI file",
    ],
  },
  {
    company: "Lantern Noodle Bar",
    kind: "frame",
    title: "No extension",
    sub: [
      "its menu and orders need no shared standard: OpenAPI and MCP describe them",
    ],
  },
];
const CORE = ["Discovery", "Identity", "OAuth consent", "Sessions"];
const NOTES = [
  "An agent declares an extension in Poppy-Extensions on every request; without it, 403 extension_required.",
  "Both extensions only read. Moving money and switching plans stay behind Operations v3 approvals.",
];

/** The core band: Poppy's own, the same at every company. */
function core({ y, w, cols, cellH, size }) {
  const rows = Math.ceil(CORE.length / cols);
  const cellW = (w - 32 - (cols - 1) * 10) / cols;
  const h = 44 + rows * cellH + (rows - 1) * 10 + 16;
  const out = [
    rect({ x: 1, y, w, h, rx: 8, fill: GREEN_WASH, stroke: GREEN }),
    text("Poppy's core, the same at every company", {
      x: 17,
      y: y + 27,
      size: size + 1,
      weight: 600,
      fill: GREEN,
    }),
  ];
  CORE.forEach((name, i) => {
    const x = 17 + (i % cols) * (cellW + 10);
    const cy = y + 44 + Math.floor(i / cols) * (cellH + 10);
    out.push(
      rect({ x, y: cy, w: cellW, h: cellH, stroke: GREEN }),
      ...centred([name], {
        cx: x + cellW / 2,
        cy: cy + cellH / 2,
        size,
        lineHeight: 19,
        weight: 500,
      }),
    );
  });
  return { parts: out, h };
}

function wide() {
  const out = [];
  const w = 230;
  const gap = 14;
  const cards = COLUMNS.map((c, i) => ({
    ...c,
    x: 1 + i * (w + gap),
    h: card({ x: 0, y: 0, w, title: c.title, sub: c.sub }).h,
  }));
  const tallest = Math.max(...cards.map((c) => c.h));
  for (const c of cards) {
    out.push(
      text(c.company, { x: c.x, y: 18, size: 15, weight: 600 }),
      card({
        kind: c.kind,
        x: c.x,
        y: 32,
        w,
        h: tallest,
        title: c.title,
        sub: c.sub,
      }).svg,
      arrow({
        points: [
          [c.x + w / 2, 32 + tallest],
          [c.x + w / 2, 32 + tallest + 28],
        ],
      }),
    );
  }
  const band = core({
    y: 32 + tallest + 28,
    w: 718,
    cols: 4,
    cellH: 44,
    size: 15,
  });
  out.push(...band.parts);
  let y = 32 + tallest + 28 + band.h + 26;
  for (const note of NOTES) {
    const ls = wrap(note, 14, 400, 716);
    out.push(...lines(ls, { x: 1, y, size: 14, fill: MUTED, lineHeight: 18 }));
    y += ls.length * 18 + 4;
  }
  return svg(720, y - 14, out);
}

function narrow() {
  const out = [];
  let y = 1;
  for (const c of COLUMNS) {
    out.push(text(c.company, { x: 1, y: y + 16, size: 14, weight: 600 }));
    const k = card({
      kind: c.kind,
      x: 1,
      y: y + 28,
      w: 358,
      title: c.title,
      sub: c.sub,
      size: 14,
      subSize: 13,
      pad: 12,
    });
    out.push(k.svg);
    y += 28 + k.h + 16;
  }
  // Stacked, every company's column rests on the one core below.
  y += 4;
  const band = core({ y, w: 358, cols: 2, cellH: 40, size: 14 });
  out.push(...band.parts);
  y += band.h + 24;
  for (const note of NOTES) {
    const ls = wrap(note, 13, 400, 356);
    out.push(...lines(ls, { x: 1, y, size: 13, fill: MUTED, lineHeight: 17 }));
    y += ls.length * 17 + 4;
  }
  return svg(360, y - 13, out);
}

export default {
  name: "sector-shapes",
  alt: "Three companies over the same Poppy core of discovery, identity, OAuth consent and Sessions. Harborline Bank adds the poppylab.dev/fdx extension, version 1: FDX consent clusters as scopes, such as fdx:TRANSACTIONS, accounts chosen at consent with a consent_id tied to the grant, and JSON at /fdx/v6. Fernwick Power & Light adds poppylab.dev/espi, version 1: espi:usage, espi:summary and espi:customer as scopes, meters chosen at consent, and Atom XML with no OpenAPI file. Lantern Noodle Bar adds no extension, because its menu and orders need no shared standard and OpenAPI and MCP describe them. An agent declares an extension in Poppy-Extensions on every request, and without it gets 403 extension_required. Both extensions only read; moving money and switching plans stay behind Operations v3 approvals.",
  caption:
    "A sector's standard sits on top of the core where an industry has one, and the core stays the same at every company.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

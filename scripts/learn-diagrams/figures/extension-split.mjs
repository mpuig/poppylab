import {
  GREEN,
  GREEN_LIGHT,
  GREEN_WASH,
  INK,
  LINE_STRONG,
  MUTED,
  PAPER,
  TINT,
  arrow,
  line,
  rect,
  svg,
  text,
  wrap,
} from "../draw.mjs";

/**
 * Who handles what when a domain standard reaches an agent through Poppy
 * (docs/learn/extensions/README.md, at Harborline): what Poppy handles, what
 * the extension adds, and what stays with the bank. Green is the protocol's
 * side, the extension included; the bank's own API stays neutral.
 */

const ZONES = [
  {
    key: "poppy",
    title: "Poppy handles",
    rows: [
      { name: "Discovery", sub: "the bank, its issuer and its URLs" },
      {
        name: "Who the agent and user are",
        sub: "client metadata and the Session",
      },
      { name: "Signing in", sub: "scopes, refresh, revocation" },
    ],
  },
  {
    key: "extension",
    title: "The extension adds",
    rows: [
      {
        name: "FDX's consent clusters",
        sub: "as scopes, the same at every bank",
      },
      {
        name: "Which accounts are shared",
        sub: "chosen at consent, for the whole grant",
      },
      {
        name: "A consent record",
        sub: "tied to the grant; begins and ends with it",
      },
    ],
  },
  {
    key: "bank",
    title: "The bank keeps",
    rows: [
      { name: "Accounts, transactions, statements", sub: "the FDX-shaped API" },
      { name: "Moving money", sub: "the bank's own API, with Operations v3" },
    ],
  },
];

const LOOK = {
  poppy: { fill: GREEN_WASH, stroke: GREEN, rule: GREEN_LIGHT, head: GREEN },
  extension: { fill: PAPER, stroke: GREEN, rule: GREEN_LIGHT, head: GREEN },
  bank: { fill: TINT, stroke: INK, rule: LINE_STRONG, head: INK },
};

/**
 * A zone: a titled panel whose rows are a name over a muted line, divided by
 * hairlines. Returns its parts and its height.
 */
function zone(spec, { x, y, w, t }) {
  const look = LOOK[spec.key];
  const inner = w - 32;
  const parts = [];
  let top = y + t.head;
  const body = [];
  spec.rows.forEach((row, i) => {
    const name = wrap(row.name, t.name, 600, inner);
    const sub = wrap(row.sub, t.sub, 400, inner);
    const height = 24 + name.length * t.nameLH + 2 + sub.length * t.subLH;
    if (i > 0)
      body.push(
        line({
          x1: x + 16,
          y1: top,
          x2: x + w - 16,
          y2: top,
          stroke: look.rule,
        }),
      );
    let base = top + 12 + t.nameLH / 2 + t.name * 0.35;
    name.forEach((string, j) =>
      body.push(
        text(string, {
          x: x + 16,
          y: base + j * t.nameLH,
          size: t.name,
          weight: 600,
        }),
      ),
    );
    base += (name.length - 1) * t.nameLH + t.nameLH / 2 + 2 + t.subLH / 2;
    sub.forEach((string, j) =>
      body.push(
        text(string, {
          x: x + 16,
          y: base + j * t.subLH,
          size: t.sub,
          fill: MUTED,
        }),
      ),
    );
    top += height;
  });
  const h = top - y + 4;
  parts.push(
    rect({ x, y, w, h, rx: 8, fill: look.fill, stroke: look.stroke }),
    text(spec.title, {
      x: x + 16,
      y: y + t.head / 2 + t.title * 0.35,
      size: t.title,
      weight: 600,
      fill: look.head,
    }),
    line({
      x1: x + 16,
      y1: y + t.head,
      x2: x + w - 16,
      y2: y + t.head,
      stroke: look.rule,
    }),
    ...body,
  );
  return { parts, h };
}

function wide() {
  const t = { head: 40, title: 16, name: 15, nameLH: 19, sub: 14, subLH: 17 };
  const at = [
    { x: 1, w: 200 },
    { x: 217, w: 232 },
    { x: 529, w: 190 },
  ];
  const out = [];
  let height = 0;
  ZONES.forEach((spec, i) => {
    const z = zone(spec, { ...at[i], y: 1, t });
    out.push(...z.parts);
    height = Math.max(height, z.h + 2);
  });
  const y = 1 + t.head / 2;
  out.push(
    arrow({
      points: [
        [at[1].x + at[1].w, y],
        [at[2].x, y],
      ],
    }),
    text("points at", {
      x: (at[1].x + at[1].w + at[2].x) / 2,
      y: y - 8,
      size: 14,
      fill: MUTED,
      anchor: "middle",
    }),
  );
  return svg(720, height, out);
}

function narrow() {
  const t = { head: 40, title: 15, name: 14, nameLH: 18, sub: 13, subLH: 16 };
  const out = [];
  let y = 1;
  ZONES.forEach((spec, i) => {
    const z = zone(spec, { x: 1, y, w: 358, t });
    out.push(...z.parts);
    y += z.h;
    if (i === 1) {
      out.push(
        arrow({
          points: [
            [33, y],
            [33, y + 40],
          ],
        }),
        text("points at", {
          x: 49,
          y: y + 20 + 14 * 0.35,
          size: 14,
          fill: MUTED,
        }),
      );
      y += 40;
    } else y += 16;
  });
  return svg(360, y - 16 + 1, out);
}

export default {
  name: "extension-split",
  alt: "Three columns say who handles each concern when bank data reaches an agent through an FDX-shaped extension at Harborline. Poppy handles discovery of the bank, its issuer and its URLs, who the agent and user are through client metadata and the Session, and signing in with scopes, refresh and revocation. The extension adds FDX's consent clusters as scopes, which accounts are shared, and a consent record tied to the grant, and it points at the bank's API. That API, the FDX-shaped one for accounts, transactions and statements, stays with the bank, as does moving money, through the bank's own API with Operations v3.",
  caption:
    "Poppy handles who the agent is and how it signs in, the extension ties the domain's consent to the grant, and the bank keeps its own API and the moving of money.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

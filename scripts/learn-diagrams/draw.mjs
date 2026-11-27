/**
 * What every Learn figure is drawn with: DESIGN.md's tokens as literal values
 * (a standalone SVG has no stylesheet), a few primitives that emit plain
 * attributes, and `sequence`, which draws the figures that show who sends what
 * to whom. A figure lives in its own file under ./figures/.
 *
 * The grammar of DESIGN.md, in short:
 * - You is the solid ink node, the agent an outline on paper, the company an
 *   outline on tint. Nothing else gets a fill from the neutrals' set.
 * - Green is Poppy: connectors, arrowheads, the protocol's side of a
 *   comparison. What stands for life without Poppy stays neutral.
 * - Amber is the person's: what waits for them, or what only they do. It is
 *   a 1px border on amber wash, a small dot, never a large fill.
 * - A request is a solid line and a reply a dashed one (5 on, 4 off), with a
 *   small solid triangle for the head.
 * - Strokes: 1px for rules and frames, 1.2px for node outlines, 1.5px for
 *   connectors. Corners: 6px for nodes, 8px for panels and frames, 4px for
 *   tags. Elbows are 8px. Everything sits on a 4px grid where it can.
 * - Type is Hanken Grotesk (the page's, once the figure is set inline): 15px
 *   for labels on the wide drawing, 14px on the narrow one, 600 for names.
 *   No capitals, no letter-spacing. No shadows, no gradients.
 * - A drawing has no classes, no ids and no scripts, so several can share a
 *   page.
 */

// DESIGN.md's colours.
export const INK = "#171a1f";
export const INK_SOFT = "#3a4049";
export const MUTED = "#5b626c";
export const ON_INK_MUTED = "#c4c9d0";
export const PAPER = "#ffffff";
export const TINT = "#f4f6f7";
export const LINE = "#e3e6ea";
export const LINE_STRONG = "#c9ced5";
export const GREEN = "#0d5c4a";
export const GREEN_DEEP = "#0a4a3b";
export const GREEN_MID = "#4f9484";
export const GREEN_LIGHT = "#9cc7bb";
export const GREEN_WASH = "#eaf3f0";
export const AMBER = "#f2b705";
export const AMBER_WASH = "#fff6d6";
export const SANS = "'Hanken Grotesk','Helvetica Neue',Arial,sans-serif";
/** For the numeral of a step on a rail, and nothing else (DESIGN.md: the one serif job). */
export const SERIF = "'STIX Two Text',Georgia,serif";

/** Two decimals at most, and none when the number is whole. */
export const n = (value) => String(Number(value.toFixed(2)));
export const esc = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A generous estimate of a line's width in this face, for label grounds. */
export const textWidth = (text, size, weight = 500) =>
  text.length * size * (weight >= 600 ? 0.56 : 0.54);
/** The same facts for both widths: `pair(wide, narrow)`. */
export const pair = (wide, narrow = wide) => ({ wide, narrow });

// ---------------------------------------------------------------------------
// Primitives. Each returns one string of SVG.

export function rect({
  x,
  y,
  w,
  h,
  rx = 6,
  fill = PAPER,
  stroke = INK,
  sw = 1.2,
  dash,
}) {
  const border = stroke
    ? ` stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}`
    : "";
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${rx}" fill="${fill}"${border}/>`;
}

/** One line of text. `anchor` is "start", "middle" or "end". */
export function text(
  string,
  { x, y, size = 15, weight = 400, fill = INK, anchor = "start", family },
) {
  const a = anchor === "start" ? "" : ` text-anchor="${anchor}"`;
  const f = family ? ` font-family="${family}"` : "";
  return `<text x="${n(x)}" y="${n(y)}"${a}${f} font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(string)}</text>`;
}

/** Several lines, `lineHeight` apart; `y` is the first line's baseline. */
export function lines(strings, { x, y, lineHeight = 19, ...style }) {
  return strings.map((s, i) => text(s, { x, y: y + i * lineHeight, ...style }));
}

export function line({ x1, y1, x2, y2, stroke = LINE_STRONG, sw = 1, dash }) {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

export function dot({ cx, cy, r = 4, fill = AMBER }) {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${r}" fill="${fill}"/>`;
}

/** A small solid triangle whose tip is at (x, y), pointing along (dx, dy). */
function head(x, y, dx, dy, color) {
  const bx = x - dx * 8;
  const by = y - dy * 8;
  const px = -dy * 4.5;
  const py = dx * 4.5;
  return `<path d="M${n(x)} ${n(y)}L${n(bx + px)} ${n(by + py)}L${n(bx - px)} ${n(by - py)}Z" fill="${color}"/>`;
}

/**
 * A connector through `points` ([[x, y], ...], every segment horizontal or
 * vertical), with 8px elbows and a solid triangle at the end (and at the start
 * with `both`). `dash` makes it a reply.
 */
export function arrow({
  points,
  color = GREEN,
  sw = 1.5,
  dash = false,
  both = false,
  radius = 8,
}) {
  const unit = (a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  const first = unit(points[0], points[1]);
  const last = unit(points[points.length - 2], points[points.length - 1]);
  const start = [...points[0]];
  const end = [...points[points.length - 1]];
  // The stroke stops at the base of each triangle.
  const from = both
    ? [start[0] + first[0] * 8, start[1] + first[1] * 8]
    : start;
  const to = [end[0] - last[0] * 8, end[1] - last[1] * 8];
  const way = [from, ...points.slice(1, -1), to];
  let d = `M${n(way[0][0])} ${n(way[0][1])}`;
  for (let i = 1; i < way.length; i++) {
    const [px, py] = way[i - 1];
    const [cx, cy] = way[i];
    if (i < way.length - 1) {
      const [nx, ny] = way[i + 1];
      const a = unit([px, py], [cx, cy]);
      const b = unit([cx, cy], [nx, ny]);
      const r = Math.min(
        radius,
        Math.hypot(cx - px, cy - py) / 2,
        Math.hypot(nx - cx, ny - cy) / 2,
      );
      d += `L${n(cx - a[0] * r)} ${n(cy - a[1] * r)}Q${n(cx)} ${n(cy)} ${n(cx + b[0] * r)} ${n(cy + b[1] * r)}`;
    } else d += `L${n(cx)} ${n(cy)}`;
  }
  return [
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}"${dash ? ' stroke-dasharray="5 4"' : ""}/>`,
    head(end[0], end[1], last[0], last[1], color),
    ...(both ? [head(start[0], start[1], -first[0], -first[1], color)] : []),
  ].join("\n  ");
}

/**
 * The amber tag of what only the person does: wash, 1px amber border, 4px
 * corners, 600 ink text. Returns its string and its width.
 */
export function tag({ x, y, string, size = 15, anchor = "middle", h = 28 }) {
  const w = textWidth(string, size, 600) + 20;
  const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return {
    width: w,
    svg: [
      rect({ x: left, y, w, h, rx: 4, fill: AMBER_WASH, stroke: AMBER, sw: 1 }),
      text(string, {
        x: left + w / 2,
        y: y + h / 2 + size * 0.35,
        size,
        weight: 600,
        anchor: "middle",
      }),
    ].join("\n  "),
  };
}

/**
 * A party or a part: `kind` is "you" (solid ink), "agent" (outline on paper),
 * "company" (outline on tint) or "plain" (outline on paper, for things that
 * are not a party). A title, and an optional second line in muted ink.
 */
export function node({ kind = "plain", x, y, w, h, title, sub, size = 16 }) {
  const fill = { you: INK, agent: PAPER, company: TINT, plain: PAPER }[kind];
  const ink = kind === "you" ? PAPER : INK;
  const quiet = kind === "you" ? ON_INK_MUTED : MUTED;
  const out = [rect({ x, y, w, h, fill })];
  const cx = x + w / 2;
  if (sub) {
    out.push(
      text(title, {
        x: cx,
        y: y + h / 2 - 2,
        size,
        weight: 600,
        fill: ink,
        anchor: "middle",
      }),
      text(sub, {
        x: cx,
        y: y + h / 2 + size - 1,
        size: size - 2,
        fill: quiet,
        anchor: "middle",
      }),
    );
  } else {
    out.push(
      text(title, {
        x: cx,
        y: y + h / 2 + size * 0.35,
        size,
        weight: 600,
        fill: ink,
        anchor: "middle",
      }),
    );
  }
  return out.join("\n  ");
}

/** A dashed frame: a group, or a boundary. */
export function frame({ x, y, w, h, rx = 8 }) {
  return rect({
    x,
    y,
    w,
    h,
    rx,
    fill: "none",
    stroke: LINE_STRONG,
    sw: 1,
    dash: "5 4",
  });
}

/** The drawing: the viewBox is its whole size. */
export function svg(width, height, parts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${SANS}">\n  ${parts.join("\n  ")}\n</svg>\n`;
}

// ---------------------------------------------------------------------------
// Sequences.

/** The layouts of a figure with the user, the agent and the company. */
export const THREE_PARTIES = {
  wide: {
    width: 720,
    font: 15,
    x: { user: 96, agent: 360, company: 624 },
    head: [168, 48],
    edge: 8,
    // A label sits centred over its line.
    anchor: () => "mid",
  },
  narrow: {
    width: 360,
    font: 14,
    x: { user: 56, agent: 180, company: 304 },
    head: [100, 44],
    edge: 12,
    // A label starts at the left edge on the user's rows and ends at the right
    // edge on the others, so a line of text never runs off the drawing.
    anchor: (message) =>
      message.from === "user" || message.to === "user" ? "start" : "end",
  },
};

/** A message between two parties: `lines` is a `pair` of arrays of lines. */
export const msg = (from, to, lines, extra = {}) => ({
  kind: "msg",
  from,
  to,
  lines,
  ...extra,
});

/**
 * A sequence figure: parties across the top, each with a lifeline, and the
 * rows beneath in the order they happen.
 *
 *   spec.parties  { id: { kind: "you" | "agent" | "company" | "plain", label:
 *                 pair } }
 *   spec.layout   { wide, narrow } as THREE_PARTIES: width, font, x by party
 *                 id, head [w, h], edge, and anchor(message) -> "mid" |
 *                 "start" | "end"
 *   spec.items    msg(...); { kind: "gate", text: pair } (an amber band: what
 *                 waits for the person); { kind: "frame-start" } ... {
 *                 kind: "frame-end" } (a dashed group); { kind: "guard", text:
 *                 pair } (a muted condition at the top of a group);
 *                 { kind: "rule" } (a hairline between two cases)
 *
 * A message with `reply: true` is dashed; one with `tag: true` has an amber
 * label, for the one thing only the person does.
 */
export function sequence(spec, variant) {
  const v = spec.layout[variant];
  const pick = (value) => value[variant];
  const { width: W, font: fs, x: at } = v;
  const [headW, headH] = v.head;
  const lineHeight = Math.round(fs * 1.25);
  const out = [];

  // Where each row sits, from the top down.
  let y = headH + 14;
  const rows = [];
  for (const item of spec.items) {
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
    const { kind, label } = spec.parties[name];
    const fill = { you: INK, agent: PAPER, company: TINT, plain: PAPER }[kind];
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
      lines.forEach((string, i) =>
        out.push(
          `<text x="${n(tx)}" y="${n(top + 5 + (i + 1) * lineHeight - 3)}" text-anchor="${textAnchor}" font-size="${fs}" font-weight="${item.tag ? 600 : 500}" fill="${INK}">${esc(string)}</text>`,
        ),
      );
    }
  }

  return svg(W, H, out);
}

/**
 * A sequence's muted guard text gets a paper ground, so a lifeline does not
 * run through it.
 */
export function groundGuards(drawing) {
  return drawing.replace(
    /<text x="28" y="([\d.]+)" font-size="(\d+)" fill="#5b626c">([^<]*)<\/text>/g,
    (whole, y, size, label) =>
      `${rect({ x: 24, y: Number(y) - Number(size), w: textWidth(label, Number(size)) + 8, h: Number(size) + 6, fill: PAPER, stroke: null })}\n  ${whole}`,
  );
}

// ---------------------------------------------------------------------------
// Text that wraps, and the boxes built from it.

/** Greedy wrap by the generous width estimate, so a line never runs long. */
export function wrap(string, size, weight, max) {
  const out = [];
  let current = "";
  for (const word of string.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (current && textWidth(next, size, weight) > max) {
      out.push(current);
      current = word;
    } else current = next;
  }
  out.push(current);
  return out;
}

/** Lines of text centred on (cx, cy). */
export function centred(
  strings,
  { cx, cy, size, lineHeight, weight, fill = INK },
) {
  const top = cy - ((strings.length - 1) * lineHeight) / 2 + size * 0.35;
  return strings.map((string, i) =>
    text(string, {
      x: cx,
      y: top + i * lineHeight,
      size,
      weight,
      fill,
      anchor: "middle",
    }),
  );
}

/** How each kind of card is drawn: its ground, its border and its text. */
const CARD = {
  you: { fill: INK, stroke: INK, title: PAPER, sub: ON_INK_MUTED },
  agent: { fill: PAPER, stroke: INK, title: INK, sub: MUTED },
  company: { fill: TINT, stroke: INK, title: INK, sub: MUTED },
  plain: { fill: PAPER, stroke: INK, title: INK, sub: MUTED },
  // The protocol's side: Poppy itself on green wash, a part of it in green.
  poppy: { fill: GREEN_WASH, stroke: GREEN, title: GREEN, sub: INK_SOFT },
  green: { fill: PAPER, stroke: GREEN, title: INK, sub: MUTED },
  // What waits for the person, as a gate draws it.
  wait: { fill: AMBER_WASH, stroke: AMBER, sw: 1, title: INK, sub: INK_SOFT },
  // A group or a boundary, as `frame` draws it.
  frame: {
    fill: "none",
    stroke: LINE_STRONG,
    sw: 1,
    dash: "5 4",
    title: INK,
    sub: MUTED,
  },
};

/**
 * A card: a title (600) over muted lines, left-aligned and wrapped to its
 * width. `sub` is a string or an array of them, each starting a new line. `h`
 * is a least height, so the cards of a row can match; `dot` puts the amber
 * dot of what waits for the person at the top right. With `cy` in place of
 * `y`, the card is centred on that line. Returns { svg, h }.
 */
export function card(spec) {
  if (spec.cy !== undefined) {
    const { cy, ...rest } = spec;
    return card({ ...rest, y: cy - card({ ...rest, y: 0 }).h / 2 });
  }
  const {
    kind = "plain",
    x,
    y,
    w,
    h: least = 0,
    title,
    sub = [],
    size = 15,
    subSize = size - 1,
    pad = 14,
    rx = 6,
    dot: waits = false,
  } = spec;
  const look = CARD[kind];
  const inner = w - pad * 2 - (waits ? 12 : 0);
  const titleLH = Math.round(size * 1.27);
  const subLH = Math.round(subSize * 1.3);
  const heads = title ? wrap(title, size, 600, inner) : [];
  // Each line, and whether it starts a paragraph after another one.
  const subs = (Array.isArray(sub) ? sub : [sub]).flatMap((s, p) =>
    wrap(s, subSize, 400, inner).map((string, i) => ({
      string,
      gap: p > 0 && i === 0 ? 5 : 0,
    })),
  );
  const parts = [];
  let base = y + pad + size * 0.8;
  heads.forEach((string, i) => {
    if (i) base += titleLH;
    parts.push(
      text(string, {
        x: x + pad,
        y: base,
        size,
        weight: 600,
        fill: look.title,
      }),
    );
  });
  subs.forEach(({ string, gap }, i) => {
    if (i || heads.length)
      base += (heads.length && !i ? subLH + 1 : subLH) + gap;
    else base = y + pad + subSize * 0.8;
    parts.push(
      text(string, { x: x + pad, y: base, size: subSize, fill: look.sub }),
    );
  });
  const h = Math.max(least, base - y + pad - 1);
  const out = [
    rect({
      x,
      y,
      w,
      h,
      rx,
      fill: look.fill,
      stroke: look.stroke,
      sw: look.sw ?? 1.2,
      dash: look.dash,
    }),
    ...parts,
  ];
  if (waits) out.push(dot({ cx: x + w - 12, cy: y + 12, r: 4 }));
  return { svg: out.join("\n  "), h };
}

/**
 * A chain: cards one under the other, each step an arrow down from the last.
 * `cards` are card specs; `heights` gives the row heights of chains set side
 * by side, so their rows line up. Returns { parts, bottom, firstCy }.
 */
export function chain(cards, { x, y, w, gap = 24, heights, ...style }) {
  const parts = [];
  let top = y;
  let firstCy = 0;
  cards.forEach((spec, i) => {
    const c = card({ ...style, ...spec, x, y: top, w, h: heights?.[i] ?? 0 });
    parts.push(c.svg);
    if (i === 0) firstCy = top + c.h / 2;
    top += c.h;
    if (i < cards.length - 1) {
      parts.push(
        arrow({
          points: [
            [x + 24, top],
            [x + 24, top + gap],
          ],
        }),
      );
      top += gap;
    }
  });
  return { parts, bottom: top, firstCy };
}

/** The heights of the rows of chains set side by side, each its tallest card. */
export function rowHeights(columns, { w, ...style }) {
  const rows = Math.max(...columns.map((c) => c.length));
  return Array.from({ length: rows }, (_, r) =>
    Math.max(
      ...columns
        .filter((c) => c[r])
        .map((c) => card({ ...style, ...c[r], x: 0, y: 0, w }).h),
    ),
  );
}

/**
 * The comparison: rows of one thing done two ways, the way without Poppy in
 * muted ink and the way with it on green wash. `spec` is { heads: [without,
 * with], rows: [{ head, without, with }] }. On the narrow drawing each row is
 * stacked: its head, then each way under its own label.
 */
export function compare(spec, variant) {
  const out = [];
  if (variant === "wide") {
    const size = 15;
    const lh = 19;
    const col = [
      { x: 1, w: 150 },
      { x: 167, w: 260 },
      { x: 443, w: 276 },
    ];
    const pad = 16;
    const rows = spec.rows.map((row) => {
      const cells = [
        wrap(row.head, size, 600, col[0].w - 4),
        wrap(row.without, size, 400, col[1].w - 8),
        wrap(row.with, size, 400, col[2].w - pad * 2),
      ];
      return {
        cells,
        h: Math.max(...cells.map((c) => c.length)) * lh + 22,
      };
    });
    const top = 44;
    const H = top + rows.reduce((s, r) => s + r.h, 0) + 6;
    out.push(
      rect({
        x: col[2].x,
        y: 1,
        w: col[2].w,
        h: H - 2,
        rx: 8,
        fill: GREEN_WASH,
        stroke: GREEN,
        sw: 1,
      }),
      text(spec.heads[0], {
        x: col[1].x,
        y: 28,
        size: 16,
        weight: 600,
        fill: MUTED,
      }),
      text(spec.heads[1], {
        x: col[2].x + pad,
        y: 28,
        size: 16,
        weight: 600,
        fill: GREEN,
      }),
    );
    let y = top;
    rows.forEach((row, i) => {
      out.push(
        line({
          x1: 1,
          y1: y,
          x2: col[1].x + col[1].w,
          y2: y,
          stroke: i ? LINE : LINE_STRONG,
        }),
        line({
          x1: col[2].x + pad,
          y1: y,
          x2: col[2].x + col[2].w - pad,
          y2: y,
          stroke: GREEN_LIGHT,
        }),
      );
      const at = [col[0].x, col[1].x, col[2].x + pad];
      row.cells.forEach((cell, c) =>
        out.push(
          ...lines(cell, {
            x: at[c],
            y: y + 11 + size * 0.95,
            lineHeight: lh,
            size,
            weight: c === 0 ? 600 : 400,
            fill: c === 1 ? MUTED : INK,
          }),
        ),
      );
      y += row.h;
    });
    return svg(720, H, out);
  }
  const size = 14;
  const lh = 18;
  const w = 358;
  let y = 1;
  spec.rows.forEach((row, i) => {
    if (i) y += 16;
    const head = wrap(row.head, 15, 600, w);
    out.push(
      line({ x1: 1, y1: y, x2: 359, y2: y, stroke: i ? LINE : LINE_STRONG }),
      ...lines(head, {
        x: 1,
        y: y + 24,
        lineHeight: 19,
        size: 15,
        weight: 600,
      }),
    );
    y += 24 + (head.length - 1) * 19 + 8;
    const without = wrap(row.without, size, 400, w - 4);
    out.push(
      text(spec.heads[0], {
        x: 1,
        y: y + 12,
        size: 13,
        weight: 600,
        fill: MUTED,
      }),
      ...lines(without, { x: 1, y: y + 30, lineHeight: lh, size, fill: MUTED }),
    );
    y += 30 + (without.length - 1) * lh + 12;
    const withPoppy = wrap(row.with, size, 400, w - 28);
    const boxH = 34 + withPoppy.length * lh;
    out.push(
      rect({
        x: 1,
        y,
        w,
        h: boxH,
        rx: 8,
        fill: GREEN_WASH,
        stroke: GREEN,
        sw: 1,
      }),
      text(spec.heads[1], {
        x: 13,
        y: y + 20,
        size: 13,
        weight: 600,
        fill: GREEN,
      }),
      ...lines(withPoppy, { x: 13, y: y + 38, lineHeight: lh, size }),
    );
    y += boxH;
  });
  return svg(360, y + 1, out);
}

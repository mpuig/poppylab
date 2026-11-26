import {
  AMBER,
  INK,
  INK_SOFT,
  LINE,
  LINE_STRONG,
  MUTED,
  PAPER,
  arrow,
  dot,
  frame,
  line,
  rect,
  svg,
  text,
  textWidth,
} from "../draw.mjs";

/**
 * Where the model stops and plain code takes over (docs/learn/build-an-agent.md,
 * "The pieces"): the model's side, a dashed edge that tool calls and results
 * cross, and the agent's own code with its six pieces and what it keeps from
 * the model. The amber dot is the user's decision, the one thing no code makes.
 */

const MODEL_ROWS = [
  {
    name: "Calls tools",
    sub: "that take parameters, not arbitrary destinations",
  },
  { name: "Sees Company content", sub: "marked as data, never instructions" },
  { name: "Sees a change's terms", sub: "with a note that nothing was done" },
];

const PIECES = [
  { name: "Identity", sub: "no registration" },
  { name: "Users and Sessions", sub: "an ID per Company" },
  { name: "Safe fetching", sub: "of Company URLs" },
  { name: "Before the first task", sub: "interfaces into tools" },
  { name: "Sign-in", sub: "plain OAuth" },
  { name: "Approvals", sub: "the user decides", person: true },
];

const KEPT = [
  "Tokens",
  "Authorization codes",
  "Authorization URL",
  "Private keys",
  "Session JWTs",
  "OAuth state",
];

/** Greedy wrap by the generous width estimate, so a line never runs long. */
function wrap(string, size, weight, max) {
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

/** The model's side: a dashed frame with its name and ruled rows. */
function modelSide({ x, y, w, t }) {
  const inner = w - 32;
  const body = [
    text("The model", { x: x + 16, y: y + 28, size: t.title, weight: 600 }),
  ];
  let top = y + 40;
  MODEL_ROWS.forEach((row) => {
    const sub = wrap(row.sub, t.sub, 400, inner);
    body.push(
      line({ x1: x + 16, y1: top, x2: x + w - 16, y2: top, stroke: LINE }),
      text(row.name, {
        x: x + 16,
        y: top + 12 + t.nameLH / 2 + t.name * 0.35,
        size: t.name,
        weight: 600,
      }),
    );
    sub.forEach((string, j) =>
      body.push(
        text(string, {
          x: x + 16,
          y: top + 12 + t.nameLH + 2 + t.subLH / 2 + t.sub * 0.35 + j * t.subLH,
          size: t.sub,
          fill: MUTED,
        }),
      ),
    );
    top += 24 + t.nameLH + 2 + sub.length * t.subLH;
  });
  const h = top - y + 4;
  return { h, parts: [frame({ x, y, w, h }), ...body] };
}

/** One piece of the agent: its numeral and name, and a muted line about it. */
function piece(p, i, { x, y, rowH, t, inline }) {
  const stack = t.nameLH + 2 + t.subLH;
  const first = y + (rowH - (inline ? t.nameLH : stack)) / 2;
  const nameBase = first + t.nameLH / 2 + t.name * 0.35;
  const parts = [
    text(String(i + 1), {
      x,
      y: nameBase,
      size: t.sub,
      weight: 600,
      fill: MUTED,
    }),
    text(p.name, { x: x + 18, y: nameBase, size: t.name, weight: 600 }),
  ];
  let sx = x + 18;
  let sy = first + t.nameLH + 2 + t.subLH / 2 + t.sub * 0.35;
  if (inline) {
    sx = x + 18 + textWidth(p.name, t.name, 600) + 10;
    sy = nameBase;
  }
  if (p.person) {
    parts.push(dot({ cx: sx + 4, cy: sy - t.sub * 0.35, r: 4, fill: AMBER }));
    sx += 16;
  }
  parts.push(text(p.sub, { x: sx, y: sy, size: t.sub, fill: MUTED }));
  return parts;
}

/** The agent's code: its head, its pieces in a grid, and what it keeps. */
function codeSide({ x, y, w, t, columns, pad }) {
  const out = [];
  const inner = w - 2 * pad;
  const left = x + pad;
  const rowH = columns === 2 ? 64 : 40;
  const gap = 16;
  const colW = (inner - (columns - 1) * gap) / columns;
  const colX = (c) => left + c * (colW + gap);
  out.push(
    text("The agent's code", {
      x: left,
      y: y + 28,
      size: t.title,
      weight: 600,
    }),
    text("deterministic code", {
      x: left,
      y: y + 48,
      size: t.sub,
      fill: MUTED,
    }),
  );
  const gridTop = y + 64;
  const rows = Math.ceil(PIECES.length / columns);
  PIECES.forEach((p, i) =>
    out.push(
      ...piece(p, i, {
        x: colX(i % columns),
        y: gridTop + Math.floor(i / columns) * rowH,
        rowH,
        t,
        inline: columns === 1,
      }),
    ),
  );
  for (let r = 0; r < rows; r++)
    out.push(
      line({
        x1: left,
        y1: gridTop + r * rowH,
        x2: left + inner,
        y2: gridTop + r * rowH,
        stroke: LINE,
      }),
    );
  if (columns === 2)
    out.push(
      line({
        x1: colX(1) - gap / 2,
        y1: gridTop + 8,
        x2: colX(1) - gap / 2,
        y2: gridTop + rows * rowH - 8,
        stroke: LINE,
      }),
    );

  // What stays here and never reaches the model.
  const keptTop = gridTop + rows * rowH;
  const itemH = 24;
  const keptRows = Math.ceil(KEPT.length / 2);
  const keptX = (c) => left + c * ((inner - gap) / 2 + gap);
  out.push(
    line({
      x1: left,
      y1: keptTop,
      x2: left + inner,
      y2: keptTop,
      stroke: LINE_STRONG,
    }),
    text("Kept here, never shown to the model", {
      x: left,
      y: keptTop + 28,
      size: t.name,
      weight: 600,
    }),
  );
  KEPT.forEach((item, i) =>
    out.push(
      text(item, {
        x: keptX(i % 2),
        y: keptTop + 56 + Math.floor(i / 2) * itemH,
        size: t.name,
        weight: 500,
        fill: INK_SOFT,
      }),
    ),
  );
  const h = keptTop + 56 + (keptRows - 1) * itemH + 16 - y;
  return { h, parts: out };
}

function wide() {
  const t = { title: 16, name: 15, nameLH: 19, sub: 14, subLH: 17 };
  const model = modelSide({ x: 1, y: 1, w: 216, t });
  const code = codeSide({ x: 305, y: 1, w: 414, t, columns: 2, pad: 16 });
  const callY = 88;
  const replyY = 124;
  const out = [
    rect({ x: 305, y: 1, w: 414, h: code.h, rx: 8, fill: PAPER, stroke: INK }),
    ...code.parts,
    ...model.parts,
    arrow({
      points: [
        [217, callY],
        [305, callY],
      ],
    }),
    text("tool calls", {
      x: 261,
      y: callY - 8,
      size: 14,
      anchor: "middle",
      fill: MUTED,
    }),
    arrow({
      points: [
        [305, replyY],
        [217, replyY],
      ],
      dash: true,
    }),
    text("results", {
      x: 261,
      y: replyY - 8,
      size: 14,
      anchor: "middle",
      fill: MUTED,
    }),
  ];
  return svg(720, Math.max(model.h, code.h) + 2, out);
}

function narrow() {
  const t = { title: 15, name: 14, nameLH: 18, sub: 13, subLH: 16 };
  const model = modelSide({ x: 1, y: 1, w: 358, t });
  const gap = 64;
  const top = 1 + model.h + gap;
  const code = codeSide({ x: 1, y: top, w: 358, t, columns: 1, pad: 12 });
  const mid = 1 + model.h + gap / 2;
  const out = [
    rect({ x: 1, y: top, w: 358, h: code.h, rx: 8, fill: PAPER, stroke: INK }),
    ...code.parts,
    ...model.parts,
    arrow({
      points: [
        [92, 1 + model.h],
        [92, top],
      ],
    }),
    text("tool calls", { x: 108, y: mid + 5, size: 14, fill: MUTED }),
    arrow({
      points: [
        [236, top],
        [236, 1 + model.h],
      ],
      dash: true,
    }),
    text("results", { x: 252, y: mid + 5, size: 14, fill: MUTED }),
  ];
  return svg(360, top + code.h + 1, out);
}

export default {
  name: "agent-pieces",
  alt: "The model's side and the agent's code, divided by a dashed edge. The model calls tools that take parameters, not arbitrary destinations, and sees Company content marked as data and a change's terms with a note that nothing was done; its tool calls cross the edge and the results come back. The agent's own deterministic code has six pieces, in the order of the steps: identity, users and Sessions, safe fetching of Company URLs, before the first task, where interfaces become tools, sign-in, and approvals, where the user decides, marked in amber. The code keeps tokens, authorization codes, the authorization URL, private keys, Session JWTs and OAuth state from the model.",
  caption:
    "The model calls tools and reads what comes back, and everything it must never see or do stays in the agent's own code.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

import {
  GREEN,
  GREEN_LIGHT,
  INK_SOFT,
  LINE_STRONG,
  MUTED,
  PAPER,
  SERIF,
  line,
  n,
  rect,
  svg,
  text,
  textWidth,
} from "../draw.mjs";

/**
 * The five milestones of a Company (docs/learn/build-a-company.md) as the
 * steps rail of DESIGN.md: a 44px stop with a 1.5px green ring and a green
 * serif numeral, a 1.5px line to the next. The squares at the right grow by
 * one at each stop: the new milestone in green, the ones it includes in a
 * lighter green.
 */

const STOPS = [
  {
    name: "Be found",
    says: "One static file, with no sign-in, that tells agents who you are and what exists.",
    note: "Stop here if you only want to be found.",
  },
  {
    name: "Foundation",
    says: "Agents become identifiable: your metadata, a verified Session header and a record of each Session.",
  },
  {
    name: "Interfaces",
    says: "Anyone may see what you offer, signed out, through the interfaces you already have.",
  },
  {
    name: "Sign-in",
    says: "A user can connect an agent you never registered, with OAuth on your own pages.",
  },
  {
    name: "Operations",
    says: "Every consequential change waits for the user's approval of its exact terms.",
  },
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

/** A stop: a 44px circle, ringed in green, with a serif numeral. */
function stop(i, cx, cy) {
  return [
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="21.25" fill="${PAPER}" stroke="${GREEN}" stroke-width="1.5"/>`,
    text(String(i), {
      x: cx,
      y: cy + 7.5,
      size: 21,
      weight: 500,
      fill: GREEN,
      anchor: "middle",
      family: SERIF,
    }),
  ];
}

/** The squares of one stop: one for each milestone it includes. */
function squares(i, { x, cy, size, gap }) {
  const out = [];
  for (let j = 0; j <= i; j++)
    out.push(
      rect({
        x: x + j * (size + gap),
        y: cy - size / 2,
        w: size,
        h: size,
        rx: 3,
        fill: j === i ? GREEN : GREEN_LIGHT,
        stroke: null,
      }),
    );
  return out;
}

function rail({ width, pitch, top, textX, textMax, t, squaresAt, legend }) {
  const out = [];
  let bottom = 0;
  out.push(
    text("each adds to the ones before", {
      x: width - 1,
      y: legend,
      size: t.note,
      fill: MUTED,
      anchor: "end",
    }),
  );
  STOPS.forEach((s, i) => {
    const cy = top + 22 + i * pitch;
    if (i > 0)
      out.push(
        line({
          x1: 23,
          y1: cy - pitch + 22 + 8,
          x2: 23,
          y2: cy - 22 - 8,
          stroke: LINE_STRONG,
          sw: 1.5,
        }),
      );
    out.push(...stop(i, 23, cy));

    // The name sits level with the stop, and its words hang under it.
    const says = wrap(s.says, t.says, 400, textMax);
    const note = s.note ? wrap(s.note, t.note, 400, textMax) : [];
    let y = cy - t.nameLH / 2;
    const nameY = y + t.nameLH / 2 + t.name * 0.35;
    out.push(text(s.name, { x: textX, y: nameY, size: t.name, weight: 600 }));
    y += t.nameLH;
    says.forEach((string, j) =>
      out.push(
        text(string, {
          x: textX,
          y: y + j * t.saysLH + t.saysLH / 2 + t.says * 0.35,
          size: t.says,
          fill: INK_SOFT,
        }),
      ),
    );
    y += says.length * t.saysLH;
    bottom = Math.max(bottom, cy + 22, y + note.length * t.noteLH);
    note.forEach((string, j) =>
      out.push(
        text(string, {
          x: textX,
          y: y + j * t.noteLH + t.noteLH / 2 + t.note * 0.35,
          size: t.note,
          fill: MUTED,
        }),
      ),
    );
    out.push(...squares(i, { ...squaresAt, cy }));
  });
  return { parts: out, bottom: Math.ceil(bottom) + 2 };
}

function wide() {
  const pitch = 100;
  const top = 36;
  const t = {
    name: 16,
    nameLH: 20,
    says: 15,
    saysLH: 20,
    note: 14,
    noteLH: 18,
  };
  const { parts, bottom } = rail({
    width: 720,
    pitch,
    top,
    textX: 68,
    textMax: 520,
    t,
    squaresAt: { x: 622, size: 16, gap: 4 },
    legend: 14,
  });
  return svg(720, bottom, parts);
}

function narrow() {
  const pitch = 112;
  const top = 36;
  const t = {
    name: 15,
    nameLH: 20,
    says: 14,
    saysLH: 19,
    note: 13,
    noteLH: 17,
  };
  const { parts, bottom } = rail({
    width: 360,
    pitch,
    top,
    textX: 64,
    textMax: 294,
    t,
    squaresAt: { x: 296, size: 10, gap: 3 },
    legend: 14,
  });
  return svg(360, bottom, parts);
}

export default {
  name: "company-milestones",
  alt: "A vertical rail of five milestones, numbered 0 to 4, each adding to the ones before it. Milestone 0, be found, is one static file with no sign-in that tells agents who you are and what exists, and a Company that only wants that can stop there. Milestone 1, foundation, makes agents identifiable, with metadata, a verified Session header and a record of each Session, and milestone 2, interfaces, offers what anyone may see, signed out, through the interfaces the Company already has. Milestone 3, sign-in, lets a user connect an agent the Company never registered, and milestone 4, operations, makes every consequential change wait for the user's approval of its exact terms.",
  caption:
    "Five milestones, each adding to the ones before it, from being found to approving every consequential change.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

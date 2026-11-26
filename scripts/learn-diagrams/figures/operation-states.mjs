import {
  GREEN,
  GREEN_WASH,
  INK,
  INK_SOFT,
  MUTED,
  PAPER,
  arrow,
  dot,
  line,
  lines,
  rect,
  svg,
  tag,
  text,
} from "../draw.mjs";

/**
 * How an operation can end after the Company proposes it
 * (docs/learn/operations.md, "What the Company checks"). One central state, the
 * proposal that waits, and the ways out of it. The approval, from the user or
 * from the agent on the user's instruction, goes to the Company's check, which
 * has three outcomes; the user's decline and the clock each lead out on their
 * own. Amber is what only the user does; green is the one end where the change
 * is made.
 */

/** A state or an end: a title and muted lines under it, left-aligned. */
function box({ tone = "plain", x, y, w, h, title, sub = [], size }) {
  const fill = { plain: PAPER, made: GREEN_WASH }[tone];
  const stroke = tone === "made" ? GREEN : INK;
  const small = size - 2;
  const lineHeight = 18;
  const block = size + (sub.length ? 8 + (sub.length - 1) * lineHeight : 0);
  const top = y + (h - block) / 2;
  return [
    rect({ x, y, w, h, fill, stroke }),
    text(title, { x: x + 16, y: top + size * 0.8, size, weight: 600 }),
    ...lines(sub, {
      x: x + 16,
      y: top + size + 8 + small * 0.6,
      lineHeight,
      size: small,
      fill: tone === "made" ? INK_SOFT : MUTED,
    }),
  ].join("\n  ");
}

// What the Company's check can end in, and the words on the way there.
const CHECKED = [
  {
    cause: "terms still match",
    tone: "made",
    title: "Made once",
    sub: ["the change is performed"],
  },
  {
    cause: "Company declines",
    title: "Declined by the Company",
    sub: ["approval_declined", "final for that approval"],
  },
  {
    cause: "terms changed",
    title: "A new revision",
    sub: ["the old approval", "no longer applies"],
  },
];

function wide() {
  const size = 16;
  const label = { size: 14, fill: MUTED };
  const parts = [];

  const endX = 463;
  const endW = 256;
  const h = 72;
  const pitch = 82;
  const first = 1;
  const centers = CHECKED.map((_, i) => first + i * pitch + h / 2);
  const trunkY = (centers[0] + centers[CHECKED.length - 1]) / 2;
  const bus = 312;

  const proposed = { x: 1, y: trunkY - 44, w: 120, h: 88 };
  const declined = { y: first + (CHECKED.length - 1) * pitch + h + 26 };
  declined.mid = declined.y + h / 2;
  const expired = { y: declined.y + h + 34 };
  expired.mid = expired.y + h / 2;

  // The approval, then the Company's check and its three outcomes.
  parts.push(
    line({
      x1: proposed.x + proposed.w,
      y1: trunkY,
      x2: bus,
      y2: trunkY,
      stroke: GREEN,
      sw: 1.5,
    }),
  );
  CHECKED.forEach((_, i) =>
    parts.push(
      arrow({
        points: [
          [bus, trunkY],
          [bus, centers[i]],
          [endX - 4, centers[i]],
        ],
      }),
    ),
  );
  parts.push(dot({ cx: bus, cy: trunkY, r: 3.5, fill: GREEN }));

  // The user declines in the agent; the Company is not told. The clock runs out.
  const rails = { declined: 88, expired: 40 };
  const below = proposed.y + proposed.h;
  parts.push(
    arrow({
      points: [
        [rails.declined, below],
        [rails.declined, declined.mid],
        [endX - 4, declined.mid],
      ],
    }),
    arrow({
      points: [
        [rails.expired, below],
        [rails.expired, expired.mid],
        [endX - 4, expired.mid],
      ],
    }),
    arrow({
      points: [
        [endX + 24, declined.y + h],
        [endX + 24, expired.y - 4],
      ],
    }),
  );

  parts.push(
    box({
      ...proposed,
      title: "Proposed",
      sub: ["waiting for", "approval"],
      size,
    }),
    ...CHECKED.map((end, i) =>
      box({
        tone: end.tone,
        x: endX,
        y: first + i * pitch,
        w: endW,
        h,
        title: end.title,
        sub: end.sub,
        size,
      }),
    ),
    box({
      x: endX,
      y: declined.y,
      w: endW,
      h,
      title: "Declined in the agent",
      sub: ["the Company is not told"],
      size,
    }),
    box({
      x: endX,
      y: expired.y,
      w: endW,
      h,
      title: "Expired",
      sub: ["nothing was done;", "it can't be approved late"],
      size,
    }),
  );

  // Words on the connectors.
  const trunkMid = (proposed.x + proposed.w + bus) / 2;
  parts.push(
    ...lines(["or the agent, on", "an instruction", "the user gave it"], {
      x: trunkMid,
      y: trunkY - 62,
      lineHeight: 18,
      anchor: "middle",
      ...label,
    }),
    tag({ x: trunkMid, y: trunkY - 14, string: "The user approves" }).svg,
    ...lines(["then the Company", "checks the approval"], {
      x: trunkMid,
      y: trunkY + 36,
      lineHeight: 18,
      anchor: "middle",
      ...label,
    }),
    ...CHECKED.map((end, i) =>
      text(end.cause, { x: bus + 16, y: centers[i] - 8, ...label }),
    ),
    tag({
      x: (rails.declined + endX) / 2,
      y: declined.mid - 14,
      string: "The user declines",
    }).svg,
    text("the time runs out", {
      x: (rails.expired + endX) / 2,
      y: expired.mid - 8,
      anchor: "middle",
      ...label,
    }),
    text("waits until it expires", {
      x: endX + 36,
      y: declined.y + h + 22,
      ...label,
    }),
  );

  return svg(720, expired.y + h + 1, parts);
}

function narrow() {
  const size = 16;
  const label = { size: 13, fill: MUTED };
  const parts = [];
  const l1 = 17;
  const l2 = 41;
  const col = 65;
  const colW = 294;

  // The Company's check: a label strip over each outcome.
  let y = 174;
  const ends = CHECKED.map((end) => {
    // Only the decline keeps two lines: its code and its finality.
    const sub = end.title.startsWith("Declined")
      ? end.sub
      : [end.sub.join(" ")];
    const h = sub.length > 1 ? 70 : 52;
    const at = { ...end, sub, y, h, mid: y + h / 2 };
    y += h + 28;
    return at;
  });
  const last = ends[ends.length - 1];
  const declined = { y: last.y + last.h + 48, h: 52 };
  declined.mid = declined.y + declined.h / 2;
  const expired = { y: declined.y + declined.h + 60, h: 72 };
  expired.mid = expired.y + expired.h / 2;
  const chain = 330;

  // From the proposal: the approval's own rail (it forks into the Company's
  // check), the user's decline, and the clock.
  parts.push(
    arrow({
      points: [
        [l1, 73],
        [l1, 99],
        [l2, 99],
        [l2, last.mid],
        [col - 4, last.mid],
      ],
    }),
    ...ends.slice(0, 3).map((end) =>
      arrow({
        points: [
          [l2, end.mid],
          [col - 4, end.mid],
        ],
      }),
    ),
    arrow({
      points: [
        [l1, 99],
        [l1, expired.mid],
        [col - 4, expired.mid],
      ],
    }),
    arrow({
      points: [
        [l1, declined.mid],
        [col - 4, declined.mid],
      ],
    }),
    arrow({
      points: [
        [chain, declined.y + declined.h],
        [chain, expired.y - 4],
      ],
    }),
  );

  parts.push(
    box({
      x: 1,
      y: 1,
      w: 220,
      h: 72,
      title: "Proposed",
      sub: ["waiting for approval", "of this revision"],
      size,
    }),
    ...ends.map((end) =>
      box({
        tone: end.tone,
        x: col,
        y: end.y,
        w: colW,
        h: end.h,
        title: end.title,
        sub: end.sub,
        size,
      }),
    ),
    box({
      x: col,
      y: declined.y,
      w: colW,
      h: declined.h,
      title: "Declined in the agent",
      sub: ["the Company is not told"],
      size,
    }),
    box({
      x: col,
      y: expired.y,
      w: colW,
      h: expired.h,
      title: "Expired",
      sub: ["nothing was done;", "it can't be approved late"],
      size,
    }),
  );

  parts.push(
    tag({
      x: 53,
      y: 85,
      string: "The user approves",
      size: 14,
      anchor: "start",
    }).svg,
    text("or the agent, on an instruction the user gave it", {
      x: 53,
      y: 129,
      ...label,
    }),
    text("then the Company checks the approval", { x: 53, y: 146, ...label }),
    ...ends.map((end) => text(end.cause, { x: col, y: end.y - 6, ...label })),
    tag({
      x: col,
      y: declined.y - 34,
      string: "The user declines",
      size: 14,
      anchor: "start",
    }).svg,
    text("the time runs out", { x: col, y: expired.y - 6, ...label }),
    text("waits until it expires", {
      x: chain - 8,
      y: declined.y + declined.h + 24,
      anchor: "end",
      ...label,
    }),
  );

  return svg(360, expired.y + expired.h + 1, parts);
}

export default {
  name: "operation-states",
  alt: "After the Company proposes an operation, it waits for approval of its terms and revision. When the user approves, or the agent does on an instruction the user gave it, the Company checks the approval: if the terms still match, the change is made once. If the Company declines, the operation ends as declined by the Company, final for that approval. If the terms have changed, a new revision replaces it and the old approval no longer applies. If the user declines in the agent, the Company is not told and the proposal waits until it expires; when the time runs out it expires, with nothing done.",
  caption:
    "A proposal ends with the change made once or with nothing done, and the Company checks each approval first.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

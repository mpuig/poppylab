import { MUTED, arrow, card, frame, lines, svg, text } from "../../draw.mjs";

/**
 * Building with coding agents (the eighteenth post): when one agent writes
 * both the client and the server, their tests can agree on the same mistake.
 * What kept the lab honest were three checks from outside that loop.
 */

const INSIDE = [
  { kind: "agent", title: "pap-client", sub: "the agent's side" },
  { kind: "company", title: "pap-company", sub: "the companies' side" },
];
const BETWEEN = ["tests written with both", "can agree on the", "same mistake"];
const CHECKS = [
  {
    kind: "green",
    title: "The official validator",
    sub: "a test agent someone else wrote, run against the five live companies",
  },
  {
    kind: "green",
    title: "The spec, pinned",
    sub: "spec/1.0 in the repository, with pnpm spec:drift against the published text",
  },
  {
    kind: "green",
    title: "Security rules in code",
    sub: "a strict XML parser, pinned DNS, and a build that refuses a bundle holding a local secret",
  },
];

function wide() {
  const out = [];
  const right = { x: 461, w: 258 };
  let y = 32;
  const checks = CHECKS.map((spec) => {
    const c = card({ ...spec, ...right, y });
    y += c.h + 14;
    return { ...c, cy: y - 14 - c.h / 2 };
  });
  const bottom = y - 14;
  out.push(
    text("Written with coding agents", { x: 1, y: 18, size: 15, weight: 600 }),
    text("Checks from outside", { x: right.x, y: 18, size: 15, weight: 600 }),
    frame({ x: 1, y: 32, w: 400, h: bottom - 32 }),
  );
  const client = card({ ...INSIDE[0], x: 25, y: 52, w: 352 });
  const company = card({
    ...INSIDE[1],
    x: 25,
    y: bottom - 20 - client.h,
    w: 352,
  });
  out.push(
    client.svg,
    company.svg,
    arrow({
      points: [
        [69, 52 + client.h],
        [69, bottom - 20 - client.h],
      ],
      both: true,
      color: MUTED,
    }),
    ...lines(BETWEEN, {
      x: 85,
      y: (52 + client.h + bottom - 20 - client.h) / 2 - 13,
      size: 14,
      fill: MUTED,
      lineHeight: 18,
    }),
  );
  for (const c of checks)
    out.push(
      arrow({
        points: [
          [right.x, c.cy],
          [401, c.cy],
        ],
      }),
      c.svg,
    );
  return svg(720, bottom + 1, out);
}

function narrow() {
  const out = [];
  const style = { size: 14, subSize: 13, pad: 12 };
  out.push(
    text("Written with coding agents", { x: 1, y: 16, size: 14, weight: 600 }),
  );
  const client = card({ ...INSIDE[0], ...style, x: 17, y: 44, w: 326 });
  const gapTop = 44 + client.h;
  const company = card({
    ...INSIDE[1],
    ...style,
    x: 17,
    y: gapTop + 64,
    w: 326,
  });
  const frameBottom = gapTop + 64 + company.h + 16;
  out.push(
    frame({ x: 1, y: 28, w: 358, h: frameBottom - 28 }),
    client.svg,
    company.svg,
    arrow({
      points: [
        [41, gapTop],
        [41, gapTop + 64],
      ],
      both: true,
      color: MUTED,
    }),
    ...lines(["tests written with both can", "agree on the same mistake"], {
      x: 57,
      y: gapTop + 28,
      size: 13,
      fill: MUTED,
      lineHeight: 17,
    }),
    text("Checks from outside", {
      x: 1,
      y: frameBottom + 30,
      size: 14,
      weight: 600,
    }),
  );
  let y = frameBottom + 44;
  for (const spec of CHECKS) {
    const c = card({ ...spec, ...style, x: 1, y, w: 358 });
    out.push(c.svg);
    y += c.h + 10;
  }
  // The checks all bear on what is inside the frame.
  out.push(
    arrow({
      points: [
        [340, frameBottom + 40],
        [340, frameBottom],
      ],
    }),
  );
  return svg(360, y - 10 + 1, out);
}

export default {
  name: "outside-checks",
  alt: "On one side, written with coding agents: pap-client, the agent's side, and pap-company, the companies' side, with tests written alongside both that can agree on the same mistake. On the other, three checks from outside that loop bear on it: the official validator, a test agent someone else wrote, run against the five live companies; the spec pinned in the repository as spec/1.0, with pnpm spec:drift against the published text; and security rules in code, a strict XML parser, pinned DNS, and a build that refuses a bundle holding a local secret.",
  caption:
    "When one agent writes both sides, their tests can agree on the same mistake; checks from outside the loop catch it.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

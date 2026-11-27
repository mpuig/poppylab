import {
  AMBER,
  GREEN,
  GREEN_WASH,
  INK,
  INK_SOFT,
  MUTED,
  TINT,
  arrow,
  centred,
  dot,
  node,
  rect,
  svg,
  text,
} from "../draw.mjs";

/**
 * Poppy among the interfaces a Company already has (docs/learn/compared.md):
 * the Personal Agent above, Poppy in green settling four things, and the
 * Company's own interfaces below, as they are. The one amber dot is the
 * thing that waits for a person.
 */

const SETTLES = [
  ["Who the agent is"],
  ["Which user it", "acts for"],
  ["What that user", "allowed"],
  ["When a person", "has to say yes"],
];
const INTERFACES = ["OpenAPI", "MCP", "Support chat", "Website"];

/** A cell of a layer: a labelled box, outlined in the layer's colour. */
function cell({ x, y, w, h, lines, stroke, size, lineHeight, weight }) {
  return [
    rect({ x, y, w, h, stroke }),
    ...centred(lines, {
      cx: x + w / 2,
      cy: y + h / 2,
      size,
      lineHeight,
      weight,
    }),
  ];
}

function wide() {
  const out = [];
  const left = 1;
  const width = 718;
  const col = (i) => 21 + i * 172;
  const colW = 162;

  out.push(
    node({
      kind: "agent",
      x: left,
      y: 1,
      w: width,
      h: 64,
      title: "Personal Agent",
      sub: "acting for a user",
    }),
    arrow({
      points: [
        [360, 65],
        [360, 97],
      ],
      both: true,
    }),
  );

  // Poppy, in green.
  out.push(
    rect({
      x: left,
      y: 97,
      w: width,
      h: 124,
      rx: 8,
      fill: GREEN_WASH,
      stroke: GREEN,
    }),
    text("Poppy settles", {
      x: 21,
      y: 125,
      size: 16,
      weight: 600,
      fill: GREEN,
    }),
    text("wraps the interfaces and replaces none", {
      x: 699,
      y: 125,
      size: 14,
      fill: INK_SOFT,
      anchor: "end",
    }),
  );
  SETTLES.forEach((lines, i) => {
    out.push(
      ...cell({
        x: col(i),
        y: 141,
        w: colW,
        h: 64,
        lines,
        stroke: GREEN,
        size: 15,
        lineHeight: 19,
        weight: 500,
      }),
    );
  });
  out.push(dot({ cx: col(3) + colW - 12, cy: 153, r: 4, fill: AMBER }));

  // The interfaces stay as they are.
  INTERFACES.forEach((_, i) =>
    out.push(
      arrow({
        points: [
          [col(i) + colW / 2, 221],
          [col(i) + colW / 2, 253],
        ],
        both: true,
      }),
    ),
  );
  out.push(
    rect({
      x: left,
      y: 253,
      w: width,
      h: 108,
      rx: 8,
      fill: TINT,
      stroke: INK,
    }),
    text("The Company's interfaces, unchanged", {
      x: 21,
      y: 281,
      size: 16,
      weight: 600,
    }),
    text("all listed in /.well-known/poppy.json", {
      x: 699,
      y: 281,
      size: 14,
      fill: MUTED,
      anchor: "end",
    }),
  );
  INTERFACES.forEach((name, i) =>
    out.push(
      ...cell({
        x: col(i),
        y: 297,
        w: colW,
        h: 48,
        lines: [name],
        stroke: INK,
        size: 15,
        lineHeight: 19,
        weight: 600,
      }),
    ),
  );
  return svg(720, 362, out);
}

function narrow() {
  const out = [];
  const left = 1;
  const width = 358;
  const colX = [17, 185];
  const colW = 158;

  out.push(
    node({
      kind: "agent",
      x: left,
      y: 1,
      w: width,
      h: 56,
      title: "Personal Agent",
      sub: "acting for a user",
      size: 15,
    }),
    arrow({
      points: [
        [180, 57],
        [180, 85],
      ],
      both: true,
    }),
  );

  out.push(
    rect({
      x: left,
      y: 85,
      w: width,
      h: 176,
      rx: 8,
      fill: GREEN_WASH,
      stroke: GREEN,
    }),
    text("Poppy settles", {
      x: 17,
      y: 109,
      size: 15,
      weight: 600,
      fill: GREEN,
    }),
    text("wraps the interfaces and replaces none", {
      x: 17,
      y: 128,
      size: 13,
      fill: INK_SOFT,
    }),
  );
  SETTLES.forEach((lines, i) => {
    const x = colX[i % 2];
    const y = 141 + Math.floor(i / 2) * 56;
    out.push(
      ...cell({
        x,
        y,
        w: colW,
        h: 48,
        lines,
        stroke: GREEN,
        size: 14,
        lineHeight: 18,
        weight: 500,
      }),
    );
  });
  out.push(dot({ cx: colX[1] + colW - 11, cy: 141 + 56 + 11, r: 4 }));

  colX.forEach((x) =>
    out.push(
      arrow({
        points: [
          [x + colW / 2, 261],
          [x + colW / 2, 289],
        ],
        both: true,
      }),
    ),
  );
  out.push(
    rect({
      x: left,
      y: 289,
      w: width,
      h: 160,
      rx: 8,
      fill: TINT,
      stroke: INK,
    }),
    text("The Company's interfaces, unchanged", {
      x: 17,
      y: 313,
      size: 15,
      weight: 600,
    }),
    text("all listed in /.well-known/poppy.json", {
      x: 17,
      y: 332,
      size: 13,
      fill: MUTED,
    }),
  );
  INTERFACES.forEach((name, i) =>
    out.push(
      ...cell({
        x: colX[i % 2],
        y: 345 + Math.floor(i / 2) * 48,
        w: colW,
        h: 40,
        lines: [name],
        stroke: INK,
        size: 14,
        lineHeight: 18,
        weight: 600,
      }),
    ),
  );
  return svg(360, 450, out);
}

export default {
  name: "poppy-layers",
  alt: "A stack of three layers. At the top, a Personal Agent acting for a user. In the middle, Poppy, in green, settles four things: who the agent is, which user it acts for, what that user allowed, and when a person has to say yes. At the bottom, the Company's own interfaces stay as they are, OpenAPI, MCP, a support chat and the website, all listed in one document at /.well-known/poppy.json. Poppy wraps the interfaces and replaces none.",
  caption:
    "Poppy sits between the agent and the interfaces a Company already has, and settles four things without replacing any of them.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

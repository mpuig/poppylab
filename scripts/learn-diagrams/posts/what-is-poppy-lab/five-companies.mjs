import { MUTED, arrow, card, frame, svg, text } from "../../draw.mjs";

/**
 * What the lab is (the first post): you, Iris, and the five fictional
 * companies, each with the part of the protocol it exercises. Every request
 * leaves Iris on one connector, which runs through the Inspector: the window
 * onto every request and answer.
 */

const COMPANIES = [
  ["Juniper Market", "a reversible delivery move"],
  ["Lantern Noodle Bar", "a support conversation"],
  ["Harborline Bank", "moving money"],
  ["Northwind Air", "a paid cabin upgrade"],
  ["Fernwick Power & Light", "hourly meter readings"],
];

/** The five companies, stacked from `top`: their parts and their centres. */
function companies({ x, top, w, size }) {
  const parts = [];
  const centres = [];
  let y = top;
  for (const [title, sub] of COMPANIES) {
    const c = card({
      kind: "company",
      x,
      y,
      w,
      h: 52,
      title,
      sub,
      size,
      pad: 12,
    });
    parts.push(c.svg);
    centres.push(y + c.h / 2);
    y += c.h + 10;
  }
  return { parts, centres, bottom: y - 10 };
}

function wide() {
  const out = [];
  const list = companies({ x: 485, top: 1, w: 234, size: 15 });
  const mid = list.centres[2];
  // You and Iris sit on the middle company's line.
  out.push(
    card({
      kind: "you",
      x: 1,
      cy: mid,
      w: 128,
      title: "You",
      sub: "as Elena or Robin",
    }).svg,
    card({
      kind: "agent",
      x: 169,
      cy: mid,
      w: 160,
      title: "Iris",
      sub: "in the playground",
    }).svg,
    arrow({
      points: [
        [129, mid],
        [169, mid],
      ],
    }),
    text("asks", {
      x: 149,
      y: mid - 8,
      size: 14,
      fill: MUTED,
      anchor: "middle",
    }),
    frame({ x: 347, y: 1, w: 98, h: list.bottom - 1 }),
    text("Inspector", {
      x: 396,
      y: 26,
      size: 15,
      weight: 600,
      anchor: "middle",
    }),
    ...["every request", "and answer,", "as sent"].map((s, i) =>
      text(s, {
        x: 396,
        y: 46 + i * 17,
        size: 13,
        fill: MUTED,
        anchor: "middle",
      }),
    ),
  );
  for (const cy of list.centres)
    out.push(
      arrow({
        points: [
          [329, mid],
          [461, mid],
          [461, cy],
          [485, cy],
        ],
      }),
    );
  out.push(...list.parts);
  return svg(720, list.bottom + 1, out);
}

function narrow() {
  const out = [];
  const you = card({
    kind: "you",
    x: 1,
    y: 1,
    w: 200,
    title: "You",
    sub: "as Elena or Robin",
    size: 15,
  });
  const irisTop = you.h + 1 + 28;
  const iris = card({
    kind: "agent",
    x: 1,
    y: irisTop,
    w: 358,
    title: "Iris",
    sub: "in the playground",
  });
  const bandTop = irisTop + iris.h + 16;
  const list = companies({ x: 49, top: bandTop + 64 + 16, w: 310, size: 14 });
  out.push(
    you.svg,
    arrow({
      points: [
        [101, you.h + 1],
        [101, irisTop],
      ],
    }),
    text("asks", { x: 111, y: you.h + 20, size: 14, fill: MUTED }),
    iris.svg,
    frame({ x: 1, y: bandTop, w: 358, h: 64 }),
    text("Inspector", { x: 49, y: bandTop + 26, size: 15, weight: 600 }),
    text("every request and answer, as sent", {
      x: 49,
      y: bandTop + 46,
      size: 13,
      fill: MUTED,
    }),
  );
  for (const cy of list.centres)
    out.push(
      arrow({
        points: [
          [25, irisTop + iris.h],
          [25, cy],
          [49, cy],
        ],
      }),
    );
  out.push(...list.parts);
  return svg(360, list.bottom + 1, out);
}

export default {
  name: "five-companies",
  alt: "You talk to Iris, the playground's agent, as one of two fictional customers, Elena or Robin. Iris connects to five fictional companies, each exercising a different part of the protocol: Juniper Market a reversible delivery move, Lantern Noodle Bar a support conversation, Harborline Bank moving money, Northwind Air a paid cabin upgrade, and Fernwick Power & Light hourly meter readings. Every request and answer between Iris and the companies passes through the Inspector, where it can be read as it was sent.",
  caption:
    "One agent and five fictional companies, each exercising a different part of the protocol, with every request between them readable in the Inspector.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

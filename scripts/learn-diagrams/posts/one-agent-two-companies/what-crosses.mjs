import { MUTED, arrow, card, lines, svg, tag, text } from "../../draw.mjs";

/**
 * One agent, two companies (the seventh post): what travels from Fernwick to
 * Harborline when Elena pays her electricity bill from checking, and what
 * stays where it is. The approval is Elena's, on Harborline's terms.
 */

const FROM_FERNWICK = ["total due", "billing month", "reference"];
const TO_HARBORLINE = ["amount", "reference", "month in the memo"];
const STAYS = [
  {
    title: "Stays at Fernwick",
    sub: "Elena's meters and readings, rate plan and address",
  },
  {
    title: "Kept apart by Iris",
    sub: "a different User ID, Session, token and key at each",
  },
  {
    title: "Stays at Harborline",
    sub: "where Elena banks, her accounts and balances",
  },
];
const ASK = "“Pay my Fernwick bill from checking.”";

function wide() {
  const out = [];
  const elena = card({
    kind: "you",
    x: 290,
    y: 1,
    w: 140,
    title: "Elena",
  });
  const rowTop = elena.h + 1 + 64;
  const fernwick = card({
    kind: "company",
    x: 1,
    y: rowTop,
    w: 160,
    title: "Fernwick Power & Light",
    sub: "reads the bill",
  });
  const cy = rowTop + fernwick.h / 2;
  const iris = card({ kind: "agent", x: 300, cy, w: 120, title: "Iris" });
  const harborline = card({
    kind: "company",
    x: 559,
    cy,
    w: 160,
    title: "Harborline Bank",
    sub: "pays it, once approved",
  });
  const irisTop = cy - iris.h / 2;
  out.push(
    arrow({
      points: [
        [330, elena.h + 1],
        [330, irisTop],
      ],
    }),
    text(ASK, {
      x: 318,
      y: elena.h + 1 + 36,
      size: 14,
      fill: MUTED,
      anchor: "end",
    }),
    arrow({
      points: [
        [390, elena.h + 1],
        [390, irisTop],
      ],
    }),
    tag({
      x: 402,
      y: elena.h + 1 + 18,
      string: "Elena approves the payment",
      size: 14,
      anchor: "start",
    }).svg,
    arrow({
      points: [
        [161, cy],
        [300, cy],
      ],
      dash: true,
    }),
    arrow({
      points: [
        [420, cy],
        [559, cy],
      ],
    }),
    ...lines(FROM_FERNWICK, {
      x: 176,
      y: cy + 24,
      lineHeight: 18,
      size: 14,
      weight: 500,
    }),
    ...lines(TO_HARBORLINE, {
      x: 435,
      y: cy + 24,
      lineHeight: 18,
      size: 14,
      weight: 500,
    }),
    elena.svg,
    fernwick.svg,
    iris.svg,
    harborline.svg,
  );
  const top = rowTop + fernwick.h + 76;
  const at = [
    { x: 1, w: 224 },
    { x: 248, w: 224 },
    { x: 495, w: 224 },
  ];
  const tallest = Math.max(
    ...STAYS.map(
      (s, i) => card({ ...at[i], y: 0, title: s.title, sub: s.sub }).h,
    ),
  );
  const cards = STAYS.map((s, i) =>
    card({
      kind: "frame",
      ...at[i],
      y: top,
      title: s.title,
      sub: s.sub,
      h: tallest,
    }),
  );
  out.push(...cards.map((c) => c.svg));
  return svg(720, top + Math.max(...cards.map((c) => c.h)) + 1, out);
}

function narrow() {
  const out = [];
  const elena = card({ kind: "you", x: 1, y: 1, w: 358, title: "Elena" });
  const irisTop = elena.h + 1 + 92;
  const iris = card({ kind: "agent", x: 1, y: irisTop, w: 358, title: "Iris" });
  out.push(
    elena.svg,
    arrow({
      points: [
        [25, elena.h + 1],
        [25, irisTop],
      ],
    }),
    ...lines(["“Pay my Fernwick", "bill from checking.”"], {
      x: 37,
      y: elena.h + 1 + 26,
      size: 13,
      fill: MUTED,
    }),
    arrow({
      points: [
        [205, elena.h + 1],
        [205, irisTop],
      ],
    }),
    tag({
      x: 215,
      y: elena.h + 1 + 32,
      string: "Elena approves",
      size: 14,
      anchor: "start",
    }).svg,
    iris.svg,
  );
  const top = irisTop + iris.h + 76;
  const fernwick = card({
    kind: "company",
    x: 1,
    y: top,
    w: 172,
    title: "Fernwick Power & Light",
    sub: "reads the bill",
    size: 14,
    subSize: 13,
    pad: 12,
    h: 70,
  });
  const harborline = card({
    kind: "company",
    x: 187,
    y: top,
    w: 172,
    title: "Harborline Bank",
    sub: "pays it, once approved",
    size: 14,
    subSize: 13,
    pad: 12,
    h: 70,
  });
  out.push(
    arrow({
      points: [
        [25, top],
        [25, irisTop + iris.h],
      ],
      dash: true,
    }),
    ...lines(FROM_FERNWICK, {
      x: 37,
      y: irisTop + iris.h + 22,
      lineHeight: 17,
      size: 13,
      weight: 500,
    }),
    arrow({
      points: [
        [211, irisTop + iris.h],
        [211, top],
      ],
    }),
    ...lines(TO_HARBORLINE, {
      x: 223,
      y: irisTop + iris.h + 22,
      lineHeight: 17,
      size: 13,
      weight: 500,
    }),
    fernwick.svg,
    harborline.svg,
  );
  let y = top + Math.max(fernwick.h, harborline.h) + 16;
  const left = card({
    kind: "frame",
    x: 1,
    y,
    w: 172,
    title: STAYS[0].title,
    sub: STAYS[0].sub,
    size: 14,
    subSize: 13,
    pad: 12,
    h: 104,
  });
  const right = card({
    kind: "frame",
    x: 187,
    y,
    w: 172,
    title: STAYS[2].title,
    sub: STAYS[2].sub,
    size: 14,
    subSize: 13,
    pad: 12,
    h: 104,
  });
  out.push(left.svg, right.svg);
  y += Math.max(left.h, right.h) + 12;
  const apart = card({
    kind: "frame",
    x: 1,
    y,
    w: 358,
    title: STAYS[1].title,
    sub: STAYS[1].sub,
    size: 14,
    subSize: 13,
    pad: 12,
  });
  out.push(apart.svg);
  return svg(360, y + apart.h + 1, out);
}

export default {
  name: "what-crosses",
  alt: "Elena asks Iris: Pay my Fernwick bill from checking. Iris reads the bill at Fernwick Power & Light and takes from it only the total due, the billing month and the payment reference. It sends Harborline Bank only the amount, the reference, and the month in the memo, and Elena approves the payment on Harborline's terms. Elena's meters and readings, rate plan and address stay at Fernwick; where she banks, her accounts and balances stay at Harborline. Iris keeps the two apart, with a different User ID, Session, token and key at each.",
  caption:
    "Three facts cross from the bill to the payment; everything else stays with the company that holds it.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

import { arrow, card, chain, rowHeights, svg, text } from "../../draw.mjs";

/**
 * A standing instruction and its limit (the eleventh post): Elena's $50 rule
 * lives in Iris and is checked in code, and each company still decides
 * whether it takes an agent's approval. Lantern does; Harborline declines,
 * and the transfer waits for Elena (amber) instead.
 */

const RULE = {
  kind: "you",
  title: "Elena's standing instruction, kept in Iris",
  sub: "approve changes up to $50 without asking",
};
const LANES = [
  {
    title: "At Lantern",
    cards: [
      {
        kind: "company",
        title: "Lantern's terms",
        sub: "the $37 order becomes $43: $6 more",
      },
      {
        kind: "agent",
        title: "Iris's code checks the rule",
        sub: "$6 is within $50, so it approves: approver agent",
      },
      {
        kind: "company",
        title: "Lantern makes the change",
        sub: "and records it as approved by your agent, on a standing instruction you gave it",
      },
    ],
  },
  {
    title: "At Harborline",
    cards: [
      {
        kind: "company",
        title: "Harborline's terms",
        sub: "$25 from checking to savings",
      },
      {
        kind: "agent",
        title: "Iris's code checks the rule",
        sub: "it compares the $25 change, not the balances: approver agent",
      },
      {
        kind: "company",
        title: "Harborline declines",
        sub: "403 approval_declined: money moves only when the customer approves",
      },
      {
        kind: "wait",
        title: "Waiting for Elena",
        sub: "with Harborline's reason; Iris doesn't try the rule again",
      },
      {
        kind: "company",
        title: "Harborline moves the $25",
        sub: "once Elena approves herself: approver user. Its site logs both.",
      },
    ],
  },
];
const OUTSIDE = {
  kind: "frame",
  title: "Outside the rule, Iris asks Elena from the start",
  sub: "more than $50, a refund, past its hourly cap of five changes or $150, or terms it can't read",
};

function wide() {
  const out = [];
  const w = 344;
  const rule = card({ ...RULE, x: 160, y: 1, w: 400 });
  out.push(rule.svg);
  const top = rule.h + 1 + 56;
  const heights = rowHeights(
    LANES.map((lane) => lane.cards),
    { w },
  );
  let bottom = 0;
  LANES.forEach((lane, i) => {
    const x = 1 + i * (w + 30);
    out.push(
      arrow({
        points: [
          [360, rule.h + 1],
          [360, rule.h + 1 + 16],
          [x + 24, rule.h + 1 + 16],
          [x + 24, top],
        ],
      }),
      text(lane.title, { x: x + 36, y: top - 12, size: 15, weight: 600 }),
    );
    const col = chain(lane.cards, { x, y: top, w, heights });
    out.push(...col.parts);
    bottom = Math.max(bottom, col.bottom);
  });
  const outside = card({ ...OUTSIDE, x: 1, y: bottom + 24, w: 718 });
  out.push(outside.svg);
  return svg(720, bottom + 24 + outside.h + 1, out);
}

function narrow() {
  const out = [];
  const style = { size: 14, subSize: 13, pad: 12 };
  const rule = card({ ...RULE, ...style, x: 1, y: 1, w: 358 });
  out.push(rule.svg);
  // Each lane branches from the rule, as on the wide drawing.
  let y = rule.h + 1;
  const cys = [];
  for (const lane of LANES) {
    out.push(text(lane.title, { x: 29, y: y + 30, size: 14, weight: 600 }));
    const col = chain(lane.cards, {
      ...style,
      x: 29,
      y: y + 42,
      w: 330,
      gap: 20,
    });
    out.push(...col.parts);
    cys.push(col.firstCy);
    y = col.bottom;
  }
  for (const cy of cys)
    out.push(
      arrow({
        points: [
          [13, rule.h + 1],
          [13, cy],
          [29, cy],
        ],
      }),
    );
  const outside = card({ ...OUTSIDE, ...style, x: 1, y: y + 16, w: 358 });
  out.push(outside.svg);
  return svg(360, y + 16 + outside.h + 1, out);
}

export default {
  name: "the-rule-and-the-company",
  alt: "Elena keeps a standing instruction in Iris: approve changes up to $50 without asking. At Lantern, the terms turn a $37 order into $43, $6 more; Iris's code checks the rule, finds $6 within $50 and approves with approver agent; Lantern makes the change and records it as approved by her agent on a standing instruction. At Harborline, the terms move $25 from checking to savings; Iris's code compares the $25 change, not the balances, and approves with approver agent; Harborline declines with 403 approval_declined, because money moves only when the customer approves; the transfer waits for Elena with Harborline's reason, and Iris doesn't try the rule again; once Elena approves herself, with approver user, Harborline moves the $25 and its site logs both attempts. Outside the rule, Iris asks Elena from the start: for more than $50, a refund, anything past its hourly cap of five changes or $150, or terms it can't read.",
  caption:
    "The rule lives in the agent and is checked in code, and each company still decides whether it accepts an agent's approval.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

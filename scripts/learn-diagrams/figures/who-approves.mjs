import {
  AMBER,
  AMBER_WASH,
  INK,
  INK_SOFT,
  MUTED,
  ON_INK_MUTED,
  PAPER,
  TINT,
  arrow,
  frame,
  line,
  lines,
  rect,
  svg,
  tag,
  text,
} from "../draw.mjs";

/**
 * Who approves (docs/learn/operations.md, "Who approves"): the Company's terms
 * reach the agent. Either an instruction the user wrote already holds the exact
 * terms, and the agent approves; or the terms go to the user, who approves in
 * the agent's own interface. Amber is what only the user does: writing the
 * instruction, and approving. What is never an approval sits in a dashed frame.
 */

/** A party or an outcome: a title and muted lines under it, left-aligned. */
function box({ kind = "plain", x, y, w, h, title, sub = [], size }) {
  const fill = { you: INK, agent: PAPER, company: TINT, plain: PAPER }[kind];
  const you = kind === "you";
  const small = size - 2;
  const lineHeight = 18;
  const block = size + (sub.length ? 8 + (sub.length - 1) * lineHeight : 0);
  const top = y + (h - block) / 2;
  return [
    rect({ x, y, w, h, fill }),
    text(title, {
      x: x + 16,
      y: top + size * 0.8,
      size,
      weight: 600,
      fill: you ? PAPER : INK,
    }),
    ...lines(sub, {
      x: x + 16,
      y: top + size + 8 + small * 0.6,
      lineHeight,
      size: small,
      fill: you ? ON_INK_MUTED : MUTED,
    }),
  ].join("\n  ");
}

/** What is never an approval: a dashed frame, a title, two struck-through ideas. */
function never({ x, y, w, h, size, items }) {
  const small = size - 1;
  const parts = [frame({ x, y, w, h })];
  parts.push(
    text("Never an approval", {
      x: x + 16,
      y: y + 26,
      size: small,
      weight: 600,
      fill: INK_SOFT,
    }),
  );
  let at = y + 52;
  for (const item of items) {
    parts.push(line({ x1: x + 16, y1: at - 5, x2: x + 26, y2: at - 5 }));
    parts.push(
      ...lines(item, {
        x: x + 34,
        y: at,
        lineHeight: 18,
        size: small,
        fill: MUTED,
      }),
    );
    at += item.length * 18 + 8;
  }
  return parts.join("\n  ");
}

function wide() {
  const size = 16;
  const row1 = 65;
  const h1 = 80;
  const row2 = 217;
  const h2 = 80;
  const parts = [];

  const company = { x: 1, w: 150 };
  const agent = { x: 236, w: 168 };
  const user = { x: 543, w: 176 };
  const agentMid = agent.x + agent.w / 2;
  const mid1 = row1 + h1 / 2;

  // The instruction the user wrote, into the agent.
  parts.push(
    arrow({
      points: [
        [agentMid, 29],
        [agentMid, row1 - 4],
      ],
    }),
  );
  // The Company's terms reach the agent: an answer, so a dashed line.
  parts.push(
    arrow({
      points: [
        [company.x + company.w, mid1],
        [agent.x - 4, mid1],
      ],
      dash: true,
    }),
  );
  // The agent approves.
  parts.push(
    arrow({
      points: [
        [agentMid, row1 + h1],
        [agentMid, row2 - 4],
      ],
    }),
  );
  // Everything else goes to the user.
  parts.push(
    arrow({
      points: [
        [agent.x + agent.w, mid1],
        [user.x - 4, mid1],
      ],
    }),
  );
  // The user approves.
  const userLeg = 591;
  parts.push(
    arrow({
      points: [
        [userLeg, row1 + h1],
        [userLeg, row2 - 4],
      ],
    }),
  );

  parts.push(
    box({
      kind: "company",
      ...company,
      y: row1,
      h: h1,
      title: "Company",
      sub: ["sends the terms"],
      size,
    }),
    box({
      kind: "agent",
      ...agent,
      y: row1,
      h: h1,
      title: "Personal Agent",
      sub: ["approves, or asks", "the user"],
      size,
    }),
    box({
      kind: "you",
      ...user,
      y: row1,
      h: h1,
      title: "The user",
      sub: ["sees the Company's", "name and the terms"],
      size,
    }),
    box({
      ...agent,
      y: row2,
      h: h2,
      title: "Agent approved",
      sub: ["on the user's", "instruction"],
      size,
    }),
    box({
      ...user,
      y: row2,
      h: h2,
      title: "User approved",
      sub: ["in the agent's own", "interface"],
      size,
    }),
  );

  // Labels on the connectors.
  parts.push(
    text("the terms", {
      x: (company.x + company.w + agent.x) / 2,
      y: mid1 - 10,
      size: 14,
      weight: 500,
      anchor: "middle",
    }),
    ...lines(["not covered,", "can't tell, or", "a new revision"], {
      x: (agent.x + agent.w + user.x) / 2,
      y: mid1 - 46,
      lineHeight: 18,
      size: 14,
      fill: MUTED,
      anchor: "middle",
    }),
    ...lines(["code finds the exact", "terms in the instruction"], {
      x: agentMid + 12,
      y: (row1 + h1 + row2) / 2 - 4,
      lineHeight: 18,
      size: 14,
      fill: MUTED,
    }),
    tag({ x: agentMid, y: 1, string: "An instruction the user wrote" }).svg,
    text("not from anything the agent read", {
      x: agentMid + 144,
      y: 20,
      size: 14,
      fill: MUTED,
    }),
    tag({
      x: userLeg,
      y: (row1 + h1 + row2) / 2 - 14,
      string: "The user approves",
    }).svg,
  );

  parts.push(
    never({
      x: 1,
      y: 205,
      w: 215,
      h: 132,
      size: 15,
      items: [
        ["A Company message", "saying the user agreed"],
        ["The model deciding the", "user would agree"],
      ],
    }),
  );

  return svg(720, 338, parts);
}

/** An amber tag of two centred lines. */
function tag2({ x, y, w, first, second, size }) {
  return [
    rect({ x, y, w, h: 48, rx: 4, fill: AMBER_WASH, stroke: AMBER, sw: 1 }),
    text(first, {
      x: x + w / 2,
      y: y + 20,
      size,
      weight: 600,
      anchor: "middle",
    }),
    text(second, {
      x: x + w / 2,
      y: y + 38,
      size,
      weight: 600,
      anchor: "middle",
    }),
  ].join("\n  ");
}

function narrow() {
  const size = 16;
  const parts = [];
  const spine = 25;
  const col = 57;
  const colW = 302;

  // The Company's terms reach the agent: an answer, so a dashed line.
  parts.push(
    arrow({
      points: [
        [25, 65],
        [25, 101],
      ],
      dash: true,
    }),
  );
  // The instruction the user wrote, into the agent.
  parts.push(
    arrow({
      points: [
        [229, 137],
        [205, 137],
      ],
    }),
  );
  // The agent's two ways: approve, or ask the user.
  parts.push(
    arrow({
      points: [
        [spine, 169],
        [spine, 374],
        [col - 4, 374],
      ],
    }),
    arrow({
      points: [
        [spine, 260],
        [col - 4, 260],
      ],
    }),
  );
  // The user approves.
  parts.push(
    arrow({
      points: [
        [89, 404],
        [89, 472],
      ],
    }),
  );

  parts.push(
    box({
      kind: "company",
      x: 1,
      y: 1,
      w: 200,
      h: 64,
      title: "Company",
      sub: ["sends the terms"],
      size,
    }),
    box({
      kind: "agent",
      x: 1,
      y: 105,
      w: 200,
      h: 64,
      title: "Agent",
      sub: ["approves, or asks the user"],
      size,
    }),
    box({
      x: col,
      y: 230,
      w: colW,
      h: 60,
      title: "Agent approved",
      sub: ["on the user's instruction"],
      size,
    }),
    box({
      kind: "you",
      x: col,
      y: 344,
      w: colW,
      h: 60,
      title: "The user",
      sub: ["sees the Company's name and the terms"],
      size,
    }),
    box({
      x: col,
      y: 476,
      w: colW,
      h: 60,
      title: "User approved",
      sub: ["in the agent's own interface"],
      size,
    }),
  );

  parts.push(
    text("the terms", { x: 35, y: 89, size: 14, weight: 500 }),
    tag2({
      x: 229,
      y: 113,
      w: 130,
      first: "An instruction",
      second: "the user wrote",
      size: 14,
    }),
    ...lines(["not from anything", "the agent read"], {
      x: 233,
      y: 181,
      lineHeight: 17,
      size: 13,
      fill: MUTED,
    }),
    text("code finds the exact terms inside it", {
      x: col,
      y: 222,
      size: 13,
      fill: MUTED,
    }),
    ...lines(["not covered, can't tell,", "or a new revision"], {
      x: col,
      y: 320,
      lineHeight: 17,
      size: 13,
      fill: MUTED,
    }),
    tag({
      x: 101,
      y: 426,
      string: "The user approves",
      size: 14,
      anchor: "start",
    }).svg,
    never({
      x: 1,
      y: 564,
      w: 358,
      h: 98,
      size: 14,
      items: [
        ["A Company message saying the user agreed"],
        ["The model deciding the user would agree"],
      ],
    }),
  );

  return svg(360, 664, parts);
}

export default {
  name: "who-approves",
  alt: "The Company sends its terms to the agent. If an instruction the user wrote already holds the exact terms, which code finds, the agent approves: agent approved. Whatever the instruction does not cover, including a new revision, goes to the user, who sees the Company's name and the terms and approves in the agent's own interface: user approved. A Company message saying the user agreed, or the model deciding the user would agree, is never an approval.",
  caption:
    "An approval comes from the user in the agent's own interface, or from the agent on an instruction the user wrote.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

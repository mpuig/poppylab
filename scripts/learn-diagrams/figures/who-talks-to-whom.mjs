import {
  INK,
  AMBER,
  AMBER_WASH,
  MUTED,
  ON_INK_MUTED,
  PAPER,
  TINT,
  arrow,
  rect,
  svg,
  tag,
  text,
} from "../draw.mjs";

/**
 * Who talks to whom (docs/learn/README.md): the home's flow diagram, drawn at
 * the size it is read. Three parties and the connectors between them; the two
 * things only the person does sit on amber tags, on the connectors that carry
 * them. The sign-in connector runs over the agent, not through it.
 */

/** A party, as the home draws it: a title and a muted line, left-aligned. */
function party({ kind, x, y, w, h = 72, title, sub, size }) {
  const you = kind === "you";
  const fill = { you: INK, agent: PAPER, company: TINT }[kind];
  return [
    rect({ x, y, w, h, fill }),
    text(title, {
      x: x + 16,
      y: y + 32,
      size,
      weight: 600,
      fill: you ? PAPER : INK,
    }),
    text(sub, {
      x: x + 16,
      y: y + 54,
      size: size - 2,
      fill: you ? ON_INK_MUTED : MUTED,
    }),
  ].join("\n  ");
}

/** An amber tag of two centred lines, for the narrow drawing. */
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

function wide() {
  const size = 15;
  const nodeW = 138;
  const you = 1;
  const agent = 291;
  const company = 581;
  const top = 57; // top edge of every node
  const mid = top + 36;
  const parts = [];

  // 2: sign-in goes from you to the company, over the agent.
  parts.push(
    arrow({
      points: [
        [33, top],
        [33, 15],
        [company + nodeW / 2, 15],
        [company + nodeW / 2, top - 4],
      ],
    }),
  );
  // 3: approval goes from you into your agent.
  const low = 171;
  parts.push(
    arrow({
      points: [
        [33, top + 72],
        [33, low],
        [agent + nodeW / 2, low],
        [agent + nodeW / 2, top + 72 + 4],
      ],
    }),
  );
  // 1: the request.
  parts.push(
    arrow({
      points: [
        [you + nodeW, mid],
        [agent - 4, mid],
      ],
    }),
  );
  // Agent and company: a request, and the answer that holds the change.
  parts.push(
    arrow({
      points: [
        [agent + nodeW, mid - 12],
        [company - 4, mid - 12],
      ],
    }),
    arrow({
      points: [
        [company, mid + 12],
        [agent + nodeW + 4, mid + 12],
      ],
      dash: true,
    }),
  );

  parts.push(
    party({
      kind: "you",
      x: you,
      y: top,
      w: nodeW,
      title: "You",
      sub: "the customer",
      size: 16,
    }),
    party({
      kind: "agent",
      x: agent,
      y: top,
      w: nodeW,
      title: "Your agent",
      sub: "Iris",
      size: 16,
    }),
    party({
      kind: "company",
      x: company,
      y: top,
      w: nodeW,
      title: "The company",
      sub: "its own website",
      size: 16,
    }),
  );

  const gap = (agent + nodeW + company) / 2;
  parts.push(
    text("1 · You ask", {
      x: (you + nodeW + agent) / 2,
      y: mid - 8,
      size,
      weight: 500,
      anchor: "middle",
    }),
    text("signed requests", {
      x: gap,
      y: mid - 20,
      size,
      weight: 500,
      anchor: "middle",
    }),
    text("changes held", {
      x: gap,
      y: mid + 38,
      size,
      weight: 500,
      anchor: "middle",
    }),
    text("for approval", {
      x: gap,
      y: mid + 56,
      size,
      weight: 500,
      anchor: "middle",
    }),
    tag({
      x: (33 + company + nodeW / 2) / 2,
      y: 1,
      string: "2 · You sign in on the company's own page",
    }).svg,
    tag({
      x: (33 + agent + nodeW / 2) / 2,
      y: low - 14,
      string: "3 · You approve the exact change",
    }).svg,
  );

  return svg(720, 188, parts);
}

function narrow() {
  const size = 14;
  const nodeW = 220;
  const x0 = 1;
  const you = 1;
  const agent = 169;
  const company = 337;
  const spine = 295;
  const parts = [];

  // 2: sign-in runs down the side, past the agent.
  parts.push(
    arrow({
      points: [
        [x0 + nodeW, you + 36],
        [spine, you + 36],
        [spine, company + 36],
        [x0 + nodeW + 4, company + 36],
      ],
    }),
  );
  // 1 and 3: the request and the approval go into your agent.
  parts.push(
    arrow({
      points: [
        [25, you + 72],
        [25, agent - 4],
      ],
    }),
    arrow({
      points: [
        [125, you + 72],
        [125, agent - 4],
      ],
    }),
  );
  // Agent and company.
  parts.push(
    arrow({
      points: [
        [25, agent + 72],
        [25, company - 4],
      ],
    }),
    arrow({
      points: [
        [149, company],
        [149, agent + 72 + 4],
      ],
      dash: true,
    }),
  );

  parts.push(
    party({
      kind: "you",
      x: x0,
      y: you,
      w: nodeW,
      title: "You",
      sub: "the customer",
      size: 16,
    }),
    party({
      kind: "agent",
      x: x0,
      y: agent,
      w: nodeW,
      title: "Your agent",
      sub: "Iris",
      size: 16,
    }),
    party({
      kind: "company",
      x: x0,
      y: company,
      w: nodeW,
      title: "The company",
      sub: "its own website",
      size: 16,
    }),
  );

  parts.push(
    text("1 · You ask", { x: 35, y: 126, size, weight: 500 }),
    text("signed requests", { x: 35, y: 292, size, weight: 500 }),
    text("changes held", { x: 159, y: 283, size, weight: 500 }),
    text("for approval", { x: 159, y: 301, size, weight: 500 }),
    tag({
      x: 135,
      y: 107,
      string: "3 · You approve",
      size,
      anchor: "start",
    }).svg,
    tag2({
      x: 231,
      y: agent + 12,
      w: 128,
      first: "2 · You sign in",
      second: "at the company",
      size,
    }),
  );

  return svg(360, 411, parts);
}

export default {
  name: "who-talks-to-whom",
  alt: "You ask your agent. Your agent sends signed requests to the company, and the company holds any change for approval. You sign in on the company's own page, not through the agent, and you approve the exact change in your agent. Those two things, signing in and approving, are the ones only you do.",
  caption:
    "You ask your agent, your agent sends signed requests to the company, and only you sign in and approve.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

import {
  LINE_STRONG,
  MUTED,
  arrow,
  card,
  line,
  svg,
  text,
  wrap,
} from "../../draw.mjs";

/**
 * What Poppy is not (the third post): the stack it sits in, with the five
 * things it stays out of set beside the layer each belongs to. Poppy is the
 * thin middle; above it the agent keeps its own model and framework, below
 * it the company keeps its interfaces and its payments.
 */

const LAYERS = [
  {
    kind: "agent",
    title: "Personal Agent",
    sub: "any model, prompt loop or SDK; Iris runs OpenAI, Anthropic, Google, Ollama or no model",
    nots: [["Not an agent framework", "nothing to adopt on the agent's side"]],
  },
  {
    kind: "poppy",
    title: "Poppy",
    sub: "discovery, identity, consent, Sessions and approvals",
    nots: [
      [
        "Not a marketplace or directory",
        "poppy.json and each client_id live on their owners' domains",
      ],
      [
        "Not a chatbot",
        "Conversations is a channel; the company's agent can be plain code",
      ],
    ],
  },
  {
    kind: "company",
    title: "The company's own systems",
    sub: "its API, MCP server, support and website; its catalog, ledger and payments",
    nots: [
      [
        "Not a payments network",
        "payments, fraud checks and settlement stay in the company's stack",
      ],
      [
        "Not a replacement for its APIs",
        "it wraps the interfaces already there",
      ],
    ],
  },
];

/** One thing Poppy is not: a short dash, a name and a muted line. */
function not({ x, y, w, title, sub, size }) {
  const subs = wrap(sub, size - 1, 400, w - 22);
  return {
    parts: [
      line({
        x1: x,
        y1: y - 5,
        x2: x + 12,
        y2: y - 5,
        stroke: LINE_STRONG,
        sw: 1.5,
      }),
      text(title, { x: x + 22, y, size, weight: 600 }),
      ...subs.map((s, i) =>
        text(s, { x: x + 22, y: y + 19 + i * 18, size: size - 1, fill: MUTED }),
      ),
    ],
    h: 19 + subs.length * 18,
  };
}

function wide() {
  const out = [];
  const heights = [84, 132, 132];
  let y = 1;
  LAYERS.forEach((layer, i) => {
    const c = card({
      kind: layer.kind,
      x: 1,
      y,
      w: 372,
      h: heights[i],
      title: layer.title,
      sub: layer.sub,
      size: 16,
      subSize: 14,
      pad: 16,
      rx: 8,
    });
    out.push(c.svg);
    let ny = y + 26;
    for (const [title, sub] of layer.nots) {
      const note = not({ x: 405, y: ny, w: 314, title, sub, size: 15 });
      out.push(...note.parts);
      ny += note.h + 16;
    }
    y += c.h;
    if (i < LAYERS.length - 1) {
      out.push(
        arrow({
          points: [
            [187, y],
            [187, y + 28],
          ],
          both: true,
        }),
      );
      y += 28;
    }
  });
  return svg(720, y + 1, out);
}

function narrow() {
  const out = [];
  let y = 1;
  LAYERS.forEach((layer, i) => {
    const c = card({
      kind: layer.kind,
      x: 1,
      y,
      w: 358,
      title: layer.title,
      sub: layer.sub,
      size: 15,
      subSize: 13,
      rx: 8,
    });
    out.push(c.svg);
    const top = y + c.h;
    let ny = top + 26;
    for (const [title, sub] of layer.nots) {
      const note = not({ x: 41, y: ny, w: 318, title, sub, size: 14 });
      out.push(...note.parts);
      ny += note.h + 14;
    }
    y = ny - 14 - 2;
    if (i < LAYERS.length - 1) {
      y += 12;
      out.push(
        arrow({
          points: [
            [21, top],
            [21, y],
          ],
          both: true,
        }),
      );
    }
  });
  return svg(360, y + 1, out);
}

export default {
  name: "stays-out",
  alt: "A stack of three layers, with what Poppy is not beside each. At the top, the Personal Agent runs any model, prompt loop or SDK; Iris runs OpenAI, Anthropic, Google, Ollama or no model at all, so Poppy is not an agent framework. In the middle, Poppy covers discovery, identity, consent, Sessions and approvals. It is not a marketplace or directory, because poppy.json and each agent's client_id live on their owners' own domains, and it is not a chatbot, because Conversations is a channel and the company's agent can be plain code. At the bottom, the company keeps its own API, MCP server, support and website, and its catalog, ledger and payments. Poppy is not a payments network, since payments, fraud checks and settlement stay in the company's stack, and it replaces none of the company's interfaces: it wraps the ones already there.",
  caption:
    "Poppy is the thin middle of the stack: the agent keeps its model and framework, and the company keeps its interfaces and its payments.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

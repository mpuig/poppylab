import { chain, svg, text } from "../../draw.mjs";

/**
 * Two ways a person comes into a conversation between agents (the tenth
 * post): a handoff brings in a person at the company (§8.9), and a Direct
 * Conversation brings in the user themself (§8.10), with their agent set
 * aside. Only the user can accept the second, so that step is amber.
 */

const WAYS = [
  {
    title: "A person at the company",
    cards: [
      {
        kind: "agent",
        title: "Either side asks for a person",
        sub: "a handoff request; handoff becomes pending",
      },
      {
        kind: "company",
        title: "A staff member joins",
        sub: [
          "responder becomes human",
          "If no one is available, the Company Agent says why; Lantern gives its phone number.",
        ],
      },
    ],
  },
  {
    title: "The user themself",
    cards: [
      {
        kind: "company",
        title: "The company asks for the user",
        sub: "a user_requested event, with its reason",
      },
      {
        kind: "wait",
        title: "Only the user can accept",
        sub: "the agent asks them, and starts nothing on its own",
      },
      {
        kind: "agent",
        title: "A Direct Conversation opens",
        sub: "the company speaks first; the user's words go as written",
      },
      {
        kind: "frame",
        title: "The agent steps aside",
        sub: "its messages to the first conversation get direct_conversation_open",
      },
    ],
  },
];

function wide() {
  const out = [];
  const w = 344;
  let bottom = 0;
  WAYS.forEach((way, i) => {
    const x = 1 + i * (w + 30);
    out.push(text(way.title, { x, y: 18, size: 16, weight: 600 }));
    const col = chain(way.cards, { x, y: 34, w });
    out.push(...col.parts);
    bottom = Math.max(bottom, col.bottom);
  });
  return svg(720, bottom + 1, out);
}

function narrow() {
  const out = [];
  let y = 1;
  WAYS.forEach((way, i) => {
    if (i) y += 28;
    out.push(text(way.title, { x: 1, y: y + 16, size: 15, weight: 600 }));
    const col = chain(way.cards, {
      x: 1,
      y: y + 30,
      w: 358,
      gap: 20,
      size: 14,
      subSize: 13,
      pad: 12,
    });
    out.push(...col.parts);
    y = col.bottom;
  });
  return svg(360, y + 1, out);
}

export default {
  name: "two-ways-to-a-person",
  alt: "Two ways a person comes into a conversation between a Personal Agent and a Company Agent. A person at the company: either side asks for one with a handoff request, and handoff becomes pending; a staff member joins and responder becomes human, and if no one is available the Company Agent says why, as Lantern does with its phone number. The user themself: the company asks for the user with a user_requested event and its reason; only the user can accept, and the agent asks them rather than starting anything on its own; a Direct Conversation opens, the company speaks first and the user's words go as written; and the agent steps aside, its messages to the first conversation refused with direct_conversation_open.",
  caption:
    "A handoff brings in a person at the company; a Direct Conversation brings in the user, and their agent steps aside.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

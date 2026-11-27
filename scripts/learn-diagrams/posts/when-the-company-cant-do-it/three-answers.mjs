import { arrow, card, chain, rowHeights, svg } from "../../draw.mjs";

/**
 * When the company can't do it (the ninth post): the three answers a task can
 * get at Lantern. Offered, it is done; excluded on purpose, the agent says so
 * and offers Lantern's alternative; neither, the agent reports it once, and
 * the report reaches Lantern as a record of what a customer tried to do.
 */

const START = {
  kind: "agent",
  title: "Iris checks what Lantern offers",
  sub: "its APIs, and /poppy/tasks, read at the start of every Session",
};

const COLUMNS = [
  [
    {
      kind: "green",
      title: "Offered",
      sub: "an API does it, such as moving an order to another slot",
    },
    {
      kind: "agent",
      title: "Iris does it",
      sub: "with an approval when it changes something",
    },
  ],
  [
    {
      kind: "green",
      title: "Excluded on purpose",
      sub: "listed in /poppy/tasks, such as cancelling an order",
    },
    {
      kind: "agent",
      title: "Iris says so",
      sub: "and offers Lantern's alternative: move the order instead",
    },
  ],
  [
    {
      kind: "green",
      title: "Neither",
      sub: "such as paying with a gift card",
    },
    {
      kind: "agent",
      title: "Iris tells Elena, and reports it once",
      sub: "to /poppy/feedback: the task, never her details",
    },
    {
      kind: "company",
      title: "Lantern answers",
      sub: "with an alternative, gift cards by phone, or 202 Accepted",
    },
    {
      kind: "company",
      title: "Under Feedback from agents",
      sub: "the report as sent, with the agent and the time",
    },
  ],
];

function wide() {
  const out = [];
  const start = card({ ...START, x: 200, y: 1, w: 320 });
  out.push(start.svg);
  const w = 228;
  const xs = [1, 246, 491];
  const top = start.h + 1 + 48;
  // Cards on the same row share a height, so the rows line up.
  const heights = rowHeights(COLUMNS, { w });
  let bottom = 0;
  COLUMNS.forEach((cards, i) => {
    const cx = xs[i] + w / 2;
    out.push(
      arrow({
        points: [
          [360, start.h + 1],
          [360, start.h + 1 + 24],
          [cx, start.h + 1 + 24],
          [cx, top],
        ],
      }),
    );
    const col = chain(cards, { x: xs[i], y: top, w, gap: 24, heights });
    out.push(...col.parts);
    bottom = Math.max(bottom, col.bottom);
  });
  return svg(720, bottom + 1, out);
}

function narrow() {
  const out = [];
  const opts = { size: 14, subSize: 13, pad: 12 };
  const start = card({ ...START, ...opts, x: 1, y: 1, w: 358 });
  out.push(start.svg);
  let y = start.h + 1 + 20;
  const cys = [];
  for (const cards of COLUMNS) {
    const col = chain(cards, { ...opts, x: 29, y, w: 330, gap: 20 });
    out.push(...col.parts);
    cys.push(col.firstCy);
    y = col.bottom + 20;
  }
  for (const cy of cys)
    out.push(
      arrow({
        points: [
          [13, start.h + 1],
          [13, cy],
          [29, cy],
        ],
      }),
    );
  return svg(360, y - 20 + 1, out);
}

export default {
  name: "three-answers",
  alt: "Iris checks what Lantern Noodle Bar offers: its APIs, and the /poppy/tasks document it reads at the start of every Session. A task gets one of three answers. Offered: an API does it, such as moving an order to another slot, and Iris does it, with an approval when it changes something. Excluded on purpose: /poppy/tasks lists it, such as cancelling an order, and Iris says so and offers Lantern's alternative, moving the order instead. Neither, such as paying with a gift card: Iris tells Elena and reports the task once to /poppy/feedback, describing the task and never her details. Lantern answers with an alternative, gift cards by phone, or with 202 Accepted, and the report appears as sent under Feedback from agents, with the agent and the time.",
  caption:
    "A task Lantern offers is done, one it excludes on purpose gets its alternative, and one it never thought of reaches it as a report.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

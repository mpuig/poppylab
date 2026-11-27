import { MUTED, arrow, card, svg, tag, text } from "../../draw.mjs";

/**
 * Giving permission and taking it back (the fifteenth post): Elena at
 * Juniper, from public questions to reading, to proposing changes, and back
 * out. Each step up is hers alone, on Juniper's own page (amber); either side
 * can end it.
 */

const STEPS = [
  {
    kind: "plain",
    title: "Signed out",
    sub: "public questions only, such as what Juniper sells",
  },
  {
    kind: "green",
    title: "Read",
    sub: "a token with poppy:read, and Propose changes: None. Iris doesn't send the delivery move at all.",
  },
  {
    kind: "green",
    title: "Read and propose changes",
    sub: "poppy:read and poppy:write on one consent screen, replacing the old grant. Each change still waits for her approval.",
  },
  {
    kind: "plain",
    title: "Disconnected",
    sub: "the refresh and access tokens end, Iris drops back to public access, and the moved delivery stays moved",
  },
];
// What moves Elena from one step to the next: hers alone (a tag), or either side's.
const MOVES = [
  {
    tag: "Elena signs in and allows, on Juniper's page",
    short: "Elena allows, at Juniper",
  },
  { tag: "Elena allows change permission too", short: "Elena allows changes" },
  { label: "Sign out in Iris, or Disconnect on Juniper's site" },
];
const NOTES = [
  {
    kind: "frame",
    title: "Narrower than scopes",
    sub: "At Harborline and Fernwick, Elena also picks which accounts or meters to share. The rest answer 404 on every channel, as if they didn't exist.",
  },
  {
    kind: "frame",
    title: "Ended from either side",
    sub: "Sign out in Iris sends POST /oauth/revoke. Disconnect on Juniper's website revokes the grant from the company's side, and Iris's next request fails.",
  },
];

/** The steps, one under the other, with what moves Elena between them. */
function steps({ x, w, gap, size, subSize, pad, tagSize, short }) {
  const parts = [];
  const centres = [];
  let y = 1;
  STEPS.forEach((spec, i) => {
    const c = card({ ...spec, x, y, w, size, subSize, pad });
    parts.push(c.svg);
    centres.push(y + c.h / 2);
    y += c.h;
    const move = MOVES[i];
    if (!move) return;
    parts.push(
      arrow({
        points: [
          [x + 24, y],
          [x + 24, y + gap],
        ],
      }),
    );
    if (move.tag)
      parts.push(
        tag({
          x: x + 40,
          y: y + gap / 2 - 14,
          string: short ? move.short : move.tag,
          size: tagSize,
          anchor: "start",
        }).svg,
      );
    else
      parts.push(
        text(move.label, {
          x: x + 40,
          y: y + gap / 2 + 5,
          size: tagSize,
          fill: MUTED,
        }),
      );
    y += gap;
  });
  return { parts, centres, bottom: y };
}

function wide() {
  const out = [];
  const left = steps({
    x: 1,
    w: 420,
    gap: 48,
    size: 15,
    subSize: 14,
    pad: 14,
    tagSize: 14,
  });
  out.push(...left.parts);
  const a = {
    ...card({ ...NOTES[0], x: 453, y: left.centres[1] - 20, w: 266 }),
    top: left.centres[1] - 20,
  };
  // The second note ends with the last step, below the first note.
  const bh = card({ ...NOTES[1], x: 453, y: 0, w: 266 }).h;
  const top = Math.max(left.bottom - bh, a.top + a.h + 16);
  const b = card({ ...NOTES[1], x: 453, y: top, w: 266 });
  out.push(a.svg, b.svg);
  return svg(720, Math.max(left.bottom, top + b.h) + 1, out);
}

function narrow() {
  const style = { size: 14, subSize: 13, pad: 12 };
  const left = steps({
    x: 1,
    w: 358,
    gap: 44,
    tagSize: 13,
    short: true,
    ...style,
  });
  const out = [...left.parts];
  let y = left.bottom + 16;
  for (const spec of NOTES) {
    const c = card({ ...spec, ...style, x: 1, y, w: 358 });
    out.push(c.svg);
    y += c.h + 10;
  }
  return svg(360, y - 10 + 1, out);
}

export default {
  name: "permission-steps",
  alt: "Elena's permission at Juniper Market, step by step. Signed out, Iris can ask public questions only, such as what Juniper sells. Elena signs in and allows on Juniper's own page, and Iris gets a token with poppy:read; the consent page says Propose changes: None, and Iris doesn't even send a request to move the delivery. Elena then allows change permission too: poppy:read and poppy:write on one consent screen, replacing the old grant, and each change still waits for her approval. Signing out in Iris, or Disconnect on Juniper's site, ends it: the refresh and access tokens end, Iris drops back to public access, and the delivery already moved stays moved. Sign out in Iris sends POST /oauth/revoke; Disconnect on Juniper's website revokes the grant from the company's side, and Iris's next request fails. At Harborline and Fernwick, Elena also picks which accounts or meters to share, and the rest answer 404 on every channel, as if they didn't exist.",
  caption:
    "Each step up in permission is the customer's own, on the company's page, and either side can take it back.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

import {
  MUTED,
  arrow,
  card,
  line,
  LINE,
  lines,
  rect,
  svg,
  text,
  wrap,
} from "../../draw.mjs";

/**
 * The four things Poppy settles (the second post), read off the one request
 * that moves Robin's noodle order: the request Iris sends again with Robin's
 * approval (docs/learn/one-task.md, step 9). Each part of it answers one
 * question for Lantern; the approval is the one only the person gives.
 */

const PARTS = [
  {
    header: "Poppy-Session: iss",
    title: "Who the agent is",
    sub: "Iris, known by its client_id URL",
  },
  {
    header: "Authorization: DPoP",
    title: "Which customer, and what they allowed",
    sub: "a token for Robin's account, with the scopes Robin allowed on Lantern's page",
  },
  {
    header: "Poppy-Session: sid, sub",
    title: "One Session across channels",
    sub: "the same Session ID on the API, MCP, a conversation or the website, and a User ID only Lantern sees",
  },
  {
    header: "Poppy-Approval",
    title: "What the customer agreed to",
    sub: "this revision of Lantern's exact terms, approved by Robin",
    waits: true,
  },
];

const PATH = ["POST /api/account/orders/", "ord_LNB2001/changes"];

function wide() {
  const out = [];
  const right = { x: 345, w: 374 };
  let y = 76;
  const rows = PARTS.map((part) => {
    const c = card({
      kind: "green",
      x: right.x,
      y,
      w: right.w,
      h: 70,
      title: part.title,
      sub: part.sub,
      dot: part.waits,
    });
    const row = { ...part, svg: c.svg, cy: y + c.h / 2 };
    y += c.h + 12;
    return row;
  });
  const H = y - 12 + 1;
  out.push(
    rect({ x: 1, y: 1, w: 296, h: H - 2, rx: 8 }),
    text("Iris to Lantern, with the approval", {
      x: 17,
      y: 25,
      size: 14,
      fill: MUTED,
    }),
    ...lines(PATH, { x: 17, y: 46, size: 15, weight: 600, lineHeight: 19 }),
    text("What each part settles", {
      x: right.x,
      y: 56,
      size: 14,
      fill: MUTED,
    }),
  );
  rows.forEach((row, i) => {
    if (i)
      out.push(
        line({
          x1: 17,
          y1: (rows[i - 1].cy + row.cy) / 2,
          x2: 281,
          y2: (rows[i - 1].cy + row.cy) / 2,
          stroke: LINE,
        }),
      );
    out.push(
      text(row.header, { x: 17, y: row.cy + 5, size: 15, weight: 500 }),
      arrow({
        points: [
          [297, row.cy],
          [right.x, row.cy],
        ],
      }),
      row.svg,
    );
  });
  return svg(720, H, out);
}

function narrow() {
  const out = [];
  const head = wrap("Iris to Lantern, with the approval", 13, 400, 326);
  out.push(
    rect({ x: 1, y: 1, w: 358, h: 74, rx: 8 }),
    ...lines(head, { x: 15, y: 22, size: 13, fill: MUTED }),
    ...lines(PATH, { x: 15, y: 43, size: 14, weight: 600, lineHeight: 18 }),
  );
  let y = 75;
  // Each part of the request over what it settles.
  for (const part of PARTS) {
    out.push(
      text(part.header, { x: 15, y: y + 30, size: 14, weight: 600 }),
      arrow({
        points: [
          [25, y + 38],
          [25, y + 60],
        ],
      }),
    );
    y += 60;
    const c = card({
      kind: "green",
      x: 1,
      y,
      w: 358,
      title: part.title,
      sub: part.sub,
      size: 14,
      subSize: 13,
      pad: 12,
      dot: part.waits,
    });
    out.push(c.svg);
    y += c.h;
  }
  return svg(360, y + 1, out);
}

export default {
  name: "one-request",
  alt: "The request Iris sends to Lantern Noodle Bar to move Robin's order, POST /api/account/orders/ord_LNB2001/changes, sent again with Robin's approval. Four of its parts settle four things. The Poppy-Session header's issuer says who the agent is: Iris, by its client_id URL. The DPoP access token says which customer it acts for and what they allowed: Robin's account, with the scopes Robin allowed on Lantern's page. The Session header's Session ID and User ID tie the API, MCP, a conversation and the website into one Session, under a User ID only Lantern sees. The Poppy-Approval header says what the customer agreed to: this revision of Lantern's exact terms, approved by Robin.",
  caption:
    "One request carries all four answers: who the agent is, whose account it acts on and with what permission, which Session it belongs to, and which terms the customer approved.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

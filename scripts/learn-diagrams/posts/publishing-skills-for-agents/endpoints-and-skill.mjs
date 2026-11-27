import { GREEN, MUTED, card, chain, svg, text } from "../../draw.mjs";

/**
 * Endpoints and a skill (the fourteenth post): what Harborline's OpenAPI
 * description says, three endpoints and their fields, beside what its
 * pay-saved-recipient skill adds, the order and the rules around them. The
 * steps are the skill's own (apps/harborline/src/skills.ts).
 */

const ENDPOINTS = [
  {
    kind: "company",
    title: "GET /api/account/accounts",
    sub: "accounts and their fields",
  },
  {
    kind: "company",
    title: "GET /api/account/recipients",
    sub: "saved recipients and their fields",
  },
  {
    kind: "company",
    title: "POST /api/account/payments",
    sub: "the parameters of a payment",
  },
];
const STEPS = [
  {
    kind: "green",
    title: "1 · Read the accounts",
    sub: "the source is active, and available_cents covers the payment",
  },
  {
    kind: "green",
    title: "2 · Read the recipients",
    sub: "saved and active, and within its payment_limit_cents",
  },
  {
    kind: "green",
    title: "3 · Request the payment",
    sub: "one idempotency_key, kept for every retry; a reference only for a biller",
  },
  {
    kind: "green",
    title: "4 · Expect approval_required",
    sub: "show the terms; only the customer's own approval counts",
  },
];
const FOOT = [
  {
    kind: "frame",
    title: "Found in /poppy/tasks",
    sub: "skill_index: name, description, type, url and a sha256 digest of the file",
  },
  {
    kind: "frame",
    title: "Company content, not authority",
    sub: "reading a skill grants no scope and never counts as an approval",
  },
];

/** Cards one under the other, with no arrows: things with no order. */
function list(cards, { x, y, w, gap, ...style }) {
  const parts = [];
  let top = y;
  for (const spec of cards) {
    const c = card({ ...style, ...spec, x, y: top, w });
    parts.push(c.svg);
    top += c.h + gap;
  }
  return { parts, bottom: top - gap };
}

function wide() {
  const out = [
    text("What the OpenAPI description says", {
      x: 1,
      y: 18,
      size: 15,
      weight: 600,
      fill: MUTED,
    }),
    text("What pay-saved-recipient adds", {
      x: 361,
      y: 18,
      size: 15,
      weight: 600,
      fill: GREEN,
    }),
  ];
  const left = list(ENDPOINTS, { x: 1, y: 34, w: 330, gap: 12 });
  const right = chain(STEPS, { x: 361, y: 34, w: 358, gap: 16 });
  out.push(...left.parts, ...right.parts);
  out.push(
    text("in no particular order", {
      x: 1,
      y: left.bottom + 24,
      size: 14,
      fill: MUTED,
    }),
  );
  const top = Math.max(left.bottom, right.bottom) + 24;
  const at = (i) => ({ x: 1 + i * 367, y: top, w: 351 });
  const h = Math.max(...FOOT.map((spec, i) => card({ ...spec, ...at(i) }).h));
  out.push(...FOOT.map((spec, i) => card({ ...spec, ...at(i), h }).svg));
  return svg(720, top + h + 1, out);
}

function narrow() {
  const style = { size: 14, subSize: 13, pad: 12 };
  const out = [
    text("What the OpenAPI description says", {
      x: 1,
      y: 16,
      size: 14,
      weight: 600,
      fill: MUTED,
    }),
  ];
  const left = list(ENDPOINTS, { ...style, x: 1, y: 28, w: 358, gap: 10 });
  out.push(
    ...left.parts,
    text("What pay-saved-recipient adds", {
      x: 1,
      y: left.bottom + 36,
      size: 14,
      weight: 600,
      fill: GREEN,
    }),
  );
  const right = chain(STEPS, {
    ...style,
    x: 1,
    y: left.bottom + 48,
    w: 358,
    gap: 16,
  });
  out.push(...right.parts);
  let y = right.bottom + 20;
  for (const spec of FOOT) {
    const c = card({ ...style, ...spec, x: 1, y, w: 358 });
    out.push(c.svg);
    y += c.h + 10;
  }
  return svg(360, y - 10 + 1, out);
}

export default {
  name: "endpoints-and-skill",
  alt: "On one side, what Harborline Bank's OpenAPI description says: three endpoints, GET /api/account/accounts, GET /api/account/recipients and POST /api/account/payments, with their fields, in no particular order. On the other, what its pay-saved-recipient skill adds, in order: read the accounts, checking that the source is active and that available_cents covers the payment; read the recipients, checking the recipient is saved, active and within its payment_limit_cents; request the payment with one idempotency_key kept for every retry, and a reference only for a biller; and expect approval_required, show the terms, and count only the customer's own approval. The skill is found in /poppy/tasks, whose skill_index lists its name, description, type, URL and a sha256 digest of the file. It is company content, not authority: reading it grants no scope and never counts as an approval.",
  caption:
    "The OpenAPI description lists what exists; the skill says in what order to use it, and grants nothing.",
  draw: (variant) => (variant === "wide" ? wide() : narrow()),
};

import { PAPER, msg, pair, rect, sequence, textWidth } from "../draw.mjs";

/**
 * One task, request by request (docs/learn/one-task.md): the nine steps in the
 * order the page numbers them, six without an access token and three with one.
 * The user acts twice, at the Company's consent page (5) and at the approval
 * (9): the amber label and the amber gate. The Company's authorization server
 * is a party of its own, called its issuer here because the head is too small
 * for "authorization server"; the label of step 2 says the longer name.
 *
 * Four parties, in the order that keeps the lines short: the agent talks to the
 * Company six times and to the issuer three times, so the Company sits next to
 * it.
 */
const FOUR_PARTIES = {
  wide: {
    width: 720,
    font: 15,
    x: { user: 90, agent: 270, company: 450, issuer: 630 },
    head: [152, 48],
    edge: 28,
    // A row between the user and the Company's side sits at the left, where the
    // agent's lifeline is not under its label.
    anchor: (message) =>
      message.from !== "agent" && message.to !== "agent" ? "start" : "mid",
  },
  narrow: {
    width: 360,
    font: 14,
    x: { user: 44, agent: 132, company: 220, issuer: 308 },
    head: [82, 44],
    edge: 28,
    anchor: (message) =>
      message.from === "user" || message.to === "user" ? "start" : "end",
  },
};

/** The muted guard text gets a paper ground, so a lifeline does not run through it. */
function finish(svg) {
  return svg.replace(
    /<text x="28" y="([\d.]+)" font-size="(\d+)" fill="#5b626c">([^<]*)<\/text>/g,
    (whole, y, size, label) =>
      `${rect({ x: 24, y: Number(y) - Number(size), w: textWidth(label, Number(size)) + 8, h: Number(size) + 6, fill: PAPER, stroke: null })}\n  ${whole}`,
  );
}

const spec = {
  parties: {
    user: { kind: "you", label: pair("The user", "User") },
    agent: { kind: "agent", label: pair("Personal Agent", "Agent") },
    company: { kind: "company", label: pair("Company") },
    issuer: { kind: "company", label: pair("Issuer") },
  },
  layout: FOUR_PARTIES,
  items: [
    { kind: "guard", text: pair("Without an access token") },
    msg("agent", "company", pair(["1 · Find out what it offers"])),
    msg(
      "agent",
      "company",
      pair(
        ["2 · Find the authorization server"],
        ["2 · Find the", "authorization server"],
      ),
    ),
    msg("agent", "issuer", pair(["Read the issuer's metadata"])),
    msg(
      "agent",
      "company",
      pair(
        ["3 · Open a Session, signed out"],
        ["3 · Open a Session,", "signed out"],
      ),
    ),
    msg("agent", "company", pair(["4 · Read public data"])),
    msg("agent", "issuer", pair(["5 · Ask for access"])),
    msg(
      "user",
      "issuer",
      pair(["The user signs in and allows"], ["User signs in", "and allows"]),
      { tag: true },
    ),
    msg("agent", "issuer", pair(["6 · Get a token"])),
    { kind: "rule" },
    { kind: "guard", text: pair("With an access token") },
    msg("agent", "company", pair(["7 · Read the order"])),
    msg("agent", "company", pair(["8 · Propose the change"])),
    msg(
      "company",
      "agent",
      pair(
        ["approval_required, with the terms"],
        ["approval_required,", "with the terms"],
      ),
      { reply: true },
    ),
    {
      kind: "gate",
      text: pair(
        "Waiting for the user to approve the terms",
        "Waiting for the user to approve",
      ),
    },
    msg(
      "user",
      "agent",
      pair(["9 · The user approves"], ["9 · User approves"]),
      {
        tag: true,
      },
    ),
    msg(
      "agent",
      "company",
      pair(
        ["The same request, with the approval"],
        ["The same request,", "with the approval"],
      ),
    ),
    msg("company", "agent", pair(["The change is made"]), { reply: true }),
  ],
};

export default {
  name: "one-task-sequence",
  alt: "The nine requests of one task, in order. Without an access token, the Personal Agent reads what the Company offers, finds its authorization server, opens a Session on the Company's tasks and reads public data. It then asks the authorization server for access, and the user signs in and allows each permission on the Company's own page, after which the agent gets a token. With the access token, the agent reads the order and proposes the change, and the Company answers approval_required with the terms. The user approves, the agent sends the same request with the approval, and the Company makes the change.",
  caption:
    "The nine requests of one task: six without an access token, then three with one, and the two moments the user decides.",
  draw: (variant) => finish(sequence(spec, variant)),
};

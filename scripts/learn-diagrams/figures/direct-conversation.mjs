import {
  PAPER,
  THREE_PARTIES,
  msg,
  pair,
  rect,
  sequence,
  text,
  textWidth,
} from "../draw.mjs";

/**
 * A Direct Conversation (docs/learn/conversations.md, "When the Company needs
 * to hear from the user"): the Company asks to talk to the user, only the user
 * decides, and while it is open the user's words go to the Company as written
 * and the Company's answers come back to the user, past the agent. A change the
 * Company proposes still waits for the user's approval. What the page does not
 * say, the figure does not draw: how the approval travels is left out.
 */

/**
 * The wide drawing sets a row between the user and the Company at the left,
 * where the agent's lifeline is not under its label. Labels keep 24px from the
 * edges so none touches the dashed frame, which sits 12px in.
 */
const layout = {
  wide: {
    ...THREE_PARTIES.wide,
    edge: 24,
    anchor: (message) =>
      message.from !== "agent" && message.to !== "agent" ? "start" : "mid",
  },
  narrow: { ...THREE_PARTIES.narrow, edge: 24 },
};

/**
 * Two touches on what `sequence` draws, local to this figure: the narrow
 * "Company Agent" head is set on two lines because its box is too small for one,
 * and the muted guard text gets a paper ground so the user's lifeline does not
 * run through it.
 */
function finish(svg, variant) {
  const head =
    /<text x="([\d.]+)" y="[\d.]+" text-anchor="middle" font-size="(\d+)" font-weight="600" fill="#171a1f">Company Agent<\/text>/;
  if (!head.test(svg))
    throw new Error("direct-conversation: no Company Agent head");
  return svg
    .replace(head, (whole, x, size) =>
      variant === "narrow"
        ? ["Company", "Agent"]
            .map((line, i) =>
              text(line, {
                x: Number(x),
                y: 19 + i * 16,
                size: Number(size),
                weight: 600,
                anchor: "middle",
              }),
            )
            .join("\n  ")
        : whole,
    )
    .replace(
      /<text x="28" y="([\d.]+)" font-size="(\d+)" fill="#5b626c">([^<]*)<\/text>/g,
      (whole, y, size, label) =>
        `${rect({ x: 24, y: Number(y) - Number(size), w: textWidth(label, Number(size)) + 8, h: Number(size) + 6, fill: PAPER, stroke: null })}\n  ${whole}`,
    );
}

const spec = {
  parties: {
    user: { kind: "you", label: pair("The user", "User") },
    agent: { kind: "agent", label: pair("Personal Agent", "Agent") },
    company: { kind: "company", label: pair("Company Agent") },
  },
  layout,
  items: [
    msg(
      "company",
      "agent",
      pair(
        ["1 · Asks to talk with the user"],
        ["1 · Asks to talk", "with the user"],
      ),
      { reply: true },
    ),
    msg("agent", "user", pair(["2 · Shows the Company's reason"])),
    {
      kind: "gate",
      text: pair(
        "Waiting for the user to accept, or to say not now",
        "Waiting for the user to decide",
      ),
    },
    msg("user", "agent", pair(["3 · The user accepts"], ["3 · User accepts"]), {
      tag: true,
    }),
    msg(
      "agent",
      "company",
      pair(
        ["4 · Opens a new thread, no message"],
        ["4 · Opens a new thread,", "no message"],
      ),
    ),
    { kind: "frame-start" },
    {
      kind: "guard",
      text: pair(
        "The agent steps aside, and can't talk over the user",
        "Agent steps aside, can't talk over user",
      ),
    },
    msg(
      "company",
      "user",
      pair(
        ["5 · The Company speaks first"],
        ["5 · The Company", "speaks first"],
      ),
      { reply: true },
    ),
    msg(
      "user",
      "company",
      pair(
        ["6 · The user's words, as written"],
        ["6 · The user's", "words, as written"],
      ),
      { tag: true },
    ),
    msg(
      "company",
      "user",
      pair(
        ["7 · Proposes a change, as terms"],
        ["7 · Proposes a", "change, as terms"],
      ),
      { reply: true },
    ),
    { kind: "frame-end" },
    {
      kind: "gate",
      text: pair(
        "The change still waits for the user's approval",
        "Waiting for the user's approval",
      ),
    },
    msg("user", "agent", pair(["8 · The user leaves"], ["8 · User leaves"]), {
      tag: true,
    }),
    msg("agent", "company", pair(["9 · Closes the thread"])),
  ],
};

export default {
  name: "direct-conversation",
  alt: "The Company Agent asks to talk with the user directly, and the Personal Agent shows the user the Company's reason. Only the user can say yes, so the process waits; when the user accepts, the agent opens a new thread linked to the first, with no message, and the Company speaks first. While it is open the agent steps aside and cannot talk over the user: the user's words go to the Company as written, and the Company's answers come back to the user, including a change it proposes as terms. That change still waits for the user's approval. When the user leaves, the agent closes the thread.",
  caption:
    "When the Company asks to hear from the user, the user speaks for themselves and the change still waits for their approval.",
  draw: (variant) => finish(sequence(spec, variant), variant),
};

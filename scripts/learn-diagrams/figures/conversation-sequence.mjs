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
 * The refund conversation of docs/learn/conversations.md: a conversation
 * starts and the Company Agent answers, it asks for a sign-in in the middle,
 * puts a proposal inside a message, takes the approval as a message and says
 * it is done. A person can be reached instead. The two amber gates and the
 * amber label are the user's: what waits for them, and the one thing only they
 * do. The sign-in happens on the Company's own page, not with the Company
 * Agent, so it is a gate and not a message.
 */

/**
 * Two touches on what `sequence` draws, local to this figure: the narrow
 * "Company Agent" head is set on two lines because its box is too small for one,
 * and the muted guard text gets a paper ground so the user's lifeline does not
 * run through it.
 */
function finish(svg, variant) {
  let out = svg.replace(
    /<text x="([\d.]+)" y="[\d.]+" text-anchor="middle" font-size="(\d+)" font-weight="600" fill="#171a1f">Company Agent<\/text>/,
    (whole, x, size) =>
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
  );
  out = out.replace(
    /<text x="28" y="([\d.]+)" font-size="(\d+)" fill="#5b626c">([^<]*)<\/text>/g,
    (whole, y, size, label) =>
      `${rect({ x: 24, y: Number(y) - Number(size), w: textWidth(label, Number(size)) + 8, h: Number(size) + 6, fill: PAPER, stroke: null })}\n  ${whole}`,
  );
  return out;
}

/** Labels keep 24px from the edges, so none touches the dashed frame, which sits 12px in. */
const layout = {
  wide: THREE_PARTIES.wide,
  narrow: { ...THREE_PARTIES.narrow, edge: 24 },
};

const spec = {
  parties: {
    user: { kind: "you", label: pair("The user", "User") },
    agent: { kind: "agent", label: pair("Personal Agent", "Agent") },
    company: { kind: "company", label: pair("Company Agent") },
  },
  layout,
  items: [
    msg("agent", "company", pair(["1 · Starts a conversation"])),
    msg(
      "company",
      "agent",
      pair(
        ["2 · Text for people, data for agents"],
        ["2 · Text for people,", "data for agents"],
      ),
      { reply: true },
    ),
    msg("agent", "company", pair(["3 · Reports the missing dish"])),
    msg("company", "agent", pair(["4 · Asks the agent to sign in"]), {
      reply: true,
    }),
    {
      kind: "gate",
      text: pair(
        "Waiting while the user signs in on the Company's own page",
        "User signs in on the Company's page",
      ),
    },
    msg("agent", "company", pair(["5 · Sends the request again"])),
    msg(
      "company",
      "agent",
      pair(
        ["6 · A proposal, inside a message"],
        ["6 · A proposal, inside", "a message"],
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
      pair(["7 · The user approves"], ["7 · User approves"]),
      {
        tag: true,
      },
    ),
    msg(
      "agent",
      "company",
      pair(
        ["8 · The approval, as a message"],
        ["8 · The approval,", "as a message"],
      ),
    ),
    msg(
      "company",
      "agent",
      pair(["9 · Answers that it is done"], ["9 · Answers that", "it is done"]),
      { reply: true },
    ),
    { kind: "frame-start" },
    { kind: "guard", text: pair("If the agent asks for a person") },
    msg("agent", "company", pair(["Asks for a person"])),
    msg(
      "company",
      "agent",
      pair(
        ["A person joins, or it says how to call"],
        ["A person joins, or it", "says how to call"],
      ),
      { reply: true },
    ),
    { kind: "frame-end" },
  ],
};

export default {
  name: "conversation-sequence",
  alt: "A Personal Agent starts a conversation with the Company Agent, which answers with text for people and data for agents. The agent reports a missing dish, and the Company Agent asks it to sign in, in the middle of the conversation. The user signs in on the Company's own page, the agent sends the request again, and the Company Agent answers with a proposal inside a message. The user approves, the agent sends the approval as a message, and the Company Agent answers that the refund is done. If the agent asks for a person, one joins, or the Company Agent says how to call.",
  caption:
    "A refund asked for in a conversation: the sign-in, the proposal and the approval all happen inside it.",
  draw: (variant) => finish(sequence(spec, variant), variant),
};

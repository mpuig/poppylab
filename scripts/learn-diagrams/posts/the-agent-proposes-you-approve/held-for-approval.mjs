import {
  THREE_PARTIES,
  groundGuards,
  msg,
  pair,
  sequence,
} from "../../draw.mjs";

/**
 * The agent proposes, you approve (the sixth post): Elena's $1,000 transfer
 * at Harborline, from the request to the one transfer. Harborline writes the
 * terms and holds the change; only Elena's click on the card approves it, and
 * a retry of the approved request moves nothing twice.
 */
const spec = {
  parties: {
    user: { kind: "you", label: pair("Elena") },
    agent: { kind: "agent", label: pair("Iris") },
    company: { kind: "company", label: pair("Harborline") },
  },
  layout: THREE_PARTIES,
  items: [
    msg(
      "user",
      "agent",
      pair(
        ["1 · “Move $1,000 to savings”"],
        ["1 · “Move $1,000", "to savings”"],
      ),
    ),
    msg("agent", "company", pair(["2 · Request the transfer"])),
    msg(
      "company",
      "agent",
      pair(
        ["3 · approval_required: terms, revision, expires_at"],
        ["3 · approval_required:", "terms, revision, expires_at"],
      ),
      { reply: true },
    ),
    {
      kind: "gate",
      text: pair(
        "Harborline holds the transfer until Elena approves",
        "Held until Elena approves",
      ),
    },
    {
      kind: "guard",
      text: pair("Nothing typed in the chat counts", "Chat text never counts"),
    },
    msg(
      "user",
      "agent",
      pair(
        ["4 · Elena approves these terms on the card"],
        ["4 · Approves these", "terms on the card"],
      ),
      { tag: true },
    ),
    msg(
      "agent",
      "company",
      pair(
        ["5 · The same request, with Poppy-Approval"],
        ["5 · The same request,", "with Poppy-Approval"],
      ),
    ),
    msg(
      "company",
      "agent",
      pair(
        ["6 · The transfer is made, once"],
        ["6 · The transfer is", "made, once"],
      ),
      { reply: true },
    ),
    { kind: "rule" },
    {
      kind: "guard",
      text: pair(
        "If Iris sends the approved request again",
        "If Iris sends it again",
      ),
    },
    msg(
      "company",
      "agent",
      pair(
        ["The first result again; nothing moves twice"],
        ["The first result again;", "nothing moves twice"],
      ),
      { reply: true },
    ),
  ],
};

export default {
  name: "held-for-approval",
  alt: "Elena asks Iris in the chat to move $1,000 to savings, and Iris asks Harborline for the transfer. Harborline answers approval_required with its exact terms, a revision and an expiry time, and holds the transfer until Elena approves; nothing she types in the chat counts. Elena approves those terms on the card, Iris sends the same request again with a Poppy-Approval header, and Harborline makes the transfer once. If Iris sends the approved request again, Harborline returns the first result and nothing moves twice.",
  caption:
    "Harborline writes the terms and holds the change; only Elena's click on the card approves it, and the transfer is made once.",
  draw: (variant) => groundGuards(sequence(spec, variant)),
};

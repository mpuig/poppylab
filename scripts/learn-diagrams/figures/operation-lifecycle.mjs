import { THREE_PARTIES, msg, pair, sequence } from "../draw.mjs";

/**
 * The life of an operation (docs/learn/operations.md): one request, an answer
 * that holds the terms, an approval of exactly those terms, and a change made
 * once. The amber gate and the amber label are the person's: what waits for
 * them, and the one thing only they do.
 */
const spec = {
  parties: {
    user: { kind: "you", label: pair("The user", "User") },
    agent: { kind: "agent", label: pair("Personal Agent", "Agent") },
    company: { kind: "company", label: pair("Company") },
  },
  layout: THREE_PARTIES,
  items: [
    msg("agent", "company", pair(["1 · Request the change"])),
    msg(
      "company",
      "agent",
      pair(
        ["2 · approval_required, with the terms and a revision"],
        ["2 · approval_required, with", "the terms and a revision"],
      ),
      { reply: true },
    ),
    { kind: "gate", text: pair("Waiting for approval of this revision") },
    msg(
      "user",
      "agent",
      pair(
        ["3 · The user approves these terms"],
        ["3 · The user approves", "these terms"],
      ),
      { tag: true },
    ),
    msg(
      "agent",
      "company",
      pair(
        ["4 · The same request, with the approval"],
        ["4 · The same request,", "with the approval"],
      ),
    ),
    { kind: "frame-start" },
    { kind: "guard", text: pair("If the terms still match") },
    msg(
      "company",
      "agent",
      pair(
        ["5 · The change is made once, or declined"],
        ["5 · The change is made", "once, or declined"],
      ),
      { reply: true },
    ),
    { kind: "rule" },
    { kind: "guard", text: pair("If the terms have changed") },
    msg(
      "company",
      "agent",
      pair(
        ["5 · A new revision; the old approval no longer applies"],
        ["5 · A new revision; the old", "approval no longer applies"],
      ),
      { reply: true },
    ),
    { kind: "frame-end" },
  ],
};

export default {
  name: "operation-lifecycle",
  // The image's alt text: the figure said in full, for a reader who can't see it.
  alt: "A Personal Agent asks a Company for a change. The Company answers approval_required with an operation holding its terms and a revision. The user approves, or the agent approves on the user's instruction, and the agent resends the same request with the approval. The Company checks it and performs the change once, or declines. If the terms change, the Company returns a new revision and the old approval no longer applies.",
  // One plain sentence, with no number and no label.
  caption:
    "A request, an answer that holds the terms, an approval of exactly those terms, and a change made once.",
  draw: (variant) => sequence(spec, variant),
};

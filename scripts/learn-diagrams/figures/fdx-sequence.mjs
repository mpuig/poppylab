import { THREE_PARTIES, msg, pair, sequence } from "../draw.mjs";

/**
 * Bank data through Poppy (docs/learn/extensions/fdx.md): the seven numbered
 * steps of the page, one row or a short group each. The user's own actions are
 * amber: choosing the accounts, downloading a statement, revoking. The ESPI
 * figure is laid out the same way, so a reader sees what stayed the same.
 */

/** A row between the user and the Company sits at the left, where the agent's lifeline is not under its label. */
const layout = {
  wide: {
    ...THREE_PARTIES.wide,
    anchor: (message) =>
      message.from !== "agent" && message.to !== "agent" ? "start" : "mid",
  },
  narrow: THREE_PARTIES.narrow,
};

const spec = {
  parties: {
    user: { kind: "you", label: pair("The user", "User") },
    agent: { kind: "agent", label: pair("Personal Agent", "Agent") },
    company: { kind: "company", label: pair("Harborline") },
  },
  layout,
  items: [
    msg(
      "company",
      "agent",
      pair(
        ["1 · The bank lists poppylab.dev/fdx"],
        ["1 · The bank lists", "poppylab.dev/fdx"],
      ),
      { reply: true },
    ),
    msg(
      "agent",
      "company",
      pair(
        ["2 · Declares it, on every request"],
        ["2 · Declares it, on", "every request"],
      ),
    ),
    msg(
      "company",
      "agent",
      pair(
        ["If undeclared: extension_required"],
        ["If undeclared:", "extension_required"],
      ),
      { reply: true },
    ),
    msg(
      "user",
      "company",
      pair(
        ["3 · The user signs in, picks accounts"],
        ["3 · User signs in,", "picks accounts"],
      ),
      { tag: true },
    ),
    msg("company", "agent", pair(["A token, with a consent ID"]), {
      reply: true,
    }),
    msg(
      "agent",
      "company",
      pair(
        ["4 · Reads accounts and transactions"],
        ["4 · Reads accounts", "and transactions"],
      ),
    ),
    msg(
      "company",
      "agent",
      pair(
        ["Only the shared account comes back"],
        ["Only the shared account", "comes back"],
      ),
      { reply: true },
    ),
    msg(
      "agent",
      "company",
      pair(
        ["5 · Asks for an account not shared"],
        ["5 · Asks for an account", "not shared"],
      ),
    ),
    msg("company", "agent", pair(["404, as if it didn't exist"]), {
      reply: true,
    }),
    msg(
      "user",
      "company",
      pair(
        ["6 · The user downloads a statement"],
        ["6 · User downloads", "a statement"],
      ),
      { tag: true },
    ),
    msg(
      "company",
      "user",
      pair(
        ["The PDF goes to the user, not the model"],
        ["The PDF goes to the user,", "not the model"],
      ),
      { reply: true },
    ),
    msg(
      "user",
      "agent",
      pair(
        ["7 · The user revokes, in the agent"],
        ["7 · User revokes,", "in the agent"],
      ),
      { tag: true },
    ),
    msg("agent", "company", pair(["Revokes the consent"])),
  ],
};

export default {
  name: "fdx-sequence",
  alt: "The bank lists the extension poppylab.dev/fdx in its poppy.json. The Personal Agent declares the extension on every request, and a request that does not is refused with extension_required. The user signs in on the bank's page and picks the accounts to share, and the agent receives a token with a consent ID. The agent reads accounts and transactions and gets only the shared account; asking for an account that was not shared gets a 404, as if it did not exist. The user downloads a statement, and the PDF goes from the bank to the user, not to the model. The user revokes the consent in the agent, and the agent revokes it at the bank.",
  caption:
    "Seven steps of one request for bank data, and the three things only the user does.",
  draw: (variant) => sequence(spec, variant),
};

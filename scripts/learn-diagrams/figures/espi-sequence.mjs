import { THREE_PARTIES, msg, pair, sequence } from "../draw.mjs";

/**
 * Energy data through Poppy (docs/learn/extensions/espi.md): the nine numbered
 * steps of the page, one row or a short group each, laid out like the FDX
 * figure so the two read as siblings. What changed is the token (it carries
 * the subscription, a step of its own), the two feeds the agent reads, and no
 * download by the user. The user's own actions are amber: choosing the meters
 * and revoking.
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
    company: { kind: "company", label: pair("Fernwick") },
  },
  layout,
  items: [
    msg(
      "company",
      "agent",
      pair(
        ["1 · The utility lists poppylab.dev/espi"],
        ["1 · The utility lists", "poppylab.dev/espi"],
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
        ["3 · The user signs in, picks meters"],
        ["3 · User signs in,", "picks meters"],
      ),
      { tag: true },
    ),
    msg(
      "company",
      "agent",
      pair(
        ["4 · The token carries the subscription"],
        ["4 · The token carries", "the subscription"],
      ),
      { reply: true },
    ),
    msg("agent", "company", pair(["5 · Finds the meter"])),
    msg(
      "company",
      "agent",
      pair(
        ["Only the EV charger is listed"],
        ["Only the EV charger", "is listed"],
      ),
      { reply: true },
    ),
    msg("agent", "company", pair(["6 · Reads last week's usage"])),
    msg("agent", "company", pair(["7 · Reads the bills"])),
    msg(
      "agent",
      "company",
      pair(
        ["8 · Asks for a meter not shared"],
        ["8 · Asks for a meter", "not shared"],
      ),
    ),
    msg("company", "agent", pair(["404, as if it didn't exist"]), {
      reply: true,
    }),
    msg(
      "user",
      "agent",
      pair(
        ["9 · The user revokes, in the agent"],
        ["9 · User revokes,", "in the agent"],
      ),
      { tag: true },
    ),
    msg("agent", "company", pair(["Deletes the authorization"])),
  ],
};

export default {
  name: "espi-sequence",
  alt: "The utility lists the extension poppylab.dev/espi in its poppy.json. The Personal Agent declares the extension on every request, and a request that does not is refused with extension_required. The user signs in on the utility's page and picks the meters to share, and the token the agent receives carries the subscription. The agent finds the meter, reads last week's usage and reads the bills, and only the shared meter is listed; asking for a meter that was not shared gets a 404, as if it did not exist. The user revokes the access in the agent, and the agent deletes the authorization at the utility.",
  caption:
    "Nine steps of one request for energy data, laid out like the bank's, with the two things only the user does.",
  draw: (variant) => sequence(spec, variant),
};

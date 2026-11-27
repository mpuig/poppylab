import {
  THREE_PARTIES,
  groundGuards,
  msg,
  pair,
  sequence,
} from "../../draw.mjs";

/**
 * Device Sign-In (the twelfth post, spec §4.3): an agent that can't catch a
 * redirect gets a code, Robin signs in on another device, and the tokens go
 * to whoever holds the device_code. That last fact is why Harborline offers
 * only Direct Sign-In.
 */
const spec = {
  parties: {
    user: { kind: "you", label: pair("Robin") },
    agent: { kind: "agent", label: pair("Agent") },
    company: { kind: "company", label: pair("Lantern") },
  },
  layout: THREE_PARTIES,
  items: [
    msg(
      "agent",
      "company",
      pair(["1 · Ask for a code, with the scopes"], ["1 · Ask for a code"]),
    ),
    msg(
      "company",
      "agent",
      pair(
        ["2 · device_code, user_code, verification_uri"],
        ["2 · device_code, user_code,", "verification_uri"],
      ),
      { reply: true },
    ),
    {
      kind: "guard",
      text: pair(
        "The agent checks the link's host is Lantern's, and keeps device_code",
        "Link host checked; device_code kept",
      ),
    },
    msg(
      "agent",
      "user",
      pair(
        ["3 · Lantern's name and domain, the link and the code"],
        ["3 · Lantern's name and", "domain, link and code"],
      ),
    ),
    {
      kind: "gate",
      text: pair("Waiting for Robin, on another device", "Waiting for Robin"),
    },
    msg(
      "user",
      "company",
      pair(
        ["4 · Robin signs in on Lantern's page and allows"],
        ["4 · Signs in at", "Lantern and allows"],
      ),
      { tag: true },
    ),
    msg(
      "agent",
      "company",
      pair(
        ["5 · Poll the token endpoint with device_code"],
        ["5 · Poll with device_code"],
      ),
    ),
    msg(
      "company",
      "agent",
      pair(
        ["6 · The tokens, to whoever holds device_code"],
        ["6 · The tokens, to whoever", "holds device_code"],
      ),
      { reply: true },
    ),
    { kind: "rule" },
    {
      kind: "guard",
      text: pair(
        "Nothing ties the person who allows to the agent that asked,",
        "Nothing ties who allows to who asked,",
      ),
    },
    {
      kind: "guard",
      text: pair(
        "so Harborline Bank turns Device Sign-In off and offers Direct Sign-In only",
        "so Harborline offers Direct Sign-In only",
      ),
    },
  ],
};

export default {
  name: "device-sign-in",
  alt: "Device Sign-In between Robin, an agent that can't receive a redirect, and Lantern Noodle Bar. The agent asks Lantern for a code, with the scopes it needs, and Lantern returns a device_code, a user_code and a verification_uri. The agent checks that the link's host is Lantern's and keeps the device_code to itself, then shows Robin Lantern's name and domain, the link and the code. Robin signs in on Lantern's own page on another device and allows. Meanwhile the agent polls Lantern's token endpoint with the device_code, and Lantern returns the tokens to whoever holds it. Nothing ties the person who allows to the agent that asked, so Harborline Bank turns Device Sign-In off and offers only Direct Sign-In.",
  caption:
    "The person signs in on another device and the tokens go to whoever holds the device code, which is why a bank can turn this off.",
  draw: (variant) => groundGuards(sequence(spec, variant)),
};

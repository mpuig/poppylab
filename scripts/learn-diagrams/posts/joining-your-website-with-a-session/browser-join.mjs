import {
  THREE_PARTIES,
  groundGuards,
  msg,
  pair,
  sequence,
} from "../../draw.mjs";

/**
 * Joining a browser to a Session (the thirteenth post, spec §6): the
 * agent's own browser loads a code, the agent authorizes it out of band, and
 * the browser hands it back. The access token never passes through the
 * browser, and neither half works alone.
 */
const spec = {
  parties: {
    browser: { kind: "agent", label: pair("Agent's browser", "Browser") },
    agent: { kind: "agent", label: pair("Personal Agent", "Agent") },
    company: { kind: "company", label: pair("Company") },
  },
  layout: {
    wide: {
      ...THREE_PARTIES.wide,
      x: { browser: 96, agent: 360, company: 624 },
    },
    narrow: {
      ...THREE_PARTIES.narrow,
      x: { browser: 56, agent: 180, company: 304 },
      // A row with the browser starts at the left; the agent's rows end at the right.
      anchor: (message) =>
        message.from === "browser" || message.to === "browser"
          ? "start"
          : "end",
    },
  },
  items: [
    msg("browser", "company", pair(["1 · Load the join page"])),
    msg(
      "company",
      "browser",
      pair(
        ["2 · A single-use code, and a __Host- cookie for this browser"],
        ["2 · A single-use code,", "and a __Host- cookie"],
      ),
      { reply: true },
    ),
    msg(
      "browser",
      "agent",
      pair(
        ["3 · The agent's code reads the code"],
        ["3 · Its code reads", "the code"],
      ),
      { reply: true },
    ),
    msg(
      "agent",
      "company",
      pair(
        [
          "4 · Authorize the code, with the Session header",
          "and, signed in, a token with poppy:browser-sign-in",
        ],
        [
          "4 · Authorize it, with the",
          "Session header and, signed",
          "in, the token",
        ],
      ),
    ),
    msg(
      "company",
      "agent",
      pair(["5 · 204: authorized for this Session"], ["5 · 204, authorized"]),
      { reply: true },
    ),
    msg("browser", "company", pair(["6 · Submit the code"])),
    {
      kind: "guard",
      text: pair(
        "The code matches this browser's cookie, is authorized, and was never used",
        "Matches the cookie, authorized, unused",
      ),
    },
    msg(
      "company",
      "browser",
      pair(
        ["7 · The company's Session cookie, with the same scopes"],
        ["7 · The Session cookie,", "with the same scopes"],
      ),
      { reply: true },
    ),
  ],
};

export default {
  name: "browser-join",
  alt: "How an agent's own browser joins its Session at a company. The browser loads the company's join page and gets a single-use code and a __Host- cookie for that browser. The agent's code, not its model, reads the code from the browser and authorizes it at the company, with its Session header and, when signed in, an access token holding poppy:browser-sign-in, and the company answers 204. The browser then submits the code. The company checks that the code matches that browser's cookie, has been authorized and was never used, and sets its own Session cookie, with the same scopes as the agent's token when it is signed in. The access token never passes through the browser.",
  caption:
    "The browser holds the cookie and the agent holds the Session key, so neither half of the join works alone, and the token never reaches the browser.",
  draw: (variant) => groundGuards(sequence(spec, variant)),
};

/**
 * Every line the agent's code writes, in every language it speaks, as a
 * table: the snapshot is the whole of what a User can read from the
 * agent's own code. Facts are the ones given, exactly, in each language.
 */
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./language";
import { LINES, say, type LineKey, type LineParams } from "./lines";

const lantern = { name: "Lantern Noodle Bar" };
const two = { names: ["Lantern Noodle Bar", "Harborline Bank"] };
const what = { what: "the $88.00 change at Lantern Noodle Bar" };

/** Each line with the facts it is said with, in one or more ways. */
const SAMPLES: { [K in LineKey]: Array<LineParams<K>> } = {
  approveButton: [{ what: "$88.00" }],
  declineButton: [{ what: "this change" }],
  thisChange: [{}],
  proposalAt: [lantern],
  signInButton: [lantern],
  writeButton: [lantern],
  signOutButton: [lantern],
  resumeButton: [{}],
  talkButton: [lantern],
  notNowButton: [{}],
  removeButton: [two],
  keepButton: [two],
  signInAsk: [lantern, { ...lantern, request: "my orders" }],
  signInAskSpoken: [
    { ...lantern, goOn: false },
    { ...lantern, goOn: true },
  ],
  writeAsk: [lantern, { ...lantern, request: "move it to Sunday" }],
  writeAskSpoken: [
    { ...lantern, goOn: false },
    { ...lantern, goOn: true },
  ],
  signInOpen: [
    { ...lantern, write: false },
    { ...lantern, write: true },
  ],
  signInTabOpen: [
    { ...lantern, write: false },
    { ...lantern, write: true },
  ],
  signInTabBlocked: [lantern],
  signInLink: [lantern],
  resumeAsk: [{ ...lantern, request: "my orders" }],
  resumeAskSpoken: [lantern],
  stayedSignedOut: [lantern, { ...lantern, waited: "my orders" }],
  accessUnchanged: [lantern, { ...lantern, waited: "my orders" }],
  didntResume: [lantern, { ...lantern, waited: "my orders" }],
  nothingToResume: [{}, lantern],
  notConnectedAnyMore: [lantern],
  noSignInOffered: [{ names: ["Lantern Noodle Bar"] }, two],
  alreadySignedIn: [lantern],
  whichSignIn: [two],
  nothingToSignIn: [{}],
  noCompanyYet: [{}],
  notSignedIn: [{ names: ["Lantern Noodle Bar"] }],
  notSignedInAnywhere: [{}],
  whichSignOut: [two],
  signOutAsk: [lantern],
  signOutAskSpoken: [lantern],
  signedOut: [lantern],
  signOutFailed: [lantern],
  stayedSignedIn: [two],
  invitationAsk: [lantern],
  invitationAskSpoken: [lantern],
  invitationGone: [lantern],
  directOpen: [lantern],
  directDeclined: [lantern],
  directClosed: [lantern],
  proposalGone: [
    { ...what, approve: true },
    { ...what, approve: false },
  ],
  termsChanged: [{ ...lantern, approve: true }],
  performed: [{ ...lantern, ...what }],
  approvalRefused: [lantern],
  declined: [lantern],
  notSent: [{ ...lantern, approve: true }],
  stillWaitsOne: [what],
  stillWaitMany: [
    {
      names: [
        "the $88.00 change at Lantern Noodle Bar",
        "the $500.00 transfer at Harborline Bank",
      ],
    },
  ],
  alreadyApproved: [
    { ...lantern, ...what, byAgent: false },
    { ...lantern, ...what, byAgent: true },
  ],
  alreadyDeclined: [{ ...lantern, ...what }],
  outcomeUnknown: [{ ...lantern, ...what }],
  expired: [{ ...what, approve: true }],
  noLongerWaits: [{ ...what, approve: false }],
  labCompanies: [two],
  whichOneMeant: [two],
  noSuchLabCompany: [{}, { named: "Acme Bakery" }],
  noSuchConnected: [
    { named: "Acme Bakery", names: [] },
    { named: "Acme Bakery", ...two },
  ],
  whichToRemove: [two],
  noneToRemove: [{}],
  removeAsk: [two],
  removeRevokes: [{}, { at: ["Harborline Bank"] }],
  removeDropsProposals: [
    { count: 1, many: false },
    { count: 2, many: true },
  ],
  connectAgainAnyTime: [{ many: false }, { many: true }],
  restAfter: [{}],
  restDropped: [{}],
  kept: [
    { names: ["Lantern Noodle Bar"], revoked: false },
    { ...two, revoked: true },
  ],
  nothingRemoved: [{}],
  connectedFor: [lantern],
  noRoomFor: [{ ...lantern, most: 3 }],
  alreadyConnected: [lantern],
  couldntConnect: [lantern],
  connected: [two],
  describesOffer: [
    { words: "Noodles, delivered." },
    { ...lantern, words: "Noodles, delivered." },
  ],
  signInOffered: [{ many: false }, { many: true }],
  askNow: [{ many: false }, { many: true }],
  notConnectedTo: [lantern],
  removedRevoked: [lantern],
  removed: [lantern],
  readGone: [{}],
  noCompanyNow: [{}],
  noRequestWaiting: [{}],
  whichIsItFor: [two],
  isItFor: [
    { ...two, why: "none" },
    { ...two, why: "both" },
  ],
  noCompanyToAsk: [two],
  needsTwo: [
    {
      reads: "Fernwick Power & Light",
      pays: "Harborline Bank",
      absent: ["Fernwick Power & Light"],
      have: 1,
      remove: 0,
    },
    {
      reads: "Fernwick Power & Light",
      pays: "Harborline Bank",
      absent: ["Fernwick Power & Light", "Harborline Bank"],
      have: 3,
      remove: 2,
    },
  ],
  sessionRefused: [{}],
  signInRequired: [{}],
  companyError: [
    {
      ...lantern,
      status: 409,
      facts: " insufficient_funds (available balance: 3,210.55)",
    },
  ],
  chatFailed: [{}],
  freeModel: [
    { why: "notDeployed" },
    { why: "allowance" },
    { why: "hour", count: 20 },
  ],
};

const render = (key: LineKey) =>
  LINES[key] as Record<string, (p: unknown) => string>;

describe("the agent's own lines", () => {
  it("are all in every language, as the table shows them", () => {
    const table = Object.fromEntries(
      (Object.keys(LINES) as LineKey[]).map((key) => [
        key,
        SAMPLES[key].map((params) =>
          Object.fromEntries(
            LANGUAGES.map((language) => [
              language,
              render(key)[language]!(params),
            ]),
          ),
        ),
      ]),
    );
    expect(table).toMatchSnapshot();
  });

  it("never name the agent: it speaks for itself, and its name is configuration", () => {
    for (const key of Object.keys(LINES) as LineKey[])
      for (const params of SAMPLES[key])
        for (const language of LANGUAGES) {
          const line = render(key)[language]!(params);
          expect(line).not.toMatch(/\bIris\b|\bAgent\b/);
          expect(line.trim()).toBe(line);
          expect(line).not.toMatch(/\s{2}|undefined|\[object/);
        }
  });

  it("keep the facts they are given, exactly, in every language", () => {
    for (const language of LANGUAGES) {
      expect(
        say(language, "signInAsk", { ...lantern, request: "x y" }),
      ).toMatch(/Lantern Noodle Bar[\s\S]*x y/);
      expect(say(language, "performed", { ...lantern, ...what })).toContain(
        what.what,
      );
      expect(say(language, "noRoomFor", { ...lantern, most: 3 })).toContain(
        "3",
      );
      expect(
        say(language, "describesOffer", { words: "Noodles, delivered." }),
      ).toContain("Noodles, delivered.");
    }
  });
});

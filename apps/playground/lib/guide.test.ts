import { expect, it } from "vitest";
import {
  guideHint,
  guideProposals,
  guideStep,
  type GuideContext,
  type GuideOperation,
  type GuideState,
} from "./guide";

const start: GuideState = {
  connected: false,
  signedIn: false,
  canWrite: false,
  waiting: 0,
  proposals: 0,
  completed: 0,
};
const juniper: GuideContext = {
  company: "Juniper Market",
  people: "Elena or Robin",
  ask: "Move my recurring delivery to Saturday.",
  demo: true,
  demoCanChange: true,
  signInOffered: true,
};

it("walks connect, sign in, ask and approve in order", () => {
  expect(guideStep(start)).toBe(0);
  const connected = { ...start, connected: true };
  expect(guideStep(connected)).toBe(1);
  const signedIn = { ...connected, signedIn: true };
  expect(guideStep(signedIn)).toBe(2);
  const asked = { ...signedIn, canWrite: true, proposals: 1, waiting: 1 };
  expect(guideStep(asked)).toBe(3);
  expect(guideStep({ ...asked, waiting: 0, completed: 1 })).toBe(4);
});

it("names the hidden step: reading isn't permission to propose changes", () => {
  const readOnly = { ...start, connected: true, signedIn: true };
  expect(guideHint(readOnly, juniper)).toContain("Request change permission");
  expect(guideHint({ ...readOnly, canWrite: true }, juniper)).toContain(
    "Move my recurring delivery to Saturday.",
  );
});

it("says when demo mode can only read at a Company", () => {
  const ready = { ...start, connected: true, signedIn: true, canWrite: true };
  const hint = guideHint(ready, {
    ...juniper,
    company: "Harborline Bank",
    ask: "Transfer $500 from checking to savings.",
    demoCanChange: false,
  });
  expect(hint).toContain("Demo mode only reads at Harborline Bank");
  expect(hint).toContain("Model settings");
  // With a model the same Company gets the request to try.
  expect(
    guideHint(ready, {
      ...juniper,
      company: "Harborline Bank",
      ask: "Transfer $500 from checking to savings.",
      demo: false,
      demoCanChange: false,
    }),
  ).toContain("Try: “Transfer $500");
});

it("keeps the visitor on approve until a change goes through", () => {
  const held = {
    ...start,
    connected: true,
    signedIn: true,
    canWrite: true,
    proposals: 1,
    waiting: 1,
  };
  expect(guideHint(held, juniper)).toContain("approve it yourself");
  expect(guideHint({ ...held, waiting: 0 }, juniper)).toContain(
    "Ask for the change again",
  );
  expect(guideHint({ ...held, waiting: 0, completed: 1 }, juniper)).toContain(
    "performed the change once",
  );
});

const asked = {
  ...start,
  connected: true,
  signedIn: true,
  canWrite: true,
};
const later = new Date(Date.now() + 60000).toISOString();
const proposal = (
  state: string,
  more: Partial<GuideOperation> = {},
): GuideOperation => ({
  operation_id: `op_${state}`,
  revision: "r1",
  state,
  expires_at: later,
  ...more,
});
const hintFor = (...operations: GuideOperation[]) =>
  guideHint({ ...asked, ...guideProposals(operations) }, juniper);

it("tells apart how the last proposal ended, and says what to do", () => {
  // The visitor's own choice isn't a failure.
  expect(hintFor(proposal("declined"))).toBe(
    "You declined the last proposal, so nothing was sent to Juniper Market. Ask for the change again if you still want it.",
  );
  expect(hintFor(proposal("expired"))).toBe(
    "The last proposal expired before it was approved, so nothing was performed. Ask for the change again to get fresh terms.",
  );
  // Still `proposed` for the server, but past its time.
  expect(
    hintFor(
      proposal("proposed", {
        expires_at: new Date(Date.now() - 1).toISOString(),
      }),
    ),
  ).toContain("expired before it was approved");
  expect(hintFor(proposal("refused"))).toBe(
    "Juniper Market declined the approval and performed nothing; the proposal shows its reason, if it gave one. You can ask for a different change.",
  );
  expect(hintFor(proposal("superseded"))).toBe(
    "Juniper Market offered new terms instead of performing the last proposal. Ask for the change again to see the terms it offers now.",
  );
  // It is the newest proposal that counts.
  expect(hintFor(proposal("expired"), proposal("declined"))).toContain(
    "You declined the last proposal",
  );
});

it("agrees with the card of a proposal whose approval wasn't performed", () => {
  const done = proposal("succeeded");
  const refused = proposal("proposed", { notPerformed: "refused" });
  const hint = hintFor(done, refused);
  // An earlier change that went through doesn't make this one done.
  expect(hint).not.toContain("Done");
  expect(hint).toBe(
    "Juniper Market refused the approval and performed nothing; the proposal says why. Approve it again once that is sorted out, or ask for the change again.",
  );
  expect(guideStep({ ...asked, ...guideProposals([done, refused]) })).toBe(3);
  expect(
    hintFor(done, proposal("proposed", { notPerformed: "new_terms" })),
  ).toBe(
    "Juniper Market answered the approval with new terms and performed nothing. Check the new terms, then approve them yourself or decline.",
  );
  // New terms under another ID: the retired proposal is not the news.
  expect(
    hintFor(
      proposal("superseded"),
      proposal("proposed", { notPerformed: "new_terms" }),
    ),
  ).toContain("answered the approval with new terms");
  // A proposal that simply waits, and one that went through since.
  expect(hintFor(done, proposal("proposed"))).toContain("approve it yourself");
  expect(hintFor(proposal("declined"), done)).toContain(
    "performed the change once",
  );
});

it("doesn't promise sign-in where the Company offers none", () => {
  expect(
    guideHint(
      { ...start, connected: true },
      {
        demo: true,
        demoCanChange: false,
        signInOffered: false,
        company: "Acme",
      },
    ),
  ).toContain("doesn’t offer sign-in");
});

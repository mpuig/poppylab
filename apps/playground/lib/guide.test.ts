import { expect, it } from "vitest";
import {
  guideHint,
  guideStep,
  type GuideContext,
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

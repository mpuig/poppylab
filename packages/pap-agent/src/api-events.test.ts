import { describe, expect, it } from "vitest";
import type { ConversationState, Proposal } from "./api";
import { eventsBetween } from "./api-events";
import { match, ROUTES } from "./api-http";

const bank = { origin: "https://bank.example", name: "Harborline Bank" };
const company = (signedIn = false, consentVersion = 0) => ({
  ...bank,
  url: `${bank.origin}/`,
  signedIn,
  signingIn: false,
  consentVersion,
  accessLost: false,
  direct: { open: false, invitation: null },
});
const proposal = (change: Partial<Proposal> = {}): Proposal => ({
  id: "op_1",
  company: bank,
  revision: "r1",
  terms: { amount_cents: 2500 },
  state: "proposed",
  expiresAt: new Date(10_000).toISOString(),
  ...change,
});
const state = (change: Partial<ConversationState> = {}): ConversationState => ({
  id: "run_events_000001",
  active: true,
  companies: [company()],
  removed: [],
  messages: [{ from: "user", text: "my account balances" }],
  proposals: [],
  ...change,
});

describe("what changed between two readings of a conversation", () => {
  it("says a sign-in finished, once, and a sign-in again after it", () => {
    expect(
      eventsBetween(state(), state({ companies: [company(true, 1)] })),
    ).toEqual([{ type: "signin.completed", company: bank }]);
    expect(
      eventsBetween(
        state({ companies: [company(true, 1)] }),
        state({ companies: [company(true, 2)] }),
      ),
    ).toEqual([{ type: "signin.completed", company: bank }]);
    expect(
      eventsBetween(
        state({ companies: [company(true, 1)] }),
        state({ companies: [company(true, 1)] }),
      ),
    ).toEqual([]);
  });

  it("gives what was said since, and the whole state when it was taken back", () => {
    const said = {
      from: "company" as const,
      text: "Yes, I can.",
      company: bank,
      direct: true,
    };
    expect(
      eventsBetween(state(), state({ messages: [...state().messages, said] })),
    ).toEqual([{ type: "message", message: said }]);
    const after = state({ messages: [said] });
    expect(eventsBetween(state(), after)).toEqual([
      { type: "messages.replaced", state: after },
    ]);
  });

  it("says a proposal came, ran out on its time, or came back with new terms", () => {
    const waiting = state({ proposals: [proposal()] });
    expect(eventsBetween(state(), waiting)).toEqual([
      { type: "proposal.created", proposal: proposal() },
    ]);
    // Nothing is written when its time passes: the readings' times tell.
    expect(
      eventsBetween(waiting, waiting, { since: 9_000, now: 11_000 }),
    ).toEqual([{ type: "proposal.expired", proposal: proposal() }]);
    expect(
      eventsBetween(waiting, waiting, { since: 11_000, now: 12_000 }),
    ).toEqual([]);
    const renewed = state({ proposals: [proposal({ revision: "r2" })] });
    expect(eventsBetween(waiting, renewed, { since: 0, now: 1 })).toEqual([
      { type: "proposal.replaced", proposal: proposal({ revision: "r2" }) },
    ]);
    const done = state({ proposals: [proposal({ state: "succeeded" })] });
    expect(eventsBetween(waiting, done, { since: 0, now: 1 })).toEqual([
      { type: "proposal.updated", proposal: proposal({ state: "succeeded" }) },
    ]);
  });

  it("says a Company came or went, and that the conversation ended", () => {
    expect(eventsBetween(state({ companies: [] }), state())).toEqual([
      { type: "company.added", company: bank },
    ]);
    expect(
      eventsBetween(state(), state({ active: false, keptUntil: 5 })),
    ).toEqual([{ type: "conversation.ended", keptUntil: 5 }]);
  });
});

it("routes each path of /api/v1 to one operation, with its names", () => {
  expect(match("POST", "/api/v1/conversations")).toEqual({
    operation: "startConversation",
    names: {},
  });
  expect(
    match("POST", "/api/v1/conversations/run_1/proposals/op_9/decision"),
  ).toEqual({
    operation: "decideProposal",
    names: { id: "run_1", proposal: "op_9" },
  });
  expect(match("GET", "/api/v1/conversations/run_1/messages")).toBeUndefined();
  expect(match("GET", "/api/v1/conversations/a%2Fb")).toBeUndefined();
  expect(new Set(ROUTES.map((r) => r.operation)).size).toBe(ROUTES.length);
});

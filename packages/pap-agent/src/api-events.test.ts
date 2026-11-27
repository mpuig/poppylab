import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationState, Proposal } from "./api";
import {
  eventsBetween,
  holdStream,
  MAX_STREAMS,
  MAX_VISITOR_STREAMS,
  STREAM_MS,
} from "./api-events";
import { match, ROUTES } from "./api-http";
import { configureBackend, memoryBackend, type Backend } from "./runs";

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

  it("says a sign-in under way ended without signing in, and nothing while it waits", () => {
    const waiting = { ...company(), signingIn: true };
    expect(eventsBetween(state(), state({ companies: [waiting] }))).toEqual([]);
    expect(eventsBetween(state({ companies: [waiting] }), state())).toEqual([
      { type: "signin.failed", company: bank },
    ]);
    // Asking for more access, signed in: the sign-in that had been there stays.
    const more = { ...company(true, 1), signingIn: true };
    expect(
      eventsBetween(
        state({ companies: [more] }),
        state({ companies: [company(true, 1)] }),
      ),
    ).toEqual([{ type: "signin.failed", company: bank }]);
    expect(
      eventsBetween(
        state({ companies: [more] }),
        state({ companies: [company(true, 2)] }),
      ),
    ).toEqual([{ type: "signin.completed", company: bank }]);
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

describe("holdStream concurrency cap", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps a custom bucket to its limit, releases on close, and writes a short expires", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    const base = memoryBackend();
    const expiries: Array<number | undefined> = [];
    const backend: Backend = {
      ...base,
      put(bucket, key, value, expected, expires) {
        expiries.push(expires);
        return base.put(bucket, key, value, expected, expires);
      },
    };
    const held: Array<NonNullable<Awaited<ReturnType<typeof holdStream>>>> = [];
    for (let i = 0; i < MAX_VISITOR_STREAMS; i++) {
      const slot = await holdStream({
        bucket: "visitor_hash_1",
        backend,
        limit: MAX_VISITOR_STREAMS,
      });
      expect(slot).toBeDefined();
      held.push(slot!);
    }
    expect(
      await holdStream({
        bucket: "visitor_hash_1",
        backend,
        limit: MAX_VISITOR_STREAMS,
      }),
    ).toBeUndefined();
    // Every write sets a short expires (at most STREAM_MS + 60s) so DO alarms stay bounded.
    expect(expiries).toHaveLength(MAX_VISITOR_STREAMS);
    for (const exp of expiries) {
      expect(exp).toBeDefined();
      expect(exp!).toBeLessThanOrEqual(1_000_000 + STREAM_MS + 60_000);
    }
    // Releasing one slot allows a new stream to be held.
    await held[0]!.release();
    const replacement = await holdStream({
      bucket: "visitor_hash_1",
      backend,
      limit: MAX_VISITOR_STREAMS,
    });
    expect(replacement).toBeDefined();
    // Abandoned slots expire after STREAM_MS + 60s even without release().
    vi.setSystemTime(1_000_000 + STREAM_MS + 60_001);
    const afterExpiry = await holdStream({
      bucket: "visitor_hash_1",
      backend,
      limit: MAX_VISITOR_STREAMS,
    });
    expect(afterExpiry).toBeDefined();
  });

  it("keeps signed-in accounts capped at MAX_STREAMS (10)", async () => {
    configureBackend(memoryBackend());
    const held: Array<NonNullable<Awaited<ReturnType<typeof holdStream>>>> = [];
    for (let i = 0; i < MAX_STREAMS; i++) {
      const slot = await holdStream("acct_test_1");
      expect(slot).toBeDefined();
      held.push(slot!);
    }
    expect(await holdStream("acct_test_1")).toBeUndefined();
    await held[0]!.release();
    expect(await holdStream("acct_test_1")).toBeDefined();
  });
});

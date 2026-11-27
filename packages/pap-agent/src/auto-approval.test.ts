import { expect, it } from "vitest";
import {
  leftToUser,
  MAX_PER_HOUR,
  nextAutoApproval,
  usesAllowance,
} from "./auto-approval";

const op = (id: string, cents: number, revision = "1") => ({
  operation_id: id,
  revision,
  state: "proposed",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  terms: { total_cents: cents, currency: "USD" },
});
const base = {
  instruction: { maxCents: 3000, currency: "USD" },
  signedIn: true,
  busy: false,
};

it("offers the first covered operation and only once per revision", () => {
  const decided = new Set<string>();
  const operations = [op("a", 5000), op("b", 2800)];
  const first = nextAutoApproval({ ...base, operations, decided });
  expect(first).toMatchObject({
    kind: "approve",
    covered: "$28.00 within your limit of $30.00",
    cents: 2800,
  });
  expect(first?.op.operation_id).toBe("b");
  // Then the one it leaves to the User, with the reason, and nothing more.
  expect(nextAutoApproval({ ...base, operations, decided })).toMatchObject({
    kind: "left",
    op: { operation_id: "a" },
    reason: "the total, $50.00, is over your limit of $30.00",
  });
  expect(nextAutoApproval({ ...base, operations, decided })).toBeNull();
  // New terms under a new revision are a new decision.
  const again = [op("b", 2800, "2")];
  expect(
    nextAutoApproval({ ...base, operations: again, decided })?.op.revision,
  ).toBe("2");
});

it("does nothing while busy, signed out or without an instruction", () => {
  const operations = [op("a", 100)];
  for (const change of [
    { busy: true },
    { signedIn: false },
    { instruction: undefined },
  ]) {
    const decided = new Set<string>();
    expect(
      nextAutoApproval({ ...base, ...change, operations, decided }),
    ).toBeNull();
    // Not marked as decided, so it can still be offered once the block lifts.
    expect(decided.size).toBe(0);
  }
});

it("leaves an over-limit operation for the User, and says why once", () => {
  const decided = new Set<string>();
  const operations = [op("a", 3001)];
  const reason = "the total, $30.01, is over your limit of $30.00";
  const left = nextAutoApproval({ ...base, operations, decided });
  expect(left).toEqual({ kind: "left", op: operations[0], reason });
  expect(nextAutoApproval({ ...base, operations, decided })).toBeNull();
  // A lower limit is another reason, and a limit it is within approves it.
  expect(
    nextAutoApproval({
      ...base,
      instruction: { maxCents: 2000, currency: "USD" },
      operations,
      decided,
    }),
  ).toMatchObject({
    kind: "left",
    reason: "the total, $30.01, is over your limit of $20.00",
  });
  expect(
    nextAutoApproval({
      ...base,
      instruction: { maxCents: 4000, currency: "USD" },
      operations,
      decided,
    }),
  ).toMatchObject({ kind: "approve" });
});

it("doesn't say again what the conversation already keeps, as after a reload", () => {
  // Nothing remembered: the operation carries the reason the server kept.
  const noted = {
    ...op("a", 3001),
    notApplied: "the total, $30.01, is over your limit of $30.00",
  };
  expect(
    nextAutoApproval({ ...base, operations: [noted], decided: new Set() }),
  ).toBeNull();
  // It doesn't stand in the way of one the rule covers.
  expect(
    nextAutoApproval({
      ...base,
      operations: [noted, op("b", 200)],
      decided: new Set(),
    }),
  ).toMatchObject({ kind: "approve", cents: 200 });
});

it("leaves an operation the Company declined from the agent for the User", () => {
  const declined = {
    ...op("a", 100),
    agentDeclined: { reason: "Approve money moves yourself." },
  };
  // Nothing remembered, as after a reload: the decline alone stops it.
  const decided = new Set<string>();
  expect(
    nextAutoApproval({ ...base, operations: [declined], decided }),
  ).toBeNull();
  expect(
    nextAutoApproval({ ...base, operations: [declined, op("b", 200)], decided })
      ?.op.operation_id,
  ).toBe("b");
});

it("leaves new terms the Company returned for the agent's approval for the User", () => {
  // Covered by the rule, and never looked at before, as after a reload.
  const superseded = { ...op("a", 100, "2"), agentSuperseded: true as const };
  const decided = new Set<string>();
  expect(
    nextAutoApproval({ ...base, operations: [superseded], decided }),
  ).toBeNull();
  expect(
    nextAutoApproval({
      ...base,
      operations: [superseded, op("b", 200)],
      decided,
    })?.op.operation_id,
  ).toBe("b");
});

it("stops after the hour's count and leaves the operation for the User", () => {
  const now = 1_000_000_000;
  const recent = Array.from({ length: MAX_PER_HOUR }, (_, i) => ({
    at: now - 1000 * (i + 1),
    cents: 100,
  }));
  const decided = new Set<string>();
  const out = nextAutoApproval({
    ...base,
    operations: [op("a", 100)],
    decided,
    recent,
    now: now,
  });
  expect(out).toMatchObject({
    kind: "left",
    allowance: "count",
    reason: "it already approved 5 changes in the last hour",
  });
  // Said once, not retried on every render.
  expect(
    nextAutoApproval({
      ...base,
      operations: [op("a", 100)],
      decided,
      recent,
      now,
    }),
  ).toBeNull();
});

it("stops once the hour's total passes three times the limit", () => {
  const now = 1_000_000_000;
  const recent = [
    { at: now - 1000, cents: 3000 },
    { at: now - 2000, cents: 3000 },
    { at: now - 3000, cents: 2900 },
  ];
  expect(
    nextAutoApproval({
      ...base,
      operations: [op("a", 200)],
      decided: new Set(),
      recent,
      now,
    }),
  ).toMatchObject({
    kind: "left",
    allowance: "total",
    reason:
      "with this change it would approve more than 3 times your limit ($90.00) within an hour",
  });
  expect(
    nextAutoApproval({
      ...base,
      operations: [op("a", 100)],
      decided: new Set(),
      recent,
      now,
    }),
  ).toMatchObject({ kind: "approve" });
});

it("forgets approvals older than an hour", () => {
  const now = 1_000_000_000;
  const old = Array.from({ length: 9 }, () => ({
    at: now - 4_000_000,
    cents: 3000,
  }));
  expect(
    nextAutoApproval({
      ...base,
      operations: [op("a", 100)],
      decided: new Set(),
      recent: old,
      now,
    }),
  ).toMatchObject({ kind: "approve" });
});

it("says in one clause why a waiting operation was left to the User", () => {
  const { instruction } = base;
  const why = (operation: object, held?: string) =>
    leftToUser(
      operation as ReturnType<typeof op>,
      instruction,
      "Harborline Bank",
      held,
    );
  // The Company's own answer comes first, whatever the terms.
  expect(why({ ...op("a", 100), agentDeclined: { reason: "Not here." } })).toBe(
    "Harborline Bank declined the approval Iris sent on it",
  );
  expect(why({ ...op("a", 100), agentSuperseded: true })).toBe(
    "Harborline Bank answered the approval Iris sent on it with new terms",
  );
  // Then the terms, then the hour's allowance.
  expect(
    why(op("a", 3001), "it already approved 5 changes in the last hour"),
  ).toBe("the total, $30.01, is over your limit of $30.00");
  expect(
    why(op("a", 100), "it already approved 5 changes in the last hour"),
  ).toBe("it already approved 5 changes in the last hour");
  // Covered and about to be approved, settled, or no instruction at all.
  expect(why(op("a", 100))).toBeNull();
  expect(why({ ...op("a", 3001), state: "succeeded" })).toBeNull();
  expect(leftToUser(op("a", 3001), undefined, "Harborline Bank")).toBeNull();
});

it("spends the allowance on what the Company performed on Iris's approval", () => {
  const done = { ...op("a", 100), state: "succeeded" };
  expect(
    usesAllowance({
      status: 200,
      operation: { ...done, approvedBy: { approver: "agent" } },
    }),
  ).toBe(true);
  // Performed on the User's own tap: not the rule's doing.
  expect(
    usesAllowance({
      status: 200,
      operation: { ...done, approvedBy: { approver: "user" } },
    }),
  ).toBe(false);
});

it("spends nothing when the answer says nothing was performed", () => {
  const waiting = op("a", 100);
  for (const answer of [
    // Not covered by the server's own check, new terms, a busy conversation,
    // a request the Company refused (such as Harborline's insufficient_funds).
    { status: 409, operation: waiting },
    { status: 409 },
    // The Company declined Iris's approval (Harborline always does).
    { status: 200, operation: { ...waiting, agentDeclined: {} } },
    { status: 409, operation: { ...waiting, state: "expired" } },
    // Expired, access lost, a missing permission, a request Poppy refused.
    { status: 410 },
    { status: 401 },
    { status: 403 },
    { status: 400 },
  ])
    expect(usesAllowance(answer)).toBe(false);
});

it("spends the allowance when the outcome is unknown: it may have been performed", () => {
  // No answer from Poppy, a lost Company response, the Company still at it.
  for (const answer of ["lost", { status: 502 }, { status: 429 }] as const)
    expect(usesAllowance(answer)).toBe(true);
});

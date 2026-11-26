import { expect, it, vi } from "vitest";
import { nextAutoApproval } from "./auto-approval";
import { outcomeUnknown, recordOperation } from "./operation-store";
import type { Operation } from "./runtime";

const remote = {
  operation_id: "op_1",
  revision: "r1",
  terms: { total_cents: 1450, currency: "USD" },
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};
const request = { url: "https://x.example/orders", body: {} };
const approval = {
  approver: "agent" as const,
  approved_at: 1791487260,
  reference: "apr_1",
};
const proposed = () => {
  const run: { operations?: Record<string, Operation> } = {};
  return { run, op: recordOperation(run, remote, request) };
};

it("notes when the proposal came, and again when its terms change", () => {
  const clock = vi.spyOn(Date, "now");
  try {
    const start = Date.parse(remote.expires_at) - 60_000;
    clock.mockReturnValue(start + 1000);
    const { run, op } = proposed();
    expect(op.changed).toBe(start + 1000);
    clock.mockReturnValue(start + 2000);
    expect(
      recordOperation(run, { ...remote, revision: "r2" }, request).changed,
    ).toBe(start + 2000);
  } finally {
    clock.mockRestore();
  }
});

it("keeps a declined agent approval when the same revision is proposed again", () => {
  const { run, op } = proposed();
  op.agentDeclined = { reason: "Approve money moves yourself." };
  const again = recordOperation(run, remote, request);
  expect(again).toMatchObject({
    state: "proposed",
    agentDeclined: { reason: "Approve money moves yourself." },
  });
  expect(run.operations!.op_1).toBe(again);
});

it("keeps the approval as first sent when the same revision is proposed again", () => {
  const { run, op } = proposed();
  // As after a request the Company refused: nothing performed, terms wait.
  op.approval = approval;
  expect(recordOperation(run, remote, request)).toMatchObject({
    state: "proposed",
    approval,
  });
});

it("keeps why the standing instruction left the terms to the User for the same revision only", () => {
  const { run, op } = proposed();
  op.notApplied = "the total, $14.50, is over your limit of $10.00";
  // The same terms again: the Inspector's line was written, and isn't again.
  expect(recordOperation(run, remote, request).notApplied).toBe(op.notApplied);
  // New terms are checked anew.
  expect(
    recordOperation(run, { ...remote, revision: "r2" }, request),
  ).not.toHaveProperty("notApplied");
});

const dearer = {
  ...remote,
  revision: "r2",
  terms: { total_cents: 1600, currency: "USD" },
};
const uncertain = () => {
  const { run, op } = proposed();
  op.approval = approval;
  op.state = "uncertain";
  return { run, op };
};

it.each([
  ["the same revision", remote],
  ["a new revision", dearer],
])(
  "leaves an approval with an unknown outcome as it is when %s is proposed again (Operations v3 §7)",
  (_name, again) => {
    const { run, op } = uncertain();
    const { changed } = op;
    const kept = recordOperation(run, again, {
      url: "https://x.example/orders",
      body: { asked: "again" },
    });
    // Still the approved revision, with the approval and request Retry sends.
    expect(kept).toBe(op);
    expect(run.operations!.op_1).toBe(op);
    expect(kept).toEqual({
      ...remote,
      state: "uncertain",
      request,
      approval,
      changed,
    });
    // Nothing asks for an approval: not the card, not the User's rule.
    expect(
      nextAutoApproval({
        operations: Object.values(run.operations!),
        instruction: { maxCents: 3000, currency: "USD" },
        signedIn: true,
        busy: false,
        decided: new Set(),
      }),
    ).toBeNull();
  },
);

it("says so, not that a proposal waits, when the outcome is unknown", () => {
  const { run } = uncertain();
  const told = outcomeUnknown(recordOperation(run, dearer, request));
  expect(told).toEqual({
    status: "outcome_unknown",
    operation_id: "op_1",
    // The terms the approval was for, never the ones offered since.
    terms: remote.terms,
    note: expect.stringContaining("outcome is unknown"),
  });
  expect(told.note).toContain("Nothing new was proposed");
  expect(told.note).toContain("Retry");
  expect(told.note).toContain("Company's own records");
});

it("takes the operation as proposed when it answers the approval itself: that outcome is known", () => {
  const { run } = uncertain();
  expect(recordOperation(run, remote, request, true)).toMatchObject({
    state: "proposed",
    approval,
  });
});

it.each(["proposed", "declined", "refused", "expired"] as const)(
  "offers a %s operation again when the Company proposes it again",
  (state) => {
    for (const again of [remote, dearer]) {
      const { run, op } = proposed();
      op.state = state;
      expect(recordOperation(run, again, request)).toMatchObject({
        state: "proposed",
        revision: again.revision,
        terms: again.terms,
      });
    }
  },
);

it("starts a new revision without the approval but keeps the decline", () => {
  const { run, op } = proposed();
  op.approval = approval;
  op.agentDeclined = { reason: "Approve money moves yourself." };
  const next = recordOperation(run, { ...remote, revision: "r2" }, request);
  expect(next.revision).toBe("r2");
  expect(next).not.toHaveProperty("approval");
  // §6: no agent approval of a new revision without asking the User.
  expect(next.agentDeclined).toEqual({
    reason: "Approve money moves yourself.",
  });
  expect(
    nextAutoApproval({
      operations: [next],
      instruction: { maxCents: 3000, currency: "USD" },
      signedIn: true,
      busy: false,
      decided: new Set(),
    }),
  ).toBeNull();
  // The same new revision without the decline is one the rule would take.
  expect(
    nextAutoApproval({
      operations: [recordOperation({}, { ...remote, revision: "r2" }, request)],
      instruction: { maxCents: 3000, currency: "USD" },
      signedIn: true,
      busy: false,
      decided: new Set(),
    }),
  ).toMatchObject({ kind: "approve" });
});

it("keeps new terms that answered an agent approval with the User when they are proposed again", () => {
  const { run, op } = proposed();
  op.agentSuperseded = true;
  // The model asks again and gets the same revision, or a later one.
  for (const revision of ["r1", "r3"]) {
    const again = recordOperation(run, { ...remote, revision }, request);
    expect(again).toMatchObject({ revision, agentSuperseded: true });
    expect(
      nextAutoApproval({
        operations: [again],
        instruction: { maxCents: 3000, currency: "USD" },
        signedIn: true,
        busy: false,
        decided: new Set(),
      }),
    ).toBeNull();
  }
});

it("drops an approval the Company declined, so it is never sent again", () => {
  const { run, op } = proposed();
  op.approval = { ...approval, approver: "user" };
  op.state = "refused";
  expect(recordOperation(run, remote, request)).not.toHaveProperty("approval");
});

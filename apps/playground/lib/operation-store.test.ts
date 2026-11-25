import { expect, it } from "vitest";
import { nextAutoApproval } from "./auto-approval";
import { recordOperation } from "./operation-store";
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
  op.approval = approval;
  op.state = "uncertain";
  expect(recordOperation(run, remote, request).approval).toEqual(approval);
});

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

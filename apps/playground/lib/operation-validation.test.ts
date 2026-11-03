import { it, expect } from "vitest";
import { validateOperation } from "./operation-validation";
import { recordOperation } from "./operation-store";
import type { Operation } from "./runtime";
const remote = {
  operation_id: "op_1",
  revision: "1791487200-k3Jd9Qx2mW8v",
  summary: "Move the fictional delivery to Saturday.",
  terms: { to: "Saturday" },
  expires_at: new Date(Date.now() + 60000).toISOString(),
};
it("keeps only the fields Operations v2 defines", () => {
  const op = validateOperation({
    ...remote,
    state: "succeeded",
    user_approval_required: false,
    url: "https://evil",
  });
  expect(op).toEqual(remote);
});
it("accepts omitted terms without inventing structured facts", () => {
  const summaryOnly: Partial<typeof remote> = { ...remote };
  delete summaryOnly.terms;
  expect(validateOperation(summaryOnly)).not.toHaveProperty("terms");
});
it.each([
  ["numeric revision", { revision: 2 }],
  ["missing expiry", { expires_at: undefined }],
  ["blank summary", { summary: " " }],
  ["array terms", { terms: [] }],
  ["bad id", { operation_id: "op 1" }],
])("rejects %s", (_name, change) => {
  expect(() => validateOperation({ ...remote, ...change })).toThrow();
});
it("allows a new revision but never different content under the same revision", () => {
  const previous = { ...remote, state: "proposed" } as Operation;
  expect(
    validateOperation({ ...remote, revision: "r2", summary: "Other" }, previous)
      .revision,
  ).toBe("r2");
  expect(() =>
    validateOperation({ ...remote, summary: "Changed silently" }, previous),
  ).toThrow("immutable");
  expect(() =>
    validateOperation({ ...remote, operation_id: "op_2" }, previous),
  ).toThrow("identity");
  expect(() =>
    validateOperation(
      { ...remote, revision: "r3" },
      { ...previous, state: "succeeded" },
    ),
  ).toThrow("Performed");
});
it("records an operation as proposed with its replayable request, bounded per run", () => {
  const run: { operations?: Record<string, Operation> } = {};
  for (let i = 0; i < 25; i++)
    recordOperation(
      run,
      { ...remote, operation_id: `op_${i}` },
      { url: "https://x.example/a", body: {} },
    );
  expect(Object.keys(run.operations!)).toHaveLength(20);
  expect(run.operations!.op_24).toMatchObject({
    state: "proposed",
    request: { url: "https://x.example/a" },
  });
  expect(() =>
    recordOperation(
      run,
      {
        ...remote,
        operation_id: "op_x",
        expires_at: new Date(Date.now() - 1).toISOString(),
      },
      { url: "u", body: {} },
    ),
  ).toThrow();
});

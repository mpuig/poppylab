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
it("keeps only the fields Operations v3 defines", () => {
  const op = validateOperation({
    ...remote,
    state: "succeeded",
    user_approval_required: false,
    url: "https://evil",
  });
  expect(op).toEqual(remote);
});
it("accepts an operation without a summary: the terms say it all (§3)", () => {
  const termsOnly: Partial<typeof remote> = { ...remote };
  delete termsOnly.summary;
  expect(validateOperation(termsOnly)).toEqual(termsOnly);
  // A blank summary is no summary.
  expect(validateOperation({ ...remote, summary: " " })).not.toHaveProperty(
    "summary",
  );
});
it.each([
  ["numeric revision", { revision: 2 }],
  ["missing expiry", { expires_at: undefined }],
  ["missing terms", { terms: undefined }],
  ["array terms", { terms: [] }],
  ["numeric summary", { summary: 7 }],
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
    validateOperation({ ...remote, terms: { to: "Sunday" } }, previous),
  ).toThrow("immutable");
  // A summary reworded without changing the terms may keep the revision.
  expect(
    validateOperation({ ...remote, summary: "Reworded." }, previous).summary,
  ).toBe("Reworded.");
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

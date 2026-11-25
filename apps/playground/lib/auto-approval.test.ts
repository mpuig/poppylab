import { expect, it } from "vitest";
import { nextAutoApproval } from "./auto-approval";

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
  expect(first?.op.operation_id).toBe("b");
  expect(first?.covered).toBe("$28.00 within your limit of $30.00");
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

it("leaves an over-limit operation for the User", () => {
  expect(
    nextAutoApproval({
      ...base,
      operations: [op("a", 3001)],
      decided: new Set(),
    }),
  ).toBeNull();
});

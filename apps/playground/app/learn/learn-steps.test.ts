import { describe, expect, it } from "vitest";
import { stepIndexForHash } from "./learn-steps";

const steps = [
  { id: "discovery" },
  { id: "sign-in" },
  { id: "human-approval" },
];

describe("stepIndexForHash", () => {
  it("finds a matching step from a valid hash", () => {
    expect(stepIndexForHash(steps, "#sign-in")).toBe(1);
    expect(stepIndexForHash(steps, "#human%2Dapproval")).toBe(2);
    expect(stepIndexForHash(steps, "")).toBe(-1);
    expect(stepIndexForHash(steps, "#unknown")).toBe(-1);
  });

  it("returns -1 instead of throwing on a malformed percent-encoded hash", () => {
    expect(stepIndexForHash(steps, "#%E0%A4%A")).toBe(-1);
    expect(stepIndexForHash(steps, "#%")).toBe(-1);
  });
});

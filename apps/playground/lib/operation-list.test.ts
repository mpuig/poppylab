import { describe, expect, it } from "vitest";
import { needsYou } from "@poppy-lab/pap-agent/operation-presentation";
import { withOperations } from "./operation-list";

const later = new Date(Date.now() + 60000).toISOString();
const op = (operation_id: string, state = "proposed", revision = "r1") => ({
  operation_id,
  revision,
  state,
  expires_at: later,
});

describe("the page's operations after an answer", () => {
  it("puts an answered operation in the place of the one with its ID", () => {
    const shown = [op("a"), op("b"), op("c")];
    expect(withOperations(shown, op("b", "succeeded"))).toEqual([
      op("a"),
      op("b", "succeeded"),
      op("c"),
    ]);
  });

  it("shows new terms under another ID at once, in place of the retired card", () => {
    const shown = [op("done", "succeeded"), op("old")];
    // What the route answers: the new operation and the one it replaces.
    const next = withOperations(shown, op("old", "superseded"), op("new"));
    expect(next).toEqual([
      op("done", "succeeded"),
      op("old", "superseded"),
      op("new"),
    ]);
    // Only the new terms are left to approve.
    expect(next.filter((o) => needsYou(o)).map((o) => o.operation_id)).toEqual([
      "new",
    ]);
  });

  it("adds an operation it hasn't seen even when nothing was retired", () => {
    expect(withOperations([op("a")], undefined, op("b"))).toEqual([
      op("a"),
      op("b"),
    ]);
  });

  it("leaves the list as it is when the answer carries none", () => {
    const shown = [op("a")];
    expect(withOperations(shown, undefined)).toBe(shown);
  });
});

import { describe, expect, it } from "vitest";
import { connected } from "./company-fixture";
import { removalRefusal, removeCompany } from "./removing";
import type { Operation, Run } from "./runtime";

const food = "https://food.papsandbox.com";

function uncertain(id = "op_1"): Operation {
  return {
    operation_id: id,
    revision: "r1",
    state: "uncertain",
    expires_at: "2030-01-01T00:00:00Z",
    request: { url: `${food}/api/order`, body: { item: "ramen" } },
    approval: { approved_at: 1, reference: "apr_1" },
  };
}

function runWith(scopes?: string): Run {
  const connection = connected(food, "Lantern Noodle Bar", scopes);
  connection.operations = { op_1: uncertain("op_1") };
  return {
    protocol: "1.0",
    visitor: "visitor_removing_test",
    epoch: "epoch_1",
    expires: Date.now() + 60_000,
    calls: 0,
    busy: false,
    connections: [connection],
    history: [],
  };
}

describe("removalRefusal and removeCompany with uncertain approvals", () => {
  it("tells the User to sign in first when signed out with an uncertain approval", async () => {
    const run = runWith(undefined);
    const connection = run.connections[0]!;

    const result = await removeCompany(run, connection);

    expect(result.refused).toEqual({
      code: "approval_unsettled",
      error:
        "An approval sent to Lantern Noodle Bar has an unknown outcome, so Lantern Noodle Bar can't be removed yet. Sign in to Lantern Noodle Bar first and retry that approval to settle it: it is performed at most once. Without Lantern Noodle Bar there would be no way to retry it, and the same change could be asked for twice.",
    });
    expect("operations" in result && result.operations).toEqual([
      connection.operations!.op_1,
    ]);
    expect(run.connections).toHaveLength(1);
  });

  it("tells the User to retry without asking to sign in when still signed in", () => {
    const run = runWith("poppy:read poppy:write");
    const connection = run.connections[0]!;

    const refusal = removalRefusal(connection);

    expect(refusal?.refused).toEqual({
      code: "approval_unsettled",
      error:
        "An approval sent to Lantern Noodle Bar has an unknown outcome, so Lantern Noodle Bar can't be removed yet. Retry that approval first: it is performed at most once. Without Lantern Noodle Bar there would be no way to retry it, and the same change could be asked for twice.",
    });
  });
});

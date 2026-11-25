import { expect, it } from "vitest";
import { approvals, type Action, type OperationRecord } from "./approvals.ts";

const owner = { client: "agent", user: "usr_a", account: "elena" };
function setup() {
  const records: Record<string, OperationRecord> = {};
  let performed = 0;
  let clock = Date.now();
  const ops = approvals(records, { now: () => clock });
  const action = (terms: Record<string, unknown>, key = "k"): Action => ({
    key,
    terms,
    summary: `Do ${JSON.stringify(terms)}`,
    perform: () => ({ summary: `done ${++performed}` }),
  });
  const header = (op: { operation_id: string; revision: string }) =>
    `operation_id="${op.operation_id}", revision="${op.revision}", approver="user", reference="apr_test"`;
  return {
    records,
    ops,
    action,
    header,
    performed: () => performed,
    tick: (ms: number) => (clock += ms),
  };
}

it("refuses with a stable operation, performs an approved revision once, then replays", () => {
  const x = setup();
  const first = x.ops.gate(owner, undefined, x.action({ a: 1 }));
  expect(first.status).toBe(403);
  const op = (
    first.body as { operation: { operation_id: string; revision: string } }
  ).operation;
  expect(x.ops.gate(owner, undefined, x.action({ a: 1 })).body).toEqual(
    first.body,
  );
  expect(x.ops.gate(owner, x.header(op), x.action({ a: 1 })).status).toBe(200);
  expect(
    x.ops.gate(owner, x.header(op), x.action({ a: 1 })).body,
  ).toMatchObject({ summary: "done 1" });
  expect(x.ops.replay(owner, x.header(op))).toMatchObject({
    summary: "done 1",
  });
  expect(x.performed()).toBe(1);
  // Operations v3 §8.1: who approved it, as the Personal Agent stated.
  expect(Object.values(x.records)[0]!.performed).toMatchObject({
    approver: "user",
    reference: "apr_test",
  });
});

it("doesn't take an approval without approver (Operations v3 §6)", () => {
  const x = setup();
  const op = (
    x.ops.gate(owner, undefined, x.action({ a: 1 })).body as {
      operation: { operation_id: string; revision: string };
    }
  ).operation;
  const bare = `operation_id="${op.operation_id}", revision="${op.revision}"`;
  expect(x.ops.gate(owner, bare, x.action({ a: 1 })).status).toBe(403);
  expect(x.performed()).toBe(0);
});

it("ignores approvals from another owner and never repeats the refused revision", () => {
  const x = setup();
  const op = (
    x.ops.gate(owner, undefined, x.action({ a: 1 })).body as {
      operation: { operation_id: string; revision: string };
    }
  ).operation;
  const other = x.ops.gate(
    { ...owner, account: "robin" },
    x.header(op),
    x.action({ a: 1 }),
  );
  expect(other.status).toBe(403);
  expect(
    x.ops.replay({ ...owner, account: "robin" }, x.header(op)),
  ).toBeUndefined();
  const mismatch = x.ops.gate(owner, x.header(op), x.action({ a: 2 }));
  expect(
    (mismatch.body as { operation: { revision: string } }).operation.revision,
  ).not.toBe(op.revision);
  x.tick(11 * 60000);
  const expired = x.ops.gate(owner, x.header(op), x.action({ a: 1 }));
  expect(
    (expired.body as { operation: { revision: string } }).operation.revision,
  ).not.toBe(op.revision);
  expect(x.performed()).toBe(0);
});

it("holds one account to its share of a tenant's operations", () => {
  const x = setup();
  // One account asking with a fresh key each time, as many times as the
  // tenant holds operations, whatever client or User ID it comes with.
  let taken = 0;
  for (let n = 0; n < 2000; n++) {
    const outcome = x.ops.gate(
      { client: `agent-${n % 3}`, user: `usr_${n % 7}`, account: "elena" },
      undefined,
      x.action({ n }, `fresh-${n}`),
    );
    if (outcome.status === 403) taken++;
    else
      expect(outcome).toEqual({
        status: 429,
        body: { error: "too_many_operations" },
      });
  }
  // Another customer still gets an operation.
  const robin = { ...owner, account: "robin" };
  expect(x.ops.gate(robin, undefined, x.action({ a: 1 })).status).toBe(403);
  // 100 of the tenant's 2000 are one account's share.
  expect(taken).toBe(100);
  expect(Object.keys(x.records)).toHaveLength(101);
  // Only new operations are refused: one the account holds is returned
  // again, and performed when approved.
  const first = { client: "agent-0", user: "usr_0", account: "elena" };
  const held = x.ops.gate(first, undefined, x.action({ n: 0 }, "fresh-0"));
  expect(held.status).toBe(403);
  const op = (
    held.body as { operation: { operation_id: string; revision: string } }
  ).operation;
  expect(
    x.ops.gate(first, x.header(op), x.action({ n: 0 }, "fresh-0")).status,
  ).toBe(200);
  // Performed, it still counts until it expires; then there is room again.
  const more = () => x.ops.gate(first, undefined, x.action({}, "later"));
  expect(more().status).toBe(429);
  x.tick(11 * 60000);
  expect(more().status).toBe(403);
  expect(Object.keys(x.records)).toHaveLength(1);
});

it("guards stale terms and ignores selected fields", () => {
  const x = setup();
  const stale: Action = {
    ...x.action({ a: 1, id: "x" }),
    stale: () => true,
    ignore: ["id"],
  };
  const op = (
    x.ops.gate(owner, undefined, stale).body as {
      operation: { operation_id: string; revision: string };
    }
  ).operation;
  expect(
    x.ops.gate(owner, x.header(op), { ...stale, terms: { a: 1, id: "y" } })
      .status,
  ).toBe(409);
  expect(x.performed()).toBe(0);
});

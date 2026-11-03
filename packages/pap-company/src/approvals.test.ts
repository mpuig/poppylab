import { expect, it } from "vitest";
import { approvals, type Action, type OperationRecord } from "./approvals.ts";

const owner = { client: "agent", user: "usr_a", account: "alex" };
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
    `operation_id="${op.operation_id}", revision="${op.revision}"`;
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
});

it("ignores approvals from another owner and never repeats the refused revision", () => {
  const x = setup();
  const op = (
    x.ops.gate(owner, undefined, x.action({ a: 1 })).body as {
      operation: { operation_id: string; revision: string };
    }
  ).operation;
  const other = x.ops.gate(
    { ...owner, account: "maya" },
    x.header(op),
    x.action({ a: 1 }),
  );
  expect(other.status).toBe(403);
  expect(
    x.ops.replay({ ...owner, account: "maya" }, x.header(op)),
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

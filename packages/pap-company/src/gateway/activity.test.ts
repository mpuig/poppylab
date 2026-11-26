/**
 * The activity a Company's website shows: a finished request stays listed,
 * with who approved it, after the gate has forgotten its operation, within
 * bounds of its own, and without changing what the gate allows.
 */
import { afterEach, expect, it, vi } from "vitest";
import { approvals, type Action, type OperationRecord } from "../approvals.ts";
import {
  agentActivity,
  keepActivity,
  type ActivityEntry,
  type ActivityItem,
} from "./activity.ts";
import { setup } from "./test-company.ts";
import type { CompanyDefinition } from "./types.ts";

afterEach(() => vi.useRealTimers());

const owner = { client: "agent", user: "usr_a", account: "elena" };
type Proposed = { operation: { operation_id: string; revision: string } };
const approval = (op: Proposed["operation"], approver = "user") =>
  `operation_id="${op.operation_id}", revision="${op.revision}", approver="${approver}"`;

/** The gate with its kept activity, on a clock the test moves. */
function gate() {
  const records: Record<string, OperationRecord> = {};
  const kept: ActivityEntry[] = [];
  const clock = { now: Date.parse("2026-11-25T12:00:00Z") };
  let performed = 0;
  const ops = approvals(records, {
    now: () => clock.now,
    finished: (entry) => keepActivity(kept, entry, clock.now),
  });
  const action = (key: string, more: Partial<Action> = {}): Action => ({
    key,
    terms: { key },
    summary: `Do ${key}`,
    perform: () => ({ summary: `Did ${key} (${++performed})` }),
    ...more,
  });
  const propose = (key: string, more?: Partial<Action>) =>
    (ops.gate(owner, undefined, action(key, more)).body as Proposed).operation;
  /** Proposes and approves `key`; returns the approval that was used. */
  const apply = (key: string, approver = "user", more?: Partial<Action>) => {
    const header = approval(propose(key, more), approver);
    return { header, outcome: ops.gate(owner, header, action(key, more)) };
  };
  return {
    records,
    kept,
    clock,
    ops,
    action,
    propose,
    apply,
    performed: () => performed,
    activity: () => agentActivity("elena", records, kept, clock.now),
  };
}

it("lists an applied request, who approved it and when, after the gate forgot the operation", () => {
  const x = gate();
  const { header, outcome } = x.apply("move", "agent");
  expect(outcome.status).toBe(200);
  const applied = {
    state: "succeeded",
    summary: "Do move",
    result: "Did move (1)",
    approver: "agent",
    at: "2026-11-25T12:00:00.000Z",
    when: "Nov 25, 12:00 UTC",
  };
  expect(x.activity()).toMatchObject([applied]);

  // Eleven minutes on, the next request makes the gate forget the operation.
  x.clock.now += 11 * 60000;
  const next = x.propose("other");
  expect(Object.keys(x.records)).toEqual([next.operation_id]);
  expect(x.activity()).toMatchObject([
    { state: "proposed", summary: "Do other", when: "Nov 25, 12:21 UTC" },
    applied,
  ]);

  // The kept entry answers no retry and makes no old approval work again:
  // the same approval is a new proposal, and nothing is performed twice.
  expect(x.ops.replay(owner, header)).toBeUndefined();
  const retried = x.ops.gate(owner, header, x.action("move"));
  expect(retried.status).toBe(403);
  expect(retried.body).toMatchObject({ error: "approval_required" });
  expect(x.performed()).toBe(1);
});

it("lists an approval the Company declined and one the account no longer matched, once each", () => {
  const x = gate();
  const decline = {
    decline: (a: { approver: string }) =>
      a.approver === "agent" ? { reason: "Approve this yourself." } : undefined,
  };
  expect(x.apply("pay", "agent", decline).outcome.status).toBe(403);
  expect(x.apply("pay", "agent", decline).outcome.status).toBe(403);
  expect(x.apply("seat", "user", { stale: () => true }).outcome.status).toBe(
    409,
  );
  expect(x.activity()).toMatchObject([
    // Both operations still wait: nothing was performed.
    { state: "proposed", summary: "Do seat" },
    { state: "proposed", summary: "Do pay" },
    { state: "refused", summary: "Do seat", approver: "user" },
    {
      state: "declined",
      summary: "Do pay",
      result: "Approve this yourself.",
      approver: "agent",
    },
  ]);
  // Approved by the User after all: the earlier answer stays on record.
  expect(x.apply("pay", "user", decline).outcome.status).toBe(200);
  expect(x.activity().map((item) => item.state)).toEqual([
    "proposed",
    "succeeded",
    "refused",
    "declined",
  ]);
});

it("lists an approved request the Company refused for a reason of its own, and leaves the operation to be approved", () => {
  const x = gate();
  const header = approval(x.propose("pay"));
  const attempt = {
    key: "pay",
    terms: { key: "pay" },
    reason: "The balance is too low.",
  };
  // The Company answers the approved request itself, before the gate.
  x.ops.refused(owner, header, attempt);
  const refused = {
    state: "refused",
    summary: "Do pay",
    result: "The balance is too low.",
    approver: "user",
    when: "Nov 25, 12:00 UTC",
  };
  expect(x.activity()).toMatchObject([
    { state: "proposed", summary: "Do pay" },
    refused,
  ]);
  // Told once, by its last answer.
  x.clock.now += 60000;
  x.ops.refused(owner, header, attempt);
  expect(x.activity()).toMatchObject([
    { state: "proposed" },
    { ...refused, when: "Nov 25, 12:01 UTC" },
  ]);
  // Nothing is recorded without an approval of a waiting revision of this
  // owner's that describes the request.
  x.ops.refused(owner, undefined, attempt);
  x.ops.refused({ ...owner, account: "robin" }, header, attempt);
  x.ops.refused(
    owner,
    header.replace(/revision="[^"]+"/, 'revision="x"'),
    attempt,
  );
  x.ops.refused(owner, header, { ...attempt, terms: { key: "other" } });
  x.ops.refused(owner, header, { ...attempt, key: "other" });
  expect(x.kept).toHaveLength(1);
  expect(x.kept[0]!.at).toBe("2026-11-25T12:01:00.000Z");
  // The operation is as it was: the same approval performs it, once.
  expect(x.ops.gate(owner, header, x.action("pay")).status).toBe(200);
  expect(x.performed()).toBe(1);
  expect(x.activity().map((item) => item.state)).toEqual([
    "succeeded",
    "refused",
  ]);
  // A performed operation has its answer, and an expired one none to give.
  x.ops.refused(owner, header, attempt);
  const late = approval(x.propose("late"));
  x.clock.now += 11 * 60000;
  x.ops.refused(owner, late, { ...attempt, key: "late", terms: {} });
  expect(x.kept).toHaveLength(2);
});

it("keeps the newest 20 per account for 90 days, at most 5 of them requests that changed nothing", () => {
  const x = gate();
  for (let i = 1; i <= 25; i++) {
    x.apply(`change-${i}`);
    x.clock.now += 60000;
  }
  const summaries = () => x.activity().map((item) => item.summary);
  expect(x.kept).toHaveLength(20);
  expect(summaries()).toEqual(
    Array.from({ length: 20 }, (_, i) => `Do change-${25 - i}`),
  );
  // Another account has its own 20.
  keepActivity(
    x.kept,
    { ...x.kept[0]!, account: "robin", summary: "Robin's" },
    x.clock.now,
  );
  expect(x.kept).toHaveLength(21);
  expect(agentActivity("robin", x.records, x.kept, x.clock.now)).toMatchObject([
    { summary: "Robin's" },
  ]);
  // Thirty refusals leave the five newest, and fifteen applied requests.
  for (let i = 1; i <= 30; i++)
    x.apply(`refused-${i}`, "user", { stale: () => true });
  const finished = x.activity().filter((item) => item.state !== "proposed");
  expect(finished.map((item) => item.summary)).toEqual([
    ...Array.from({ length: 5 }, (_, i) => `Do refused-${30 - i}`),
    ...Array.from({ length: 15 }, (_, i) => `Do change-${25 - i}`),
  ]);

  // Ninety days after the last of them, none is listed, and the next
  // request leaves none kept.
  x.clock.now += 91 * 86400000;
  expect(x.activity().filter((item) => item.state !== "expired")).toEqual([]);
  x.apply("much-later");
  expect(x.activity().map((item) => item.summary)).toEqual(["Do much-later"]);
  expect(x.kept.filter((e) => e.account === "elena")).toHaveLength(1);
});

it("counts no kept entry toward the gate's caps", () => {
  const x = gate();
  for (let i = 1; i <= 20; i++) x.apply(`change-${i}`);
  x.clock.now += 11 * 60000;
  // The account's hundred operations are all free again.
  for (let i = 1; i <= 100; i++)
    expect(x.ops.gate(owner, undefined, x.action(`new-${i}`)).status).toBe(403);
  expect(x.ops.gate(owner, undefined, x.action("one-more")).body).toEqual({
    error: "too_many_operations",
  });
  expect(x.kept).toHaveLength(20);
  // A website lists the newest ten proposals above what it kept.
  expect(x.activity().map((item) => item.state)).toEqual([
    ...Array.from({ length: 10 }, () => "proposed"),
    ...Array.from({ length: 20 }, () => "succeeded"),
  ]);
});

it("says of a waiting proposal that its agent is no longer connected, until it expires", () => {
  const x = gate();
  const op = x.propose("move");
  const activity = (connected: boolean) =>
    agentActivity("elena", x.records, x.kept, x.clock.now, (record) => {
      expect(record).toMatchObject(owner);
      return connected;
    });
  expect(activity(true)).toEqual(x.activity());
  expect(activity(true)).toMatchObject([{ state: "proposed" }]);
  expect(activity(true)[0]).not.toHaveProperty("result");
  expect(activity(false)).toEqual([
    {
      id: op.operation_id,
      state: "disconnected",
      summary: "Do move",
      result:
        "The agent that proposed this is no longer connected to your account, so it can't be approved now, and nothing has changed. If you connect the same agent to this account again before Nov 25, 12:10 UTC, the proposal can still be approved there. After that it expires.",
      at: "2026-11-25T12:10:00.000Z",
      when: "Nov 25, 12:10 UTC",
    },
  ]);
  // Once it ran out it is expired, whoever is connected.
  x.clock.now += 11 * 60000;
  expect(activity(false)).toEqual(activity(true));
  expect(activity(false)).toMatchObject([{ state: "expired" }]);
  expect(activity(false)[0]).not.toHaveProperty("result");
});

/** A Company whose website reads `ctx.activity`, behind the gateway. */
const company: Partial<CompanyDefinition> = {
  mount: (app, ctx) => {
    app.post("/api/account/things", (c) =>
      ctx.gate(c, {
        key: c.req.query("key") ?? "thing",
        terms: {},
        summary: "Add a thing",
        perform: () => ({ summary: "Added" }),
      }),
    );
    app.get("/site/activity", (c) => c.json(ctx.activity("elena")));
    // The website's Disconnect, for the customer's one connected agent.
    app.post("/site/disconnect", (c) =>
      c.json({
        revoked: ctx.grants.revoke("elena", ctx.grants.list("elena")[0]!.id),
      }),
    );
  },
};
const OPERATIONS = { extensions: '"operations";v="3"' };

it("gives a Company's website the kept activity, saved with its tenant", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await setup({}, company);
  const tokens = await x.signIn("things:read things:write");
  if ("refused" in tokens) throw new Error("refused");
  const change = async (approve?: Proposed["operation"]) =>
    x.call("/api/account/things", {
      method: "POST",
      access: tokens.access_token,
      ...OPERATIONS,
      ...(approve ? { approval: approval(approve) } : {}),
    });
  const op = ((await (await change()).json()) as Proposed).operation;
  expect((await change(op)).status).toBe(200);
  vi.setSystemTime(Date.now() + 11 * 60000);
  await change();
  const listed = (await (
    await x.app.request("/site/activity")
  ).json()) as ActivityItem[];
  expect(listed.map((item) => item.state)).toEqual(["proposed", "succeeded"]);
  expect(listed[1]).toMatchObject({ summary: "Add a thing", approver: "user" });
  const tenant = x.store.value.tenants.shared!;
  expect(tenant.activity).toHaveLength(1);
  // Only what a website shows is kept: no terms and no first response.
  expect(Object.keys(tenant.activity![0]!).sort()).toEqual(
    ["account", "approver", "at", "id", "outcome", "result", "summary"].sort(),
  );
});

it("stops listing a proposal as awaiting once its agent can't reach the account, and lists it again when the same agent is connected again", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  for (const isolation of ["visitor", "shared"] as const) {
    const x = await setup({ isolation }, company);
    // The customer's browser: it approves the consents and reads the website.
    const browser =
      (await x.app.request("/site/activity")).headers
        .getSetCookie()
        .find((c) => c.includes("pap_browser="))
        ?.split(";")[0] ?? "";
    const site = async (path = "/site/activity", method = "GET") =>
      (await x.app.request(path, {
        method,
        headers: { cookie: browser },
      })) as Response;
    const listed = async () => (await (await site()).json()) as ActivityItem[];
    const connect = async () => {
      const tokens = await x.signIn(
        "things:read things:write",
        {},
        browser || undefined,
      );
      if ("refused" in tokens) throw new Error("refused");
      return tokens;
    };
    const change = (access: string, key: string, op?: Proposed["operation"]) =>
      x.call(`/api/account/things?key=${key}`, {
        method: "POST",
        access,
        ...OPERATIONS,
        ...(op ? { approval: approval(op) } : {}),
      });
    const propose = async (access: string, key: string) =>
      ((await (await change(access, key)).json()) as Proposed).operation;

    let tokens = await connect();
    const op = await propose(tokens.access_token, "one");
    expect(await listed()).toMatchObject([
      { id: op.operation_id, state: "proposed" },
    ]);

    // The customer presses Disconnect on the website.
    expect(await (await site("/site/disconnect", "POST")).json()).toEqual({
      revoked: true,
    });
    const gone = await listed();
    expect(gone).toMatchObject([
      { id: op.operation_id, state: "disconnected", summary: "Add a thing" },
    ]);
    expect(gone[0]!.result).toContain(
      "is no longer connected to your account, so it can't be approved now",
    );
    // And it can't: the agent has no token that reaches the account.
    expect((await change(tokens.access_token, "one", op)).status).toBe(401);
    expect(await listed()).toEqual(gone);

    // The same agent, User and account with a new consent: the operation is
    // theirs (Operations §3), so it waits again, and the approval performs it.
    tokens = await connect();
    expect(await listed()).toMatchObject([{ state: "proposed" }]);
    expect((await listed())[0]).not.toHaveProperty("result");
    expect((await change(tokens.access_token, "one", op)).status).toBe(200);
    expect(await listed()).toMatchObject([{ state: "succeeded" }]);

    // The agent signs out itself (RFC 7009): the same as Disconnect.
    await propose(tokens.access_token, "two");
    const revoked = await x.form("/oauth/revoke", {
      token: tokens.refresh_token,
      ...(await x.credentials()),
    });
    expect(revoked.status).toBe(200);
    expect((await listed()).map((item) => item.state)).toEqual([
      "disconnected",
      "succeeded",
    ]);

    // Nobody connected it again: the proposal expires like any other.
    vi.setSystemTime(Date.now() + 11 * 60000);
    expect((await listed()).map((item) => item.state)).toEqual([
      "expired",
      "succeeded",
    ]);
  }
});

it("shows a request performed in a tenant stored before activity was kept", async () => {
  const x = await setup({}, company);
  // As stored by an earlier version: a performed operation, no activity.
  const at = new Date().toISOString();
  x.store.value.tenants.shared = {
    business: {},
    used: Date.now(),
    operations: {
      op_before: {
        client: "agent",
        user: "usr",
        account: "elena",
        key: "thing",
        revisions: [
          {
            revision: "r1",
            summary: "Add a thing",
            terms: {},
            expires_at: new Date(Date.now() + 60000).toISOString(),
          },
        ],
        performed: {
          revision: "r1",
          at,
          until: Date.now() + 60000,
          body: { operation_id: "op_before", summary: "Added" },
          approver: "user",
        },
      },
    },
  };
  const listed = (await (
    await x.app.request("/site/activity")
  ).json()) as ActivityItem[];
  expect(listed).toMatchObject([
    {
      id: "op_before",
      state: "succeeded",
      summary: "Add a thing",
      result: "Added",
      approver: "user",
      at,
    },
  ]);
});

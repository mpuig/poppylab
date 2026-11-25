/**
 * Fernwick's own API: discovery and OpenAPI, consent subsets, the meters
 * chosen at consent, bills, and the rate plan switch through Operations v3
 * (approval_required → approved → performed once, replay, idempotency).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scopes } from "./scopes.ts";
import { inject, origin, setup } from "./test-harness.ts";

type Harness = Awaited<ReturnType<typeof setup>>;
const own = ["account:read", "plan:write"];
const operation = (response: Awaited<ReturnType<typeof inject>>) =>
  response.json().operation as {
    operation_id: string;
    revision: string;
    terms: Record<string, unknown>;
    summary: string;
  };

describe("Fernwick Power & Light", () => {
  let h: Harness;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T12:00:00.000Z"));
    h = await setup();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes discovery, scope hints, tasks, OpenAPI and pages", async () => {
    const discovery = (await inject("/.well-known/poppy.json")).json();
    expect(discovery).toMatchObject({
      protocol_version: "1.0",
      organization: {
        name: "Fernwick Power & Light",
        domain: "fernwick.localhost:4500",
      },
    });
    expect(Object.keys(discovery.auth.scopes)).toEqual([...scopes]);
    expect(discovery.auth.scope_hints.offline_access).toEqual({
      changes: "none",
      personal_data: false,
    });
    const openapi = (await inject("/openapi.json")).json();
    expect(openapi.paths["/api/account/plan"].post).toMatchObject({
      operationId: "change_plan",
      "x-poppy-proposal": true,
      "x-poppy-scopes": ["account:read", "plan:write"],
    });
    expect(openapi.paths["/api/account/bills"].get["x-poppy-scopes"]).toEqual([
      "account:read",
    ]);
    const tasks = (await inject("/poppy/tasks")).json();
    expect(tasks.excluded_tasks.map((t: { task: string }) => t.task)).toContain(
      "Pay a bill or set up automatic payments",
    );
    const home = await inject("/");
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("Nothing here is real.");
    expect(home.body).toContain(
      "Fernwick Power &#38; Light is a fictional company",
    );
    const agents = await inject("/for-agents");
    expect(agents.body).toContain(
      "ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified",
    );
    expect(agents.body).toContain(`${origin}/espi/1_1/resource`);
  });

  it("lets consent leave out the plan change and offline access", async () => {
    const requested = [...own, "espi:usage", "offline_access"];
    const limited = await h.sign("elena", requested, {
      allowChanges: false,
      allowOffline: false,
    });
    expect(limited.scope).toBe("account:read espi:usage");
    const full = await h.sign("robin", requested, { allowOffline: true });
    expect(full.scope ?? requested.join(" ")).toBe(requested.join(" "));
  });

  it("shows only the meters chosen at consent, and their bills", async () => {
    const both = await h.sign("elena", ["account:read"]);
    const account = (
      await h.call(both.access_token, "GET", "/api/account/account")
    ).json();
    expect(account.customer.name).toBe("Elena Maren");
    expect(account.service_address.line).toBe("41 Bracken Row, Fernwick 00000");
    expect(
      account.meters.map((m: { usage_point_id: string }) => m.usage_point_id),
    ).toEqual(["UP-E1", "UP-E2"]);
    expect(account.meters[1]).toMatchObject({
      plan: "time-of-use",
      label: "EV charger",
    });
    expect(
      account.plans[1].bands.map(
        (b: { cents_per_kwh: number }) => b.cents_per_kwh,
      ),
    ).toEqual([17, 25, 41]);
    const one = await h.sign("elena", ["account:read"], { meters: ["UP-E2"] });
    const narrow = (
      await h.call(one.access_token, "GET", "/api/account/account")
    ).json();
    expect(
      narrow.meters.map((m: { usage_point_id: string }) => m.usage_point_id),
    ).toEqual(["UP-E2"]);
    const bills = (
      await h.call(one.access_token, "GET", "/api/account/bills")
    ).json();
    expect(
      bills.bills.map(
        (b: { id: string; usage_point_id: string }) =>
          `${b.usage_point_id} ${b.id}`,
      ),
    ).toEqual(["UP-E2 2026-10", "UP-E2 2026-09"]);
    for (const bill of bills.bills)
      expect(bill.total_cents).toBe(
        bill.lines.reduce(
          (sum: number, l: { amount_cents: number }) => sum + l.amount_cents,
          0,
        ),
      );
    // Robin's bill carries the solar credit.
    const robin = await h.sign("robin", ["account:read"]);
    const robinBills = (
      await h.call(robin.access_token, "GET", "/api/account/bills")
    ).json();
    expect(robinBills.bills[0].lines.at(-1).note).toBe(
      "Credit for energy sent to the grid",
    );
    expect(robinBills.bills[0].lines.at(-1).amount_cents).toBeLessThan(0);
    const scope = await h.call(
      robin.access_token,
      "POST",
      "/api/account/plan",
      {
        usage_point_id: "UP-R1",
        plan: "flat",
        idempotency_key: "plan-scope-0001",
      },
    );
    expect(scope.statusCode).toBe(403);
    expect(scope.json().error).toBe("insufficient_scope");
  });

  it("switches a plan from the next cycle once, after exact approval", async () => {
    const tokens = await h.sign("elena", own);
    const payload = {
      usage_point_id: "UP-E1",
      plan: "time-of-use",
      idempotency_key: "plan-switch-001",
    };
    const proposed = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      payload,
    );
    expect(proposed.statusCode).toBe(403);
    expect(proposed.json().error).toBe("approval_required");
    const op = operation(proposed);
    expect(op.terms).toMatchObject({
      usage_point_id: "UP-E1",
      meter: "Home",
      from_plan: "flat",
      to_plan: "time-of-use",
      effective_date: "2026-12-01",
      estimate_basis_month: "2026-10",
      currency: "USD",
      meter_version: 1,
      idempotency_key: "plan-switch-001",
    });
    const difference = op.terms.estimated_monthly_difference_cents as number;
    expect(Number.isInteger(difference)).toBe(true);
    expect(op.terms.on_new_plan_cents).toBe(
      (op.terms.billed_cents as number) + difference,
    );
    expect(op.summary).toContain("from December 1, 2026, the next bill cycle");
    expect(op.summary).toContain("October 2026");

    const approved = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      payload,
      op,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.change).toMatchObject({
      usage_point_id: "UP-E1",
      from_plan: "flat",
      to_plan: "time-of-use",
      effective_date: "2026-12-01",
    });
    // The same approval again: the first response, nothing new.
    const replay = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      payload,
      op,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(approved.json());
    // The same request without approval: answered by its change.
    const again = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      payload,
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().data.change.id).toBe(approved.json().data.change.id);
    // The key with another request conflicts.
    const conflict = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      {
        ...payload,
        plan: "flat",
      },
    );
    expect(conflict.json().error).toBe("idempotency_conflict");
    // Nothing changes before the 1st; then the meter is on the new plan.
    const account = (
      await h.call(tokens.access_token, "GET", "/api/account/account")
    ).json();
    expect(account.meters[0]).toMatchObject({
      plan: "flat",
      scheduled_change: { plan: "time-of-use", effective_date: "2026-12-01" },
    });
    const twice = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      {
        ...payload,
        idempotency_key: "plan-switch-002",
      },
    );
    expect([twice.statusCode, twice.json().error]).toEqual([
      409,
      "change_already_scheduled",
    ]);
    const same = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      {
        usage_point_id: "UP-E2",
        plan: "time-of-use",
        idempotency_key: "plan-switch-003",
      },
    );
    expect([same.statusCode, same.json().error]).toEqual([
      409,
      "plan_unchanged",
    ]);
  });

  it("refuses a stale approval, an unchosen meter and requests without Operations v3", async () => {
    const tokens = await h.sign("elena", own, { meters: ["UP-E1"] });
    const unchosen = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      {
        usage_point_id: "UP-E2",
        plan: "flat",
        idempotency_key: "plan-unchosen-1",
      },
    );
    expect([unchosen.statusCode, unchosen.json().error]).toEqual([
      404,
      "meter_not_found",
    ]);
    const payload = {
      usage_point_id: "UP-E1",
      plan: "time-of-use",
      idempotency_key: "plan-stale-0001",
    };
    const without = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      payload,
      undefined,
      "usr_fernwick",
      { "Poppy-Extensions": '"poppylab.dev/espi";v="1"' },
    );
    expect([without.statusCode, without.json()]).toEqual([
      403,
      { error: "extension_required", extension: "operations" },
    ]);
    const first = operation(
      await h.call(tokens.access_token, "POST", "/api/account/plan", payload),
    );
    // Another switch is performed first, under another key.
    const other = { ...payload, idempotency_key: "plan-stale-0002" };
    const second = operation(
      await h.call(tokens.access_token, "POST", "/api/account/plan", other),
    );
    expect(
      (
        await h.call(
          tokens.access_token,
          "POST",
          "/api/account/plan",
          other,
          second,
        )
      ).statusCode,
    ).toBe(200);
    const stale = await h.call(
      tokens.access_token,
      "POST",
      "/api/account/plan",
      payload,
      first,
    );
    expect(stale.statusCode).not.toBe(200);
    const account = (
      await h.call(tokens.access_token, "GET", "/api/account/account")
    ).json();
    expect(account.meters).toHaveLength(1);
  });
});

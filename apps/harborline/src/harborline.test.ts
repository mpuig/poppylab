import { beforeEach, describe, expect, it } from "vitest";
import { scopes } from "./scopes.ts";
import { inject, origin, setup } from "./test-harness.ts";

const reads = [
  "accounts:read",
  "transactions:read",
  "cards:read",
  "recipients:read",
  "budgets:read",
];
const all = [...scopes];
const operation = (response: Awaited<ReturnType<typeof inject>>) =>
  response.json().operation as {
    operation_id: string;
    revision: string;
    terms: Record<string, unknown>;
    summary: string;
  };

describe("Harborline Bank", () => {
  beforeEach(async () => {
    await setup();
  });

  it("publishes Poppy 1.0 discovery, narrow scope hints, tasks and useful OpenAPI", async () => {
    const discovery = (await inject("/.well-known/poppy.json")).json();
    expect(discovery).toMatchObject({
      protocol_version: "1.0",
      organization: {
        name: "Harborline Bank",
        domain: "harbor.localhost:4300",
      },
      extensions: { operations: [{ version: "3" }] },
    });
    expect(Object.keys(discovery.auth.scopes)).toEqual(all);
    expect(discovery.auth.scope_hints["cards:write"]).toEqual({
      changes: "reversible",
      personal_data: true,
    });
    expect(discovery.auth.scope_hints["payments:request"]).toEqual({
      changes: "irreversible",
      personal_data: true,
    });
    expect(discovery.auth.scope_hints.offline_access).toEqual({
      changes: "none",
      personal_data: false,
    });
    const tasks = (await inject("/poppy/tasks")).json();
    expect(
      tasks.excluded_tasks.map((item: { task: string }) => item.task),
    ).toContain("Create, edit or verify a payment recipient");
    const openapi = (await inject("/openapi.json")).json();
    expect(openapi.paths["/api/account/payments"].post).toMatchObject({
      operationId: "request_payment",
      "x-poppy-proposal": true,
      "x-poppy-scopes": [
        "accounts:read",
        "recipients:read",
        "payments:request",
      ],
    });
    expect(
      openapi.paths["/api/account/payments"].post.requestBody.content[
        "application/json"
      ].schema.properties.idempotency_key.description,
    ).toContain("Reusing it with different terms");
    expect(await inject("/")).toMatchObject({ statusCode: 200 });
    expect((await inject("/")).body).toContain("Never enter real bank details");
  });

  it("lets consent omit offline and change scopes without widening the grant", async () => {
    const { sign } = await setup();
    const requested = [...reads, "cards:write", "offline_access"];
    const limited = await sign("avery", requested, {
      allowChanges: false,
      allowOffline: false,
    });
    expect(limited.scope).toBe(reads.join(" "));
    const full = await sign("jordan", requested, {
      allowChanges: true,
      allowOffline: true,
    });
    expect(full.scope?.split(" ")).toEqual(requested);
  });

  it("enforces route-specific scopes and returns each persona's matching reads", async () => {
    const { sign, call } = await setup();
    const token = await sign("jordan", ["accounts:read"]);
    const accounts = await call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(accounts.statusCode).toBe(200);
    expect(accounts.json().customer.name).toBe("Jordan Lee");
    expect(accounts.json().accounts[0].balance_cents).toBe(382740);
    const transactions = await call(
      token.access_token,
      "GET",
      "/api/account/transactions",
    );
    expect(transactions.statusCode).toBe(403);
    expect(transactions.json().error).toBe("insufficient_scope");
    expect(transactions.headers["www-authenticate"]).toContain(
      'scope="transactions:read"',
    );
  });

  it("requests a payment with exact terms, performs it once, and rejects idempotency conflicts", async () => {
    const { sign, call } = await setup();
    const token = await sign("avery", all, { allowOffline: true });
    const payload = {
      source_account_id: "acc_HLB_A100",
      recipient_id: "rcp_HLB_A501",
      amount_cents: 12500,
      memo: "November design work",
      idempotency_key: "payment-demo-001",
    };
    const proposed = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      payload,
    );
    expect(proposed.statusCode).toBe(403);
    const op = operation(proposed);
    expect(op.summary).toContain("USD 125.00");
    expect(op.summary).toContain("No real money moves");
    expect(op.terms).toMatchObject({
      recipient_name: "Beacon Studio LLC",
      source_balance_before_cents: 1284500,
      source_balance_after_cents: 1272000,
      fee_cents: 0,
    });
    const approved = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      payload,
      op,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.account.balance_cents).toBe(1272000);
    const replay = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      payload,
      op,
    );
    expect(replay.json()).toEqual(approved.json());
    const conflict = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      { ...payload, amount_cents: 13000 },
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("idempotency_conflict");
    const accounts = await call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(accounts.json().accounts[0].balance_cents).toBe(1272000);
  });

  it("returns meaningful payment and transfer errors before creating an operation", async () => {
    const { sign, call } = await setup();
    const token = await sign("avery", all);
    const inactive = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      {
        source_account_id: "acc_HLB_A100",
        recipient_id: "rcp_HLB_A502",
        amount_cents: 1000,
        memo: "Storage",
        idempotency_key: "payment-inactive",
      },
    );
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().error).toBe("recipient_inactive");
    const recipientLimit = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      {
        source_account_id: "acc_HLB_A100",
        recipient_id: "rcp_HLB_A501",
        amount_cents: 600000,
        memo: "Over recipient limit",
        idempotency_key: "payment-too-large",
      },
    );
    expect(recipientLimit.statusCode).toBe(422);
    expect(recipientLimit.json().error).toBe("recipient_limit_exceeded");
    const jordan = await sign("jordan", all);
    const insufficient = await call(
      jordan.access_token,
      "POST",
      "/api/account/payments",
      {
        source_account_id: "acc_HLB_J100",
        recipient_id: "rcp_HLB_J501",
        amount_cents: 400000,
        memo: "Beyond available balance",
        idempotency_key: "payment-insufficient",
      },
    );
    expect(insufficient.statusCode).toBe(409);
    expect(insufficient.json().error).toBe("insufficient_funds");
    const limit = await call(
      token.access_token,
      "POST",
      "/api/account/transfers",
      {
        source_account_id: "acc_HLB_A100",
        destination_account_id: "acc_HLB_A200",
        amount_cents: 250001,
        idempotency_key: "transfer-limit-01",
      },
    );
    expect(limit.statusCode).toBe(422);
    expect(limit.json()).toMatchObject({
      error: "transfer_limit_exceeded",
      limit_cents: 250000,
    });
  });

  it("detects stale approved transfers after another approved transfer changes the account", async () => {
    const { sign, call } = await setup();
    const token = await sign("avery", all);
    const firstPayload = {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_HLB_A200",
      amount_cents: 50000,
      idempotency_key: "transfer-stale-01",
    };
    const secondPayload = {
      ...firstPayload,
      amount_cents: 60000,
      idempotency_key: "transfer-stale-02",
    };
    const first = operation(
      await call(
        token.access_token,
        "POST",
        "/api/account/transfers",
        firstPayload,
      ),
    );
    const second = operation(
      await call(
        token.access_token,
        "POST",
        "/api/account/transfers",
        secondPayload,
      ),
    );
    expect(
      (
        await call(
          token.access_token,
          "POST",
          "/api/account/transfers",
          firstPayload,
          first,
        )
      ).statusCode,
    ).toBe(200);
    const stale = await call(
      token.access_token,
      "POST",
      "/api/account/transfers",
      secondPayload,
      second,
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("account_changed");
  });

  it("freezes and unfreezes active cards while refusing inactive or stale cards", async () => {
    const { sign, call } = await setup();
    const token = await sign("avery", all);
    const freezePayload = { status: "frozen", expected_version: 1 };
    const proposal = operation(
      await call(
        token.access_token,
        "POST",
        "/api/account/cards/card_HLB_A401/status",
        freezePayload,
      ),
    );
    const frozen = await call(
      token.access_token,
      "POST",
      "/api/account/cards/card_HLB_A401/status",
      freezePayload,
      proposal,
    );
    expect(frozen.json().data.card).toMatchObject({
      status: "frozen",
      version: 2,
    });
    const stale = await call(
      token.access_token,
      "POST",
      "/api/account/cards/card_HLB_A401/status",
      { status: "active", expected_version: 1 },
    );
    expect(stale.json().error).toBe("card_changed");
    const unfreezePayload = { status: "active", expected_version: 2 };
    const unfreeze = operation(
      await call(
        token.access_token,
        "POST",
        "/api/account/cards/card_HLB_A401/status",
        unfreezePayload,
      ),
    );
    const active = await call(
      token.access_token,
      "POST",
      "/api/account/cards/card_HLB_A401/status",
      unfreezePayload,
      unfreeze,
    );
    expect(active.json().data.card).toMatchObject({
      status: "active",
      version: 3,
    });
    const inactive = await call(
      token.access_token,
      "POST",
      "/api/account/cards/card_HLB_A402/status",
      { status: "frozen", expected_version: 1 },
    );
    expect(inactive.json().error).toBe("card_inactive");
  });

  it("edits transaction categories and creates then updates a budget through approvals", async () => {
    const { sign, call } = await setup();
    const token = await sign("avery", all);
    const categoryPayload = { category: "dining", expected_version: 1 };
    const categoryOp = operation(
      await call(
        token.access_token,
        "POST",
        "/api/account/transactions/txn_HLB_A301/category",
        categoryPayload,
      ),
    );
    const categorized = await call(
      token.access_token,
      "POST",
      "/api/account/transactions/txn_HLB_A301/category",
      categoryPayload,
      categoryOp,
    );
    expect(categorized.json().data.transaction).toMatchObject({
      category: "dining",
      version: 2,
    });
    const jordan = await sign("jordan", all);
    const pending = await call(
      jordan.access_token,
      "POST",
      "/api/account/transactions/txn_HLB_J302/category",
      categoryPayload,
    );
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error).toBe("transaction_pending");

    const createPayload = {
      name: "Harbor trips",
      category: "travel",
      limit_cents: 90000,
      month: "2026-12",
      idempotency_key: "budget-create-01",
    };
    const createOp = operation(
      await call(
        token.access_token,
        "POST",
        "/api/account/budgets",
        createPayload,
      ),
    );
    const created = await call(
      token.access_token,
      "POST",
      "/api/account/budgets",
      createPayload,
      createOp,
    );
    expect(created.statusCode).toBe(200);
    const budget = created.json().data.budget;
    const updatePayload = {
      name: "Coastal travel",
      limit_cents: 120000,
      expected_version: 1,
    };
    const updateOp = operation(
      await call(
        token.access_token,
        "POST",
        `/api/account/budgets/${budget.id}`,
        updatePayload,
      ),
    );
    const updated = await call(
      token.access_token,
      "POST",
      `/api/account/budgets/${budget.id}`,
      updatePayload,
      updateOp,
    );
    expect(updated.json().data.budget).toMatchObject({
      name: "Coastal travel",
      limit_cents: 120000,
      version: 2,
    });
  });

  it("requires Operations v3 for every mutation", async () => {
    const { sign, call } = await setup();
    const token = await sign("avery", all);
    const response = await call(
      token.access_token,
      "POST",
      "/api/account/cards/card_HLB_A401/status",
      { status: "frozen", expected_version: 1 },
      undefined,
      "usr_harborline",
      { "Poppy-Extensions": "" },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "extension_required",
      extension: "operations",
    });
  });

  it("serves a customer portal that observes the same approved API state", async () => {
    const { sign, call } = await setup();
    const token = await sign("avery", all);
    const payload = {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_HLB_A200",
      amount_cents: 50000,
      idempotency_key: "portal-transfer-01",
    };
    const op = operation(
      await call(token.access_token, "POST", "/api/account/transfers", payload),
    );
    await call(
      token.access_token,
      "POST",
      "/api/account/transfers",
      payload,
      op,
    );
    const login = await inject("/site/login");
    const loginCookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const signed = await inject({
      method: "POST",
      url: "/site/login",
      headers: { cookie: loginCookie, origin },
      payload: { account: "avery" },
    });
    const portalCookie = String(signed.headers["set-cookie"])
      .split(",")
      .find((value) => value.includes("harborline_web="))!
      .trim()
      .split(";")[0]!;
    const state = await inject({
      url: "/site/state",
      headers: { cookie: portalCookie },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().accounts).toMatchObject([
      { id: "acc_HLB_A100", balance_cents: 1234500 },
      { id: "acc_HLB_A200", balance_cents: 4300000 },
    ]);
    expect(state.json().activity[0].state).toBe("succeeded");
    expect(state.json().note).toContain("No real money moves");
  });
});

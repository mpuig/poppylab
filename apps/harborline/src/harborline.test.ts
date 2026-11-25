import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore, SHARED_TENANT } from "@poppy-lab/pap-company";
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
    const limited = await sign("elena", requested, {
      allowChanges: false,
      allowOffline: false,
    });
    expect(limited.scope).toBe(reads.join(" "));
    const full = await sign("robin", requested, {
      allowChanges: true,
      allowOffline: true,
    });
    expect(full.scope?.split(" ")).toEqual(requested);
  });

  it("enforces route-specific scopes and returns each persona's matching reads", async () => {
    const { sign, call } = await setup();
    const token = await sign("robin", ["accounts:read"]);
    const accounts = await call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(accounts.statusCode).toBe(200);
    expect(accounts.json().customer.name).toBe("Robin Ito");
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
    const token = await sign("elena", all, { allowOffline: true });
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

  it("declines an agent's approval to move money, performs nothing, and takes the customer's own (Operations v3 §6)", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", all, { allowOffline: true });
    const payload = {
      source_account_id: "acc_HLB_A100",
      recipient_id: "rcp_HLB_A501",
      amount_cents: 2500,
      memo: "Coffee for the team",
      idempotency_key: "payment-agent-001",
    };
    const proposed = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      payload,
    );
    const op = operation(proposed);
    const byAgent = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      payload,
      { ...op, approver: "agent" },
    );
    expect(byAgent.statusCode).toBe(403);
    expect(byAgent.json()).toMatchObject({
      error: "approval_declined",
      operation_id: op.operation_id,
      revision: op.revision,
      reason: expect.stringContaining("approve it yourself"),
    });
    // No reason codes, and no new operation (§6).
    expect(byAgent.json()).not.toHaveProperty("operation");
    const before = await call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(before.json().accounts[0].balance_cents).toBe(1284500);
    // The customer's own approval of the same revision performs it.
    const mine = await call(
      token.access_token,
      "POST",
      "/api/account/payments",
      payload,
      op,
    );
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.account.balance_cents).toBe(1282000);
  });

  it("returns meaningful payment and transfer errors before creating an operation", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", all);
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
    const robin = await sign("robin", all);
    const insufficient = await call(
      robin.access_token,
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

  it("answers a stale transfer approval with a new revision after another approved transfer changes the account", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", all);
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
    // The approved terms no longer describe the accounts: nothing moves, and
    // the same operation comes back with a revision for the current balances.
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error).toBe("approval_required");
    const fresh = operation(stale);
    expect(fresh.operation_id).toBe(second.operation_id);
    expect(fresh.revision).not.toBe(second.revision);
    expect(fresh.terms).toMatchObject({
      source_balance_before_cents: 1234500,
      source_balance_after_cents: 1174500,
    });
    const accounts = await call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(accounts.json().accounts).toMatchObject([
      { id: "acc_HLB_A100", balance_cents: 1234500 },
      { id: "acc_HLB_A200", balance_cents: 4300000 },
    ]);
  });

  it("re-proposes a payment on the current balance when its idempotency key is reused after the account changed", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", all);
    const post = (
      url: string,
      payload: Record<string, unknown>,
      approval?: ReturnType<typeof operation>,
    ) => call(token.access_token, "POST", url, payload, approval);
    const payment = {
      source_account_id: "acc_HLB_A100",
      recipient_id: "rcp_HLB_A501",
      amount_cents: 30000,
      memo: "Logo revisions",
      idempotency_key: "payment-reuse-001",
    };
    const transfer = {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_HLB_A200",
      amount_cents: 100000,
      idempotency_key: "payment-reuse-other",
    };
    const first = operation(await post("/api/account/payments", payment));
    expect(first.terms.source_balance_before_cents).toBe(1284500);
    // Another approved transfer changes the account before the approval.
    const other = operation(await post("/api/account/transfers", transfer));
    expect(
      (await post("/api/account/transfers", transfer, other)).statusCode,
    ).toBe(200);
    const again = await post("/api/account/payments", payment);
    expect(again.statusCode).toBe(403);
    const second = operation(again);
    expect(second.operation_id).toBe(first.operation_id);
    expect(second.revision).not.toBe(first.revision);
    // The new revision's terms and summary describe the same, current balance.
    expect(second.terms).toMatchObject({
      source_account_version: Number(first.terms.source_account_version) + 1,
      source_balance_before_cents: 1184500,
      source_balance_after_cents: 1154500,
    });
    expect(second.summary).toContain(
      "Resulting fictional balance USD 11545.00",
    );
    // The key still stands for one request only.
    const conflict = await post("/api/account/payments", {
      ...payment,
      amount_cents: 31000,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("idempotency_conflict");
    // The first revision describes a balance that is gone: nothing is paid.
    const outdated = await post("/api/account/payments", payment, first);
    expect(outdated.statusCode).toBe(403);
    expect(operation(outdated).revision).toBe(second.revision);
    const approved = await post("/api/account/payments", payment, second);
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.account.balance_cents).toBe(1154500);
    const replay = await post("/api/account/payments", payment, second);
    expect(replay.json()).toEqual(approved.json());
    const accounts = await call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(accounts.json().accounts[0].balance_cents).toBe(1154500);
  });

  it("re-proposes a transfer on the current balances when its idempotency key is reused after the accounts changed", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", all);
    const post = (
      payload: Record<string, unknown>,
      approval?: ReturnType<typeof operation>,
    ) =>
      call(
        token.access_token,
        "POST",
        "/api/account/transfers",
        payload,
        approval,
      );
    const transfer = {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_HLB_A200",
      amount_cents: 30000,
      idempotency_key: "transfer-reuse-001",
    };
    const between = {
      ...transfer,
      amount_cents: 100000,
      idempotency_key: "transfer-reuse-other",
    };
    const first = operation(await post(transfer));
    expect(first.terms.source_balance_before_cents).toBe(1284500);
    const other = operation(await post(between));
    expect((await post(between, other)).statusCode).toBe(200);
    const again = await post(transfer);
    expect(again.statusCode).toBe(403);
    const second = operation(again);
    expect(second.operation_id).toBe(first.operation_id);
    expect(second.revision).not.toBe(first.revision);
    expect(second.terms).toMatchObject({
      source_version: Number(first.terms.source_version) + 1,
      destination_version: Number(first.terms.destination_version) + 1,
      source_balance_before_cents: 1184500,
      source_balance_after_cents: 1154500,
      destination_balance_before_cents: 4350000,
      destination_balance_after_cents: 4380000,
    });
    expect(second.summary).toContain(
      "Operating checking USD 11545.00; Reserve savings USD 43800.00",
    );
    const conflict = await post({ ...transfer, amount_cents: 31000 });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("idempotency_conflict");
    const approved = await post(transfer, second);
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.accounts).toMatchObject([
      { id: "acc_HLB_A100", balance_cents: 1154500 },
      { id: "acc_HLB_A200", balance_cents: 4380000 },
    ]);
    const replay = await post(transfer, second);
    expect(replay.json()).toEqual(approved.json());
    const accounts = await call(
      token.access_token,
      "GET",
      "/api/account/accounts",
    );
    expect(accounts.json().accounts).toMatchObject([
      { id: "acc_HLB_A100", balance_cents: 1154500 },
      { id: "acc_HLB_A200", balance_cents: 4380000 },
    ]);
  });

  it("never performs an idempotency key twice, even after the gateway has forgotten the operation", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", all);
    const post = (
      url: string,
      payload: Record<string, unknown>,
      approval?: ReturnType<typeof operation>,
    ) => call(token.access_token, "POST", url, payload, approval);
    const requests: Array<[string, Record<string, unknown>]> = [
      [
        "/api/account/payments",
        {
          source_account_id: "acc_HLB_A100",
          recipient_id: "rcp_HLB_A501",
          amount_cents: 30000,
          memo: "Logo revisions",
          idempotency_key: "payment-once-001",
        },
      ],
      [
        "/api/account/transfers",
        {
          source_account_id: "acc_HLB_A100",
          destination_account_id: "acc_HLB_A200",
          amount_cents: 100000,
          idempotency_key: "transfer-once-001",
        },
      ],
    ];
    for (const [url, payload] of requests) {
      const op = operation(await post(url, payload));
      expect((await post(url, payload, op)).statusCode).toBe(200);
    }
    // A performed operation is only kept until its revision would expire.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 11 * 60000);
      for (const [url, payload] of requests) {
        const again = await post(url, payload);
        // Not a replay: the gateway treats this as a new operation.
        expect(again.statusCode).toBe(403);
        const repeated = await post(url, payload, operation(again));
        expect(repeated.statusCode).toBe(409);
        expect(repeated.json().error).toBe("account_changed");
      }
      const accounts = await call(
        token.access_token,
        "GET",
        "/api/account/accounts",
      );
      expect(accounts.json().accounts).toMatchObject([
        { id: "acc_HLB_A100", balance_cents: 1154500 },
        { id: "acc_HLB_A200", balance_cents: 4350000 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps nothing of its own for an idempotency key, whether or not the gateway takes the request", async () => {
    const store = memoryStore();
    const { sign, call } = await setup({ store });
    const token = await sign("elena", all);
    const budget = (n: number) =>
      call(token.access_token, "POST", "/api/account/budgets", {
        name: `Harbor trips ${n}`,
        category: "travel",
        limit_cents: 90000,
        month: "2026-12",
        idempotency_key: `budget-fresh-${n}`,
      });
    expect((await budget(0)).statusCode).toBe(403);
    const tenant = store.value.tenants[SHARED_TENANT]!;
    const kept = () => JSON.stringify(tenant.business);
    const before = kept();
    // Fill the gateway's own cap, so it refuses every further key.
    for (let n = 0; Object.keys(tenant.operations).length < 2000; n++)
      tenant.operations[`op_filler_${n}`] = {
        client: "filler",
        user: "filler",
        account: "filler",
        key: `filler:${n}`,
        revisions: [
          {
            revision: "filler",
            summary: "",
            terms: {},
            expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
          },
        ],
      };
    for (let n = 1; n <= 5; n++) {
      const refused = await budget(n);
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error).toBe("too_many_operations");
    }
    expect(kept()).toBe(before);
    expect(Object.keys(tenant.operations)).toHaveLength(2000);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Keys the gateway takes are held in its operations and nowhere else.
      vi.setSystemTime(Date.now() + 11 * 60000);
      for (let n = 6; n <= 10; n++)
        expect((await budget(n)).statusCode).toBe(403);
      expect(Object.keys(tenant.operations)).toHaveLength(5);
      expect(kept()).toBe(before);
      // The operations expire, and nothing of their keys is left behind.
      vi.setSystemTime(Date.now() + 11 * 60000);
      expect((await budget(11)).statusCode).toBe(403);
      expect(Object.keys(tenant.operations)).toHaveLength(1);
      expect(kept()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees an idempotency key when its operation expires unapproved, and keeps one that was performed", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", all);
    const post = (
      payload: Record<string, unknown>,
      approval?: ReturnType<typeof operation>,
    ) =>
      call(
        token.access_token,
        "POST",
        "/api/account/payments",
        payload,
        approval,
      );
    const balance = async () =>
      (await call(token.access_token, "GET", "/api/account/accounts")).json()
        .accounts[0].balance_cents;
    const payment = {
      source_account_id: "acc_HLB_A100",
      recipient_id: "rcp_HLB_A501",
      amount_cents: 30000,
      memo: "Logo revisions",
      idempotency_key: "payment-expire-001",
    };
    const other = { ...payment, amount_cents: 31000 };
    const first = operation(await post(payment));
    // While the operation can be approved, its key stands for that request.
    expect((await post(other)).json().error).toBe("idempotency_conflict");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Nobody approved it: nothing was done under the key, so it is free.
      vi.setSystemTime(Date.now() + 11 * 60000);
      const proposed = await post(other);
      expect(proposed.statusCode).toBe(403);
      const second = operation(proposed);
      expect(second.terms.amount_cents).toBe(31000);
      // Now the key stands for the second request, and only for it.
      expect((await post(payment)).json().error).toBe("idempotency_conflict");
      expect((await post(payment, first)).json().error).toBe(
        "idempotency_conflict",
      );
      expect((await post(other, second)).statusCode).toBe(200);
      expect(await balance()).toBe(1253500);
      // Performed: the payment answers for the key after the gateway forgets.
      vi.setSystemTime(Date.now() + 11 * 60000);
      const conflict = await post(payment);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error).toBe("idempotency_conflict");
      expect(await balance()).toBe(1253500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("freezes and unfreezes active cards while refusing inactive or stale cards", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", all);
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
    const token = await sign("elena", all);
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
    const robin = await sign("robin", all);
    const pending = await call(
      robin.access_token,
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
    const token = await sign("elena", all);
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
    const token = await sign("elena", all);
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
      payload: { account: "elena" },
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

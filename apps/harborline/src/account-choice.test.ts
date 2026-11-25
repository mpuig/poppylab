/**
 * The accounts chosen at consent limit the whole grant: Harborline's own
 * API (reads, payments, transfers, cards, categories) and the Company Agent
 * see and act on only those, as the FDX-shaped API does. Recipients and
 * budgets aren't account-bound. Grants without a choice see every account.
 * Elena has acc_HLB_A100 (checking, with every card and transaction) and
 * acc_HLB_A200 (savings).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { memoryStore, SHARED_TENANT } from "@poppy-lab/pap-company";
import { fdxScopes } from "./scopes.ts";
import { setup } from "./test-harness.ts";

/** Harborline's own scopes, reads and changes, with the FDX clusters. */
const own = [
  "accounts:read",
  "transactions:read",
  "cards:read",
  "recipients:read",
  "budgets:read",
  "cards:write",
  "transactions:write",
  "budgets:write",
  "payments:request",
  "transfers:request",
];
const withFdx = [...own, ...fdxScopes];
type Harness = Awaited<ReturnType<typeof setup>>;
const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("Harborline account choice", () => {
  let h: Harness;
  let store: ReturnType<typeof memoryStore>;
  /** The operations the gateway holds: none proposed means none here. */
  const operations = () =>
    Object.keys(store.value.tenants[SHARED_TENANT]?.operations ?? {});
  beforeEach(async () => {
    store = memoryStore();
    h = await setup({ store });
  });
  /** Signed in as Elena with every scope, sharing only `accounts`. */
  const sharing = async (...accounts: string[]) =>
    (await h.sign("elena", withFdx, { fdxAccounts: accounts })).access_token;
  const read = async (access: string, path: string) => {
    const r = await h.call(access, "GET", path);
    expect(r.statusCode).toBe(200);
    return r.json();
  };

  it("lists only the chosen accounts, their transactions and their cards; recipients and budgets in full", async () => {
    const checking = await sharing("acc_HLB_A100");
    expect(
      ids((await read(checking, "/api/account/accounts")).accounts),
    ).toEqual(["acc_HLB_A100"]);
    expect(
      ids((await read(checking, "/api/account/transactions")).transactions),
    ).toEqual(["txn_HLB_A301", "txn_HLB_A302", "txn_HLB_A303"]);
    expect(ids((await read(checking, "/api/account/cards")).cards)).toEqual([
      "card_HLB_A401",
      "card_HLB_A402",
    ]);

    const savings = await sharing("acc_HLB_A200");
    const accounts = (await read(savings, "/api/account/accounts")).accounts;
    expect(ids(accounts)).toEqual(["acc_HLB_A200"]);
    // The checking account's balance is nowhere in the answer.
    expect(JSON.stringify(accounts)).not.toContain("1284500");
    expect(
      (await read(savings, "/api/account/transactions")).transactions,
    ).toEqual([]);
    expect((await read(savings, "/api/account/cards")).cards).toEqual([]);
    // Not account-bound: the same for every grant.
    expect(
      (await read(savings, "/api/account/recipients")).recipients,
    ).toHaveLength(2);
    expect((await read(savings, "/api/account/budgets")).budgets).toHaveLength(
      2,
    );
  });

  it("refuses a transfer to an unchosen account, and a payment from one, as unknown accounts, proposing nothing", async () => {
    const checking = await sharing("acc_HLB_A100");
    const transfer = await h.call(checking, "POST", "/api/account/transfers", {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_HLB_A200",
      amount_cents: 5000,
      idempotency_key: "choice-transfer-1",
    });
    expect(transfer.statusCode).toBe(404);
    expect(transfer.json()).toEqual({ error: "account_not_found" });
    const unknown = await h.call(checking, "POST", "/api/account/transfers", {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_nope",
      amount_cents: 5000,
      idempotency_key: "choice-transfer-2",
    });
    // The same answer as an account that doesn't exist.
    expect(unknown.json()).toEqual(transfer.json());

    const savings = await sharing("acc_HLB_A200");
    const payment = await h.call(savings, "POST", "/api/account/payments", {
      source_account_id: "acc_HLB_A100",
      recipient_id: "rcp_HLB_A501",
      amount_cents: 1250,
      memo: "Design work",
      idempotency_key: "choice-payment-1",
    });
    expect(payment.statusCode).toBe(404);
    expect(payment.json()).toEqual({ error: "account_not_found" });
    expect(operations()).toEqual([]);

    // A chosen source still proposes as before.
    const allowed = await h.call(checking, "POST", "/api/account/payments", {
      source_account_id: "acc_HLB_A100",
      recipient_id: "rcp_HLB_A501",
      amount_cents: 1250,
      memo: "Design work",
      idempotency_key: "choice-payment-2",
    });
    expect(allowed.statusCode).toBe(403);
    expect(allowed.json().error).toBe("approval_required");
    expect(operations()).toHaveLength(1);
  });

  it("doesn't perform an approval through a grant that didn't choose the account", async () => {
    const everything = await sharing("acc_HLB_A100", "acc_HLB_A200");
    const transfer = {
      source_account_id: "acc_HLB_A100",
      destination_account_id: "acc_HLB_A200",
      amount_cents: 5000,
      idempotency_key: "choice-transfer-3",
    };
    const proposed = await h.call(
      everything,
      "POST",
      "/api/account/transfers",
      transfer,
    );
    expect(proposed.statusCode).toBe(403);
    const checking = await sharing("acc_HLB_A100");
    const approved = await h.call(
      checking,
      "POST",
      "/api/account/transfers",
      transfer,
      proposed.json().operation,
    );
    expect(approved.statusCode).toBe(404);
    expect(approved.json()).toEqual({ error: "account_not_found" });
    expect(
      (await read(everything, "/api/account/accounts")).accounts,
    ).toMatchObject([
      { id: "acc_HLB_A100", balance_cents: 1284500 },
      { id: "acc_HLB_A200", balance_cents: 4250000 },
    ]);
  });

  it("answers a card or transaction of an unchosen account as not found, proposing nothing", async () => {
    const savings = await sharing("acc_HLB_A200");
    const card = await h.call(
      savings,
      "POST",
      "/api/account/cards/card_HLB_A401/status",
      { status: "frozen", expected_version: 1 },
    );
    expect(card.statusCode).toBe(404);
    expect(card.json()).toEqual({ error: "card_not_found" });
    const category = await h.call(
      savings,
      "POST",
      "/api/account/transactions/txn_HLB_A301/category",
      { category: "dining", expected_version: 1 },
    );
    expect(category.statusCode).toBe(404);
    expect(category.json()).toEqual({ error: "transaction_not_found" });
    expect(operations()).toEqual([]);

    // Through a grant that chose checking, both are proposed as before.
    const checking = await sharing("acc_HLB_A100");
    for (const [path, body] of [
      [
        "/api/account/cards/card_HLB_A401/status",
        { status: "frozen", expected_version: 1 },
      ],
      [
        "/api/account/transactions/txn_HLB_A301/category",
        { category: "dining", expected_version: 1 },
      ],
    ] as const)
      expect(
        (await h.call(checking, "POST", path, { ...body })).json().error,
      ).toBe("approval_required");
    expect(operations()).toHaveLength(2);
  });

  it("keeps every account for a sign-in without FDX scopes and for a grant from before the choice", async () => {
    const plain = (await h.sign("elena", own)).access_token;
    expect(ids((await read(plain, "/api/account/accounts")).accounts)).toEqual([
      "acc_HLB_A100",
      "acc_HLB_A200",
    ]);
    expect(Object.values(store.value.grants)[0]).not.toHaveProperty(
      "resources",
    );

    // A grant persisted before accounts were chosen has no resources.
    const chosen = await sharing("acc_HLB_A200");
    const grant = Object.values(store.value.grants).find((item) =>
      item.resources?.includes("acc_HLB_A200"),
    )!;
    delete grant.resources;
    expect(ids((await read(chosen, "/api/account/accounts")).accounts)).toEqual(
      ["acc_HLB_A100", "acc_HLB_A200"],
    );
    expect((await read(chosen, "/api/account/cards")).cards).toHaveLength(2);
    expect(
      (
        await h.call(chosen, "POST", "/api/account/transfers", {
          source_account_id: "acc_HLB_A100",
          destination_account_id: "acc_HLB_A200",
          amount_cents: 5000,
          idempotency_key: "choice-transfer-4",
        })
      ).json().error,
    ).toBe("approval_required");
  });

  describe("the Company Agent", () => {
    let n = 0;
    /** One structured request in a new conversation; the Company's reply. */
    const ask = async (access: string, data: Record<string, unknown>) => {
      const r = await h.call(access, "POST", "/poppy/conversations?wait=0", {
        id: `req_choice_${++n}`,
        message: { author: { type: "agent" }, data },
      });
      expect(r.statusCode).toBe(201);
      const events = r.json().events as Array<{
        type: string;
        message?: {
          role: string;
          data?: Record<string, unknown>;
          extensions?: Record<string, unknown>;
        };
      }>;
      return events.filter((e) => e.message?.role === "company").at(-1)!
        .message!;
    };

    it("sums the cash position of the chosen accounts only", async () => {
      const checking = await sharing("acc_HLB_A100");
      const cash = await ask(checking, { request: "cash_position" });
      expect(cash.data).toMatchObject({ total_available_cents: 1284500 });
      expect(ids(cash.data!.accounts as Array<{ id: string }>)).toEqual([
        "acc_HLB_A100",
      ]);
      // Without a choice, every account, as before.
      const plain = (await h.sign("elena", own)).access_token;
      expect(
        (await ask(plain, { request: "cash_position" })).data,
      ).toMatchObject({ total_available_cents: 5534500 });
    });

    it("summarizes spending and lists cards of the chosen accounts only, and won't freeze another's card", async () => {
      const savings = await sharing("acc_HLB_A200");
      const spending = await ask(savings, { request: "spending_summary" });
      expect(spending.data!.spending_by_category_cents).toEqual({});
      expect(spending.data!.budgets).toHaveLength(2);
      expect(
        (await ask(savings, { request: "card_status" })).data!.cards,
      ).toEqual([]);
      const freeze = await ask(savings, {
        request: "freeze_card",
        card_id: "card_HLB_A401",
      });
      expect(freeze.data).toEqual({ error: "card_not_found" });
      expect(freeze.extensions).toBeUndefined();
      expect(operations()).toEqual([]);

      const checking = await sharing("acc_HLB_A100");
      expect(
        (await ask(checking, { request: "spending_summary" })).data!
          .spending_by_category_cents,
      ).toEqual({ groceries: 8642, software: 2400 });
    });
  });
});

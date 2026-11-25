/**
 * Harborline Bank: a fully fictional PAP 1.0 banking Company. It exposes
 * balances, transactions, cards, recipients and budgets, with every change
 * held behind Operations v3 approval. No real money or banking data exists.
 */
import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import type {
  CompanyDefinition,
  ConversationHandler,
  FeedbackReport,
  Gate,
  GrantAccess,
  OperationRecord,
  Session,
} from "@poppy-lab/pap-company";
import {
  bankPersona,
  categories,
  customers,
  FICTION_NOTICE,
  usd,
  type Account,
  type Budget,
  type Card,
  type Category,
  type CustomerSeed,
  type Recipient,
  type Transaction,
} from "./data.ts";
import { consentPage, forAgentsPage, homePage, pageHeaders } from "./site.ts";
import { mountPortal } from "./portal.ts";
import { harborlineAgent } from "./agent.ts";
import { scopes, type HarborlineScope } from "./scopes.ts";

/**
 * Harborline moves money only on the customer's own approval (Operations v3
 * §6, "Declining"): an agent approval, even on a standing instruction the
 * customer gave their agent, is declined with the reason and a way to do it.
 */
const ownApprovalForMoney = (approval: { approver: string }) =>
  approval.approver === "agent"
    ? {
        reason:
          "Harborline moves money only when you approve it yourself. Your agent's standing instruction can't approve payments or transfers here.",
        alternative: {
          instructions:
            "Approve this exact payment or transfer yourself in your agent.",
        },
      }
    : undefined;

export { bankPersona, categories, customers } from "./data.ts";
export { scopes, type HarborlineScope } from "./scopes.ts";

export type Payment = {
  id: string;
  source_account_id: string;
  recipient_id: string;
  amount_cents: number;
  memo: string;
  created_at: string;
};
export type Transfer = {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  amount_cents: number;
  created_at: string;
};
export type CustomerState = {
  id: string;
  name: string;
  email: string;
  accounts: Account[];
  transactions: Transaction[];
  cards: Card[];
  recipients: Recipient[];
  budgets: Budget[];
  payments: Payment[];
  transfers: Transfer[];
};
type State = {
  customers?: Record<string, CustomerState>;
  /** What older versions kept for every key ever sent; no longer used. */
  idempotency?: unknown;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number) =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.length <= max
    ? value.trim()
    : undefined;
const idempotencyKey = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value)
    ? value
    : undefined;
const category = (value: unknown): Category | undefined =>
  categories.includes(value as Category) ? (value as Category) : undefined;
const cloneCustomer = (seed: CustomerSeed): CustomerState => ({
  id: seed.id,
  name: seed.name,
  email: seed.email,
  accounts: seed.accounts.map((item) => ({ ...item })),
  transactions: seed.transactions.map((item) => ({ ...item })),
  cards: seed.cards.map((item) => ({ ...item })),
  recipients: seed.recipients.map((item) => ({ ...item })),
  budgets: seed.budgets.map((item) => ({ ...item })),
  payments: [],
  transfers: [],
});
/** Whether a stored record or an operation's terms carry this request. */
const sameRequest = (
  made: Record<string, unknown>,
  request: Record<string, unknown>,
) => Object.entries(request).every(([name, value]) => made[name] === value);
const generatedId = (prefix: string, key: string) =>
  `${prefix}_${createHash("sha256").update(key).digest("base64url").slice(0, 14)}`;
const accountView = (account: Account) => ({
  ...account,
  currency: "USD",
  note: FICTION_NOTICE,
});
const transactionView = (transaction: Transaction) => ({
  ...transaction,
  currency: "USD",
  note: FICTION_NOTICE,
});
const cardView = (card: Card) => ({ ...card, note: FICTION_NOTICE });
const recipientView = (recipient: Recipient) => ({
  ...recipient,
  note: FICTION_NOTICE,
});
const budgetView = (budget: Budget) => ({
  ...budget,
  currency: "USD",
  remaining_cents: budget.limit_cents - budget.spent_cents,
  note: FICTION_NOTICE,
});

const response = (description: string) => ({ description });
const auth = (required: HarborlineScope[]) => ({
  "x-poppy-scopes": required,
  security: [{ dpop: required }],
});
const idParameter = (name: string, description: string) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", maxLength: 80 },
});
const cents = {
  type: "integer",
  minimum: 1,
  maximum: 1000000,
  description: "Whole USD cents. For example, 1250 means USD 12.50.",
};
const idempotencySchema = {
  type: "string",
  minLength: 8,
  maxLength: 80,
  pattern: "^[A-Za-z0-9_-]+$",
  description:
    "A caller-generated stable key for this intended change. Reusing it with different terms returns idempotency_conflict; replaying the same approved request returns the first result.",
};
const operationResponses = {
  "200": response("Performed once after exact Operations v3 approval"),
  "400": response("Invalid request body"),
  "403": response(
    "approval_required with exact terms, or insufficient_scope/extension_required",
  ),
  "409": response(
    "Stale account state, inactive resource, insufficient funds, or idempotency conflict",
  ),
  "422": response(
    "A declared payment, transfer, card, or budget limit was exceeded",
  ),
};

export const bankPaths: Record<string, unknown> = {
  "/api/account/accounts": {
    get: {
      operationId: "accounts",
      summary:
        "List the fictional customer's owned checking and savings accounts with current and available balances. Read this before proposing a payment or transfer.",
      ...auth(["accounts:read"]),
      responses: { "200": response("Owned accounts and balances") },
    },
  },
  "/api/account/transactions": {
    get: {
      operationId: "transactions",
      summary:
        "List recent fictional transactions, including signed USD-cent amounts, posted/pending status, category and entity version. Positive amounts are credits; negative amounts are debits.",
      ...auth(["transactions:read"]),
      responses: { "200": response("Recent transactions") },
    },
  },
  "/api/account/cards": {
    get: {
      operationId: "cards",
      summary:
        "List fictional cards, their active/frozen/inactive status, linked account, last four digits, daily limit, today's simulated spend and version.",
      ...auth(["cards:read"]),
      responses: { "200": response("Cards") },
    },
  },
  "/api/account/recipients": {
    get: {
      operationId: "recipients",
      summary:
        "List existing fictional payment recipients. A payment can only target an active recipient returned here and cannot create or edit a recipient.",
      ...auth(["recipients:read"]),
      responses: { "200": response("Existing recipients") },
    },
  },
  "/api/account/budgets": {
    get: {
      operationId: "budgets",
      summary:
        "List fictional monthly category budgets with limits, simulated spend, remaining amount and version.",
      ...auth(["budgets:read"]),
      responses: { "200": response("Budgets") },
    },
    post: {
      operationId: "create_budget",
      summary:
        "Propose creating a fictional monthly category budget. Requires exact Operations v3 approval and a stable idempotency key. It does not reserve or move money.",
      ...auth(["budgets:read", "budgets:write"]),
      "x-poppy-proposal": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: [
                "name",
                "category",
                "limit_cents",
                "month",
                "idempotency_key",
              ],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 60 },
                category: { type: "string", enum: categories },
                limit_cents: cents,
                month: {
                  type: "string",
                  pattern: "^20[0-9]{2}-(0[1-9]|1[0-2])$",
                },
                idempotency_key: idempotencySchema,
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: operationResponses,
    },
  },
  "/api/account/budgets/{budget_id}": {
    post: {
      operationId: "update_budget",
      summary:
        "Propose changing a fictional budget name or limit. Read budgets first and send expected_version; approval becomes stale if the budget changes.",
      ...auth(["budgets:read", "budgets:write"]),
      "x-poppy-proposal": true,
      parameters: [idParameter("budget_id", "Budget ID from budgets")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["expected_version"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 60 },
                limit_cents: cents,
                expected_version: { type: "integer", minimum: 1 },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: operationResponses,
    },
  },
  "/api/account/payments": {
    post: {
      operationId: "request_payment",
      summary:
        "Propose one outgoing fictional payment from an owned active account to an existing active recipient. Read accounts and recipients first. The exact recipient, amount, memo and resulting balance require Operations v3 approval; no real money moves.",
      ...auth(["accounts:read", "recipients:read", "payments:request"]),
      "x-poppy-proposal": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: [
                "source_account_id",
                "recipient_id",
                "amount_cents",
                "memo",
                "idempotency_key",
              ],
              properties: {
                source_account_id: { type: "string", maxLength: 80 },
                recipient_id: { type: "string", maxLength: 80 },
                amount_cents: cents,
                memo: { type: "string", minLength: 1, maxLength: 120 },
                idempotency_key: idempotencySchema,
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: operationResponses,
    },
  },
  "/api/account/transfers": {
    post: {
      operationId: "transfer_between_accounts",
      summary:
        "Propose moving fictional funds between two different owned active accounts. Read accounts first. Transfers are capped at USD 2,500.00 and require exact Operations v3 approval.",
      ...auth(["accounts:read", "transfers:request"]),
      "x-poppy-proposal": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: [
                "source_account_id",
                "destination_account_id",
                "amount_cents",
                "idempotency_key",
              ],
              properties: {
                source_account_id: { type: "string", maxLength: 80 },
                destination_account_id: { type: "string", maxLength: 80 },
                amount_cents: cents,
                idempotency_key: idempotencySchema,
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: operationResponses,
    },
  },
  "/api/account/cards/{card_id}/status": {
    post: {
      operationId: "set_card_status",
      summary:
        "Propose freezing or unfreezing an active fictional card. Read cards first and send expected_version. Inactive cards cannot be changed.",
      ...auth(["cards:read", "cards:write"]),
      "x-poppy-proposal": true,
      parameters: [idParameter("card_id", "Card ID from cards")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status", "expected_version"],
              properties: {
                status: { type: "string", enum: ["active", "frozen"] },
                expected_version: { type: "integer", minimum: 1 },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: operationResponses,
    },
  },
  "/api/account/transactions/{transaction_id}/category": {
    post: {
      operationId: "edit_transaction_category",
      summary:
        "Propose changing the category of a posted fictional transaction. Read transactions first and send expected_version. Pending transactions cannot be recategorized.",
      ...auth(["transactions:read", "transactions:write"]),
      "x-poppy-proposal": true,
      parameters: [
        idParameter("transaction_id", "Transaction ID from transactions"),
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["category", "expected_version"],
              properties: {
                category: { type: "string", enum: categories },
                expected_version: { type: "integer", minimum: 1 },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: operationResponses,
    },
  },
};

const routeScopes = ({
  path,
  method,
}: {
  path: string;
  method: string;
}): string[] => {
  if (method === "GET") {
    if (path.endsWith("/accounts")) return ["accounts:read"];
    if (path.endsWith("/transactions")) return ["transactions:read"];
    if (path.endsWith("/cards")) return ["cards:read"];
    if (path.endsWith("/recipients")) return ["recipients:read"];
    if (path.endsWith("/budgets")) return ["budgets:read"];
  }
  if (path.endsWith("/payments"))
    return ["accounts:read", "recipients:read", "payments:request"];
  if (path.endsWith("/transfers"))
    return ["accounts:read", "transfers:request"];
  if (/\/cards\/[^/]+\/status$/.test(path))
    return ["cards:read", "cards:write"];
  if (/\/transactions\/[^/]+\/category$/.test(path))
    return ["transactions:read", "transactions:write"];
  if (/\/budgets(?:\/[^/]+)?$/.test(path))
    return ["budgets:read", "budgets:write"];
  return ["accounts:read"];
};

function mount(
  app: Hono,
  ctx: {
    sessionFor: (c: Context) => Session;
    state: Record<string, unknown>;
    gate: Gate;
    grants: GrantAccess;
    origin: string;
    operations: () => Readonly<Record<string, OperationRecord>>;
    converse: (handler: ConversationHandler) => void;
    feedback: () => readonly FeedbackReport[];
  },
) {
  const state = ctx.state as State;
  const customerStates = (state.customers ??= {});
  // Keys are no longer kept here (see reservedForAnother): shed the old ones.
  delete state.idempotency;
  const customerFor = (id: string) => {
    const seed = bankPersona(id) ?? customers[0]!;
    return (customerStates[id] ??= cloneCustomer(seed));
  };
  const customerOf = (session: Session) =>
    customerFor(session.account ?? "elena");
  /**
   * An idempotency key stands for one request, and the gateway's operation
   * for the key is the reservation: while it can still be approved, a
   * different request under the key is refused. Nothing is kept here, so a
   * key costs what its operation costs and goes when the gateway forgets it.
   * A forgotten operation that nobody approved did nothing, so its key is
   * free and a different request under it is a new proposal. A key that was
   * performed is answered by the payment, transfer or budget it made.
   */
  const reservedForAnother = (
    customer: CustomerState,
    action: string,
    request: Record<string, unknown>,
  ) =>
    Object.values(ctx.operations()).some(
      (record) =>
        record.account === customer.id &&
        record.key === action &&
        record.revisions.some(
          (revision) =>
            Date.parse(revision.expires_at) > Date.now() &&
            !sameRequest(revision.terms, request),
        ),
    );
  const findAccount = (customer: CustomerState, id: string) =>
    customer.accounts.find((item) => item.id === id);
  const addTransaction = (
    customer: CustomerState,
    account: Account,
    description: string,
    amount: number,
    categoryValue: Category,
    key: string,
  ) => {
    const transaction: Transaction = {
      id: generatedId("txn_HLB", `${customer.id}:${key}`),
      account_id: account.id,
      description,
      amount_cents: amount,
      category: categoryValue,
      status: "posted",
      occurred_at: new Date().toISOString(),
      version: 1,
    };
    customer.transactions.unshift(transaction);
    return transaction;
  };

  mountPortal(app, ctx, { customerFor });
  ctx.converse(harborlineAgent({ customerFor }));

  app.get("/api/account/accounts", (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    return c.json({
      customer: { id: customer.id, name: customer.name },
      currency: "USD",
      accounts: customer.accounts.map(accountView),
      note: FICTION_NOTICE,
    });
  });
  app.get("/api/account/transactions", (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    return c.json({
      transactions: customer.transactions.map(transactionView),
      note: FICTION_NOTICE,
    });
  });
  app.get("/api/account/cards", (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    return c.json({
      cards: customer.cards.map(cardView),
      note: FICTION_NOTICE,
    });
  });
  app.get("/api/account/recipients", (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    return c.json({
      recipients: customer.recipients.map(recipientView),
      note: FICTION_NOTICE,
    });
  });
  app.get("/api/account/budgets", (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    return c.json({
      budgets: customer.budgets.map(budgetView),
      note: FICTION_NOTICE,
    });
  });

  app.post("/api/account/payments", async (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            "source_account_id",
            "recipient_id",
            "amount_cents",
            "memo",
            "idempotency_key",
          ].includes(key),
      )
    )
      return c.json({ error: "invalid_payment" }, 400);
    const amount = integer(body.amount_cents, 1, 1000000),
      memo = text(body.memo, 120),
      key = idempotencyKey(body.idempotency_key),
      source = findAccount(customer, String(body.source_account_id)),
      recipient = customer.recipients.find(
        (item) => item.id === body.recipient_id,
      );
    if (!amount || !memo || !key)
      return c.json({ error: "invalid_payment" }, 400);
    if (!source) return c.json({ error: "account_not_found" }, 404);
    if (!recipient) return c.json({ error: "recipient_not_found" }, 404);
    const request = {
      source_account_id: source.id,
      recipient_id: recipient.id,
      amount_cents: amount,
      memo,
    };
    const id = generatedId("pay_HLB", `${customer.id}:${key}`);
    const result = (payment: Payment) => ({
      summary: `Sent ${usd(payment.amount_cents)} to ${recipient.name}. Fictional only; no real money moved.`,
      data: { payment, account: accountView(source) },
    });
    // A key that has paid is answered by its payment, before anything is
    // asked of the account as it is now: the same request gets the first
    // result again, with the account as it stands, and no new approval.
    const paid = customer.payments.find((item) => item.id === id);
    if (paid)
      return sameRequest(paid, request)
        ? c.json(result(paid))
        : c.json({ error: "idempotency_conflict" }, 409);
    if (source.status !== "active")
      return c.json({ error: "account_inactive" }, 409);
    if (recipient.status !== "active")
      return c.json({ error: "recipient_inactive" }, 409);
    if (amount > recipient.payment_limit_cents)
      return c.json(
        {
          error: "recipient_limit_exceeded",
          limit_cents: recipient.payment_limit_cents,
        },
        422,
      );
    if (amount > source.available_cents)
      return c.json(
        {
          error: "insufficient_funds",
          available_cents: source.available_cents,
        },
        409,
      );
    if (reservedForAnother(customer, `payment:${key}`, request))
      return c.json({ error: "idempotency_conflict" }, 409);
    // The key reserves the request, not a balance: the terms describe the
    // account as it is now, so a reused key can still be approved.
    const terms = {
      ...request,
      idempotency_key: key,
      source_account_version: source.version,
      source_balance_before_cents: source.balance_cents,
      source_balance_after_cents: source.balance_cents - amount,
      recipient_name: recipient.name,
      recipient_account_last4: recipient.account_last4,
      recipient_version: recipient.version,
      fee_cents: 0,
      currency: "USD",
      execution: "Immediate fictional payment after approval",
      notice: FICTION_NOTICE,
    };
    return ctx.gate(c, {
      key: `payment:${key}`,
      terms,
      decline: ownApprovalForMoney,
      summary: `Send ${usd(amount)} from ${source.name} to ${recipient.name} (account ending ${recipient.account_last4}) for “${memo}”. Fee ${usd(0)}. Resulting fictional balance ${usd(source.balance_cents - amount)}. No real money moves.`,
      // A key that has paid never pays again. A paid key is answered above
      // and shouldn't get here, so this is the last line of defence. The
      // snapshot checks back up the gateway's own comparison of the terms.
      stale: (approved) =>
        customer.payments.some((item) => item.id === id) ||
        source.version !== approved.source_account_version ||
        source.balance_cents !== approved.source_balance_before_cents ||
        recipient.version !== approved.recipient_version ||
        recipient.status !== "active" ||
        source.status !== "active" ||
        source.available_cents < Number(approved.amount_cents),
      perform: (approved) => {
        source.balance_cents -= Number(approved.amount_cents);
        source.available_cents -= Number(approved.amount_cents);
        source.version++;
        const payment: Payment = {
          id,
          source_account_id: source.id,
          recipient_id: recipient.id,
          amount_cents: Number(approved.amount_cents),
          memo: String(approved.memo),
          created_at: new Date().toISOString(),
        };
        customer.payments.push(payment);
        addTransaction(
          customer,
          source,
          `Payment to ${recipient.name}: ${payment.memo}`,
          -payment.amount_cents,
          "transfer",
          `payment:${key}`,
        );
        return result(payment);
      },
    });
  });

  app.post("/api/account/transfers", async (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            "source_account_id",
            "destination_account_id",
            "amount_cents",
            "idempotency_key",
          ].includes(key),
      )
    )
      return c.json({ error: "invalid_transfer" }, 400);
    const amount = integer(body.amount_cents, 1, 1000000),
      key = idempotencyKey(body.idempotency_key),
      source = findAccount(customer, String(body.source_account_id)),
      destination = findAccount(customer, String(body.destination_account_id));
    if (!amount || !key) return c.json({ error: "invalid_transfer" }, 400);
    if (!source || !destination)
      return c.json({ error: "account_not_found" }, 404);
    if (source.id === destination.id)
      return c.json({ error: "same_account" }, 400);
    const request = {
      source_account_id: source.id,
      destination_account_id: destination.id,
      amount_cents: amount,
    };
    const id = generatedId("trf_HLB", `${customer.id}:${key}`);
    const result = (transfer: Transfer) => ({
      summary: `Transferred ${usd(transfer.amount_cents)} from ${source.name} to ${destination.name}. Fictional only; no real money moved.`,
      data: {
        transfer,
        accounts: [accountView(source), accountView(destination)],
      },
    });
    // As for payments: a key that has moved money is answered by its
    // transfer, with the accounts as they stand.
    const made = customer.transfers.find((item) => item.id === id);
    if (made)
      return sameRequest(made, request)
        ? c.json(result(made))
        : c.json({ error: "idempotency_conflict" }, 409);
    if (source.status !== "active" || destination.status !== "active")
      return c.json({ error: "account_inactive" }, 409);
    if (amount > 250000)
      return c.json(
        { error: "transfer_limit_exceeded", limit_cents: 250000 },
        422,
      );
    if (amount > source.available_cents)
      return c.json(
        {
          error: "insufficient_funds",
          available_cents: source.available_cents,
        },
        409,
      );
    if (reservedForAnother(customer, `transfer:${key}`, request))
      return c.json({ error: "idempotency_conflict" }, 409);
    // As for payments: the terms describe the accounts as they are now.
    const terms = {
      ...request,
      idempotency_key: key,
      source_name: source.name,
      destination_name: destination.name,
      source_version: source.version,
      destination_version: destination.version,
      source_balance_before_cents: source.balance_cents,
      source_balance_after_cents: source.balance_cents - amount,
      destination_balance_before_cents: destination.balance_cents,
      destination_balance_after_cents: destination.balance_cents + amount,
      currency: "USD",
      notice: FICTION_NOTICE,
    };
    return ctx.gate(c, {
      key: `transfer:${key}`,
      terms,
      decline: ownApprovalForMoney,
      summary: `Transfer ${usd(amount)} from ${source.name} to ${destination.name}. New fictional balances: ${source.name} ${usd(source.balance_cents - amount)}; ${destination.name} ${usd(destination.balance_cents + amount)}. No real money moves.`,
      // A key that has moved money never moves it again (see payments).
      // It is answered above; this is the last line of defence.
      stale: (approved) =>
        customer.transfers.some((item) => item.id === id) ||
        source.version !== approved.source_version ||
        destination.version !== approved.destination_version ||
        source.balance_cents !== approved.source_balance_before_cents ||
        destination.balance_cents !==
          approved.destination_balance_before_cents ||
        source.status !== "active" ||
        destination.status !== "active" ||
        source.available_cents < Number(approved.amount_cents),
      perform: (approved) => {
        const moved = Number(approved.amount_cents);
        source.balance_cents -= moved;
        source.available_cents -= moved;
        source.version++;
        destination.balance_cents += moved;
        destination.available_cents += moved;
        destination.version++;
        const transfer: Transfer = {
          id,
          source_account_id: source.id,
          destination_account_id: destination.id,
          amount_cents: moved,
          created_at: new Date().toISOString(),
        };
        customer.transfers.push(transfer);
        addTransaction(
          customer,
          source,
          `Transfer to ${destination.name}`,
          -moved,
          "transfer",
          `transfer-out:${key}`,
        );
        addTransaction(
          customer,
          destination,
          `Transfer from ${source.name}`,
          moved,
          "transfer",
          `transfer-in:${key}`,
        );
        return result(transfer);
      },
    });
  });

  app.post("/api/account/cards/:card_id/status", async (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    const card = customer.cards.find(
      (item) => item.id === c.req.param("card_id"),
    );
    if (!card) return c.json({ error: "card_not_found" }, 404);
    if (card.status === "inactive")
      return c.json({ error: "card_inactive" }, 409);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) => !["status", "expected_version"].includes(key),
      ) ||
      !["active", "frozen"].includes(String(body.status)) ||
      !integer(body.expected_version, 1, Number.MAX_SAFE_INTEGER)
    )
      return c.json({ error: "invalid_card_change" }, 400);
    if (body.status === card.status)
      return c.json({ error: `card_already_${card.status}` }, 409);
    if (Number(body.expected_version) !== card.version)
      return c.json({ error: "card_changed" }, 409);
    const next = String(body.status) as "active" | "frozen";
    const terms = {
      card_id: card.id,
      card_last4: card.last4,
      card_label: card.label,
      from_status: card.status,
      to_status: next,
      card_version: card.version,
      notice: FICTION_NOTICE,
    };
    return ctx.gate(c, {
      key: `card:${card.id}:${card.version}:${next}`,
      terms,
      summary: `${next === "frozen" ? "Freeze" : "Unfreeze"} ${card.label} ending ${card.last4}. Current status ${card.status}; new status ${next}. Fictional card only.`,
      stale: (approved) =>
        card.version !== approved.card_version ||
        card.status !== approved.from_status ||
        card.status === "inactive",
      perform: (approved) => {
        card.status = approved.to_status as "active" | "frozen";
        card.version++;
        return {
          summary: `${card.label} ending ${card.last4} is now ${card.status}. Fictional card only.`,
          data: { card: cardView(card) },
        };
      },
    });
  });

  app.post("/api/account/transactions/:transaction_id/category", async (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    const transaction = customer.transactions.find(
      (item) => item.id === c.req.param("transaction_id"),
    );
    if (!transaction) return c.json({ error: "transaction_not_found" }, 404);
    if (transaction.status !== "posted")
      return c.json({ error: "transaction_pending" }, 409);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) => !["category", "expected_version"].includes(key),
      )
    )
      return c.json({ error: "invalid_category_change" }, 400);
    const next = category(body.category),
      expected = integer(body.expected_version, 1, Number.MAX_SAFE_INTEGER);
    if (!next || !expected)
      return c.json({ error: "invalid_category_change" }, 400);
    if (transaction.category === next)
      return c.json({ error: "category_unchanged" }, 409);
    if (transaction.version !== expected)
      return c.json({ error: "transaction_changed" }, 409);
    const terms = {
      transaction_id: transaction.id,
      description: transaction.description,
      amount_cents: transaction.amount_cents,
      currency: "USD",
      from_category: transaction.category,
      to_category: next,
      transaction_version: transaction.version,
      notice: FICTION_NOTICE,
    };
    return ctx.gate(c, {
      key: `transaction:${transaction.id}:${transaction.version}:${next}`,
      terms,
      summary: `Change ${transaction.description} (${usd(Math.abs(transaction.amount_cents))}) from ${transaction.category} to ${next}. Fictional transaction only.`,
      stale: (approved) =>
        transaction.version !== approved.transaction_version ||
        transaction.category !== approved.from_category ||
        transaction.status !== "posted",
      perform: (approved) => {
        transaction.category = approved.to_category as Category;
        transaction.version++;
        return {
          summary: `${transaction.description} is now categorized as ${transaction.category}. Fictional transaction only.`,
          data: { transaction: transactionView(transaction) },
        };
      },
    });
  });

  app.post("/api/account/budgets", async (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            "name",
            "category",
            "limit_cents",
            "month",
            "idempotency_key",
          ].includes(key),
      )
    )
      return c.json({ error: "invalid_budget" }, 400);
    const name = text(body.name, 60),
      nextCategory = category(body.category),
      limit = integer(body.limit_cents, 1, 1000000),
      month =
        typeof body.month === "string" &&
        /^20\d{2}-(0[1-9]|1[0-2])$/.test(body.month)
          ? body.month
          : undefined,
      key = idempotencyKey(body.idempotency_key);
    if (!name || !nextCategory || !limit || !month || !key)
      return c.json({ error: "invalid_budget" }, 400);
    const request = {
      name,
      category: nextCategory,
      limit_cents: limit,
      month,
    };
    const id = generatedId("bdg_HLB", `${customer.id}:${key}`);
    const result = (budget: Budget) => ({
      summary: `Created ${budget.name} with a ${usd(budget.limit_cents)} limit. Fictional budget only.`,
      data: { budget: budgetView(budget) },
    });
    // A key that created a budget is answered with that budget as it is
    // now, and no new approval. A budget changed since it was created no
    // longer shows the name and limit it was created with, so only what
    // can't change is compared then.
    const created = customer.budgets.find((budget) => budget.id === id);
    if (created)
      return sameRequest(
        created,
        created.version > 1 ? { category: nextCategory, month } : request,
      )
        ? c.json(result(created))
        : c.json({ error: "idempotency_conflict" }, 409);
    if (reservedForAnother(customer, `budget-create:${key}`, request))
      return c.json({ error: "idempotency_conflict" }, 409);
    const terms = {
      budget_id: id,
      ...request,
      spent_cents: 0,
      currency: "USD",
      idempotency_key: key,
      notice: FICTION_NOTICE,
    };
    return ctx.gate(c, {
      key: `budget-create:${key}`,
      terms,
      summary: `Create ${name}, a ${month} ${nextCategory} budget with a ${usd(limit)} limit. It tracks fictional spending and moves no money.`,
      stale: () => customer.budgets.some((budget) => budget.id === id),
      perform: (approved) => {
        const budget: Budget = {
          id: String(approved.budget_id),
          name: String(approved.name),
          category: approved.category as Category,
          limit_cents: Number(approved.limit_cents),
          spent_cents: 0,
          month: String(approved.month),
          version: 1,
        };
        customer.budgets.push(budget);
        return result(budget);
      },
    });
  });

  app.post("/api/account/budgets/:budget_id", async (c) => {
    const customer = customerOf(ctx.sessionFor(c));
    const budget = customer.budgets.find(
      (item) => item.id === c.req.param("budget_id"),
    );
    if (!budget) return c.json({ error: "budget_not_found" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) => !["name", "limit_cents", "expected_version"].includes(key),
      )
    )
      return c.json({ error: "invalid_budget" }, 400);
    const expected = integer(body.expected_version, 1, Number.MAX_SAFE_INTEGER),
      name = body.name === undefined ? budget.name : text(body.name, 60),
      limit =
        body.limit_cents === undefined
          ? budget.limit_cents
          : integer(body.limit_cents, 1, 1000000);
    if (!expected || !name || !limit)
      return c.json({ error: "invalid_budget" }, 400);
    if (expected !== budget.version)
      return c.json({ error: "budget_changed" }, 409);
    if (name === budget.name && limit === budget.limit_cents)
      return c.json({ error: "budget_unchanged" }, 409);
    const terms = {
      budget_id: budget.id,
      month: budget.month,
      category: budget.category,
      budget_version: budget.version,
      from_name: budget.name,
      to_name: name,
      from_limit_cents: budget.limit_cents,
      to_limit_cents: limit,
      spent_cents: budget.spent_cents,
      currency: "USD",
      notice: FICTION_NOTICE,
    };
    return ctx.gate(c, {
      key: `budget-update:${budget.id}:${budget.version}`,
      terms,
      summary: `Update ${budget.name}: name becomes ${name}; monthly limit becomes ${usd(limit)} (was ${usd(budget.limit_cents)}; fictional spend ${usd(budget.spent_cents)}). No money moves.`,
      stale: (approved) =>
        budget.version !== approved.budget_version ||
        budget.name !== approved.from_name ||
        budget.limit_cents !== approved.from_limit_cents,
      perform: (approved) => {
        budget.name = String(approved.to_name);
        budget.limit_cents = Number(approved.to_limit_cents);
        budget.version++;
        return {
          summary: `${budget.name} now has a ${usd(budget.limit_cents)} limit. Fictional budget only.`,
          data: { budget: budgetView(budget) },
        };
      },
    });
  });
}

const scopeDescriptions: Record<HarborlineScope, string> = {
  "accounts:read":
    "See owned fictional accounts, balances, available balances and account status. Read only; includes personal financial data.",
  "transactions:read":
    "See recent fictional transaction amounts, descriptions, dates, status and categories. Read only; includes personal financial data.",
  "cards:read":
    "See fictional cards, last four digits, status, limits and linked accounts. Read only; includes personal financial data.",
  "recipients:read":
    "See existing fictional payment recipients and masked destination details. Read only; includes personal financial data.",
  "budgets:read":
    "See fictional monthly budgets, category limits and simulated spending. Read only; includes personal financial data.",
  "cards:write":
    "Freeze or unfreeze a fictional card. Reversible, but every change requires separate approval. Does not include reading cards.",
  "transactions:write":
    "Change a posted fictional transaction's category. Reversible, with separate approval. Does not include reading transactions.",
  "budgets:write":
    "Create or update fictional budgets. Reversible, with separate approval. Does not include reading budgets.",
  "payments:request":
    "Request an outgoing fictional payment to an existing recipient. Irreversible in this demo after approval; no real money moves.",
  "transfers:request":
    "Request a fictional transfer between owned accounts. Treated as irreversible after approval; no real money moves.",
  offline_access:
    "Allow the Personal Agent to refresh this fictional grant while you are away. It does not add data or change permissions.",
};

export const harborline: CompanyDefinition = {
  name: "Harborline Bank",
  readScope: "accounts:read",
  writeScope: "cards:write",
  scopes: [...scopes],
  requiredScopes: routeScopes,
  selectScopes: ({ requested, body }) =>
    requested.filter((scope) => {
      if (scope === "offline_access") return body.allow_offline === "yes";
      const hint = scope.endsWith(":write") || scope.endsWith(":request");
      return !hint || body[`allow_${scope.replace(/[:_]/g, "_")}`] === "yes";
    }),
  consent: consentPage,
  persona: bankPersona,
  defaultAccount: "elena",
  paths: bankPaths,
  mount,
  agent: {
    name: "Harborline's automated account guide",
    handoff: {
      text: "No real banker can join this fictional demo. For protocol questions, inspect the endpoints or return to Poppy Lab.",
      data: { handoff: "unavailable", fictional_company: true },
    },
  },
  discovery: (origin, domain) => ({
    protocol_version: "1.0",
    organization: { name: "Harborline Bank", domain },
    auth: {
      issuer: origin,
      scopes: scopeDescriptions,
      scope_hints: Object.fromEntries(
        scopes.map((scope) => [
          scope,
          {
            changes: scope.endsWith(":request")
              ? "irreversible"
              : scope.endsWith(":write")
                ? "reversible"
                : "none",
            personal_data: scope !== "offline_access",
          },
        ]),
      ),
    },
    apis: [
      {
        type: "openapi",
        url: `${origin}/openapi.json`,
        description:
          "Fictional accounts, balances, transactions, cards, recipients, budgets, payment requests and owned-account transfers",
      },
    ],
    agent: {
      protocols: [
        {
          type: "poppy",
          endpoint: `${origin}/poppy/conversations`,
          description:
            'Harborline\'s deterministic account guide: supported requests, cash position, spending summary, card status, and approval-gated card freezing. Send {"request":"help"} in data.',
        },
      ],
    },
    web: {},
    tasks: { endpoint: `${origin}/poppy/tasks` },
    extensions: { operations: [{ version: "3" }] },
  }),
  excludedTasks: (origin) => [
    {
      task: "Open or close a bank account",
      alternative: {
        instructions:
          "Harborline only exposes the pre-seeded fictional accounts. Account opening and closure are not available through this protocol demo.",
        references: [{ type: "web", url: `${origin}/for-agents` }],
      },
    },
    { task: "Create, edit or verify a payment recipient" },
    { task: "Deposit checks, cash or cryptocurrency" },
    { task: "Dispute a transaction or chargeback" },
    { task: "Export statements or tax documents" },
    {
      task: "Send a payment to a new recipient",
      alternative: {
        instructions:
          "Only active recipients already returned by the recipients API may be used.",
        references: [
          {
            type: "openapi",
            url: `${origin}/openapi.json`,
            operation_id: "recipients",
          },
          {
            type: "openapi",
            url: `${origin}/openapi.json`,
            operation_id: "request_payment",
          },
        ],
      },
    },
  ],
  landing: homePage,
  pages: { "/for-agents": forAgentsPage },
  pageHeaders,
};

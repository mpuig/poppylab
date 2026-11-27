import { beforeEach, describe, expect, it } from "vitest";
import { scopes } from "./scopes.ts";
import { setup } from "./test-harness.ts";

const companyMessages = (body: {
  events: Array<{
    type: string;
    message?: {
      role: string;
      text?: string;
      data?: Record<string, unknown>;
      extensions?: Record<string, unknown>;
    };
  }>;
}) =>
  body.events
    .filter(
      (event) => event.type === "message" && event.message?.role === "company",
    )
    .map((event) => event.message!);

describe("Harborline conversations", () => {
  beforeEach(async () => {
    await setup();
  });

  it("offers deterministic help and authorization events for account requests", async () => {
    const { call } = await setup();
    const help = await call("", "POST", "/poppy/conversations?wait=0", {
      id: "req_help_1",
      message: { author: { type: "agent" }, data: { request: "help" } },
    });
    expect(help.statusCode).toBe(201);
    expect(companyMessages(help.json())[0]?.data?.requests).toHaveLength(4);

    const account = await call("", "POST", "/poppy/conversations?wait=0", {
      id: "req_cash_1",
      message: {
        author: { type: "agent" },
        data: { request: "cash_position" },
      },
    });
    expect(account.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "authorization",
          error: "insufficient_scope",
          scope: "accounts:read",
        }),
      ]),
    );
    expect(companyMessages(account.json()).at(-1)).toMatchObject({
      text: "That needs additional Harborline account access. Sign in or add the listed permissions, then send the request again.",
      data: { error: "sign_in_required", scopes: ["accounts:read"] },
    });
  });

  it("tells a customer signed in without a permission which one is missing, not to sign in", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", ["accounts:read"]);
    const spending = await call(
      token.access_token,
      "POST",
      "/poppy/conversations?wait=0",
      {
        id: "req_spending_reader",
        message: {
          author: { type: "agent" },
          data: { request: "spending_summary" },
        },
      },
    );
    expect(companyMessages(spending.json()).at(-1)).toMatchObject({
      text: "You're signed in, but you haven't allowed this agent to see your transactions or see your budgets. Allow it from your agent, then send the request again.",
      data: {
        error: "insufficient_scope",
        scopes: ["transactions:read", "budgets:read"],
      },
    });
    expect(spending.json().events.at(-1)).toMatchObject({
      type: "authorization",
      scope: "transactions:read budgets:read",
    });
  });

  it("reads cash position and freezes a card only after conversation approval", async () => {
    const { sign, call } = await setup();
    const token = await sign("elena", [...scopes]);
    const cash = await call(
      token.access_token,
      "POST",
      "/poppy/conversations?wait=0",
      {
        id: "req_cash_signed",
        message: {
          author: { type: "agent" },
          data: { request: "cash_position" },
        },
      },
    );
    const cashBody = cash.json();
    expect(companyMessages(cashBody)[0]?.data).toMatchObject({
      total_available_cents: 5534500,
      currency: "USD",
    });
    const conversation = cashBody.conversation_id as string;
    const freeze = await call(
      token.access_token,
      "POST",
      `/poppy/conversations/${conversation}/messages?wait=0`,
      {
        id: "req_freeze_1",
        message: {
          author: { type: "agent" },
          data: { request: "freeze_card", card_id: "card_HLB_A401" },
        },
      },
    );
    const operation = companyMessages(freeze.json()).at(-1)?.extensions
      ?.operations as {
      operation: { operation_id: string; revision: string };
    };
    expect(operation.operation.operation_id).toMatch(/^op_/);
    const approved = await call(
      token.access_token,
      "POST",
      `/poppy/conversations/${conversation}/messages?wait=0`,
      {
        id: "req_freeze_approval",
        message: {
          author: { type: "human" },
          data: { request: "approve" },
          extensions: {
            operations: {
              approval: {
                ...operation.operation,
                approver: "user",
                approved_at: Math.floor(Date.now() / 1000),
                input_type: "tap",
              },
            },
          },
        },
      },
    );
    expect(companyMessages(approved.json()).at(-1)?.data?.card).toMatchObject({
      id: "card_HLB_A401",
      status: "frozen",
      version: 2,
    });
    const cards = await call(token.access_token, "GET", "/api/account/cards");
    expect(cards.json().cards[0]).toMatchObject({
      status: "frozen",
      version: 2,
    });
  });
});

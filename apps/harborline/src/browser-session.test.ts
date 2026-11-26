/**
 * An agent's browser at Harborline (§6): the suite every Company on the
 * gateway runs, with Harborline's portal, and what is Harborline's own: a
 * grant that shares some accounts shows only those, and the email is read
 * with the FDX-shaped scope alone.
 */
import { expect, it } from "vitest";
import {
  browser,
  browserJoinSuite,
  BROWSER_SCOPE,
  join,
  setup,
} from "@poppy-lab/pap-company/testing";
import { harborline } from "./harborline.ts";

const changes = {
  allow_cards_write: "yes",
  allow_transactions_write: "yes",
  allow_budgets_write: "yes",
  allow_payments_request: "yes",
  allow_transfers_request: "yes",
};

browserJoinSuite({
  company: harborline,
  name: "Harborline",
  account: "elena",
  accountHeader: "x-harborline-account",
  scopes:
    "accounts:read transactions:read cards:read recipients:read budgets:read cards:write transactions:write budgets:write payments:request transfers:request",
  consent: changes,
  parts: [
    {
      name: "Accounts and balances",
      scope: "accounts:read",
      ids: ["accounts"],
      state: { accounts: [] },
    },
    {
      name: "Recent transactions",
      scope: "transactions:read",
      ids: ["transactions"],
      state: { transactions: [] },
    },
    {
      name: "Budgets",
      scope: "budgets:read",
      ids: ["budgets"],
      state: { budgets: [] },
    },
    {
      name: "Cards",
      scope: "cards:read",
      ids: ["cards"],
      state: { cards: [] },
    },
    {
      name: "Recipients",
      scope: "recipients:read",
      ids: ["recipients"],
      state: { recipients: [] },
    },
  ],
  own: ["logout", "access", "activity", "agent-feedback"],
  ownState: ["agents", "activity", "payments", "transfers"],
  writes: [
    ["POST", "/site/login"],
    ["POST", "/site/logout"],
    ["POST", "/site/access/x/revoke"],
  ],
});

it("shows an agent's browser only the accounts its grant shares, and the email with the scope that reads it", async () => {
  const x = await setup({ isolation: "visitor" }, harborline);
  const state = async (scopes: string, consent: Record<string, string>) => {
    const tokens = await x.signIn(`${scopes} ${BROWSER_SCOPE}`, {
      account: "elena",
      allow_browser: "yes",
      ...consent,
    });
    if ("refused" in tokens) throw new Error("refused");
    const b = browser(x);
    await join(x, b, { access: tokens.access_token });
    return (await (await b.get("/site/state")).json()) as {
      customer: { name: string; email: string };
      accounts: Array<{ id: string }>;
      transactions: Array<{ account_id: string }>;
      cards: Array<{ account_id: string }>;
    };
  };
  // Every account, and no email: Harborline's own API doesn't read it.
  const all = await state("accounts:read transactions:read cards:read", {});
  expect(all.accounts.map((a) => a.id)).toEqual([
    "acc_HLB_A100",
    "acc_HLB_A200",
  ]);
  expect(all.customer).toEqual({ name: "Elena Maren", email: "" });
  // A consent that shares one account limits the whole grant to it.
  const one = await state(
    "accounts:read transactions:read cards:read fdx:ACCOUNT_BASIC fdx:CUSTOMER_CONTACT",
    { fdx_account_acc_HLB_A200: "yes" },
  );
  expect(one.accounts.map((a) => a.id)).toEqual(["acc_HLB_A200"]);
  for (const record of [...one.transactions, ...one.cards])
    expect(record.account_id).toBe("acc_HLB_A200");
  expect(one.customer.email).toBe("elena.maren@example.invalid");
});

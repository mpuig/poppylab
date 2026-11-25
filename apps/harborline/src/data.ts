/** Fully fictional Harborline Bank customers and banking records. */
export const categories = [
  "groceries",
  "dining",
  "transport",
  "software",
  "utilities",
  "travel",
  "income",
  "transfer",
  "other",
] as const;
export type Category = (typeof categories)[number];

export type Account = {
  id: string;
  name: string;
  type: "checking" | "savings";
  balance_cents: number;
  available_cents: number;
  status: "active" | "inactive";
  version: number;
};
export type Transaction = {
  id: string;
  account_id: string;
  description: string;
  amount_cents: number;
  category: Category;
  status: "posted" | "pending";
  occurred_at: string;
  version: number;
};
export type Card = {
  id: string;
  account_id: string;
  label: string;
  last4: string;
  status: "active" | "frozen" | "inactive";
  daily_limit_cents: number;
  spent_today_cents: number;
  version: number;
};
export type Recipient = {
  id: string;
  name: string;
  bank_label: string;
  account_last4: string;
  status: "active" | "inactive";
  payment_limit_cents: number;
  version: number;
};
export type Budget = {
  id: string;
  name: string;
  category: Category;
  limit_cents: number;
  spent_cents: number;
  month: string;
  version: number;
};
export type CustomerSeed = {
  id: string;
  name: string;
  email: string;
  accounts: Account[];
  transactions: Transaction[];
  cards: Card[];
  recipients: Recipient[];
  budgets: Budget[];
};

export const customers: readonly CustomerSeed[] = [
  {
    id: "elena",
    name: "Elena Maren",
    email: "elena.maren@example.invalid",
    accounts: [
      {
        id: "acc_HLB_A100",
        name: "Operating checking",
        type: "checking",
        balance_cents: 1284500,
        available_cents: 1284500,
        status: "active",
        version: 1,
      },
      {
        id: "acc_HLB_A200",
        name: "Reserve savings",
        type: "savings",
        balance_cents: 4250000,
        available_cents: 4250000,
        status: "active",
        version: 1,
      },
    ],
    transactions: [
      {
        id: "txn_HLB_A301",
        account_id: "acc_HLB_A100",
        description: "North Pier Grocer",
        amount_cents: -8642,
        category: "groceries",
        status: "posted",
        occurred_at: "2026-11-18T15:42:00.000Z",
        version: 1,
      },
      {
        id: "txn_HLB_A302",
        account_id: "acc_HLB_A100",
        description: "Cloudline Software",
        amount_cents: -2400,
        category: "software",
        status: "posted",
        occurred_at: "2026-11-17T09:10:00.000Z",
        version: 1,
      },
      {
        id: "txn_HLB_A303",
        account_id: "acc_HLB_A100",
        description: "Fictional payroll deposit",
        amount_cents: 325000,
        category: "income",
        status: "posted",
        occurred_at: "2026-11-15T12:00:00.000Z",
        version: 1,
      },
    ],
    cards: [
      {
        id: "card_HLB_A401",
        account_id: "acc_HLB_A100",
        label: "Harborline debit",
        last4: "1842",
        status: "active",
        daily_limit_cents: 200000,
        spent_today_cents: 8642,
        version: 1,
      },
      {
        id: "card_HLB_A402",
        account_id: "acc_HLB_A100",
        label: "Archived virtual card",
        last4: "7009",
        status: "inactive",
        daily_limit_cents: 50000,
        spent_today_cents: 0,
        version: 1,
      },
    ],
    recipients: [
      {
        id: "rcp_HLB_A501",
        name: "Beacon Studio LLC",
        bank_label: "North Coast Credit (fictional)",
        account_last4: "4410",
        status: "active",
        payment_limit_cents: 500000,
        version: 1,
      },
      {
        id: "rcp_HLB_A502",
        name: "Old Wharf Storage",
        bank_label: "Harbor Mutual (fictional)",
        account_last4: "9902",
        status: "inactive",
        payment_limit_cents: 100000,
        version: 1,
      },
    ],
    budgets: [
      {
        id: "bdg_HLB_A601",
        name: "Meals out",
        category: "dining",
        limit_cents: 45000,
        spent_cents: 18650,
        month: "2026-11",
        version: 1,
      },
      {
        id: "bdg_HLB_A602",
        name: "Software",
        category: "software",
        limit_cents: 20000,
        spent_cents: 2400,
        month: "2026-11",
        version: 1,
      },
    ],
  },
  {
    id: "robin",
    name: "Robin Ito",
    email: "robin.ito@example.invalid",
    accounts: [
      {
        id: "acc_HLB_J100",
        name: "Everyday checking",
        type: "checking",
        balance_cents: 382740,
        available_cents: 382740,
        status: "active",
        version: 1,
      },
      {
        id: "acc_HLB_J200",
        name: "Rainy day savings",
        type: "savings",
        balance_cents: 1600000,
        available_cents: 1600000,
        status: "active",
        version: 1,
      },
    ],
    transactions: [
      {
        id: "txn_HLB_J301",
        account_id: "acc_HLB_J100",
        description: "Sound Ferry Transit",
        amount_cents: -1875,
        category: "transport",
        status: "posted",
        occurred_at: "2026-11-19T08:15:00.000Z",
        version: 1,
      },
      {
        id: "txn_HLB_J302",
        account_id: "acc_HLB_J100",
        description: "Harbor Light Electric",
        amount_cents: -9230,
        category: "utilities",
        status: "pending",
        occurred_at: "2026-11-18T17:30:00.000Z",
        version: 1,
      },
    ],
    cards: [
      {
        id: "card_HLB_J401",
        account_id: "acc_HLB_J100",
        label: "Harborline debit",
        last4: "6215",
        status: "frozen",
        daily_limit_cents: 150000,
        spent_today_cents: 1875,
        version: 2,
      },
    ],
    recipients: [
      {
        id: "rcp_HLB_J501",
        name: "Morrow Workshop",
        bank_label: "Rain City Bank (fictional)",
        account_last4: "3088",
        status: "active",
        payment_limit_cents: 500000,
        version: 1,
      },
    ],
    budgets: [
      {
        id: "bdg_HLB_J601",
        name: "Local travel",
        category: "transport",
        limit_cents: 18000,
        spent_cents: 7350,
        month: "2026-11",
        version: 1,
      },
    ],
  },
] as const;

export const bankPersona = (id: unknown) =>
  customers.find((customer) => customer.id === id);
export const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
export const FICTION_NOTICE =
  "Fictional Harborline Bank data. No real money moves; never enter real banking data or credentials.";

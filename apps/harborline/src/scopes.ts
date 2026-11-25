export const scopes = [
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
  "offline_access",
] as const;
export type HarborlineScope = (typeof scopes)[number];

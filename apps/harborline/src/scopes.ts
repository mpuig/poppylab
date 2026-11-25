/**
 * FDX-shaped data clusters (`poppylab.dev/fdx`), all read only. Separate
 * from Harborline's own read scopes: a sign-in may ask for both kinds.
 */
export const fdxScopes = [
  "fdx:ACCOUNT_BASIC",
  "fdx:ACCOUNT_DETAILED",
  "fdx:TRANSACTIONS",
  "fdx:STATEMENTS",
  "fdx:CUSTOMER_CONTACT",
] as const;
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
  ...fdxScopes,
  "offline_access",
] as const;
export type HarborlineScope = (typeof scopes)[number];
export const isFdxScope = (scope: string) => scope.startsWith("fdx:");

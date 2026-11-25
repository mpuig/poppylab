/**
 * Fernwick's scopes: its own API's, and the ESPI-shaped API's (Poppy
 * scopes, not ESPI's `FB=…` strings: the function blocks each one covers
 * are named in its description).
 */
export const espiScopes = [
  "espi:usage",
  "espi:summary",
  "espi:customer",
] as const;
export const scopes = [
  "account:read",
  "plan:write",
  ...espiScopes,
  "offline_access",
] as const;
export type FernwickScope = (typeof scopes)[number];
export const isEspiScope = (scope: string) => scope.startsWith("espi:");
/** Scopes that read or change a meter: their grants carry the meters chosen. */
export const meterScopes: readonly string[] = [
  "account:read",
  "plan:write",
  "espi:usage",
  "espi:summary",
];

export const scopeDescriptions: Record<FernwickScope, string> = {
  "account:read":
    "Fernwick's own API: see the service address, the meters you choose at consent with their rate plans, and their monthly bills. Needed for the plan change. Read only; includes personal data.",
  "plan:write":
    "Fernwick's own API: propose switching a chosen meter between the flat and time-of-use plans from the next bill cycle. Each change needs separate approval of its exact terms and can be switched back. Does not include reading the account.",
  "espi:usage":
    "ESPI-shaped API (modelled on NAESB REQ.21 ESPI, not certified): see the meters (UsagePoints) you choose at consent, their meter readings and reading types, hourly interval data with its cost, and local time parameters. Covers function blocks 1, 3, 4, 5, 12 and 13: common usage data, third-party access over OAuth, interval metering, hourly electricity, the cost of each interval, and the security and privacy rules. Read only; includes personal data.",
  "espi:summary":
    "ESPI-shaped API (not certified): see the monthly bill summaries (UsageSummary) of the meters you choose, with consumption, line items and costs. Covers function blocks 15 and 16: usage summaries, with cost. Read only; includes personal data.",
  "espi:customer":
    "ESPI-shaped API (not certified): see the customer's name and service address (RetailCustomer). Covers function blocks 51, 53, 54 and 55: common customer data, third-party access to it, basic customer data and the address. Read only; includes personal data.",
  offline_access:
    "Allow the Personal Agent to refresh this fictional grant while you are away, for up to 7 days. Without it, the grant ends with its first access token, after 1 hour. It does not add data or change permissions.",
};

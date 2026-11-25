import { it, expect } from "vitest";
import {
  canChange,
  canRequestChanges,
  consentScopes,
  grantedSubset,
  consentOutcome,
  missingFdxScopes,
} from "./account-permissions";
import type { CompanyProfile } from "@poppy-lab/pap-core";
const profile: CompanyProfile = {
  version: "1.0",
  identifier: "https://food.papsandbox.com",
  issuer: "https://food.papsandbox.com",
  signIn: { direct: true, device: true },
  scopes: ["orders:read", "orders:write", "addresses"],
  scopeDescriptions: {},
  operations: true,
  scopeHints: {
    "orders:read": { changes: "none", personal_data: true },
    "orders:write": { changes: "irreversible", personal_data: true },
  },
};
import { accountRecovery } from "./account-recovery";
import { ProtocolError } from "@poppy-lab/pap-client";
it("does not mistake the previous signed-in account for a successful expanded consent", () => {
  expect(
    consentOutcome({ signedIn: true, authPending: true, consentVersion: 1 }, 1),
  ).toBe("pending");
  expect(
    consentOutcome(
      { signedIn: true, authPending: false, consentVersion: 1 },
      1,
    ),
  ).toBe("not_completed");
  expect(
    consentOutcome(
      { signedIn: true, authPending: false, consentVersion: 2 },
      1,
    ),
  ).toBe("completed");
});
it("chooses least privilege from the Company's scopes and hints", () => {
  expect(consentScopes(profile)).toBe("orders:read");
  expect(consentScopes(profile, "write")).toBe(
    "orders:read orders:write addresses",
  );
  for (const input of ["admin", "orders:write", {}, null])
    expect(() => consentScopes(profile, input)).toThrow();
});
it("asks for the FDX-shaped data clusters only with Use FDX on (RFC 9700 §2.3)", () => {
  const bank: CompanyProfile = {
    ...profile,
    scopes: [
      "accounts:read",
      "transfers:request",
      "fdx:ACCOUNT_BASIC",
      "fdx:TRANSACTIONS",
    ],
    scopeHints: {
      "accounts:read": { changes: "none", personal_data: true },
      "transfers:request": { changes: "irreversible", personal_data: true },
      "fdx:ACCOUNT_BASIC": { changes: "none", personal_data: true },
      "fdx:TRANSACTIONS": { changes: "none", personal_data: true },
    },
  };
  // Off: none, though the hints say they change nothing.
  expect(consentScopes(bank)).toBe("accounts:read");
  expect(consentScopes(bank, "write")).toBe("accounts:read transfers:request");
  expect(consentScopes(bank, "read", { fdx: true })).toBe(
    "accounts:read fdx:ACCOUNT_BASIC fdx:TRANSACTIONS",
  );
  expect(consentScopes(bank, "write", { fdx: true })).toBe(
    "accounts:read transfers:request fdx:ACCOUNT_BASIC fdx:TRANSACTIONS",
  );
  expect(missingFdxScopes(bank, "accounts:read fdx:ACCOUNT_BASIC")).toEqual([
    "fdx:TRANSACTIONS",
  ]);
  expect(missingFdxScopes(profile, "orders:read")).toEqual([]);
});
it("never treats a scope without hints as read-only", () => {
  expect(() => consentScopes({ ...profile, scopeHints: {} }, "read")).toThrow(
    "read-only",
  );
  expect(canChange(profile, "addresses")).toBe(true);
  expect(canChange(profile, "orders:read")).toBe(false);
  expect(canRequestChanges(profile, "orders:read")).toBe(true);
  expect(canRequestChanges(profile, "orders:read orders:write addresses")).toBe(
    false,
  );
  expect(() =>
    consentScopes({ ...profile, signIn: { direct: false, device: true } }),
  ).toThrow("Direct");
});
it("rejects missing, duplicate, unknown and elevated returned permissions", () => {
  expect(grantedSubset("poppy:read", "poppy:read poppy:write")).toBe(true);
  for (const value of [
    undefined,
    "",
    "poppy:read poppy:read",
    "poppy:read poppy:write",
    "admin",
  ])
    expect(grantedSubset(value, "poppy:read")).toBe(false);
});
it.each([
  ["insufficient_scope", 403, "permissions"],
  ["invalid_grant", 400, "signin"],
  ["sign_in_required", 403, "signin"],
  ["invalid_token", 401, "signin"],
  ["terms_changed", 409, "status"],
  ["operation_not_found", 404, "status"],
] as const)("offers a specific recovery for %s", (code, status, next) => {
  const result = accountRecovery(new ProtocolError(status, code));
  expect(result?.next).toBe(next);
  expect(result?.error).toBeTruthy();
});
it("never describes an uncertain server failure as revoked access", () => {
  expect(
    accountRecovery(new ProtocolError(500, "invalid_grant")),
  ).toBeUndefined();
  expect(accountRecovery(new Error("secret remote message"))).toBeUndefined();
});

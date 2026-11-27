import { it, expect } from "vitest";
import {
  accountNote,
  canChange,
  canRequestChanges,
  consentScopes,
  grantedSubset,
  consentOutcome,
  missingExtensionScopes,
  missingFdxScopes,
} from "./account-permissions";
import { extensionByKey } from "./domain-extension";
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
it("never asks for the scope that signs a browser in, since Iris doesn't browse", () => {
  // As the lab's Companies advertise it: it changes nothing.
  const browsing: CompanyProfile = {
    ...profile,
    scopes: [...profile.scopes, "poppy:browser-sign-in"],
    scopeHints: {
      ...profile.scopeHints,
      "poppy:browser-sign-in": { changes: "none", personal_data: true },
    },
  };
  expect(consentScopes(browsing)).toBe("orders:read");
  expect(consentScopes(browsing, "write")).toBe(
    "orders:read orders:write addresses",
  );
  // Without hints it is neither asked for nor counted as a change left to
  // ask for.
  const unhinted = { ...browsing, scopeHints: profile.scopeHints };
  expect(consentScopes(unhinted, "write")).toBe(
    "orders:read orders:write addresses",
  );
  expect(
    canRequestChanges(unhinted, "orders:read orders:write addresses"),
  ).toBe(false);
  // Alone, it isn't a reason to sign in.
  expect(() =>
    consentScopes({ ...browsing, scopes: ["poppy:browser-sign-in"] }),
  ).toThrow("read-only");
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
it("asks for the ESPI-shaped scopes its tools use only with Use ESPI on, never espi:customer", () => {
  const utility: CompanyProfile = {
    ...profile,
    scopes: [
      "account:read",
      "plan:write",
      "espi:usage",
      "espi:summary",
      "espi:customer",
      "fdx:ACCOUNT_BASIC",
    ],
    scopeHints: {
      "account:read": { changes: "none", personal_data: true },
      "plan:write": { changes: "reversible", personal_data: true },
      "espi:usage": { changes: "none", personal_data: true },
      "espi:summary": { changes: "none", personal_data: true },
      "espi:customer": { changes: "none", personal_data: true },
      "fdx:ACCOUNT_BASIC": { changes: "none", personal_data: true },
    },
  };
  expect(consentScopes(utility)).toBe("account:read");
  expect(consentScopes(utility, "read", { espi: true })).toBe(
    "account:read espi:usage espi:summary",
  );
  expect(consentScopes(utility, "write", { espi: true })).toBe(
    "account:read plan:write espi:usage espi:summary",
  );
  // Each extension's scopes go with its own setting only.
  expect(consentScopes(utility, "read", { fdx: true })).toBe(
    "account:read fdx:ACCOUNT_BASIC",
  );
  const espi = extensionByKey("espi")!;
  expect(
    missingExtensionScopes(utility, "account:read espi:usage", espi),
  ).toEqual(["espi:summary"]);
  expect(
    missingExtensionScopes(
      utility,
      "account:read espi:usage espi:summary",
      espi,
    ),
  ).toEqual([]);
});

it("tells the model a signed-in user is signed in, and that a missing permission is asked for with Request change permission", () => {
  const note = (signedIn: boolean, granted = "", lost = false) =>
    accountNote("Lantern", { signedIn, lost, granted, profile });
  const readOnly = note(true, "orders:read");
  expect(readOnly).toBe(
    "Account note: the user is signed in at Lantern, with these permissions: orders:read. Never ask them to sign in. They don't include proposing changes: when a request needs that, tell the user this permission is missing and that they can choose Request change permission in the chat.",
  );
  expect(note(true, "orders:read orders:write")).toBe(
    "Account note: the user is signed in at Lantern, with these permissions: orders:read, orders:write. Never ask them to sign in. They include proposing changes.",
  );
  // Only with no sign-in, or one the Company no longer takes, is signing
  // in what the user does.
  expect(note(false)).toContain("the user is not signed in at Lantern");
  expect(note(true, "orders:read", true)).toContain(
    "Lantern no longer accepts the user's sign-in",
  );
  for (const signedIn of [readOnly, note(true, "orders:read orders:write")])
    expect(signedIn).not.toMatch(/sign_in_required|use the Sign in/);
});

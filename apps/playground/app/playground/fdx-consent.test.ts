import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FdxConsentView, type FdxConsentRecord } from "./fdx-consent";

const html = (
  record: FdxConsentRecord | undefined,
  confirming = false,
  disabled = false,
) =>
  renderToStaticMarkup(
    createElement(FdxConsentView, {
      consentId: "grant_1",
      company: "Harborline Bank",
      record,
      disabled,
      confirming,
      onAsk: () => {},
      onCancel: () => {},
      onRevoke: () => {},
    }),
  );

describe("The FDX consent in the account row", () => {
  it("shows the consent id, then its status, accounts and expiry once read", () => {
    expect(html(undefined)).toContain("<code>grant_1</code>");
    expect(html(undefined)).toContain("Reading its status…");
    const read = html({
      id: "grant_1",
      status: "ACTIVE",
      expirationTime: "2027-01-01T00:00:00Z",
      accounts: ["acc_HLB_A100"],
    });
    expect(read).toContain(
      "ACTIVE · 1 account (acc_HLB_A100) · until Jan 1, 2027",
    );
    expect(html({ id: "grant_1", unavailable: true })).toContain(
      "Status unavailable",
    );
  });

  it("asks in the page before revoking, with a way back", () => {
    const first = html({ id: "grant_1", status: "ACTIVE" });
    expect(first).toContain(">Revoke FDX consent</button>");
    expect(first).not.toContain("Confirm revoke");
    const second = html({ id: "grant_1", status: "ACTIVE" }, true);
    expect(second).toContain(">Confirm revoke</button>");
    expect(second).toContain(">Cancel</button>");
    expect(second).toContain("Harborline Bank ends this consent");
    expect(second).not.toContain(">Revoke FDX consent<");
    // While the page is busy, neither step can be taken.
    expect(
      html({ id: "grant_1" }, true, true).match(/disabled=""/g),
    ).toHaveLength(2);
  });
});

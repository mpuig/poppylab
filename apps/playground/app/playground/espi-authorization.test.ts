import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EspiAuthorizationView,
  type EspiAuthorizationRecord,
} from "./espi-authorization";

const html = (
  record: EspiAuthorizationRecord | undefined,
  confirming = false,
  disabled = false,
) =>
  renderToStaticMarkup(
    createElement(EspiAuthorizationView, {
      authorizationId: "grant_1",
      company: "Fernwick Power & Light",
      record,
      disabled,
      confirming,
      onAsk: () => {},
      onCancel: () => {},
      onRevoke: () => {},
    }),
  );

describe("The ESPI authorization in the account row", () => {
  it("shows the authorization id, then its status, meters and expiry once read", () => {
    expect(html(undefined)).toContain(
      "ESPI authorization <code>grant_1</code>",
    );
    expect(html(undefined)).toContain("Reading its status…");
    expect(
      html({
        id: "grant_1",
        status: "active",
        expiresAt: "2026-12-02T18:00:00Z",
        meters: [{ id: "UP-E2", title: "EV charger" }],
      }),
    ).toContain("active · 1 meter (EV charger) · until Dec 2, 2026");
    expect(
      html({
        id: "grant_1",
        status: "active",
        meters: [{ id: "UP-E1", title: "Home" }, { id: "UP-E2" }],
      }),
    ).toContain("active · 2 meters (Home, UP-E2)");
    // Meters not read (a grant for bills alone): not said.
    expect(html({ id: "grant_1", status: "active" })).toContain(
      '<span class="quiet"> · active</span>',
    );
    expect(html({ id: "grant_1", unavailable: true })).toContain(
      "Status unavailable",
    );
  });

  it("asks in the page before revoking, with a way back", () => {
    const first = html({ id: "grant_1", status: "active" });
    expect(first).toContain(">Revoke ESPI access</button>");
    expect(first).not.toContain("Confirm revoke");
    const second = html({ id: "grant_1", status: "active" }, true);
    expect(second).toContain('aria-label="Revoke ESPI access"');
    expect(second).toContain(">Confirm revoke</button>");
    expect(second).toContain(">Cancel</button>");
    expect(second).toContain(
      "Fernwick Power &amp; Light ends this authorization, its subscription",
    );
    expect(second).not.toContain(">Revoke ESPI access<");
    expect(
      html({ id: "grant_1" }, true, true).match(/disabled=""/g),
    ).toHaveLength(2);
    expect(first + second).not.toMatch(/green button/i);
  });
});

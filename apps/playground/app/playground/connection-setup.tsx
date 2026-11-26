"use client";
import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { ModelSettings } from "../model-settings";
import { labCompany } from "./companies";
import type { Playground } from "./use-playground";

/**
 * Model settings and the connection: one status row before there is a
 * conversation (the Companies bar follows once there is one), and the
 * address form only when it is needed (another Company's address). The
 * lab's own Companies are picked from the cards in the conversation, or
 * from the bar.
 */
export function ConnectionSetup({ p }: { p: Playground }) {
  const { busy, discovering } = p;
  const started = !!p.conversation || !!p.companies.length;
  // An address that isn't one of the cards has to be seen to be sent.
  const form =
    !p.readOnly &&
    (p.addressOpen || (!started && !discovering && !labCompany(p.companyUrl)));
  useEffect(() => {
    if (p.addressOpen) document.getElementById("company-url")?.focus();
  }, [p.addressOpen]);
  return (
    <div className="workspace-setup">
      <ModelSettings onChange={p.configureModel} disabled={busy} />
      {form && (
        <form
          className="setup company-setup"
          onSubmit={p.discover}
          aria-label="Connect to a Company"
        >
          <div className="company-field">
            <label htmlFor="company-url">Company address</label>
            <input
              id="company-url"
              type="url"
              required
              value={p.companyUrl}
              disabled={busy}
              onChange={(event) => p.setCompanyUrl(event.target.value)}
              placeholder="https://company.example"
            />
          </div>
          <button className="connect-button" type="submit" disabled={busy}>
            {discovering ? (
              <>
                <LoaderCircle className="spin" size={15} /> Connecting
              </>
            ) : (
              "Connect"
            )}
          </button>
          {started && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => p.setAddressOpen(false)}
            >
              Cancel
            </button>
          )}
          {started && p.addError && (
            <p className="error-message" role="alert">
              {p.addError}
            </p>
          )}
        </form>
      )}
      {!started && (
        <div className="connection-row">
          {discovering ? (
            <span className="quiet">
              <LoaderCircle className="spin" size={13} /> Connecting to{" "}
              {labCompany(p.companyUrl)?.name ?? "the company"}…
            </span>
          ) : (
            <span className="quiet">Not connected yet.</span>
          )}
          <span className="connection-actions">
            {!form && (
              <button
                type="button"
                className="text-button inspect-link"
                disabled={busy}
                onClick={() => p.setAddressOpen(true)}
              >
                Use another address
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

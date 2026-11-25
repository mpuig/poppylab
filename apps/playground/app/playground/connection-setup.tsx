"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { ModelSettings } from "../model-settings";
import { labCompany } from "./companies";
import type { Playground } from "./use-playground";

/**
 * Model settings and the connection: one status row, and the address form
 * only when it is needed (another Company's address, or changing Company).
 * The lab's own Companies are picked from the cards in the conversation.
 */
export function ConnectionSetup({
  p,
  onInspect,
}: {
  p: Playground;
  onInspect: () => void;
}) {
  const { result, busy, discovering } = p;
  // `connected` implies a result; keep the type in step with the flag.
  const company = p.connected ? result : null;
  const [editing, setEditing] = useState(false);
  // An address that isn't one of the cards has to be seen to be sent.
  const form = editing || (!company && !labCompany(p.companyUrl));
  useEffect(() => {
    if (company) setEditing(false);
  }, [company]);
  useEffect(() => {
    if (editing) document.getElementById("company-url")?.focus();
  }, [editing]);
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
        </form>
      )}
      <div className="connection-row">
        {company ? (
          // What discovery proved: a valid poppy.json at this domain. Account
          // access is shown in the conversation header, not here.
          <span className="connected">
            <span className="quiet">Found</span>{" "}
            {company.document.organization.name}
            <span className="quiet">
              {" "}
              · {company.document.organization.domain} ·{" "}
              {company.document.apis?.length ?? 0}{" "}
              {(company.document.apis?.length ?? 0) === 1 ? "API" : "APIs"} ·{" "}
              {company.document.agent?.protocols.some((p) => p.type === "poppy")
                ? "Company agent · "
                : ""}
              Poppy {company.document.protocol_version}
            </span>
          </span>
        ) : discovering ? (
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
              onClick={() => setEditing(true)}
            >
              {company ? "Change company" : "Use another address"}
            </button>
          )}
          {result && (
            <button
              type="button"
              className="text-button inspect-link"
              onClick={onInspect}
            >
              Inspect connection <ArrowUpRight size={13} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

"use client";
import { ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import { ModelSettings } from "../model-settings";
import { exampleUrl, lanternUrl } from "./companies";
import type { Playground } from "./use-playground";

/** Model settings, the Company URL form and the connection status row. */
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
  const suggest = (url: string) => {
    p.setCompanyUrl(url);
    document.getElementById("company-url")?.focus();
  };
  return (
    <div className="workspace-setup">
      <ModelSettings onChange={p.configureModel} disabled={busy} />
      <form
        className="setup company-setup"
        onSubmit={p.discover}
        aria-label="Connect to a Company"
      >
        <div className="company-field">
          <label htmlFor="company-url">Company URL</label>
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
      <div className="connection-row">
        {company ? (
          <span className="connected">
            <Check size={14} aria-hidden="true" />
            {company.document.organization.name}
            <span className="quiet">
              {" "}
              · {company.document.apis?.length ?? 0}{" "}
              {(company.document.apis?.length ?? 0) === 1 ? "API" : "APIs"} ·{" "}
              {company.document.agent?.protocols.some((p) => p.type === "poppy")
                ? "Company agent · "
                : ""}
              PAP {company.document.protocol_version}
            </span>
          </span>
        ) : (
          <span className="quiet">
            Try{" "}
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => suggest(exampleUrl)}
            >
              Juniper Market
            </button>{" "}
            or{" "}
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => suggest(lanternUrl)}
            >
              Lantern Noodle Bar
            </button>
            , our fictional test companies.
          </span>
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
      </div>
    </div>
  );
}

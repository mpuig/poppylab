"use client";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, Download } from "lucide-react";
import type {
  DiscoveredCompany,
  DiscoveryTraceStep,
} from "@poppy-lab/pap-core";
import {
  discoverySection,
  traceReport,
} from "@poppy-lab/pap-agent/spec-sections";
import { SpecRef } from "../spec-ref";
import {
  clock,
  outcomeLabel,
  traceFileName,
} from "@poppy-lab/pap-agent/protocol-log";
import { CompanyProfileView } from "../company-profile";
import type { PageLine } from "./answers";
import type { CompanyRef } from "./companies";
import { FromCompany } from "./company-mark";
import type { CompanyState, Former } from "./company-state";

/**
 * Discovery steps and API events with their spec sections, and the
 * document. With several Companies, each line names its Company, and a
 * choice of Company shows that one's discovery, lines, profile and
 * document.
 */
export function Inspector({
  companies,
  former,
  chatLog,
  failedTrace,
  companyUrl,
}: {
  companies: CompanyState[];
  former: Former[];
  chatLog: PageLine[];
  /** A discovery that failed, before any Company was connected. */
  failedTrace: DiscoveryTraceStep[];
  companyUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  // Every Company the lines came from: connected, and removed since.
  const known: CompanyRef[] = [
    ...companies,
    ...former.filter((f) => !companies.some((c) => c.origin === f.origin)),
  ];
  const several = known.length > 1;
  const [chosen, setChosen] = useState<string>("all");
  const choice = several ? known.find((c) => c.origin === chosen) : known[0];
  const company = companies.find((c) => c.origin === choice?.origin);
  const result: DiscoveredCompany | null = company?.company ?? null;
  const trace: DiscoveryTraceStep[] = several
    ? (result?.trace ?? [])
    : (result?.trace ?? failedTrace);
  const lines =
    several && choice
      ? chatLog.filter((line) => line.from?.origin === choice.origin)
      : chatLog;
  const all = several && !choice;
  const report = () =>
    traceReport({
      company: all
        ? known.map((c) => c.name).join(", ")
        : (choice?.name ?? companyUrl),
      steps: trace,
      // All of them: each line says which Company it was for.
      events: all
        ? lines.map((line) => ({
            ...line,
            text: `${line.from?.name ?? "Iris"} · ${line.text}`,
          }))
        : lines,
    });
  function download() {
    const url = URL.createObjectURL(
      new Blob([report()], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = traceFileName(
      all ? "companies" : (result?.requestedUrl ?? companyUrl),
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setSaved(true);
  }
  return (
    <section className="inspector" aria-label="Protocol inspector">
      {several && (
        <div
          className="inspector-filter"
          role="group"
          aria-label="Show the protocol of"
        >
          <button
            type="button"
            aria-pressed={all}
            onClick={() => setChosen("all")}
          >
            All companies
          </button>
          {known.map((c) => (
            <button
              type="button"
              key={c.origin}
              aria-pressed={choice?.origin === c.origin}
              onClick={() => setChosen(c.origin)}
            >
              <FromCompany from={c} />
            </button>
          ))}
        </div>
      )}
      {!trace.length && !all && (
        <p className="inspector-empty">
          {choice && !company
            ? `${choice.name} was removed from this conversation. Its lines are listed below.`
            : "Connect to a Company in the playground to inspect its protocol."}
        </p>
      )}
      {(!!trace.length || (several && !!lines.length)) && (
        <>
          <div className="inspector-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(report())
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              <Copy size={14} aria-hidden="true" />{" "}
              {copied ? "Copied" : "Copy trace for an interop report"}
            </button>
            <button type="button" className="text-button" onClick={download}>
              <Download size={14} aria-hidden="true" />{" "}
              {saved ? "Downloaded" : "Download .txt"}
            </button>
            {result && (
              <a
                className="text-button"
                href={`https://poppydemoagent.dev/validator?url=${encodeURIComponent(new URL(result.requestedUrl).host)}`}
                target="_blank"
                rel="noreferrer"
              >
                Check with an independent validator{" "}
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            )}
          </div>
          {!!trace.length && <h2>Discovery</h2>}
          {!!trace.length && (
            <ol className="event-list">
              {trace.map((step, index) => (
                <li key={`${step.id}-${index}`}>
                  <span
                    className={`event-status ${step.status}`}
                    aria-label={step.status}
                  >
                    {step.status === "passed" ? <Check size={14} /> : "—"}
                  </span>
                  <div>
                    <strong>
                      {step.label}
                      <SpecRef
                        className="spec-ref"
                        reference={discoverySection(step.id)}
                      />
                    </strong>
                    <p>{step.detail}</p>
                  </div>
                  {step.durationMs !== undefined && (
                    <span className="timing">{step.durationMs} ms</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {!!lines.length && (
        <>
          <h2>Session & API calls</h2>
          <p className="log-note">
            Times are when this page received each event, or when the server
            kept it for events from before the page was loaded; one turn&apos;s
            events arrive together.
          </p>
          <ol className="api-events">
            {lines.map((entry, index) => (
              <li key={index} className={`log-${entry.outcome}`}>
                <time
                  dateTime={new Date(entry.at).toISOString()}
                  title={`Received at ${new Date(entry.at).toLocaleString()}`}
                >
                  {clock(entry.at)}
                </time>
                <div>
                  {all && entry.from && <FromCompany from={entry.from} />}
                  <p>
                    {entry.text}
                    <SpecRef
                      className="spec-ref"
                      reference={entry.section ?? ""}
                    />
                  </p>
                  {entry.url &&
                    !entry.text.startsWith(`${entry.method} ${entry.url}`) && (
                      <code>
                        {entry.method} {entry.url}
                      </code>
                    )}
                </div>
                <span className={`outcome ${entry.outcome}`}>
                  {outcomeLabel[entry.outcome]}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {all && (
        <p className="log-note">
          Choose a company above to see its discovery, its profile and its
          discovery document.
        </p>
      )}
      {result && company && (
        <CompanyProfileView
          company={result}
          excludedTasks={company.excludedTasks}
          skills={company.skills}
        />
      )}
      {result && (
        <details className="raw-document">
          <summary>Discovery document</summary>
          <pre>{JSON.stringify(result.document, null, 2)}</pre>
        </details>
      )}
      <p className="privacy-note">
        Private keys, credentials, Session JWTs, access tokens and DPoP proofs
        stay out of this inspector and of the copied trace. The validator is a
        third-party site (Poppy Demo Agent); the link only sends it the
        Company&apos;s domain.
      </p>
    </section>
  );
}

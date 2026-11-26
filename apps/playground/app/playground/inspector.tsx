"use client";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, Download } from "lucide-react";
import type {
  DiscoveredCompany,
  DiscoveryTraceStep,
} from "@poppy-lab/pap-core";
import { discoverySection, traceReport } from "@/lib/spec-sections";
import { SpecRef } from "../spec-ref";
import {
  clock,
  outcomeLabel,
  traceFileName,
  type ProtocolEntry,
} from "@/lib/protocol-log";
import { CompanyProfileView } from "../company-profile";

/** Discovery steps and API events with their spec sections, and the document. */
export function Inspector({
  result,
  trace,
  chatLog,
  companyUrl,
}: {
  result: DiscoveredCompany | null;
  trace: DiscoveryTraceStep[];
  chatLog: ProtocolEntry[];
  companyUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const report = () =>
    traceReport({
      company: result?.document.organization.name ?? companyUrl,
      steps: trace,
      events: chatLog,
    });
  function download() {
    const url = URL.createObjectURL(
      new Blob([report()], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = traceFileName(result?.requestedUrl ?? companyUrl);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setSaved(true);
  }
  return (
    <section className="inspector" aria-label="Protocol inspector">
      {!trace.length && (
        <p className="inspector-empty">
          Connect to a Company in the playground to inspect its protocol.
        </p>
      )}
      {!!trace.length && (
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
          <h2>Discovery</h2>
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
        </>
      )}
      {!!chatLog.length && (
        <>
          <h2>Session & API calls</h2>
          <p className="log-note">
            Times are when this page received each event, or when the server
            kept it for events from before the page was loaded; one turn&apos;s
            events arrive together.
          </p>
          <ol className="api-events">
            {chatLog.map((entry, index) => (
              <li key={index} className={`log-${entry.outcome}`}>
                <time
                  dateTime={new Date(entry.at).toISOString()}
                  title={`Received at ${new Date(entry.at).toLocaleString()}`}
                >
                  {clock(entry.at)}
                </time>
                <div>
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
      {result && <CompanyProfileView company={result} />}
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

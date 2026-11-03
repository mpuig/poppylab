"use client";
import { useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import type {
  DiscoveredCompany,
  DiscoveryTraceStep,
} from "@poppy-lab/pap-core";
import { apiSection, discoverySection, traceReport } from "@/lib/spec-sections";
import { CompanyProfileView } from "../company-profile";

/** Discovery steps and API events with their spec sections, and the document. */
export function Inspector({
  result,
  trace,
  chatTrace,
  companyUrl,
}: {
  result: DiscoveredCompany | null;
  trace: DiscoveryTraceStep[];
  chatTrace: string[];
  companyUrl: string;
}) {
  const [copied, setCopied] = useState(false);
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
                const text = traceReport({
                  company: result?.document.organization.name ?? companyUrl,
                  steps: trace,
                  events: chatTrace,
                });
                void navigator.clipboard
                  ?.writeText(text)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              <Copy size={14} aria-hidden="true" />{" "}
              {copied ? "Copied" : "Copy trace for an interop report"}
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
                    {discoverySection(step.id) && (
                      <span className="spec-ref">
                        {discoverySection(step.id)}
                      </span>
                    )}
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
      {!!chatTrace.length && (
        <>
          <h2>Session & API calls</h2>
          <ol className="api-events">
            {chatTrace.map((event, index) => (
              <li key={index}>
                {event}
                {apiSection(event) && (
                  <span className="spec-ref">{apiSection(event)}</span>
                )}
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

"use client";
import { Check } from "lucide-react";
import { companyProfile } from "@poppy-lab/pap-core";
import { guideHint, guideStep, guideSteps } from "@/lib/guide";
import { needsYou } from "@/lib/operation-presentation";
import { accountCompany, labCompany } from "./companies";
import type { Playground } from "./use-playground";

/** The four moves of a first run, the one the visitor is on, and what to do. */
export function Guide({ p }: { p: Playground }) {
  const company = p.connected ? p.result : null;
  const known = labCompany(company?.requestedUrl);
  const state = {
    connected: p.connected,
    signedIn: p.signedIn,
    canWrite: p.canWrite,
    waiting: p.operations.filter((op) => needsYou(op)).length,
    proposals: p.operations.length,
    // "succeeded" is the state the page labels Completed.
    completed: p.operations.filter((op) => op.state === "succeeded").length,
  };
  const step = guideStep(state);
  return (
    <section className="guide" aria-label="What to do next">
      <ol>
        {guideSteps.map((label, index) => (
          <li
            key={label}
            className={
              index < step ? "done" : index === step ? "current" : undefined
            }
            aria-current={index === step ? "step" : undefined}
          >
            <span aria-hidden="true">
              {index < step ? <Check size={12} strokeWidth={3} /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <p role="status">
        {guideHint(state, {
          ...(company ? { company: company.document.organization.name } : {}),
          ...(known ? { people: known.people, ask: known.ask } : {}),
          demo: p.demo,
          demoCanChange: !!known?.demoChange,
          signInOffered:
            !!company &&
            companyProfile(company).signIn.direct &&
            accountCompany(new URL(company.requestedUrl).origin),
        })}
      </p>
    </section>
  );
}

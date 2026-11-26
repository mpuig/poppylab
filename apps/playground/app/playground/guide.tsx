"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { companyProfile } from "@poppy-lab/pap-core";
import {
  guideHint,
  guideProposals,
  guideStep,
  guideSteps,
  nextExpiry,
  type GuideOperation,
} from "@/lib/guide";
import { accountCompany, labCompany } from "./companies";
import type { Playground } from "./use-playground";

/**
 * The time, read again when the next waiting proposal runs out. The guide
 * and the "Needs you" panel take it from here, so both change at the moment
 * the proposal's card turns to Expired.
 */
export function useProposalClock(operations: GuideOperation[]) {
  const [now, setNow] = useState(() => Date.now());
  const next = nextExpiry(operations, now);
  useEffect(() => {
    if (next === undefined) return;
    // As the card times itself: a moment past the expiry.
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(next - Date.now() + 10, 100), 2147483647),
    );
    return () => clearTimeout(timer);
  }, [next, now]);
  return now;
}

/** The four moves of a first run, the one the visitor is on, and what to do. */
export function Guide({ p }: { p: Playground }) {
  const now = useProposalClock(p.operations);
  const company = p.connected ? p.result : null;
  const known = labCompany(company?.requestedUrl);
  const state = {
    connected: p.connected,
    signedIn: p.signedIn,
    canWrite: p.canWrite,
    ...guideProposals(p.operations, now),
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

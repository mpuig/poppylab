"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  guideHint,
  guideProposals,
  guideStep,
  guideSteps,
  nextExpiry,
  type GuideOperation,
} from "@/lib/guide";
import { needsYou } from "@/lib/operation-presentation";
import { labCompany } from "./companies";
import {
  inFocus,
  mayChange,
  offersSignIn,
  type CompanyState,
} from "./company-state";
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

/**
 * The Company the guide speaks about, with several: the one holding the
 * proposal that changed last while it waits for the User, since that is
 * theirs to do; otherwise the one the last turn was with. Every sentence
 * names it, so each stays true of that Company.
 */
export function guideCompany(
  companies: CompanyState[],
  lastTurn: string | undefined,
  now = Date.now(),
) {
  const waits = companies
    .flatMap((c) =>
      c.operations
        .filter((op) => needsYou(op, now))
        .map((op) => ({ origin: c.origin, changed: op.changed ?? 0 })),
    )
    .sort((a, b) => b.changed - a.changed)[0];
  return inFocus(companies, lastTurn, waits?.origin);
}

/** The Company the guide speaks about, where it is, and the step it is on. */
export function guideAt(
  companies: CompanyState[],
  lastTurn: string | undefined,
  now = Date.now(),
) {
  const company = guideCompany(companies, lastTurn, now);
  const state = {
    connected: !!company,
    signedIn: !!company?.signedIn,
    canWrite: !!company && mayChange(company),
    ...guideProposals(company?.operations ?? [], now),
  };
  return { company, state, step: guideStep(state) };
}

/** The four moves of a first run, the one the visitor is on, and what to do. */
export function Guide({ p }: { p: Playground }) {
  const now = useProposalClock(p.companies.flatMap((c) => c.operations));
  const { company, state, step } = guideAt(p.companies, p.lastTurn, now);
  const known = labCompany(company?.url);
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
          ...(company ? { company: company.name } : {}),
          ...(known ? { people: known.people, ask: known.ask } : {}),
          demo: p.demo,
          demoCanChange: !!known?.demoChange,
          signInOffered: !!company && offersSignIn(company),
        })}
      </p>
    </section>
  );
}

"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, LoaderCircle, Plus } from "lucide-react";
import { AccountRow } from "./account-row";
import { CompanyMark } from "./company-mark";
import {
  MAX_COMPANIES,
  notConnected,
  offersSignIn,
  removalLoss,
  stateWords,
  type CompanyState,
} from "./company-state";
import { useProposalClock } from "./guide";
import type { Playground } from "./use-playground";

/** What discovery proved of a Company, as the line under its name says. */
function found(c: CompanyState) {
  const document = c.company?.document;
  if (!document) return new URL(c.url).host;
  const apis = document.apis?.length ?? 0;
  return [
    document.organization.domain,
    `${apis} ${apis === 1 ? "API" : "APIs"}`,
    ...(document.agent?.protocols.some((p) => p.type === "poppy")
      ? ["Company agent"]
      : []),
    `Poppy ${document.protocol_version}`,
  ].join(" · ");
}

/**
 * The conversation's Companies, above it, once there is a conversation:
 * one item for each, with its state in plain words, and a way to add one.
 * An item opens what belongs to that Company: what discovery found, its
 * account controls and its removal. Opening one is a view and nothing
 * else: which Company a message is for is never chosen here.
 */
export function CompaniesBar({
  p,
  onInspect,
}: {
  p: Playground;
  onInspect: () => void;
}) {
  const { companies, busy } = p;
  // The open panel: a Company's, by origin, or the one that adds one.
  const { panel: open, setPanel: setOpen } = p;
  /** The Company whose removal waits for the User's confirmation. */
  const [confirming, setConfirming] = useState<string | undefined>();
  const now = useProposalClock(companies.flatMap((c) => c.operations));
  // A Company that went closes its panel; one added closes the add panel.
  const origins = companies.map((c) => c.origin).join();
  useEffect(() => {
    setOpen(
      open === "add"
        ? p.addError
          ? open
          : undefined
        : companies.some((c) => c.origin === open)
          ? open
          : undefined,
    );
    setConfirming(undefined);
    // Only a change in the Companies closes a panel.
  }, [origins]);
  const toggle = (which: string) => {
    setConfirming(undefined);
    p.setAddError("");
    setOpen(open === which ? undefined : which);
  };
  const shown = companies.find((c) => c.origin === open);
  const loss = shown ? removalLoss(shown, now) : [];
  const toAdd = notConnected(companies);
  const remove = (c: CompanyState) => {
    // Asked first when it takes something with it; the server removes at
    // once, so this question is the confirmation.
    if (removalLoss(c, now).length && confirming !== c.origin)
      setConfirming(c.origin);
    else {
      setConfirming(undefined);
      void p.removeCompany(c.origin);
    }
  };
  return (
    <div className="companies-bar">
      <div className="companies-row">
        <ul aria-label="Companies in this conversation">
          {companies.map((c) => (
            <li key={c.origin}>
              <button
                type="button"
                className="company-item"
                aria-expanded={open === c.origin}
                aria-controls="company-panel"
                onClick={() => toggle(c.origin)}
              >
                <CompanyMark origin={c.origin} />
                <strong>{c.name}</strong>
                <span className={c.signingIn ? "waits" : undefined}>
                  {p.readOnly ? "Ended" : stateWords(c)}
                </span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
          {!companies.length && (
            <li className="quiet">
              {p.discovering ? (
                <>
                  <LoaderCircle className="spin" size={13} /> Connecting…
                </>
              ) : (
                "No company yet"
              )}
            </li>
          )}
          {!p.readOnly && (
            <li>
              <button
                type="button"
                className="text-button add-company"
                aria-expanded={open === "add"}
                aria-controls="company-panel"
                disabled={busy && !p.discovering}
                onClick={() => toggle("add")}
              >
                {p.discovering && companies.length ? (
                  <LoaderCircle className="spin" size={13} />
                ) : (
                  <Plus size={14} aria-hidden="true" />
                )}
                Add a company
              </button>
            </li>
          )}
        </ul>
      </div>
      {p.barNote && (
        <p className="bar-note" role="status">
          {p.barNote}
        </p>
      )}
      {shown && (
        <section
          id="company-panel"
          className="company-panel"
          aria-label={shown.name}
        >
          <p className="company-found">
            <CompanyMark origin={shown.origin} />
            <strong>{shown.name}</strong>
            <span>· {found(shown)}</span>
            <button
              type="button"
              className="text-button inspect-link"
              onClick={onInspect}
            >
              Inspect connection <ArrowUpRight size={13} />
            </button>
          </p>
          {!p.readOnly &&
            (offersSignIn(shown) ? (
              <AccountRow p={p} c={shown} named={false} now={now} />
            ) : (
              <p className="panel-text">
                {shown.name} doesn’t offer sign-in to agents, so Iris can only
                ask its public questions.
              </p>
            ))}
          {!p.readOnly &&
            (confirming === shown.origin ? (
              <div className="remove-confirm" role="group">
                <p>
                  Remove {shown.name} from this conversation? {loss.join(" ")}
                </p>
                <div className="direct-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busy}
                    onClick={() => remove(shown)}
                  >
                    Remove {shown.name}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setConfirming(undefined)}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-button remove-company"
                disabled={busy}
                onClick={() => remove(shown)}
              >
                Remove from this conversation
              </button>
            ))}
          {p.removeError?.origin === shown.origin && (
            <p className="error-message" role="alert">
              {p.removeError.text}
            </p>
          )}
        </section>
      )}
      {open === "add" && (
        <section
          id="company-panel"
          className="company-panel"
          aria-label="Add a company"
        >
          {companies.length >= MAX_COMPANIES ? (
            <p className="panel-text">
              A conversation works with at most {MAX_COMPANIES} companies.
              Remove one to add another.
            </p>
          ) : (
            <>
              <p className="panel-text">
                {companies.length
                  ? "Iris keeps what this conversation holds; the company you add starts signed out."
                  : "Pick a company for this conversation."}
              </p>
              <div className="add-options">
                {toAdd.map((lab) => (
                  <button
                    type="button"
                    key={lab.url}
                    className="company-item"
                    disabled={busy}
                    onClick={() => void p.connectTo(lab.url)}
                  >
                    <CompanyMark origin={lab.url} />
                    <strong>{lab.name}</strong>
                    <span>{lab.sector}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    // The form above takes over: one place to add from.
                    p.setCompanyUrl("");
                    p.setAddError("");
                    p.setAddressOpen(true);
                    setOpen(undefined);
                  }}
                >
                  Use another address
                </button>
              </div>
            </>
          )}
          {p.addError && !p.addressOpen && (
            <p className="error-message" role="alert">
              {p.addError}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

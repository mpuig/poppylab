"use client";
import { inlineText } from "./inline-text";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { companyProfile } from "@poppy-lab/pap-core";
import { needsYou, openLast } from "@/lib/operation-presentation";
import { leftToUser } from "@/lib/auto-approval";
import { demoChangeReplyNow } from "@/lib/demo-changes";
import { hideLinkSecrets } from "@/lib/link-display";
import { OperationReview } from "../operation-review";
import { StandingInstruction } from "./standing-instruction";
import { FdxConsent, type FdxConsentRecord } from "./fdx-consent";
import { FdxStatements } from "./fdx-statements";
import {
  EspiAuthorization,
  type EspiAuthorizationRecord,
} from "./espi-authorization";

/** What the account row says of each domain extension's grant. */
const GRANT_WORDS = {
  fdx: {
    revoked: (company: string) =>
      `FDX consent revoked. ${company} ended the grant and its tokens, and this conversation is signed out.`,
    ended: (company: string) =>
      `This FDX consent had already ended at ${company}. This conversation is signed out.`,
    again: "Sign in again to share accounts over FDX",
  },
  espi: {
    revoked: (company: string) =>
      `ESPI access revoked. ${company} ended the authorization, its subscription and its tokens, and this conversation is signed out.`,
    ended: (company: string) =>
      `This ESPI authorization had already ended at ${company}. This conversation is signed out.`,
    again: "Sign in again to share meters over ESPI",
  },
} as const;
import { accountCompany, labCompanies, labCompany } from "./companies";
import { useProposalClock } from "./guide";
import type { Playground } from "./use-playground";

/** The currency the Company's own proposals use; USD until it has made one. */
function currencyOf(operations: Array<{ terms?: Record<string, unknown> }>) {
  const found = operations
    .map((op) => op.terms?.currency)
    .find((c) => typeof c === "string" && /^[A-Z]{3}$/.test(c));
  return typeof found === "string" ? found : "USD";
}

/** A Company message's data, indented for reading (it arrives compact). */
function prettyData(json: string) {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/** The transcript, the account controls, approval cards and the composer. */
export function Conversation({
  p,
  transcript,
  taskInput,
}: {
  p: Playground;
  transcript: RefObject<HTMLDivElement | null>;
  taskInput: RefObject<HTMLTextAreaElement | null>;
}) {
  const { result, connected, busy, messages, signedIn, waitingSignIn } = p;
  const companyName = result?.document.organization.name ?? "the Company";
  // An open proposal expires on its own clock, which the guide reads too.
  const now = useProposalClock(p.operations);
  const [panelOpen, setPanelOpen] = useState(true);
  const panel = useRef<HTMLElement>(null);
  const waiting = p.operations.filter((op) => needsYou(op, now));
  const settled = p.operations.filter((op) => !needsYou(op, now));
  // A new proposal opens the panel again, and the card folded in it.
  const waitingKey = waiting
    .map((op) => `${op.operation_id}:${op.revision}`)
    .join();
  // One waiting card is open at a time, the last in the panel: the first to
  // arrive, until the person opens another or folds it.
  const [chosen, setChosen] = useState<string>();
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    if (!waitingKey) return;
    setPanelOpen(true);
    setFolded(false);
  }, [waitingKey]);
  const listed = openLast(waiting, chosen);
  const shownId = folded ? undefined : listed.at(-1)?.operation_id;
  const cards = useRef<HTMLDivElement>(null);
  // Opening a card moves it to the panel's end, which drops the focus its
  // title had.
  useEffect(() => {
    if (chosen)
      cards.current
        ?.querySelector<HTMLElement>(".operation-review[open] > summary")
        ?.focus();
  }, [chosen]);
  // A card that opens is read from its top.
  useEffect(() => {
    if (cards.current) cards.current.scrollTop = 0;
  }, [shownId]);
  // In a short window the open panel reaches past the window's foot. The
  // page moves to show all of it, or its top when it is the taller of the two.
  useEffect(() => {
    const element = panel.current;
    if (waitingKey && panelOpen && element)
      element.scrollIntoView({
        block: element.offsetHeight > window.innerHeight ? "start" : "nearest",
      });
  }, [waitingKey, panelOpen, shownId]);
  // Why the User's standing instruction left a waiting operation to them.
  const leftOut = (op: (typeof p.operations)[number]) =>
    leftToUser(
      op,
      p.instruction,
      companyName,
      p.heldBack[`${op.operation_id}:${op.revision}`],
      now,
    );
  // Whether Iris approved an operation on the standing instruction: the
  // demo's answer about it was written before, while it still waited.
  const approvedByIris = (id: string) =>
    p.operations.some(
      (op) =>
        op.operation_id === id &&
        op.state === "succeeded" &&
        op.approvedBy?.approver === "agent",
    );
  const review = (op: (typeof p.operations)[number], inPanel = false) => (
    <OperationReview
      key={op.operation_id}
      op={op}
      company={result?.document.organization.name ?? "Company"}
      domain={result?.document.organization.domain}
      busy={busy}
      signedIn={signedIn}
      onAction={(action, operation) => void p.accountAction(action, operation)}
      notApplied={leftOut(op)}
      {...(inPanel && {
        open: op.operation_id === shownId,
        onOpen: (open: boolean) => {
          setChosen(op.operation_id);
          setFolded(!open);
        },
      })}
    />
  );
  // `connected` implies a result; keep the type in step with the flag.
  const company = connected ? result : null;
  // Requests that work here and now: public ones signed out, account ones
  // signed in, and the change once Iris may propose it (in demo mode, only
  // where the demo's rules can).
  const known = labCompany(company?.requestedUrl);
  const suggestions: string[] = !company
    ? []
    : known
      ? signedIn
        ? [
            ...known.account,
            ...(p.canWrite && (!p.demo || known.demoChange) ? [known.ask] : []),
          ]
        : [...known.open]
      : p.demo
        ? []
        : ["What can you help me with?"];
  return (
    <section className="conversation" aria-label="Chat">
      <div className="conversation-heading">
        <h2>Conversation</h2>
        <div className="heading-side">
          <span>
            {p.readOnly
              ? "Ended · read-only"
              : signedIn
                ? "Account connected"
                : "Public access"}
          </span>
          {p.conversation && (
            <a className="new-conversation" href="/playground">
              New conversation
            </a>
          )}
        </div>
      </div>
      <div
        className={`messages ${messages.length ? "has-messages" : ""}`}
        ref={transcript}
        role="log"
        aria-label="Messages"
        aria-live="polite"
        aria-relevant="additions"
      >
        {!messages.length && !connected && !p.readOnly && (
          <div className="company-picker">
            <p>Pick a company to start</p>
            <div className="company-cards">
              {labCompanies.map((item) => (
                <button
                  type="button"
                  key={item.url}
                  className="company-card"
                  disabled={busy}
                  onClick={() => void p.connectTo(item.url)}
                >
                  <strong>
                    {item.name} <span>{item.sector}</span>
                  </strong>
                  <small>“{item.ask}”</small>
                </button>
              ))}
            </div>
            <span>
              They are fictional. Nothing is charged, shipped or moved.
            </span>
          </div>
        )}
        {!messages.length && connected && !p.readOnly && (
          <div className="empty-state">
            <p>
              {suggestions.length
                ? "What would you like to ask?"
                : signedIn
                  ? "Ask Iris about your account."
                  : "Sign in to ask about your account."}
            </p>
            {!!suggestions.length && (
              <div className="suggestions">
                {suggestions.map((question) => (
                  <button
                    type="button"
                    key={question}
                    onClick={() => {
                      p.setTask(question);
                      taskInput.current?.focus();
                    }}
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((message, index) => (
          <article
            key={index}
            className={`message ${message.role.toLowerCase()}`}
          >
            <h3>
              {message.role === "Agent"
                ? "Iris"
                : message.role === "Demo"
                  ? "Protocol demo"
                  : message.role === "Company"
                    ? message.author
                    : message.role === "You" && message.direct
                      ? `You → ${companyName}`
                      : message.role}
              {message.role === "Company" && (
                <span className="company-badge">Company content</span>
              )}
              {message.direct && (
                <span className="direct-badge">Direct, without Iris</span>
              )}
            </h3>
            {message.text && (
              <div className="message-text">
                {message.role === "Agent"
                  ? inlineText(hideLinkSecrets(message.text))
                  : hideLinkSecrets(
                      message.role === "Demo"
                        ? demoChangeReplyNow(
                            message.text,
                            message.data,
                            approvedByIris,
                          )
                        : message.text,
                    )}
              </div>
            )}
            {!!message.steps?.length && (
              <details className="agent-steps">
                <summary>
                  What Iris did · {message.steps.length}{" "}
                  {message.steps.length === 1 ? "step" : "steps"}
                </summary>
                <ol>
                  {message.steps.map((step, i) => (
                    <li key={i} className={`step-${step.state}`}>
                      <span>{step.text}</span>
                      <small>
                        {step.how}
                        {step.access ? ` · ${step.access}` : ""}
                        {step.state === "waiting" ? " · waiting for you" : ""}
                        {step.state === "failed" ? " · failed" : ""}
                      </small>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {message.role === "Error" && (
              <div className="message-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => p.retryMessage(index)}
                >
                  Try again
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => p.removeMessage(index)}
                >
                  Remove
                </button>
              </div>
            )}
            {message.note && <p className="company-note">{message.note}</p>}
            {message.data && (
              <details className="company-data">
                <summary>Data</summary>
                <pre>{prettyData(message.data)}</pre>
              </details>
            )}
          </article>
        ))}
        {company &&
          !p.readOnly &&
          companyProfile(company).signIn.direct &&
          accountCompany(new URL(company.requestedUrl).origin) && (
            <div className="account-row">
              <span>
                {signedIn
                  ? `${p.canWrite ? "Reading and change proposals" : "Read-only access"} · ${p.scopes.split(" ").join(", ")}`
                  : waitingSignIn
                    ? "Finish sign-in in the Company tab."
                    : "Account access is optional · only connect accounts you trust"}
              </span>
              {p.extension && (
                // Use FDX or Use ESPI, per conversation: the domain
                // extension is declared from the next Session on (§3.4),
                // with its native read tools.
                <label className="extension-toggle">
                  <input
                    type="checkbox"
                    checked={p.extensionOn}
                    disabled={busy || waitingSignIn}
                    onChange={(event) =>
                      void p.chooseExtension(event.target.checked)
                    }
                  />
                  <span>
                    Use {p.extension.label}
                    <small>
                      {p.extension.shape} read tools ({p.extension.name} v1).
                      Changing it starts a new Session.
                    </small>
                  </span>
                </label>
              )}
              {signedIn && p.grant && p.extension?.key === "fdx" && (
                <FdxConsent
                  key={p.grant}
                  consentId={p.grant}
                  company={company.document.organization.name}
                  record={p.grantRecord as FdxConsentRecord | undefined}
                  disabled={busy || waitingSignIn}
                  onRevoke={() => void p.revokeGrant()}
                />
              )}
              {signedIn && p.grant && p.extension?.key === "espi" && (
                <EspiAuthorization
                  key={p.grant}
                  authorizationId={p.grant}
                  company={company.document.organization.name}
                  record={p.grantRecord as EspiAuthorizationRecord | undefined}
                  disabled={busy || waitingSignIn}
                  onRevoke={() => void p.revokeGrant()}
                />
              )}
              {signedIn && p.fdxStatementsShown && (
                <FdxStatements
                  accounts={p.fdxStatements}
                  disabled={busy || waitingSignIn}
                  onList={() => void p.listFdxStatements()}
                  onDownload={(accountId, statementId) =>
                    void p.downloadFdxStatement(accountId, statementId)
                  }
                />
              )}
              {!signedIn && !waitingSignIn && p.grantRevoked && p.extension && (
                <p className="permission-note" role="status">
                  {GRANT_WORDS[p.extension.key][
                    p.grantRevoked === "revoked" ? "revoked" : "ended"
                  ](company.document.organization.name)}{" "}
                  {GRANT_WORDS[p.extension.key].again}.
                </p>
              )}
              {p.extensionSignIn && p.extension && (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy || waitingSignIn}
                  onClick={() =>
                    void p.accountAction(
                      "signin",
                      undefined,
                      p.canWrite ? "write" : "read",
                    )
                  }
                >
                  {GRANT_WORDS[p.extension.key].again}
                </button>
              )}
              {signedIn && p.moreAccess && (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy || waitingSignIn}
                  onClick={() =>
                    void p.accountAction("signin", undefined, "write")
                  }
                >
                  Request change permission
                </button>
              )}
              <button
                type="button"
                className={signedIn ? "text-button" : "connect-button"}
                disabled={busy}
                onClick={() =>
                  void p.accountAction(signedIn ? "signout" : "signin")
                }
              >
                {signedIn
                  ? "Sign out"
                  : waitingSignIn
                    ? "Retry sign-in"
                    : `Sign in to ${company.document.organization.name} · read only`}
              </button>
              {signedIn && p.canWrite && (
                <StandingInstruction
                  instruction={p.instruction}
                  currency={p.instruction?.currency ?? currencyOf(p.operations)}
                  onChange={p.setLimit}
                  operations={p.operations}
                  leftToUser={leftOut}
                />
              )}
              {signedIn && p.moreAccess && (
                <p className="permission-note">
                  This opens a new Company consent. Afterwards, ask for the
                  change again; you will approve it separately.
                </p>
              )}
            </div>
          )}
        {p.error && (
          <p className="error-message" role="alert">
            {p.error}
          </p>
        )}
        {settled.map((op) => review(op))}
        {p.sending && (
          <div className="thinking" role="status">
            <LoaderCircle className="spin" size={14} />
            Working on it…
          </div>
        )}
      </div>
      {/* Always present, so a proposal arriving in the panel is announced. */}
      <p className="sr-only" role="status">
        {waiting.length
          ? `${waiting.length} ${waiting.length === 1 ? "request needs" : "requests need"} your decision`
          : ""}
      </p>
      {!!waiting.length && (
        <section
          ref={panel}
          className="needs-you"
          aria-label="Needs you"
          onKeyDown={(event) => {
            if (event.key === "Escape" && panelOpen) {
              setPanelOpen(false);
              taskInput.current?.focus();
            }
          }}
        >
          <button
            type="button"
            className="needs-you-toggle"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <span>Needs you</span>
            <b>{waiting.length}</b>
            <small>{panelOpen ? "Hide" : "Show"}</small>
          </button>
          {panelOpen && (
            <div className="needs-you-body" ref={cards}>
              {listed.map((op) => review(op, true))}
            </div>
          )}
        </section>
      )}
      {connected && !p.readOnly && p.invitation !== null && !p.direct && (
        <div className="direct-bar" role="region" aria-label="Invitation">
          <p>
            <strong>{companyName}</strong> asks to talk with you directly
            {p.invitation ? `: ${p.invitation}` : "."} Iris won&apos;t read or
            answer there; you can leave at any time.
          </p>
          <div className="direct-actions">
            <button
              type="button"
              className="connect-button"
              disabled={busy}
              onClick={() => p.directAction("accept")}
            >
              Talk to {companyName}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => p.directAction("decline")}
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {connected && !p.readOnly && p.direct && (
        <div
          className="direct-bar live"
          role="region"
          aria-label="Direct conversation"
        >
          <p>
            You&apos;re talking with <strong>{companyName}</strong> directly.
            What you type goes to them as your own words; Iris isn&apos;t
            reading or answering.
          </p>
          <div className="direct-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => p.directAction("close")}
            >
              Leave and go back to Iris
            </button>
          </div>
        </div>
      )}
      {connected &&
        !p.readOnly &&
        !p.direct &&
        p.invitation === null &&
        p.canTalkDirectly && (
          <div className="direct-bar quiet">
            {p.startingDirect ? (
              <>
                <p>
                  Your next message goes to <strong>{companyName}</strong>{" "}
                  directly, in your own words.
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => p.setStartingDirect(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  p.setStartingDirect(true);
                  taskInput.current?.focus();
                }}
              >
                Talk to {companyName} yourself
              </button>
            )}
          </div>
        )}
      {(connected || p.readOnly) && (
        <form className="composer" onSubmit={p.send}>
          <label className="sr-only" htmlFor="task">
            Message
          </label>
          <textarea
            ref={taskInput}
            id="task"
            value={p.task}
            maxLength={2000}
            rows={2}
            disabled={!connected || busy || p.readOnly}
            onChange={(event) => p.setTask(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              p.readOnly
                ? "This conversation has ended."
                : !connected
                  ? "Connect a Company first…"
                  : p.direct || p.startingDirect
                    ? `Message ${companyName}…`
                    : "Ask Iris…"
            }
          />
          <button
            type="submit"
            className="send-button"
            disabled={!connected || busy || p.readOnly || !p.task.trim()}
            aria-label="Send message"
          >
            <ArrowUp size={19} />
          </button>
        </form>
      )}
    </section>
  );
}

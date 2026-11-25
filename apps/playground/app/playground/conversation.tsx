"use client";
import { inlineText } from "./inline-text";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { companyProfile } from "@poppy-lab/pap-core";
import { needsYou } from "@/lib/operation-presentation";
import { hideLinkSecrets } from "@/lib/link-display";
import { OperationReview } from "../operation-review";
import { StandingInstruction } from "./standing-instruction";
import { accountCompany } from "./companies";
import type { Playground } from "./use-playground";

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
  const [now, setNow] = useState(() => Date.now());
  const [panelOpen, setPanelOpen] = useState(true);
  const panel = useRef<HTMLElement>(null);
  const waiting = p.operations.filter((op) => needsYou(op, now));
  const settled = p.operations.filter((op) => !needsYou(op, now));
  // An open proposal expires on its own clock.
  useEffect(() => {
    if (!waiting.length) return;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [waiting.length]);
  // A new proposal opens the panel again.
  const waitingKey = waiting
    .map((op) => `${op.operation_id}:${op.revision}`)
    .join();
  useEffect(() => {
    if (waitingKey) setPanelOpen(true);
  }, [waitingKey]);
  const review = (op: (typeof p.operations)[number]) => (
    <OperationReview
      key={op.operation_id}
      op={op}
      company={result?.document.organization.name ?? "Company"}
      domain={result?.document.organization.domain}
      busy={busy}
      signedIn={signedIn}
      onAction={(action, operation) => void p.accountAction(action, operation)}
    />
  );
  // `connected` implies a result; keep the type in step with the flag.
  const company = connected ? result : null;
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
        {!messages.length && (
          <div className="empty-state">
            <p>
              {connected
                ? "What would you like to know?"
                : "Your conversation starts here."}
            </p>
            <span>
              {connected
                ? "Ask about products, your basket, orders, or delivery."
                : "Connect to a Company to get started."}
            </span>
            {connected && (
              <div className="suggestions">
                {["What are your products?", "When do you deliver?"].map(
                  (question) => (
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
                  ),
                )}
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
                    : message.role}
              {message.role === "Company" && (
                <span className="company-badge">Company content</span>
              )}
            </h3>
            {message.text && (
              <div className="message-text">
                {message.role === "Agent"
                  ? inlineText(hideLinkSecrets(message.text))
                  : hideLinkSecrets(message.text)}
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
              {signedIn && p.moreAccess && (
                <button
                  type="button"
                  className="text-button"
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
                className="text-button"
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
                  currency={p.instruction?.currency ?? "USD"}
                  onChange={p.setLimit}
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
        {settled.map(review)}
        {p.sending && (
          <div className="thinking" role="status">
            <LoaderCircle className="spin" size={14} />
            Working on it…
          </div>
        )}
      </div>
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
            <div className="needs-you-body">{waiting.map(review)}</div>
          )}
        </section>
      )}
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
              : connected
                ? "Ask Iris…"
                : "Connect a Company first…"
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
    </section>
  );
}

"use client";
import { type RefObject } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { companyProfile } from "@poppy-lab/pap-core";
import { OperationReview } from "../operation-review";
import { accountCompany } from "./companies";
import type { Playground } from "./use-playground";

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
  // `connected` implies a result; keep the type in step with the flag.
  const company = connected ? result : null;
  return (
    <section className="conversation" aria-label="Chat">
      <div className="conversation-heading">
        <h2>Conversation</h2>
        <span>{signedIn ? "Account connected" : "Public access"}</span>
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
                ? "Personal Agent"
                : message.role === "Demo"
                  ? "Protocol demo"
                  : message.role}
            </h3>
            <div className="message-text">{message.text}</div>
          </article>
        ))}
        {company &&
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
        {p.operations.map((op) => (
          <OperationReview
            key={op.operation_id}
            op={op}
            company={result?.document.organization.name ?? "Company"}
            busy={busy}
            signedIn={signedIn}
            onAction={(action, operation) =>
              void p.accountAction(action, operation)
            }
          />
        ))}
        {p.sending && (
          <div className="thinking" role="status">
            <LoaderCircle className="spin" size={14} />
            Working on it…
          </div>
        )}
      </div>
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
          disabled={!connected || busy}
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
            connected ? "Ask your agent…" : "Connect a Company first…"
          }
        />
        <button
          type="submit"
          className="send-button"
          disabled={!connected || busy || !p.task.trim()}
          aria-label="Send message"
        >
          <ArrowUp size={19} />
        </button>
      </form>
    </section>
  );
}

"use client";
import { inlineText } from "./inline-text";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import {
  needsYou,
  openLast,
} from "@poppy-lab/pap-agent/operation-presentation";
import { demoChangeReplyNow } from "@poppy-lab/pap-agent/demo-changes";
import { hideLinkSecrets } from "@/lib/link-display";
import { OperationReview } from "../operation-review";
import { AccountRow, leftOutAt, rowWaits } from "./account-row";
import { CompanyMark, FromCompany } from "./company-mark";
import { shownCompanies } from "./answers";
import { labCompanies, labCompany } from "./companies";
import {
  inFocus,
  offersSignIn,
  type CompanyState,
  type Operation,
} from "./company-state";
import { guideAt, useProposalClock } from "./guide";
import type { Playground } from "./use-playground";

/** A Company message's data, indented for reading (it arrives compact). */
function prettyData(json: string) {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/** A proposal, and the Company that holds it, as one card of the page. */
type Held = { op: Operation; c: CompanyState; operation_id: string };

/**
 * The transcript, the account controls of the Company the conversation is
 * with while something there waits for the person, approval cards and the
 * composer.
 */
export function Conversation({
  p,
  transcript,
  taskInput,
}: {
  p: Playground;
  transcript: RefObject<HTMLDivElement | null>;
  taskInput: RefObject<HTMLTextAreaElement | null>;
}) {
  const { companies, busy, messages } = p;
  // An open proposal expires on its own clock, which the guide reads too.
  const now = useProposalClock(companies.flatMap((c) => c.operations));
  const [panelOpen, setPanelOpen] = useState(true);
  const panel = useRef<HTMLElement>(null);
  // Each card is its Company's: two Companies may use the same IDs.
  const held: Held[] = companies.flatMap((c) =>
    c.operations.map((op) => ({
      op,
      c,
      operation_id: `${c.origin} ${op.operation_id}`,
    })),
  );
  // Cards from several Companies are listed in the order they came.
  const waiting = held
    .filter((h) => needsYou(h.op, now))
    .sort((a, b) => (a.op.changed ?? 0) - (b.op.changed ?? 0));
  const settled = held.filter((h) => !needsYou(h.op, now));
  // A new proposal opens the panel again, and the card folded in it.
  const waitingKey = waiting
    .map((h) => `${h.operation_id}:${h.op.revision}`)
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
  // Whether Iris approved an operation on the standing instruction: the
  // demo's answer about it was written before, while it still waited.
  const approvedByIris = (id: string) =>
    companies.some((c) =>
      c.operations.some(
        (op) =>
          op.operation_id === id &&
          op.state === "succeeded" &&
          op.approvedBy?.approver === "agent",
      ),
    );
  const review = ({ op, c, operation_id }: Held, inPanel = false) => (
    <OperationReview
      key={operation_id}
      op={op}
      company={c.name}
      domain={c.company?.document.organization.domain}
      busy={busy}
      signedIn={c.signedIn}
      onAction={(action, operation) =>
        void p.accountAction(action, c.origin, operation as Operation)
      }
      notApplied={leftOutAt(p, c, now)(op)}
      {...(several && { mark: <CompanyMark origin={c.origin} /> })}
      {...(inPanel && {
        open: operation_id === shownId,
        onOpen: (open: boolean) => {
          setChosen(operation_id);
          setFolded(!open);
        },
      })}
    />
  );
  /** Messages name their Company once the conversation has had two. */
  const several = shownCompanies(companies, p.former) > 1;
  const connected = !!companies.length;
  // The Company the conversation is with: its account row closes the
  // transcript while something there waits for the person, so a turn that
  // needs its sign-in has the button right there. Otherwise its controls
  // are in its panel in the Companies bar.
  const focus = inFocus(companies, p.lastTurn);
  const rowFor =
    focus &&
    offersSignIn(focus) &&
    !p.readOnly &&
    p.panel !== focus.origin &&
    rowWaits(p, focus, messages, guideAt(companies, p.lastTurn, now))
      ? focus
      : undefined;
  // Requests that work here and now, for each Company: public ones signed
  // out, account ones signed in, and the change once Iris may propose it
  // (in demo mode, only where the demo's rules can).
  const suggestions = companies.flatMap((c) => {
    const known = labCompany(c.url);
    const list: string[] = known
      ? c.signedIn
        ? [
            ...known.account,
            ...(p.canWrite(c) && (!p.demo || known.demoChange)
              ? [known.ask]
              : []),
          ]
        : [...known.open]
      : p.demo
        ? []
        : ["What can you help me with?"];
    // With several Companies, two of each.
    return list
      .slice(0, companies.length > 1 ? 2 : undefined)
      .map((text) => ({ text, c }));
  });
  const signedInCount = companies.filter((c) => c.signedIn).length;
  const invited = companies.find(
    (c) => c.direct.invitation !== null && !c.direct.direct,
  );
  const direct = p.directWith;
  const startingWith = companies.find((c) => c.origin === p.startingDirect);
  const canTalk = companies.filter(
    (c) => c.direct.canTalkDirectly && c.direct.invitation === null,
  );
  const lastIndex = messages.length - 1;
  return (
    <section className="conversation" aria-label="Chat">
      <div className="conversation-heading">
        <h2>Conversation</h2>
        <div className="heading-side">
          <span>
            {p.readOnly
              ? "Ended · read-only"
              : signedInCount > 1
                ? `${signedInCount} accounts connected`
                : signedInCount
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
        {!messages.length && !connected && !p.readOnly && !p.missing && (
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
                : companies.some((c) => c.signedIn)
                  ? "Ask Iris about your account."
                  : "Sign in to ask about your account."}
            </p>
            {!!suggestions.length && (
              <div className="suggestions">
                {suggestions.map(({ text, c }) => (
                  <button
                    type="button"
                    key={`${c.origin} ${text}`}
                    disabled={busy}
                    onClick={() => void p.suggest(text, c.origin)}
                  >
                    {several && <FromCompany from={c} />}
                    {text}
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
              {several && message.role === "Company" && message.from && (
                <CompanyMark origin={message.from.origin} />
              )}
              {message.role === "Agent" || message.role === "Iris"
                ? "Iris"
                : message.role === "Demo"
                  ? "Protocol demo"
                  : message.role === "Company"
                    ? message.author
                    : message.role === "You" && message.direct
                      ? `You → ${direct?.name ?? startingWith?.name ?? "the Company"}`
                      : message.role}
              {/* Where it came from, once there could be doubt. Company
                  content names its Company in its author already. */}
              {several &&
                message.from &&
                message.role !== "Company" &&
                message.role !== "Iris" &&
                // A turn that used several Companies names each of them.
                (message.using?.length ? message.using : [message.from]).map(
                  (c) => <FromCompany key={c.origin} from={c} />,
                )}
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
            {/* Iris's question is answered with a button while it is the
                last thing said; the answer goes as it came. */}
            {!!message.choices?.length &&
              index === lastIndex &&
              !p.readOnly && (
                <div className="message-choices">
                  {message.choices.map((choice) => (
                    <button
                      type="button"
                      key={JSON.stringify(choice.answer)}
                      className="ghost-button"
                      disabled={busy}
                      onClick={() => void p.choose(choice)}
                    >
                      {choice.label}
                    </button>
                  ))}
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
                        {/* In a turn with several Companies, where it was. */}
                        {step.company
                          ? `${message.using?.find((c) => c.origin === step.company)?.name ?? new URL(step.company).host} · `
                          : ""}
                        {step.how}
                        {step.access ? ` · ${step.access}` : ""}
                        {step.state === "waiting" ? " · waiting for you" : ""}
                        {step.state === "failed" ? " · failed" : ""}
                      </small>
                      {/* What the call sent: what crossed, in a turn with several. */}
                      {step.args && <code>{step.args}</code>}
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
        {rowFor && <AccountRow p={p} c={rowFor} named={several} now={now} />}
        {p.error && (
          <p className="error-message" role="alert">
            {p.error}
          </p>
        )}
        {settled.map((h) => review(h))}
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
              {listed.map((h) => review(h, true))}
            </div>
          )}
        </section>
      )}
      {!p.readOnly && invited && !direct && (
        <div className="direct-bar" role="region" aria-label="Invitation">
          <p>
            <strong>{invited.name}</strong> asks to talk with you directly
            {invited.direct.invitation
              ? `: ${invited.direct.invitation}`
              : "."}{" "}
            Iris won&apos;t read or answer there; you can leave at any time.
          </p>
          <div className="direct-actions">
            <button
              type="button"
              className="connect-button"
              disabled={busy}
              onClick={() => p.directAction("accept", invited.origin)}
            >
              Talk to {invited.name}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => p.directAction("decline", invited.origin)}
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {!p.readOnly && direct && (
        <div
          className="direct-bar live"
          role="region"
          aria-label="Direct conversation"
        >
          <p>
            You&apos;re talking with <strong>{direct.name}</strong> directly.
            What you type goes to them as your own words; Iris isn&apos;t
            reading or answering.
          </p>
          <div className="direct-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => p.directAction("close", direct.origin)}
            >
              Leave and go back to Iris
            </button>
          </div>
        </div>
      )}
      {!p.readOnly && !direct && !invited && !!canTalk.length && (
        <div className="direct-bar quiet">
          {startingWith ? (
            <>
              <p>
                Your next message goes to <strong>{startingWith.name}</strong>{" "}
                directly, in your own words.
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => p.setStartingDirect(undefined)}
              >
                Cancel
              </button>
            </>
          ) : (
            canTalk.map((c) => (
              <button
                key={c.origin}
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  p.setStartingDirect(c.origin);
                  taskInput.current?.focus();
                }}
              >
                Talk to {c.name} yourself
              </button>
            ))
          )}
        </div>
      )}
      {!p.missing && (
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
            disabled={busy || p.readOnly}
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
                : direct
                  ? `Message ${direct.name}…`
                  : startingWith
                    ? `Message ${startingWith.name}…`
                    : "Ask Iris…"
            }
          />
          {companies.length > 1 && !direct && !startingWith && (
            // Which Company the message is for, when the User wants to say
            // so; otherwise Iris decides, and asks when it can't.
            <select
              className="composer-target"
              aria-label="Which company this message is for"
              value={p.target ?? ""}
              disabled={busy || p.readOnly}
              onChange={(event) => p.setTarget(event.target.value || undefined)}
            >
              <option value="">Iris decides</option>
              {companies.map((c) => (
                <option key={c.origin} value={c.origin}>
                  For {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="send-button"
            disabled={busy || p.readOnly || !p.task.trim()}
            aria-label="Send message"
          >
            <ArrowUp size={19} />
          </button>
        </form>
      )}
    </section>
  );
}

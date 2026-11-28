"use client";
import { inlineText } from "./inline-text";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { waitsAgain } from "@poppy-lab/pap-agent/operation-presentation";
import { pendingItems, type OpenAsk } from "@poppy-lab/pap-agent/pending";
import { demoChangeReplyNow } from "@poppy-lab/pap-agent/demo-changes";
import { hideLinkSecrets } from "@poppy-lab/pap-agent/link-display";
import { say } from "@poppy-lab/pap-agent/lines";
import { OperationReview } from "../operation-review";
import { leftOutAt } from "./account-row";
import { AskBlock, askId } from "./ask-block";
import { nextAsks, waitsForPerson, type Ask } from "./asks";
import { CompanyMark, FromCompany } from "./company-mark";
import { shownCompanies } from "./answers";
import {
  labCompanies,
  labCompany,
  type Choice,
  type Message,
} from "./companies";
import {
  inFocus,
  offersSignIn,
  type CompanyState,
  type Operation,
} from "./company-state";
import { focusGoesBack } from "./focus-return";
import { guideAt, useProposalClock } from "./guide";
import {
  inboxItems,
  PendingInbox,
  usePendingElsewhere,
  waitingCount,
  type InboxItem,
} from "./pending-inbox";
import {
  cardId,
  placeRows,
  proposalKey,
  type Arrivals,
} from "./transcript-items";
import { liveChoices, openQuestion, signInOf } from "./typed";
import type { Playground } from "./use-playground";

/** A Company message's data, indented for reading (it arrives compact). */
function prettyData(json: string) {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/**
 * Whether a Company's data has anything for a person to read: not when it
 * holds only flags about the conversation, such as a handoff that can't
 * happen in a fictional demo. The Inspector keeps it either way.
 */
export function dataForPerson(json: string) {
  try {
    const data = JSON.parse(json) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return true;
    const keys = Object.keys(data);
    return !keys.every((key) =>
      /^(handoff|fictional_company|fictional|demo|direct|conversation_state)$/.test(
        key,
      ),
    );
  } catch {
    return true;
  }
}

/** Whether the transcript is part of the page, not a box with its own scroll. */
const inPage = (transcript: HTMLElement | null) =>
  !!transcript && getComputedStyle(transcript).overflowY === "visible";

/**
 * On a phone with a proposal waiting, the transcript is part of the page
 * (playground.css). The page then shows the latest message from its top,
 * with the card under it, as a box of its own would show its end.
 */
export function showLatest(transcript: HTMLElement | null) {
  if (!inPage(transcript)) return;
  [...transcript!.querySelectorAll(":scope > .message")]
    .at(-1)
    ?.scrollIntoView({ block: "start" });
}

/** A proposal, and the Company that holds it, as one card of the page. */
type Held = { op: Operation; c: CompanyState; key: string };
/** What the transcript places after a message: a card or an ask. */
type Item = { key: string } & (
  { held: Held; ask?: undefined } | { ask: Ask; held?: undefined }
);

/** Iris's open question, as `pendingItems` reads it from its buttons. */
export function askOfChoices(choices: readonly Choice[] | undefined) {
  const answers = (choices ?? []).map((c) => c.answer);
  const signin = choices?.map(signInOf).find(Boolean);
  if (signin) return { signin } satisfies OpenAsk;
  const resume = answers.find((a) => typeof a.resume === "string");
  if (resume) return { resume: resume.resume as string } satisfies OpenAsk;
  const invited = answers.find(
    (a) => a.invitation && typeof a.invitation === "object",
  )?.invitation as { company?: string } | undefined;
  if (typeof invited?.company === "string")
    return { invitation: invited.company } satisfies OpenAsk;
  const signout = answers.flatMap((a) =>
    typeof a.signout === "string" ? [a.signout] : [],
  );
  if (signout.length) return { signout } satisfies OpenAsk;
  const removing = answers.find((a) => Array.isArray(a.remove))?.remove;
  if (Array.isArray(removing))
    return { removing: removing as string[] } satisfies OpenAsk;
  if (answers.some((a) => typeof a.company === "string"))
    return { which: true } satisfies OpenAsk;
  return undefined;
}

/** A button that decides a proposal: the proposal's card has it. */
const decides = (choice: Choice) =>
  "approve" in choice.answer || "decline" in choice.answer;

/**
 * The transcript, with each proposal's card and each ask about an account
 * where it arose; the count of what waits for the person, with the list;
 * and the composer.
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
  /** Messages name their Company once the conversation has had two. */
  const several = shownCompanies(companies, p.former) > 1;
  const connected = !!companies.length;
  // Each card is its Company's: two Companies may use the same IDs.
  const held: Held[] = companies.flatMap((c) =>
    c.operations.map((op) => ({
      op,
      c,
      key: proposalKey(c.origin, op.operation_id),
    })),
  );
  const question = openQuestion(messages);
  // Where each card and ask arose, when no message names it; and the asks
  // shown so far, to fold each to how it ended.
  const arrivals = useRef<Arrivals>(new Map()).current;
  const shownAsks = useRef(new Map<string, Ask>()).current;
  const guide = guideAt(companies, p.lastTurn, now);
  const asks = nextAsks(
    {
      companies,
      guide: { origin: guide.company?.origin, step: guide.step },
      moreAccess: p.moreAccess,
      extensionSignIn: p.extensionSignIn,
      offersSignIn,
      // Iris's question there has the button under it already.
      askedAt: (origin) =>
        !!question?.some(
          (choice) =>
            signInOf(choice)?.company === origin ||
            (choice.answer.invitation as { company?: string } | undefined)
              ?.company === origin,
        ),
      readOnly: p.readOnly,
      language: p.language ?? "en",
    },
    shownAsks,
    arrivals,
  );
  const items: Item[] = [
    ...held
      // Cards from several Companies are placed in the order they came.
      .sort((a, b) => (a.op.changed ?? 0) - (b.op.changed ?? 0))
      .map((h) => ({ key: h.key, held: h })),
    ...asks.map((ask) => ({ key: ask.key, ask })),
  ];
  const rows = placeRows(messages, items, arrivals);

  // What waits for the person: here, from the page's state, and in the
  // visitor's other conversations, from the agent's API.
  const lastIndex = messages.length - 1;
  const here: InboxItem[] = pendingItems(
    p.conversation ?? "",
    companies.map((c) => ({
      company: { origin: c.origin, name: c.name },
      operations: c.operations,
      ...(c.signingIn ? { signingIn: true as const } : {}),
      ...(!c.signedIn && (c.recovery || c.grantRevoked)
        ? { accessLost: true }
        : {}),
    })),
    askOfChoices(question),
    now,
  ).map((item) => ({
    ...item,
    // Why a proposal waits again, which only its card's foot says.
    text: (() => {
      const h = held.find(
        (x) =>
          x.c.origin === item.company?.origin &&
          x.op.operation_id === item.proposal?.id,
      );
      const again = h && waitsAgain(h.op, leftOutAt(p, h.c, now)(h.op));
      return again ? `${item.text} · ${again}` : item.text;
    })(),
    target:
      item.kind === "proposal" && item.company && item.proposal
        ? cardId(proposalKey(item.company.origin, item.proposal.id))
        : item.kind === "signin"
          ? (asks.find(
              (a) => a.origin === item.company?.origin && waitsForPerson(a),
            )?.key ?? `message-${lastIndex}`)
          : `message-${lastIndex}`,
  }));
  for (const ask of asks)
    if (
      (ask.kind === "extension" || ask.kind === "invitation") &&
      ask.phase === "open"
    ) {
      const c = companies.find((x) => x.origin === ask.origin)!;
      here.push({
        conversation: p.conversation ?? "",
        kind: ask.kind === "invitation" ? "question" : "signin",
        company: { origin: c.origin, name: c.name },
        text:
          ask.kind === "invitation"
            ? "Answer the invitation to talk with it directly"
            : "Sign in again to share what you turned on",
        target: ask.key,
      });
    }
  for (const item of here)
    if (item.target?.startsWith("ask ")) item.target = askId(item.target);
  const elsewhere = usePendingElsewhere(
    p.conversation,
    `${messages.length} ${busy} ${here.length}`,
  );
  const inbox = inboxItems(here, elsewhere, now);

  // The message box takes the focus back after a send, a quick reply or
  // a decision from the keyboard, once it can (`focus-return.ts`).
  const refocus = useRef(false);
  const [asked, setAsked] = useState(0);
  const giveBack = () => {
    refocus.current = true;
    setAsked((n) => n + 1);
  };
  useEffect(() => {
    if (!refocus.current || busy || p.readOnly) return;
    refocus.current = false;
    if (focusGoesBack(document.activeElement, document.hasFocus()))
      taskInput.current?.focus();
  }, [busy, asked, p.readOnly]);

  /** Brings an item into view and gives it the focus. */
  const bringIn = (target: string) => {
    const element = document.getElementById(target);
    if (!element) return false;
    if (element instanceof HTMLDetailsElement) element.open = true;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element.scrollIntoView({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
    (element.querySelector<HTMLElement>(":scope > summary") ?? element).focus({
      preventScroll: true,
    });
    return true;
  };
  const choose = (item: InboxItem) => {
    if (item.target && bringIn(item.target)) return;
    // In another conversation: open it there, at the card.
    const hash =
      item.kind === "proposal" && item.company && item.proposal
        ? `#${cardId(proposalKey(item.company.origin, item.proposal.id))}`
        : "";
    window.location.assign(`/playground/${item.conversation}${hash}`);
  };
  // Opened from the inbox of another conversation: at the card it named,
  // once the transcript has it, after the transcript has shown its end.
  const arrivedAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    arrivedAt.current = window.location.hash.slice(1) || undefined;
  }, []);
  useEffect(() => {
    const target = arrivedAt.current;
    if (!target || !document.getElementById(target)) return;
    arrivedAt.current = undefined;
    requestAnimationFrame(() => bringIn(target));
    window.history.replaceState(null, "", window.location.pathname);
  }, [messages, companies]);

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
  const card = ({ op, c, key }: Held) => (
    <OperationReview
      key={key}
      id={cardId(key)}
      op={op}
      company={c.name}
      domain={c.company?.document.organization.domain}
      busy={busy}
      signedIn={c.signedIn}
      onAction={(action, operation, keyboard) => {
        if (keyboard) giveBack();
        void p.accountAction(action, c.origin, operation as Operation);
      }}
      notApplied={leftOutAt(p, c, now)(op)}
      error={p.cardError?.key === key ? p.cardError.text : undefined}
      {...(several && { mark: <CompanyMark origin={c.origin} /> })}
    />
  );
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
  const direct = p.directWith;
  const startingWith = companies.find((c) => c.origin === p.startingDirect);
  // Talking directly is offered for the Company the conversation is with
  // now, and only while it doesn't ask for it itself.
  const talkingAbout = inFocus(companies, p.lastTurn);
  const canTalk =
    talkingAbout?.direct.canTalkDirectly &&
    talkingAbout.direct.invitation === null
      ? talkingAbout
      : undefined;
  const message = (m: Message, index: number) => (
    <article
      key={`m${index}`}
      id={`message-${index}`}
      tabIndex={-1}
      className={`message ${m.role.toLowerCase()}${m.noLongerAsked ? " no-longer-asked" : ""}`}
    >
      <h3>
        {several && m.role === "Company" && m.from && (
          <CompanyMark origin={m.from.origin} />
        )}
        {m.role === "Agent" || m.role === "Own"
          ? "Iris"
          : m.role === "Demo"
            ? "Protocol demo"
            : m.role === "Company"
              ? m.author
              : m.role === "You" && m.direct
                ? `You → ${direct?.name ?? startingWith?.name ?? "the Company"}`
                : m.role}
        {/* Where it came from, once there could be doubt. Company
            content names its Company in its author already. */}
        {several &&
          m.from &&
          m.role !== "Company" &&
          m.role !== "Own" &&
          // A turn that used several Companies names each of them.
          (m.using?.length ? m.using : [m.from]).map((c) => (
            <FromCompany key={c.origin} from={c} />
          ))}
        {m.role === "Company" && (
          <span className="company-badge">Company content</span>
        )}
        {m.direct && <span className="direct-badge">Direct, without Iris</span>}
        {m.earlier && (
          <span className="earlier-badge">
            {say(p.language ?? "en", "earlierSignIn", {
              name: m.earlier.name,
            })}
          </span>
        )}
      </h3>
      {m.text && (
        <div className="message-text">
          {m.role === "Agent"
            ? inlineText(hideLinkSecrets(m.text))
            : hideLinkSecrets(
                m.role === "Demo"
                  ? demoChangeReplyNow(m.text, m.data, approvedByIris)
                  : m.text,
              )}
        </div>
      )}
      {m.link && (
        <div className="message-choices">
          <a
            className="ghost-button"
            href={m.link.href}
            target={m.link.target}
            rel="noopener noreferrer"
          >
            {m.link.label}
          </a>
        </div>
      )}
      {/* Iris's question is answered with a button while it is the last
          thing said, or in words; the answer goes as it came. A proposal
          is decided on its card, which follows. */}
      {!!m.choices?.length && index === lastIndex && !p.readOnly && (
        <div className="message-choices">
          {liveChoices(m.choices, companies, now)
            .filter((choice) => !decides(choice))
            .map((choice) => (
              <button
                type="button"
                key={JSON.stringify(choice.answer)}
                className="ghost-button"
                disabled={busy}
                onClick={() => {
                  // A sign-in opens the Company's tab, which has the focus.
                  if (!signInOf(choice)) giveBack();
                  void p.choose(choice);
                }}
              >
                {choice.label}
              </button>
            ))}
        </div>
      )}
      {!!m.steps?.length && (
        <details className="agent-steps">
          <summary>
            What Iris did · {m.steps.length}{" "}
            {m.steps.length === 1 ? "step" : "steps"}
          </summary>
          <ol>
            {m.steps.map((step, i) => (
              <li key={i} className={`step-${step.state}`}>
                <span>{step.text}</span>
                <small>
                  {/* In a turn with several Companies, where it was. */}
                  {step.company
                    ? `${m.using?.find((c) => c.origin === step.company)?.name ?? new URL(step.company).host} · `
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
      {m.role === "Error" && (
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
      {m.note && <p className="company-note">{m.note}</p>}
      {m.data && dataForPerson(m.data) && (
        <details className="company-data">
          <summary>Data</summary>
          <pre>{prettyData(m.data)}</pre>
        </details>
      )}
    </article>
  );
  return (
    <section className="conversation" aria-label="Chat">
      <div className="conversation-heading">
        <h2>Conversation</h2>
        <div className="heading-side">
          <PendingInbox items={inbox} onChoose={choose} now={now} />
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
                    onClick={() => {
                      giveBack();
                      void p.suggest(text, c.origin);
                    }}
                  >
                    {several && <FromCompany from={c} />}
                    {text}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {rows.map((row) => {
          if (row.kind === "message")
            return message(messages[row.index]!, row.index);
          if (row.item.held) return card(row.item.held);
          const c = companies.find((x) => x.origin === row.item.ask!.origin);
          return c ? (
            <AskBlock
              key={row.key}
              ask={row.item.ask!}
              c={c}
              p={p}
              named={several}
              onPressed={(keyboard) => {
                if (keyboard) giveBack();
              }}
            />
          ) : null;
        })}
        {p.error && (
          <p className="error-message" role="alert">
            {p.error}
          </p>
        )}
        {p.sending && (
          <div className="thinking" role="status">
            <LoaderCircle className="spin" size={14} />
            Working on it…
          </div>
        )}
      </div>
      {/* Always present, so what arrives for the person is announced. */}
      <p className="sr-only" role="status">
        {inbox.length ? `${waitingCount(inbox.length)} for you` : ""}
      </p>
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
      {!p.readOnly && !direct && (startingWith ?? canTalk) && (
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
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                p.setStartingDirect(canTalk!.origin);
                taskInput.current?.focus();
              }}
            >
              Talk to {canTalk!.name} yourself
            </button>
          )}
        </div>
      )}
      {!p.missing && (
        <form
          className="composer"
          onSubmit={(event) => {
            giveBack();
            void p.send(event);
          }}
        >
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

"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { LAB_REPOSITORY, labSites } from "@poppy-lab/pap-core";
import { exampleUrl } from "./companies";
import type { View } from "./companies";
import { usePlayground } from "./use-playground";
import { ConnectionSetup } from "./connection-setup";
import { CompaniesBar } from "./companies-bar";
import { Conversation, showLatest } from "./conversation";
import { Inspector } from "./inspector";
import { IdentityPanel } from "./identity-panel";
import { AccountPanel } from "./account-panel";
import { readAccount, type AccountView } from "./agent-account";
import { ConversationList } from "./conversation-list";
import { Guide } from "./guide";

const copy: Record<View, { title: string; lead: string; tab: string }> = {
  run: {
    title: "Meet Iris, your agent.",
    lead: "Pick a company, sign in as a test customer, and tell Iris what you need.",
    tab: "Playground",
  },
  inspect: {
    title: "Under the hood.",
    lead: "Discovery checks and API calls, without the secrets.",
    tab: "Inspector",
  },
  identity: {
    title: "Your account and Iris’s identity.",
    lead: "Your account keeps your conversations on every device you sign in on. Iris’s identity is the public metadata a Company uses to verify Iris.",
    tab: "Identity",
  },
  history: {
    title: "Your conversations.",
    lead: "Each one has its own address. Only this browser can open them.",
    tab: "History",
  },
};

const day = (time: number) =>
  new Date(time).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/**
 * The transcript shows its end, where the latest message is. The Company
 * cards of a new conversation are read from the top: from the end, a
 * phone showed the last three and hid Juniper and Lantern above them.
 */
function toEnd(transcript: HTMLElement | null) {
  if (!transcript || transcript.querySelector(":scope > .company-picker"))
    return;
  transcript.scrollTop = transcript.scrollHeight;
  // A waiting card taller than the room left is read from Iris's question
  // above it, not from its buttons.
  const card = [
    ...transcript.querySelectorAll<HTMLElement>(
      ":scope > .operation-review.waiting",
    ),
  ].at(-1);
  const before = card?.previousElementSibling;
  // Only while it is the latest thing said: what follows is read first.
  let next = card?.nextElementSibling;
  while (next && !next.matches(".message")) next = next.nextElementSibling;
  if (!before || next) return;
  const top =
    before.getBoundingClientRect().top -
    transcript.getBoundingClientRect().top +
    transcript.scrollTop -
    8;
  if (transcript.scrollHeight - top > transcript.clientHeight)
    transcript.scrollTop = top;
}

/**
 * The playground, at `/playground` (a new conversation) and at
 * `/playground/<id>` (that conversation). Both routes render this.
 */
export function Workspace() {
  const [view, setView] = useState<View>("run");
  const transcript = useRef<HTMLDivElement>(null);
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const p = usePlayground({ onConnected: () => taskInput.current?.focus() });
  // The agent account this browser is signed in to: undefined until read.
  const [account, setAccount] = useState<AccountView | null>();
  useEffect(() => {
    void readAccount()
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);
  const accountChanged = (next: AccountView | null) => {
    setAccount(next);
    p.reloadConversation();
  };
  // The account is the first thing in the Identity view.
  const openAccount = () => setView("identity");
  const lead =
    view === "history" && account
      ? "Each one has its own address. Every device signed in to your account can open them."
      : copy[view].lead;

  // A window too short for all of the workspace: a phone with its keyboard
  // open, where only the visual viewport shrinks.
  const [short, setShort] = useState(false);
  // The viewport owns the workspace; the transcript scrolls to its end.
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const resize = () => {
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty(
        "--workspace-height",
        `${height}px`,
      );
      setShort(height < 560);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        toEnd(transcript.current);
      });
    };
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--workspace-height");
    };
  }, []);
  useEffect(
    () => toEnd(transcript.current),
    [p.messages, p.sending, p.companies, p.error],
  );
  // Part of the page, on a phone with a proposal waiting: only a new
  // message moves the page, never a refresh of the Companies.
  useEffect(() => showLatest(transcript.current), [p.messages.length]);

  return (
    <div
      className={`app ${view === "run" ? "chat-workspace" : ""} ${p.messages.length || p.companies.length || p.conversation ? "has-conversation" : ""} ${short ? "short-window" : ""}`}
    >
      <header className="site-header">
        <a href="/" className="brand">
          Poppy Lab
        </a>
        <nav aria-label="Playground views">
          {(Object.keys(copy) as View[]).map((item) => (
            <button
              type="button"
              key={item}
              className={view === item ? "nav-item selected" : "nav-item"}
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {item === "identity" ? (
                // On a phone the Account entry has no room: this tab,
                // which opens on the account, is named for it instead.
                <>
                  <span className="wide-only">{copy[item].tab}</span>
                  <span className="narrow-only">Account</span>
                </>
              ) : (
                copy[item].tab
              )}
            </button>
          ))}
          <button
            type="button"
            className="nav-item account-entry"
            onClick={openAccount}
            aria-label={account ? "Account, signed in" : "Account"}
          >
            Account
          </button>
        </nav>
      </header>

      <main>
        <section className="intro">
          <h1>{copy[view].title}</h1>
          <p>{lead}</p>
        </section>

        {view === "run" && (
          <>
            {p.missing && !!account?.unclaimed && (
              <p className="conversation-note" role="status">
                You signed in to your account, and this browser&apos;s
                conversations from before aren&apos;t in it yet. Bring them into
                your account to go on with them here and on your other devices.{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={openAccount}
                >
                  Go to your account
                </button>
              </p>
            )}
            {p.missing && !account?.unclaimed && (
              <p className="conversation-note" role="status">
                This address names a conversation that isn&apos;t available
                here. A conversation opens only in the browser that started it,
                or on every device signed in to the account it was brought into,
                for seven days.{" "}
                <a href="/playground">Start a new conversation</a>
              </p>
            )}
            {p.readOnly && (
              <p className="conversation-note" role="status">
                This conversation has ended and is read-only
                {p.keptUntil ? `, kept until ${day(p.keptUntil)}` : ""}. Connect
                again to start a new one.
              </p>
            )}
            <ConnectionSetup p={p} />
            {(!!p.conversation || !!p.companies.length) && (
              <CompaniesBar p={p} onInspect={() => setView("inspect")} />
            )}
            {!p.readOnly && !p.missing && <Guide p={p} />}
            <Conversation p={p} transcript={transcript} taskInput={taskInput} />
            <p className="composer-note">
              {Object.values(p.instructions).some(Boolean)
                ? "Your model · you approve every change unless your standing instruction covers it."
                : "Your model · human approval for every change."}{" "}
              <span>Enter to send · Shift + Enter for a new line</span>
            </p>
          </>
        )}
        {view === "inspect" && (
          <Inspector
            companies={p.companies}
            former={p.former}
            chatLog={p.chatLog}
            failedTrace={p.failedTrace}
            companyUrl={p.companyUrl}
          />
        )}
        {view === "identity" && (
          <>
            <AccountPanel account={account} onChange={accountChanged} />
            <IdentityPanel />
          </>
        )}
        {view === "history" && (
          <ConversationList current={p.conversation} onReset={p.demoReset} />
        )}
      </main>
      <footer>
        <span>
          An independent Poppy 1.0 experiment. The shops are fictional; nothing
          is charged or shipped.
        </span>
        <nav aria-label="Poppy Lab sites" className="lab-links">
          {labSites(exampleUrl)
            .filter((s) => s.id !== "playground")
            .map((s) => (
              <a key={s.id} href={s.url}>
                {s.label}
              </a>
            ))}
          <a href={LAB_REPOSITORY}>
            Source on GitHub <ArrowUpRight size={13} />
          </a>
          <a
            href="https://personalagentprotocol.org/docs/1.0/spec"
            target="_blank"
            rel="noreferrer"
          >
            Protocol docs <ArrowUpRight size={13} />
          </a>
        </nav>
      </footer>
    </div>
  );
}

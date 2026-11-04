"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { LAB_REPOSITORY, labSites } from "@poppy-lab/pap-core";
import { exampleUrl } from "./companies";
import type { View } from "./companies";
import { usePlayground } from "./use-playground";
import { ConnectionSetup } from "./connection-setup";
import { Conversation } from "./conversation";
import { Inspector } from "./inspector";
import { IdentityPanel } from "./identity-panel";

const copy: Record<View, { title: string; lead: string; tab: string }> = {
  run: {
    title: "Meet Iris, your agent.",
    lead: "Choose a model, connect a company, and tell Iris what you need.",
    tab: "Playground",
  },
  inspect: {
    title: "Under the hood.",
    lead: "Discovery checks and API calls, without the secrets.",
    tab: "Inspector",
  },
  identity: {
    title: "Iris’s identity.",
    lead: "The public metadata a Company uses to verify Iris.",
    tab: "Identity",
  },
};

export default function PlaygroundPage() {
  const [view, setView] = useState<View>("run");
  const transcript = useRef<HTMLDivElement>(null);
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const p = usePlayground({ onConnected: () => taskInput.current?.focus() });

  // The viewport owns the workspace; the transcript scrolls to its end.
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const resize = () => {
      document.documentElement.style.setProperty(
        "--workspace-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = transcript.current;
        if (element) element.scrollTop = element.scrollHeight;
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
  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [p.messages, p.sending, p.operations, p.error, p.signedIn]);

  return (
    <div
      className={`app ${view === "run" ? "chat-workspace" : ""} ${p.messages.length ? "has-conversation" : ""}`}
    >
      <header className="site-header">
        <a href="/" className="brand">
          Poppy Lab<span className="version">PAP 0.3</span>
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
              {copy[item].tab}
            </button>
          ))}
        </nav>
      </header>

      <main>
        <section className="intro">
          <h1>{copy[view].title}</h1>
          <p>{copy[view].lead}</p>
        </section>

        {view === "run" && (
          <>
            <ConnectionSetup p={p} onInspect={() => setView("inspect")} />
            <Conversation p={p} transcript={transcript} taskInput={taskInput} />
            <p className="composer-note">
              {"Your model · human approval for every change."}{" "}
              <span>Enter to send · Shift + Enter for a new line</span>
            </p>
          </>
        )}
        {view === "inspect" && (
          <Inspector
            result={p.result}
            trace={p.trace}
            chatTrace={p.chatTrace}
            companyUrl={p.companyUrl}
          />
        )}
        {view === "identity" && <IdentityPanel />}
      </main>
      <footer>
        <span>
          An independent PAP 0.3 experiment. The shops are fictional; nothing is
          charged or shipped.
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
            href="https://personalagentprotocol.org/docs/0.3/spec"
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

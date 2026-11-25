"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { LearnStep } from "@/lib/learn";

/**
 * A walk-through, one step at a time. The steps are the page's own HTML,
 * built from docs/learn at build time; this only chooses which one shows.
 * Without scripts every step shows in order, as on GitHub.
 */
export function LearnSteps({ steps }: { steps: LearnStep[] }) {
  const [index, setIndex] = useState(0);
  const [all, setAll] = useState(false);
  const root = useRef<HTMLElement>(null);
  const last = steps.length - 1;

  // A link to one step (its heading's own anchor) opens on that step.
  useEffect(() => {
    const open = () => {
      const at = steps.findIndex(
        (step) => step.id === decodeURIComponent(location.hash.slice(1)),
      );
      if (at >= 0) setIndex(at);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [steps]);

  const go = (to: number) => {
    const next = Math.min(Math.max(to, 0), last);
    if (next === index) return;
    setIndex(next);
    // The address names the step, so it can be linked or sent.
    history.replaceState(null, "", `#${steps[next]!.id}`);
    // A long step may have been scrolled: the next one starts at its top.
    const top = root.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) root.current?.scrollIntoView({ block: "start" });
  };

  // Left and right move between steps, unless the keys are in use: inside
  // a field, or scrolling a wide table.
  useEffect(() => {
    if (all) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, [contenteditable], .table-scroll",
        )
      )
        return;
      if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <section
      ref={root}
      className="learn-steps"
      aria-label="Step by step"
      data-mode={all ? "all" : "one"}
    >
      <div className="learn-steps-bar">
        <p className="learn-steps-count" aria-live="polite" aria-atomic="true">
          {all
            ? `${steps.length} steps`
            : `Step ${index + 1} of ${steps.length}`}
        </p>
        <div className="learn-steps-actions">
          <button
            type="button"
            className="learn-steps-toggle"
            onClick={() => setAll(!all)}
          >
            {all ? "One step at a time" : "Show all steps"}
          </button>
          {!all && (
            <>
              <button
                type="button"
                className="button ghost small"
                onClick={() => go(index - 1)}
                disabled={index === 0}
              >
                Previous
              </button>
              <button
                type="button"
                className="button small"
                onClick={() => go(index + 1)}
                disabled={index === last}
              >
                Next <ArrowRight size={18} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      <ol className="learn-steps-list">
        {steps.map((step, at) => (
          <li
            key={step.id}
            className="learn-step learn-body"
            hidden={!all && at !== index}
          >
            <h3 id={step.id}>
              {all && <span className="learn-step-number">{at + 1}. </span>}
              <span dangerouslySetInnerHTML={{ __html: step.title }} />
            </h3>
            {/* Our own Markdown from docs/learn, converted at build time. */}
            <div
              className="learn-body"
              dangerouslySetInnerHTML={{ __html: step.html }}
            />
          </li>
        ))}
      </ol>
      <noscript>
        <style>{`.learn-step[hidden]{display:block!important}.learn-steps-bar{display:none!important}`}</style>
      </noscript>
    </section>
  );
}

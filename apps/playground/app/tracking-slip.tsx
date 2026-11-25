"use client";
import { useState } from "react";
import { Check, PenLine, RotateCcw } from "lucide-react";

/** A sample request (illustrative), in the order Iris and a company handle it. */
const steps = [
  {
    title: "Found the company",
    detail: "Juniper publishes how agents can reach it.",
  },
  {
    title: "Introduced itself",
    detail: "Each request is signed, so Juniper knows it is Iris.",
  },
  {
    title: "You signed in",
    detail: "On Juniper's own page, as Elena. You chose what Iris may do.",
  },
  {
    title: "Change proposed",
    detail: "Juniper holds it: delivery from Thursday to Saturday.",
  },
  { title: "Approved by you", detail: "Your click. The AI can't press it." },
  {
    title: "Done, once",
    detail: "Thursday → Saturday. A retry can't repeat it.",
  },
] as const;

export function TrackingSlip() {
  // Steps 1–4 are done; the last two wait for the visitor's signature.
  const [signed, setSigned] = useState(false);
  const visible = signed ? 6 : 4;
  return (
    <figure className="slip" aria-label="Sample of one agent request">
      <dl className="slip-route">
        <div>
          <dt>From</dt>
          <dd>Iris, your agent</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>Juniper Market</dd>
        </div>
      </dl>
      <p className="slip-item">“Move my delivery to Saturday.”</p>
      <ol className="slip-steps" aria-live="polite">
        {steps.map((step, i) => {
          const done = i < visible;
          const waiting = !signed && i === 4;
          return (
            <li
              key={step.title}
              style={{ "--i": i } as React.CSSProperties}
              className={done ? "done" : waiting ? "waiting" : "pending"}
              aria-current={waiting ? "step" : undefined}
            >
              <span className="mark" aria-hidden="true">
                {done ? <Check size={13} strokeWidth={3} /> : null}
              </span>
              <span className="step-text">
                <strong>
                  {waiting ? "Awaiting your signature" : step.title}
                </strong>
                <small>
                  {waiting
                    ? "Nothing has changed yet. The agent can't approve it."
                    : step.detail}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="slip-foot">
        {signed ? (
          <button
            type="button"
            className="slip-button quiet"
            onClick={() => setSigned(false)}
          >
            <RotateCcw size={16} aria-hidden="true" /> Show it again
          </button>
        ) : (
          <button
            type="button"
            className="slip-button"
            onClick={() => setSigned(true)}
          >
            <PenLine size={16} aria-hidden="true" /> Sign for it
          </button>
        )}
        <figcaption>
          A sample. In the live demo, you approve a real proposal.
        </figcaption>
      </div>
    </figure>
  );
}

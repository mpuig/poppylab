"use client";
import { useState } from "react";
import { Check, PenLine, RotateCcw } from "lucide-react";

/** A sample trace (illustrative), shaped like what Poppy records. */
const steps = [
  {
    title: "Discovered",
    detail: "/.well-known/poppy.json · issuer verified",
  },
  { title: "Session started", detail: "Poppy-Session · ES256, signed out" },
  {
    title: "Signed in",
    detail: "Juniper's own page · Alex · poppy:read poppy:write",
  },
  {
    title: "Proposal held",
    detail: "403 approval_required · revision 1793646108",
  },
  { title: "Approved by you", detail: "Poppy-Approval · same request, resent" },
  {
    title: "Delivered once",
    detail: "Thursday → Saturday · a retry replays it",
  },
] as const;

export function Barcode({ code }: { code: string }) {
  // Deterministic bars from the item code: geometry, not a picture.
  const bars: Array<{ x: number; w: number }> = [];
  let x = 0;
  for (const ch of code) {
    const n = ch.charCodeAt(0);
    for (const w of [1 + (n % 3), 1 + ((n >> 2) % 2), 2 + ((n >> 3) % 3)]) {
      bars.push({ x, w });
      x += w + 1 + ((n >> 1) % 2);
    }
  }
  return (
    <svg
      className="barcode"
      viewBox={`0 0 ${x} 24`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.w} height="24" />
      ))}
    </svg>
  );
}

export function TrackingSlip() {
  // Steps 1–4 are done; the last two wait for the visitor's signature.
  const [signed, setSigned] = useState(false);
  const visible = signed ? 6 : 4;
  return (
    <figure
      className="slip"
      aria-label="Sample tracking slip of one agent request"
    >
      <div className="slip-head">
        <div>
          <span className="slip-kind">Registered request</span>
          <span className="slip-code">PL-JM-0001</span>
        </div>
        <Barcode code="PLJM0001" />
      </div>
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
                {done ? <Check size={14} strokeWidth={3} /> : null}
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
              {i === 5 && done && (
                <span className="stamp" aria-hidden="true">
                  Delivered
                </span>
              )}
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
          Sample trace. In the playground, you sign on a real proposal.
        </figcaption>
      </div>
    </figure>
  );
}

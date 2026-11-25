"use client";
import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";

/** Where each party's lifeline sits, as a share of the figure's width. */
const AT = [16.667, 50, 83.333] as const;
const WHO = ["You", "Iris", "Juniper Market"] as const;

type Party = 0 | 1 | 2;
type Message = { from: Party; to: Party; text: string; reply?: boolean };

/** A sample request (illustrative), in the order Iris and a company handle it. */
const asked: Message[] = [
  { from: 0, to: 1, text: "“Move my delivery to Saturday.”" },
  { from: 1, to: 2, text: "Signed request" },
  { from: 0, to: 2, text: "You sign in on Juniper's own page" },
  { from: 2, to: 1, text: "Change held: Thursday to Saturday", reply: true },
];
/** These two happen only once the visitor has approved. */
const approved: Message[] = [
  { from: 1, to: 2, text: "Same request, with your approval" },
  { from: 2, to: 1, text: "Done, once", reply: true },
];

function Row({
  message,
  number,
  order,
  pending,
}: {
  message: Message;
  number: number;
  order: number;
  pending?: boolean;
}) {
  const { from, to, text, reply } = message;
  const left = Math.min(AT[from], AT[to]);
  const width = Math.abs(AT[to] - AT[from]);
  return (
    <li
      className={`msg ${pending ? "pending" : "live"}${reply ? " reply" : ""}`}
      data-dir={to > from ? "right" : "left"}
      // The label starts at the customer's lifeline, or ends at the company's.
      data-anchor={from === 0 || to === 0 ? "start" : "end"}
      style={
        {
          "--a": `${left}%`,
          "--w": `${width}%`,
          "--i": order,
        } as React.CSSProperties
      }
    >
      <span className="msg-label">
        <b>{number}</b>
        <span className="sr-only">
          {WHO[from]} to {WHO[to]}:{" "}
        </span>
        {text}
        {pending ? <span className="sr-only"> (not yet)</span> : null}
      </span>
      <span className="msg-line" aria-hidden="true" />
    </li>
  );
}

export function SequenceFigure() {
  // Messages 1 to 4 have happened; the rest wait for the visitor's approval.
  const [signed, setSigned] = useState(false);
  // The button a click replaces takes the focus the click had, so a keyboard
  // goes from Approve to "Show it again" and back without losing its place.
  const approve = useRef<HTMLButtonElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const acted = useRef(false);
  useEffect(() => {
    if (acted.current) (signed ? again : approve).current?.focus();
  }, [signed]);
  const set = (next: boolean) => {
    acted.current = true;
    setSigned(next);
  };
  // A CSS animation plays when its element is mounted, and messages 1 to 4 stay
  // mounted when the figure is reset. Counting the runs in their keys mounts
  // them again, so "Show it again" draws the sequence from its first message.
  const [run, setRun] = useState(0);
  const replay = () => {
    setRun((n) => n + 1);
    set(false);
  };
  return (
    <figure className="seq" aria-label="Sample of one agent request">
      <div className="seq-heads" aria-hidden="true">
        <div className="you">
          You<small>the customer</small>
        </div>
        <div>
          Iris<small>your agent</small>
        </div>
        <div className="company">
          Juniper Market<small>the company</small>
        </div>
      </div>
      <ol className="seq-rows">
        {asked.map((message, i) => (
          <Row
            key={`${run}-${message.text}`}
            message={message}
            number={i + 1}
            order={i}
          />
        ))}
        <li>
          <div className={signed ? "seq-gate done" : "seq-gate"}>
            <p role="status">
              <strong>
                {signed ? (
                  <span className="tick" aria-hidden="true">
                    <Check size={13} strokeWidth={3} />
                  </span>
                ) : (
                  <b>5</b>
                )}
                {signed ? "Approved by you" : "Waiting for your approval"}
              </strong>
              {signed
                ? "The delivery is now on Saturday, and a retry can't repeat the change."
                : "Nothing has changed yet. The AI can't approve it."}
            </p>
            {signed ? null : (
              <button
                ref={approve}
                type="button"
                className="seq-button"
                onClick={() => set(true)}
              >
                Approve
              </button>
            )}
          </div>
        </li>
        {approved.map((message, i) => (
          <Row
            key={message.text}
            message={message}
            number={i + 6}
            order={i}
            pending={!signed}
          />
        ))}
      </ol>
      <figcaption>
        <span>
          A sample request. In the live demo you approve a real proposal.
        </span>
        {signed ? (
          <button
            ref={again}
            type="button"
            className="seq-again"
            onClick={replay}
          >
            <RotateCcw size={15} aria-hidden="true" /> Show it again
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}

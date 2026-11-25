"use client";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  approvalTotal,
  changes,
  money,
  summaryDisagreements,
  operationTitle,
  ownLayout,
  termRows,
  termValue,
  type ReviewOperation,
} from "../lib/operation-presentation";
/** The amounts of Juniper's and Lantern's terms, as their cards name them. */
const moneyRows = [
  ["subtotal_cents", "Products"],
  ["delivery_fee_cents", "Delivery"],
  ["tax_cents", "Tax"],
  ["total_cents", "Total"],
  ["fee_cents", "Change fee"],
  ["unit_price_cents", "Unit price"],
  ["before_total_cents", "Previous total"],
  ["price_difference_cents", "Difference"],
  ["new_total_cents", "New total"],
  ["refund_cents", "Refund"],
] as const;
const states: Record<string, string> = {
  proposed: "Approval required",
  succeeded: "Completed",
  declined: "Declined",
  refused: "Declined by the Company",
  failed: "Not applied",
  expired: "Expired",
  uncertain: "Outcome unknown",
};
export function OperationReview({
  op,
  company,
  domain,
  busy,
  signedIn,
  onAction,
  notApplied,
}: {
  op: ReviewOperation;
  company: string;
  /** §10.3: the name is the Company's claim; the domain is what discovery proved. */
  domain?: string | undefined;
  busy: boolean;
  signedIn: boolean;
  onAction: (action: string, op: ReviewOperation) => void;
  /** Why the User's standing instruction left this to them (`leftToUser`). */
  notApplied?: string | null | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (op.state !== "proposed" || !(Date.parse(op.expires_at) > now)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(
        Math.max(Date.parse(op.expires_at) - Date.now() + 10, 100),
        2147483647,
      ),
    );
    return () => clearTimeout(timer);
  }, [op.state, op.expires_at, now]);
  const pending = op.state === "proposed" && Date.parse(op.expires_at) > now,
    state = op.state === "proposed" && !pending ? "expired" : op.state;
  // Terms the card has no layout for are read from their shape.
  const own = ownLayout(op),
    read = own ? undefined : termRows(op);
  const diff = read ? read.changes : changes(op),
    t = op.terms ?? {};
  const active = pending || state === "uncertain";
  const total = approvalTotal(op);
  const disagreements = summaryDisagreements(op);
  return (
    <details className="operation-review" open={active}>
      <summary className="operation-summary">
        <span>{operationTitle(op)}</span>
        <span className="operation-state">{states[state] ?? state}</span>
      </summary>
      <div className="operation-content">
        <p className="quiet operation-company">
          {company}
          {domain ? <> · {domain}</> : null} · terms revision {op.revision}
        </p>
        {total && pending && (
          <p className="operation-headline" data-total>
            <span>{total.text}</span>
            <strong>{total.label}</strong>
          </p>
        )}
        {op.summary ? (
          // Quoted as the Company's words and shown as text: a summary's
          // Markdown, links or images never render.
          <figure className="company-says">
            <figcaption>{company} says:</figcaption>
            <blockquote>{op.summary}</blockquote>
          </figure>
        ) : (
          <p>
            {company} sent no summary. Review its exact terms below before you
            approve.
          </p>
        )}
        {disagreements.length > 0 && (
          <div className="operation-warning" role="alert">
            <strong>
              Check before you approve: the terms and {company}’s summary differ
            </strong>
            <ul>
              {disagreements.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {diff.map((row, index) => (
          <div className="operation-diff" key={`${row.label}-${index}`}>
            <strong>{row.label}</strong>
            <div>
              <span>
                <small>Before</small>
                {row.before}
              </span>
              <ArrowRight size={18} aria-hidden="true" />
              <span>
                <small>After</small>
                {row.after}
              </span>
            </div>
          </div>
        ))}
        {!!read?.rows.length && (
          <dl className="operation-money operation-fields">
            {read.rows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {own && (t.items !== undefined || t.next_items !== undefined) && (
          <div className="operation-items">
            <h3>{t.next_items ? "Resulting delivery" : "Order items"}</h3>
            <p>{termValue("items", t.next_items ?? t.items, t)}</p>
          </div>
        )}
        {own && moneyRows.some(([k]) => typeof t[k] === "number") && (
          <dl className="operation-money">
            {moneyRows
              .filter(([key]) => typeof t[key] === "number")
              .map(([key, label]) => (
                <div
                  key={key}
                  className={
                    key === "total_cents" || key === "new_total_cents"
                      ? "money-total"
                      : ""
                  }
                >
                  <dt>{label}</dt>
                  <dd>{money(t[key], t.currency)}</dd>
                </div>
              ))}
          </dl>
        )}
        {op.result && (
          <p className="operation-result" role="status">
            {op.result.summary}
          </p>
        )}
        {op.approvedBy?.approver === "agent" && (
          <p className="operation-ledger">
            Approved by Iris on your standing instruction
            {op.approvedBy.rule ? ` (${op.approvedBy.rule})` : ""}, not by a
            tap. {company} received approver “agent”
            {op.approvedBy.reference ? (
              <>
                {" "}
                and ledger reference <code>{op.approvedBy.reference}</code>
              </>
            ) : null}
            .
          </p>
        )}
        {pending && op.agentDeclined && (
          <p className="operation-ledger declined" role="status">
            {company} declined the approval Iris sent on your standing
            instruction, and did nothing
            {op.agentDeclined.reason
              ? `. It says: “${op.agentDeclined.reason}”`
              : ""}
            . It&apos;s up to you now.
          </p>
        )}
        {pending && op.agentSuperseded && (
          // Not a decline, but the same kind of note: it waits for the User.
          <p className="operation-ledger declined" role="status">
            {company} answered the approval Iris sent on your standing
            instruction with new terms, and did nothing. It&apos;s up to you
            now.
          </p>
        )}
        {pending && notApplied && !op.agentDeclined && !op.agentSuperseded && (
          // The two notes above already say it for a decline and new terms.
          <p className="operation-ledger declined" role="status">
            Your standing instruction did not apply: {notApplied}. It&apos;s up
            to you now.
          </p>
        )}
        <details className="operation-terms" open={!op.summary}>
          <summary>All exact terms</summary>
          <pre className="operation-exact">
            {JSON.stringify(op.terms ?? {}, null, 2)}
          </pre>
          <p className="quiet">Operation {op.operation_id}</p>
        </details>
        {pending && (
          <p className="quiet">
            Approval covers only revision {op.revision}. Expires{" "}
            {new Date(op.expires_at).toLocaleString()}.
          </p>
        )}
        {state === "uncertain" && (
          <p className="quiet">
            Your approval was sent but the result is unknown. Retrying sends the
            same approval; the Company performs it at most once.
          </p>
        )}
        {(pending || state === "uncertain") && (
          <div className="operation-actions">
            {pending ? (
              <>
                <button
                  type="button"
                  className="connect-button"
                  disabled={busy || !signedIn}
                  onClick={() => onAction("approve", op)}
                >
                  {total ? `Approve ${total.label}` : "Approve this change"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => onAction("decline", op)}
                >
                  Decline
                </button>
              </>
            ) : (
              <button
                type="button"
                className="connect-button"
                disabled={busy || !signedIn}
                onClick={() => onAction("retry", op)}
              >
                Retry the same approval
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

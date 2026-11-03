"use client";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  changes,
  money,
  operationTitle,
  termValue,
  type ReviewOperation,
} from "../lib/operation-presentation";
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
] as const;
const states: Record<string, string> = {
  proposed: "Approval required",
  succeeded: "Completed",
  declined: "Declined",
  failed: "Not applied",
  expired: "Expired",
  uncertain: "Outcome unknown",
};
export function OperationReview({
  op,
  company,
  busy,
  signedIn,
  onAction,
}: {
  op: ReviewOperation;
  company: string;
  busy: boolean;
  signedIn: boolean;
  onAction: (action: string, op: ReviewOperation) => void;
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
  const diff = changes(op),
    t = op.terms ?? {};
  const active = pending || state === "uncertain";
  return (
    <details className="operation-review" open={active}>
      <summary className="operation-summary">
        <span>{operationTitle(op)}</span>
        <span className="operation-state">{states[state] ?? state}</span>
      </summary>
      <div className="operation-content">
        <p className="quiet operation-company">
          {company} · terms revision {op.revision}
        </p>
        <p>{op.summary}</p>
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
        {(t.items !== undefined || t.next_items !== undefined) && (
          <div className="operation-items">
            <h3>{t.next_items ? "Resulting delivery" : "Order items"}</h3>
            <p>{termValue("items", t.next_items ?? t.items, t)}</p>
          </div>
        )}
        {moneyRows.some(([k]) => typeof t[k] === "number") && (
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
        <details className="operation-terms">
          <summary>All exact terms</summary>
          {op.terms === undefined ? (
            <p>
              No structured terms supplied. Review the Company's full summary
              above; approval applies to that summary and this revision.
            </p>
          ) : (
            <pre className="operation-exact">
              {JSON.stringify(op.terms, null, 2)}
            </pre>
          )}
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
                  Approve this change
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

"use client";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import {
  amountToApprove,
  changes,
  declinedReason,
  money,
  summaryDisagreements,
  operationTitle,
  outcome,
  ownLayout,
  termRows,
  termValue,
  type ReviewOperation,
} from "@poppy-lab/pap-agent/operation-presentation";
import { agentName } from "@poppy-lab/pap-agent/agent";
import { valueIn } from "@poppy-lab/pap-agent/words";
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

/** "17:42": a time of today, as the card says when something happened. */
export function hourOf(at: number | undefined) {
  if (at === undefined || !Number.isFinite(at)) return "";
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "17:42", or "27 Nov, 17:42" when it isn't today. */
export function whenOf(at: number, now = Date.now()) {
  const d = new Date(at);
  return d.toDateString() === new Date(now).toDateString()
    ? hourOf(at)
    : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${hourOf(at)}`;
}

/**
 * What the card says of where its proposal stands, in a few words, and
 * the tone of the mark beside them: `waiting` (amber, it is the person's
 * to do), `done` (green, performed), or `ended` (neutral).
 */
export function cardState(
  op: ReviewOperation,
  now = Date.now(),
): { words: string; tone: "waiting" | "done" | "ended" } {
  const pending = op.state === "proposed" && Date.parse(op.expires_at) > now;
  if (pending) return { words: "Waiting for you", tone: "waiting" };
  const at = (time: number | undefined) =>
    time !== undefined ? ` · ${whenOf(time, now)}` : "";
  // An approval's time is in seconds, as it was sent to the Company.
  const approved =
    op.approval?.approved_at !== undefined
      ? op.approval.approved_at * 1000
      : undefined;
  switch (op.state) {
    case "proposed":
    case "expired":
      return { words: "Expired", tone: "ended" };
    case "uncertain":
      return { words: "Outcome unknown", tone: "waiting" };
    case "succeeded":
      return {
        words:
          op.approvedBy?.approver === "agent"
            ? `Approved by ${agentName()} on your standing instruction${at(approved)}`
            : op.approvedBy?.approver === "user"
              ? `Approved by you${at(approved)}`
              : "Done by the Company",
        tone: "done",
      };
    case "declined":
      return { words: `Declined by you${at(op.changed)}`, tone: "ended" };
    case "refused":
      return { words: "Declined by the Company", tone: "ended" };
    case "failed":
      return { words: "Not applied", tone: "ended" };
    // The Company answered an approval with new terms under another ID.
    case "superseded":
      return { words: "Replaced by new terms", tone: "ended" };
    default:
      return { words: op.state, tone: "ended" };
  }
}

/**
 * One proposal, as a card in the transcript where it arrived: the
 * Company's name and host, what changes before and after, what the
 * Company says (as its words, §10.1), when the terms run out, and one
 * Approve and Decline. Once it is decided or has run out, the same card
 * folds to how it ended; it stays where it was.
 */
export function OperationReview({
  op,
  company,
  domain,
  busy,
  signedIn,
  onAction,
  notApplied,
  mark,
  error,
  id,
}: {
  op: ReviewOperation;
  company: string;
  /**
   * With several Companies, the Company's mark: the card's line then names
   * its Company too, so cards from two Companies read apart when closed.
   */
  mark?: ReactNode;
  /** §10.3: the name is the Company's claim; the domain is what discovery proved. */
  domain?: string | undefined;
  busy: boolean;
  signedIn: boolean;
  /**
   * The person's decision. `keyboard` is true when it was pressed from
   * the keyboard, so the page can give the message box its focus back.
   */
  onAction: (action: string, op: ReviewOperation, keyboard?: boolean) => void;
  /** Why the User's standing instruction left this to them (`leftToUser`). */
  notApplied?: string | null | undefined;
  /** What went wrong with the person's last decision on this card. */
  error?: string | undefined;
  /** The card's element ID, for the inbox to bring it into view. */
  id?: string | undefined;
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
  // A slot's code or a day is said as a person says it ("Sunday at
  // 13:00"); the exact terms below keep the Company's own values.
  const diff = (read ? read.changes : changes(op)).map((row) => ({
      ...row,
      before: valueIn("en", row.before),
      after: valueIn("en", row.after),
    })),
    t = op.terms ?? {};
  const active = pending || state === "uncertain";
  const total = amountToApprove(op);
  const disagreements = summaryDisagreements(op);
  const stand = cardState(op, now);
  // A finished operation says how it ended on its closed entry. Who
  // approved it is in its state already.
  const told = active ? {} : outcome(op, state, company);
  const ended = {
    says: told.says,
    note:
      (state === "succeeded"
        ? told.note?.replace(/\s*Approved by [^.]*\.$/, "").trim()
        : told.note) || undefined,
  };
  // The generic title says nothing a closed card needs: its first change does.
  const title =
    operationTitle(op) === "Review Company proposal" && diff[0]
      ? `${diff[0].label}: ${diff[0].before} → ${diff[0].after}`
      : operationTitle(op);
  const act = (action: string) => (event: MouseEvent<HTMLButtonElement>) =>
    // A click from the keyboard has no pointer, and no click count.
    onAction(action, op, event.detail === 0);
  return (
    <details
      className={`operation-review ${stand.tone}`}
      open={active}
      {...(id ? { id } : {})}
    >
      <summary className="operation-summary">
        <span className="operation-company">
          {mark}
          <strong>{company}</strong>
          {domain ? <span> · {domain}</span> : null}
        </span>
        <span className={`operation-state ${stand.tone}`}>
          {stand.tone === "done" && (
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
          )}
          {stand.words}
          {pending && (
            <span className="operation-expiry">
              {" "}
              · expires {whenOf(Date.parse(op.expires_at), now)}
            </span>
          )}
        </span>
        <span className="operation-title">{title}</span>
        {(ended.says || ended.note) && (
          <span className="operation-outcome">
            {ended.says && (
              // The Company's words, marked as they are in the open card.
              <span className="company-says">
                <small>{company} says:</small>
                {ended.says}
              </span>
            )}
            {ended.note && <span>{ended.note}</span>}
          </span>
        )}
      </summary>
      <div className="operation-content">
        {total && pending && (
          <p className="operation-headline" data-total>
            <span>{total.text}</span>
            <strong>{total.label}</strong>
          </p>
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
        {op.summary ? (
          // Quoted as the Company's words and shown as text: a summary's
          // Markdown, links or images never render.
          <figure className="company-says">
            <figcaption>
              {company} says:{" "}
              <span className="company-badge">Company content</span>
            </figcaption>
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
        <details className="operation-terms" open={!op.summary}>
          <summary>All exact terms</summary>
          <pre className="operation-exact">
            {JSON.stringify(op.terms ?? {}, null, 2)}
          </pre>
        </details>
        {pending && (
          <p className="quiet">
            Approving covers exactly these terms. They expire{" "}
            {new Date(op.expires_at).toLocaleString()}.
          </p>
        )}
        {state === "uncertain" && (
          <p className="quiet">
            Your approval was sent but the result is unknown. Retrying sends the
            same approval; the Company performs it at most once.
          </p>
        )}
        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
        {active && (
          // Why the card still waits belongs with its buttons.
          <div className="operation-foot">
            {pending && op.agentDeclined && (
              <p className="operation-ledger declined" role="status">
                {company} declined the approval Iris sent on your standing
                instruction, and did nothing.
                {declinedReason(op.agentDeclined.reason)} It&apos;s up to you
                now.
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
            {pending &&
              notApplied &&
              !op.agentDeclined &&
              !op.agentSuperseded && (
                // The two notes above already say it for a decline and new terms.
                <p className="operation-ledger declined" role="status">
                  Your standing instruction did not apply: {notApplied}.
                  It&apos;s up to you now.
                </p>
              )}
            {op.result && (
              // What became of an approval already sent, while this still
              // waits: the Company refused the request, or answered a retry
              // with new terms. A notice, not a success line.
              <p className="operation-ledger declined" role="status">
                {op.result.summary}
              </p>
            )}
            <div className="operation-actions">
              {pending ? (
                <>
                  <button
                    type="button"
                    className="connect-button"
                    disabled={busy || !signedIn}
                    onClick={act("approve")}
                  >
                    {total ? `Approve ${total.label}` : "Approve this change"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busy}
                    onClick={act("decline")}
                  >
                    Decline
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="connect-button"
                  disabled={busy || !signedIn}
                  onClick={act("retry")}
                >
                  Retry the same approval
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

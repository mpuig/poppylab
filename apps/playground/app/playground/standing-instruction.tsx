"use client";
import { useState } from "react";
import {
  formatLimit,
  parseLimit,
  type Instruction,
} from "@/lib/standing-instructions";
import type { ReviewOperation } from "@/lib/operation-presentation";

/**
 * One rule the User can write for this Company: approve exchanges up to an
 * amount without asking. Anything larger, or that the check cannot settle,
 * still waits in Needs you.
 */
export function StandingInstruction({
  instruction,
  currency,
  onChange,
  operations = [],
  leftToUser = () => null,
}: {
  instruction: Instruction | undefined;
  currency: string;
  onChange: (next: Instruction | null) => void;
  /** This conversation's operations, for the ledger of what Iris approved. */
  operations?: ReviewOperation[];
  /** Why the instruction left a waiting operation to the User, if it did. */
  leftToUser?: (op: ReviewOperation) => string | null;
}) {
  // The ledger (Operations v3 §6): each approval Iris sent as the agent,
  // with the reference the Company received, and each waiting operation the
  // instruction left to the User, with the reason.
  const ledger = operations
    .map((op) => ({ op, why: leftToUser(op) }))
    .filter(
      ({ op, why }) =>
        op.approvedBy?.approver === "agent" || op.agentDeclined || why,
    );
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <details className="standing-instruction">
      <summary>
        Standing instruction
        {instruction ? ` · up to ${formatLimit(instruction)}` : " · none"}
      </summary>
      {instruction ? (
        <p>
          Iris approves exchanges here up to {formatLimit(instruction)} without
          asking, and says so in the log each time. The limit is for the amount
          you pay or move. Any other amount over it (fees included), refunds,
          other currencies, terms Iris can&apos;t read and anything that does
          not match its summary still come to you, and so does everything after
          5 approvals an hour or three times the limit in total. A change left
          to you says why, here and on its card.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => onChange(null)}
          >
            Remove
          </button>
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = parseLimit(value, currency);
            setInvalid(!next);
            if (next) {
              onChange(next);
              setValue("");
            }
          }}
        >
          <label htmlFor="standing-limit">
            Approve exchanges up to ({currency})
          </label>
          <input
            id="standing-limit"
            inputMode="decimal"
            value={value}
            aria-invalid={invalid}
            onChange={(event) => setValue(event.target.value)}
            placeholder="20"
          />
          <button type="submit" className="text-button">
            Save
          </button>
          {invalid && (
            <span role="alert">
              Enter an amount above 0, such as 20 or 14.50.
            </span>
          )}
        </form>
      )}
      {!!ledger.length && (
        <ol
          className="instruction-ledger"
          aria-label="Approved on this instruction, or left to you"
        >
          {ledger.map(({ op, why }) => (
            <li key={`${op.operation_id}:${op.revision}`}>
              <span>{op.summary ?? op.operation_id}</span>
              <small>
                {op.approvedBy?.approver === "agent"
                  ? `Approved by Iris${op.approvedBy.rule ? ` · ${op.approvedBy.rule}` : ""}${op.approvedBy.reference ? ` · ${op.approvedBy.reference}` : ""}`
                  : why
                    ? `Left to you: ${why}.${op.agentDeclined?.reason ? ` It says: “${op.agentDeclined.reason}”` : ""}`
                    : "Declined by the Company · left to you"}
              </small>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

"use client";
import { useState } from "react";
import {
  formatLimit,
  parseLimit,
  type Instruction,
} from "@/lib/standing-instructions";

/**
 * One rule the User can write for this Company: approve exchanges up to an
 * amount without asking. Anything larger, or that the check cannot settle,
 * still waits in Needs you.
 */
export function StandingInstruction({
  instruction,
  currency,
  onChange,
}: {
  instruction: Instruction | undefined;
  currency: string;
  onChange: (next: Instruction | null) => void;
}) {
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
          asking, and says so in the log each time. Refunds, other currencies,
          larger totals and anything that does not match its summary still come
          to you.{" "}
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
            <span role="alert">Enter an amount above 0, such as 20 or 14.50.</span>
          )}
        </form>
      )}
    </details>
  );
}

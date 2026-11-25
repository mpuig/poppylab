"use client";
import { useState, type ReactNode } from "react";

/** The steps of revoking in the page: ask, then confirm or cancel. */
export type Confirmation = {
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRevoke: () => void;
};

/**
 * Holds the confirmation step of a revocation in the page (no browser
 * dialog) and renders each step with `view`.
 */
export function ConfirmedRevoke({
  onRevoke,
  view,
}: {
  onRevoke: () => void;
  view: (confirmation: Confirmation) => ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  return view({
    confirming,
    onAsk: () => setConfirming(true),
    onCancel: () => setConfirming(false),
    onRevoke: () => {
      setConfirming(false);
      onRevoke();
    },
  });
}

export const day = (value: string | undefined) => {
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at)
    ? new Date(at).toLocaleDateString("en", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : undefined;
};

/**
 * A domain extension's grant of this sign-in (the FDX consent, the ESPI
 * authorization) in the account row: what it is, its status once read, and
 * the User's own way to revoke it. Iris has no tool for this.
 */
export function ExtensionGrantView({
  name,
  id,
  details,
  revoke,
  group,
  explanation,
  disabled,
  confirming,
  onAsk,
  onCancel,
  onRevoke,
}: Confirmation & {
  /** "FDX consent". */
  name: string;
  id: string;
  details: string;
  /** The first button: "Revoke FDX consent". */
  revoke: string;
  /** The confirmation's label: "Revoke the FDX consent". */
  group: string;
  /** What confirming does, in the Company's name. */
  explanation: string;
  disabled: boolean;
}) {
  return (
    <div className="extension-grant">
      <p>
        {name} <code>{id}</code>
        <span className="quiet"> · {details}</span>
      </p>
      {confirming ? (
        <div
          className="extension-grant-actions"
          role="group"
          aria-label={group}
        >
          <span>{explanation}</span>
          <button
            type="button"
            className="connect-button"
            disabled={disabled}
            onClick={onRevoke}
          >
            Confirm revoke
          </button>
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={onAsk}
        >
          {revoke}
        </button>
      )}
    </div>
  );
}

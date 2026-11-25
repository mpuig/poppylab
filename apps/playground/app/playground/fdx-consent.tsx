"use client";
import { useState } from "react";

/** The consent record's bounded fields the page shows (`fdx_consent` action). */
export type FdxConsentRecord = {
  id: string;
  status?: string;
  expirationTime?: string;
  accounts?: string[];
  /** The bank didn't return the record: only the id is known. */
  unavailable?: boolean;
};

const day = (value: string | undefined) => {
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
 * `poppylab.dev/fdx` v1: the FDX consent of this sign-in, and the User's
 * own way to revoke it, confirmed in the page. Iris has no tool for this.
 */
export function FdxConsent(props: {
  consentId: string;
  company: string;
  record: FdxConsentRecord | undefined;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <FdxConsentView
      {...props}
      confirming={confirming}
      onAsk={() => setConfirming(true)}
      onCancel={() => setConfirming(false)}
      onRevoke={() => {
        setConfirming(false);
        props.onRevoke();
      }}
    />
  );
}

/** What `FdxConsent` renders, for each step of the confirmation. */
export function FdxConsentView({
  consentId,
  company,
  record,
  disabled,
  confirming,
  onAsk,
  onCancel,
  onRevoke,
}: {
  consentId: string;
  company: string;
  record: FdxConsentRecord | undefined;
  disabled: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRevoke: () => void;
}) {
  const accounts = record?.accounts ?? [];
  const until = day(record?.expirationTime);
  const details = !record
    ? "Reading its status…"
    : record.unavailable
      ? "Status unavailable"
      : [
          record.status,
          accounts.length
            ? `${accounts.length === 1 ? "1 account" : `${accounts.length} accounts`} (${accounts.join(", ")})`
            : "no accounts",
          until ? `until ${until}` : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <div className="fdx-consent">
      <p>
        FDX consent <code>{consentId}</code>
        <span className="quiet"> · {details}</span>
      </p>
      {confirming ? (
        <div
          className="fdx-consent-actions"
          role="group"
          aria-label="Revoke the FDX consent"
        >
          <span>
            {company} ends this consent, its tokens and this sign-in. You can
            sign in again afterwards.
          </span>
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
          Revoke FDX consent
        </button>
      )}
    </div>
  );
}

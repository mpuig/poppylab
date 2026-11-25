"use client";
import {
  ConfirmedRevoke,
  day,
  ExtensionGrantView,
  type Confirmation,
} from "./extension-grant";

/** The consent record's bounded fields the page shows (`fdx_consent` action). */
export type FdxConsentRecord = {
  id: string;
  status?: string;
  expirationTime?: string;
  accounts?: string[];
  /** The bank didn't return the record: only the id is known. */
  unavailable?: boolean;
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
  return (
    <ConfirmedRevoke
      onRevoke={props.onRevoke}
      view={(confirmation) => <FdxConsentView {...props} {...confirmation} />}
    />
  );
}

/** What `FdxConsent` renders, for each step of the confirmation. */
export function FdxConsentView({
  consentId,
  company,
  record,
  disabled,
  ...confirmation
}: Confirmation & {
  consentId: string;
  company: string;
  record: FdxConsentRecord | undefined;
  disabled: boolean;
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
    <ExtensionGrantView
      {...confirmation}
      name="FDX consent"
      id={consentId}
      details={details}
      revoke="Revoke FDX consent"
      group="Revoke the FDX consent"
      explanation={`${company} ends this consent, its tokens and this sign-in. You can sign in again afterwards.`}
      disabled={disabled}
    />
  );
}

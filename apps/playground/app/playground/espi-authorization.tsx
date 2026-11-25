"use client";
import {
  ConfirmedRevoke,
  day,
  ExtensionGrantView,
  type Confirmation,
} from "./extension-grant";

/** The subscription's bounded fields the page shows (`espi_authorization`). */
export type EspiAuthorizationRecord = {
  id: string;
  status?: string;
  expiresAt?: string;
  /** The shared meters, when the grant reads usage. */
  meters?: Array<{ id: string; title?: string }>;
  /** The utility didn't return the authorization: only the id is known. */
  unavailable?: boolean;
};

/**
 * `poppylab.dev/espi` v1: the ESPI authorization of this sign-in, which is
 * its subscription, and the User's own way to revoke it, confirmed in the
 * page. Iris has no tool for this.
 */
export function EspiAuthorization(props: {
  authorizationId: string;
  company: string;
  record: EspiAuthorizationRecord | undefined;
  disabled: boolean;
  onRevoke: () => void;
}) {
  return (
    <ConfirmedRevoke
      onRevoke={props.onRevoke}
      view={(confirmation) => (
        <EspiAuthorizationView {...props} {...confirmation} />
      )}
    />
  );
}

/** What `EspiAuthorization` renders, for each step of the confirmation. */
export function EspiAuthorizationView({
  authorizationId,
  company,
  record,
  disabled,
  ...confirmation
}: Confirmation & {
  authorizationId: string;
  company: string;
  record: EspiAuthorizationRecord | undefined;
  disabled: boolean;
}) {
  const meters = record?.meters;
  const until = day(record?.expiresAt);
  const details = !record
    ? "Reading its status…"
    : record.unavailable
      ? "Status unavailable"
      : [
          record.status,
          meters
            ? meters.length
              ? `${meters.length === 1 ? "1 meter" : `${meters.length} meters`} (${meters.map((m) => m.title ?? m.id).join(", ")})`
              : "no meters"
            : undefined,
          until ? `until ${until}` : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <ExtensionGrantView
      {...confirmation}
      name="ESPI authorization"
      id={authorizationId}
      details={details}
      revoke="Revoke ESPI access"
      group="Revoke ESPI access"
      explanation={`${company} ends this authorization, its subscription, its tokens and this sign-in. You can sign in again afterwards.`}
      disabled={disabled}
    />
  );
}

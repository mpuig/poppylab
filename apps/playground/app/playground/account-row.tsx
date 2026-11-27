"use client";
import { leftToUser } from "@poppy-lab/pap-agent/auto-approval";
import { StandingInstruction } from "./standing-instruction";
import { FdxConsent, type FdxConsentRecord } from "./fdx-consent";
import { FdxStatements } from "./fdx-statements";
import {
  EspiAuthorization,
  type EspiAuthorizationRecord,
} from "./espi-authorization";
import { FromCompany } from "./company-mark";
import type { CompanyState, Operation } from "./company-state";
import { openQuestion, signInOf } from "./typed";
import { extensionOf, type Playground } from "./use-playground";

/** What the account row says of each domain extension's grant. */
export const GRANT_WORDS = {
  fdx: {
    revoked: (company: string) =>
      `FDX consent revoked. ${company} ended the grant and its tokens, and ${company} is signed out in this conversation.`,
    ended: (company: string) =>
      `This FDX consent had already ended at ${company}. ${company} is signed out in this conversation.`,
    again: "Sign in again to share accounts over FDX",
  },
  espi: {
    revoked: (company: string) =>
      `ESPI access revoked. ${company} ended the authorization, its subscription and its tokens, and ${company} is signed out in this conversation.`,
    ended: (company: string) =>
      `This ESPI authorization had already ended at ${company}. ${company} is signed out in this conversation.`,
    again: "Sign in again to share meters over ESPI",
  },
} as const;

/** The currency the Company's own proposals use; USD until it has made one. */
function currencyOf(operations: Array<{ terms?: Record<string, unknown> }>) {
  const found = operations
    .map((op) => op.terms?.currency)
    .find((c) => typeof c === "string" && /^[A-Z]{3}$/.test(c));
  return typeof found === "string" ? found : "USD";
}

/** Why the User's standing instruction left a waiting operation to them. */
export const leftOutAt =
  (p: Playground, c: CompanyState, now: number) => (op: Operation) =>
    leftToUser(
      op,
      p.instructions[c.origin],
      c.name,
      p.heldBack[`${c.origin} ${op.operation_id}:${op.revision}`],
      now,
    );

/**
 * One Company's account controls, in its panel in the Companies bar: its
 * access, Use FDX or Use ESPI and the grant, change permission, sign-in
 * and sign-out, and the standing instruction. Each acts at this Company
 * only. What waits for the person there (a sign-in to finish, the change
 * permission to ask for) is also an ask in the transcript, where it arose
 * (`asks.ts`). `named` heads the row with the Company.
 */
export function AccountRow({
  p,
  c,
  named,
  now,
}: {
  p: Playground;
  c: CompanyState;
  named: boolean;
  now: number;
}) {
  const { busy } = p;
  const signedIn = c.signedIn;
  const waiting = !!c.signingIn;
  const extension = extensionOf(c);
  const canWrite = p.canWrite(c);
  const moreAccess = p.moreAccess(c);
  const grant = p.grantShown(c) ? c.grantId : undefined;
  // Iris asks about this sign-in in the conversation: it can be answered
  // there as well as here.
  const asked = !!openQuestion(p.messages)?.some(
    (choice) => signInOf(choice)?.company === c.origin,
  );
  return (
    <div className="account-row">
      {named && (
        <h3 className="account-company">
          <FromCompany from={c} />
        </h3>
      )}
      <span>
        {signedIn
          ? `${canWrite ? "Reading and change proposals" : "Read-only access"} · ${c.scopes.split(" ").join(", ")}`
          : waiting
            ? `Finish sign-in in the ${c.name} tab.`
            : asked
              ? "Iris asks about this in the chat: answer “yes” there, or press the button · only connect accounts you trust"
              : "Account access is optional · only connect accounts you trust"}
      </span>
      {extension && (
        // Use FDX or Use ESPI, per Company: the domain extension is
        // declared from the next Session on (§3.4), with its native tools.
        <label className="extension-toggle">
          <input
            type="checkbox"
            checked={c.extensionOn}
            disabled={busy || waiting}
            onChange={(event) =>
              void p.chooseExtension(c.origin, event.target.checked)
            }
          />
          <span>
            Use {extension.label}
            <small>
              {extension.shape} read tools ({extension.name} v1). Changing it
              starts a new Session.
            </small>
          </span>
        </label>
      )}
      {signedIn && grant && extension?.key === "fdx" && (
        <FdxConsent
          key={grant}
          consentId={grant}
          company={c.name}
          record={c.grantRecord as FdxConsentRecord | undefined}
          disabled={busy || waiting}
          onRevoke={() => void p.revokeGrant(c.origin)}
        />
      )}
      {signedIn && grant && extension?.key === "espi" && (
        <EspiAuthorization
          key={grant}
          authorizationId={grant}
          company={c.name}
          record={c.grantRecord as EspiAuthorizationRecord | undefined}
          disabled={busy || waiting}
          onRevoke={() => void p.revokeGrant(c.origin)}
        />
      )}
      {signedIn && p.statementsShown(c) && (
        <FdxStatements
          accounts={c.statements}
          disabled={busy || waiting}
          onList={() => void p.listFdxStatements(c.origin)}
          onDownload={(accountId, statementId) =>
            void p.downloadFdxStatement(c.origin, accountId, statementId)
          }
        />
      )}
      {!signedIn && !waiting && c.grantRevoked && extension && (
        <p className="permission-note" role="status">
          {GRANT_WORDS[extension.key][
            c.grantRevoked === "revoked" ? "revoked" : "ended"
          ](c.name)}{" "}
          {GRANT_WORDS[extension.key].again}.
        </p>
      )}
      {p.extensionSignIn(c) && extension && (
        <button
          type="button"
          className="ghost-button"
          disabled={busy || waiting}
          onClick={() =>
            void p.accountAction(
              "signin",
              c.origin,
              undefined,
              canWrite ? "write" : "read",
            )
          }
        >
          {GRANT_WORDS[extension.key].again}
        </button>
      )}
      {signedIn && moreAccess && (
        <button
          type="button"
          className="ghost-button"
          disabled={busy || waiting}
          onClick={() =>
            void p.accountAction("signin", c.origin, undefined, "write")
          }
        >
          Request change permission
        </button>
      )}
      <button
        type="button"
        className={signedIn ? "text-button" : "connect-button"}
        disabled={busy}
        onClick={() =>
          void p.accountAction(signedIn ? "signout" : "signin", c.origin)
        }
      >
        {signedIn
          ? named
            ? `Sign out of ${c.name}`
            : "Sign out"
          : waiting
            ? "Retry sign-in"
            : `Sign in to ${c.name} · read only`}
      </button>
      {signedIn && canWrite && (
        <StandingInstruction
          instruction={p.instructions[c.origin]}
          currency={
            p.instructions[c.origin]?.currency ?? currencyOf(c.operations)
          }
          onChange={(next) => p.setLimit(c.origin, next)}
          operations={c.operations}
          leftToUser={leftOutAt(p, c, now)}
        />
      )}
      {signedIn && moreAccess && (
        <p className="permission-note">
          This opens a new Company consent. Afterwards Iris asks whether to go
          on with the request that waited for it; you will approve the change
          itself separately.
        </p>
      )}
    </div>
  );
}

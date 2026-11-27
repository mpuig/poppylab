import { ProtocolError, validFdxId } from "@poppy-lab/pap-client";
import { accountUnavailableNotice } from "./account-recovery";
import type { AccountRequest } from "./account-request";
import { signedOutLocally } from "./account-sign-in";
import { afterReset, wordsView } from "./conversation-view";
import { fdxStatementsByAccount } from "./demo-fdx";
import type { DomainExtension } from "./domain-extension";
import { statementLine } from "./inspector-log";
import {
  espiAuthorizationRecord,
  espiAuthorizationTarget,
  fdxConsentRecord,
  fdxEntry,
  fdxStatementDownload,
  fdxUserTools,
  revokeEspiAuthorization,
  revokeFdxConsent,
  setExtension,
  type Connection,
  type Run,
} from "./runtime";
import { json } from "./web";

/**
 * An FDX-shaped answer that isn't what the page asked for, in our own words:
 * the adapter's error code and status, never the Company's text.
 */
function fdxRefusal(answer: Record<string, unknown>) {
  if (answer.error === "insufficient_scope")
    return {
      status: 403,
      code: "insufficient_scope",
      error:
        "This sign-in doesn't include statements (fdx:STATEMENTS). Sign in again with Use FDX on.",
    };
  if (answer.error === "sign_in_required")
    return { status: 400, code: "no_fdx_access", error: "Sign in first." };
  if (answer.error === "fdx_error" && answer.status === 404)
    return {
      status: 404,
      code: "statement_not_found",
      error: "The bank has no such statement for an account you shared.",
    };
  return {
    status: 502,
    code: "fdx_statement_failed",
    error: "The bank didn't return the statements as expected.",
  };
}

/** The shared accounts' statements, reduced to what the account row shows. */
function fdxStatementsAnswer(
  answer: { accounts?: unknown; error?: unknown },
  trace: string[],
) {
  if (typeof answer.error === "string" || !Array.isArray(answer.accounts)) {
    const refusal = fdxRefusal(answer);
    return json(
      { code: refusal.code, error: refusal.error, trace },
      { status: refusal.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const accounts = (answer.accounts as Array<Record<string, unknown>>).map(
    (item) =>
      Array.isArray(item?.statements)
        ? {
            accountId: str(item.accountId),
            productName: str(item.productName),
            accountNumberDisplay: str(item.accountNumberDisplay),
            statements: (item.statements as Array<Record<string, unknown>>).map(
              (st) => ({
                statementId: str(st.statementId),
                statementDate: str(st.statementDate),
                description: str(st.description),
              }),
            ),
          }
        : { error: fdxRefusal(item ?? {}).error },
  );
  return json(
    { accounts, trace },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** The Company says this access is gone: a dead token or refresh token. */
const accessEnded = (error: unknown) =>
  error instanceof ProtocolError &&
  ((error.status === 401 && (!error.code || error.code === "invalid_token")) ||
    (error.status === 400 && error.code === "invalid_grant"));

/**
 * The User revokes a domain extension's grant (the FDX consent, the ESPI
 * authorization) with `revoke`, and the answer the page gets. Revoked, or
 * found already ended: the Company holds no live token of this sign-in, so
 * the connection is signed out here without revoking the dead refresh token.
 * Anything else keeps the sign-in. Signed out, the answer carries what the
 * conversation still shows, as sign-out's does.
 */
async function revocationAnswer(
  run: Run,
  connection: Connection,
  revoke: (connection: Connection, trace: string[]) => Promise<void>,
  what: { name: string; code: string; named: Record<string, unknown> },
  trace: string[],
) {
  try {
    await revoke(connection, trace);
  } catch (error) {
    // The Company no longer takes this sign-in's tokens: the grant has
    // ended already. Its refresh token is dead too, so it isn't revoked.
    if (accessEnded(error)) {
      const withdrew = signedOutLocally(run, connection);
      trace.push(`${what.name} already ended · signed out`);
      return json(
        {
          signedIn: false,
          revoked: "already_ended",
          ...what.named,
          trace,
          ...wordsView(run),
          ...afterReset(run, withdrew),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return json(
      {
        code: what.code,
        error:
          error instanceof ProtocolError &&
          error.status === 429 &&
          error.retryAt
            ? `The Company asked to wait before trying again. The ${what.name} wasn't revoked, and you're still signed in.`
            : error instanceof ProtocolError && error.status < 500
              ? `The Company didn't revoke the ${what.name} (HTTP ${error.status}). You're still signed in; try again, or sign out to end this access.`
              : "The Company didn't confirm the revocation. You're still signed in; try again, or sign out to end this access.",
        trace,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  // The consent or authorization was the grant: its access and refresh
  // tokens are gone at the Company, so sign-out has nothing left to revoke.
  const withdrew = signedOutLocally(run, connection);
  return json(
    {
      signedIn: false,
      revoked: "revoked",
      ...what.named,
      trace,
      ...wordsView(run),
      ...afterReset(run, withdrew),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Access the Company already refused: nothing is sent for it. */
const unavailable = () =>
  json(accountUnavailableNotice, {
    status: accountUnavailableNotice.status,
    headers: { "Cache-Control": "no-store" },
  });

/**
 * Use FDX, Use ESPI. §3.3: only for a Company that lists a valid entry of
 * that extension (v1). A change starts a new Session (§3.4); sign-in is
 * kept.
 */
export async function useExtension(
  { connection, body, said }: AccountRequest,
  extension: DomainExtension,
) {
  if (typeof body.enabled !== "boolean") throw new Error();
  if (
    body.enabled &&
    !connection.company?.profile?.extensions?.[extension.name]
  )
    return json(
      {
        error: `This Company doesn't offer the ${extension.shape} extension.`,
      },
      { status: 400 },
    );
  setExtension(connection, extension.key, body.enabled);
  const on = !!connection[extension.key];
  return json(
    {
      [extension.key]: on,
      sessionId: connection.sessionId,
      trace: said(
        `Use ${extension.label} ${on ? "on" : "off"} · new Session · ${extension.name} ${on ? "v1 declared" : "not declared"}`,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * `fdx_consent`, `fdx_revoke`. poppylab.dev/fdx v1: the User's own look
 * at, and revocation of, the consent of this sign-in. The endpoint and id
 * come from the validated entry and the token response, never from this
 * body.
 */
export async function fdxConsent({
  run,
  connection,
  body,
  trace,
}: AccountRequest) {
  if (connection.accountToken && connection.accountUnavailable)
    return unavailable();
  if (
    !fdxEntry(connection) ||
    !connection.fdxConsent ||
    !connection.accountToken
  )
    return json(
      {
        code: "no_fdx_consent",
        error: !connection.accountToken
          ? "Sign in first: there is no FDX consent to revoke."
          : !fdxEntry(connection)
            ? "Turn on Use FDX to manage the FDX consent."
            : "This sign-in has no FDX consent. Sign in again to share accounts over FDX.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  if (body.action === "fdx_consent") {
    const record = await fdxConsentRecord(connection, trace);
    const resources = Array.isArray(record.resources)
      ? (record.resources as Array<{ resourceId?: unknown }>)
      : [];
    return json(
      {
        consent:
          typeof record.id === "string"
            ? {
                id: record.id,
                status: record.status,
                expirationTime: record.expirationTime,
                accounts: resources.flatMap((r) =>
                  typeof r.resourceId === "string" ? [r.resourceId] : [],
                ),
              }
            : undefined,
        // No record (`fdx_error`, `invalid_response`…): a message of
        // ours, never the Company's words.
        ...(typeof record.id === "string"
          ? {}
          : { error: "The bank didn't return this consent's record." }),
        trace,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  // Awaited here: the run is saved only once it is signed out and the
  // revocation's lines are written.
  return await revocationAnswer(
    run,
    connection,
    revokeFdxConsent,
    {
      name: "FDX consent",
      code: "fdx_revoke_failed",
      named: { consent: connection.fdxConsent },
    },
    trace,
  );
}

/**
 * `espi_authorization`, `espi_revoke`. poppylab.dev/espi v1: the User's
 * own look at, and revocation of, the authorization of this sign-in,
 * which is its subscription. The URI comes from the token response,
 * checked against the entry, never from this body.
 */
export async function espiAuthorization({
  run,
  connection,
  body,
  trace,
}: AccountRequest) {
  if (connection.accountToken && connection.accountUnavailable)
    return unavailable();
  const target = espiAuthorizationTarget(connection);
  if (!target)
    return json(
      {
        code: "no_espi_authorization",
        error: !connection.accountToken
          ? "Sign in first: there is no ESPI authorization to revoke."
          : !connection.espi
            ? "Turn on Use ESPI to manage the ESPI authorization."
            : "This sign-in has no ESPI authorization. Sign in again to share meters over ESPI.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  if (body.action === "espi_revoke")
    // Awaited for the same reason as the FDX consent's.
    return await revocationAnswer(
      run,
      connection,
      revokeEspiAuthorization,
      {
        name: "ESPI authorization",
        code: "espi_revoke_failed",
        named: { authorization: target.id },
      },
      trace,
    );
  const { authorization, meters } = await espiAuthorizationRecord(
    connection,
    trace,
  );
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const points = Array.isArray(meters?.usagePoints)
    ? (meters.usagePoints as Array<Record<string, unknown>>)
    : undefined;
  const known = authorization.authorizationId === target.id;
  return json(
    {
      authorization: known
        ? {
            id: target.id,
            status: str(authorization.status),
            expiresAt: str(authorization.expiresAt),
            meters: points?.flatMap((p) =>
              typeof p?.usagePointId === "string"
                ? [{ id: p.usagePointId, title: str(p.title) }]
                : [],
            ),
          }
        : undefined,
      // No record (`espi_error`, `invalid_response`…): a message of
      // ours, never the Company's words.
      ...(known
        ? {}
        : { error: "The utility didn't return this authorization." }),
      trace,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * `fdx_statements`, `fdx_statement`. poppylab.dev/fdx v1: the User's own
 * statements, listed and downloaded through the native adapter. The URL
 * comes from the validated entry and the ids alone; the model never gets
 * the PDF.
 */
export async function fdxStatements({
  connection,
  body,
  trace,
  said,
  written,
}: AccountRequest) {
  if (connection.accountToken && connection.accountUnavailable)
    return unavailable();
  if (!fdxEntry(connection) || !connection.accountToken)
    return json(
      {
        code: "no_fdx_access",
        error: !connection.accountToken
          ? "Sign in first: statements come from the accounts you share over FDX."
          : "Turn on Use FDX to see statements.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  if (body.action === "fdx_statements") {
    const answer = (await fdxStatementsByAccount(
      fdxUserTools(connection, trace),
    )) as { accounts?: unknown; error?: unknown };
    return fdxStatementsAnswer(answer, trace);
  }
  // The adapter's own id rule, before anything is sent.
  if (!validFdxId(body.accountId) || !validFdxId(body.statementId))
    return json(
      {
        code: "invalid_request",
        error: "Choose a statement from the list.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  // The answer to a download is the file, which carries no lines: the
  // page writes one when the file arrives, and only that one is kept.
  const asked: string[] = [];
  const result = await fdxStatementDownload(
    connection,
    body.accountId,
    body.statementId,
    asked,
  );
  if (!result.pdf) {
    const refusal = fdxRefusal(result);
    return json(
      { code: refusal.code, error: refusal.error, trace: said(...asked) },
      { status: refusal.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  written.push(statementLine(body.statementId, result.pdf.byteLength));
  // Our own file name, from the checked ids: never the Company's header.
  const name = `statement-${String(body.accountId)}-${String(body.statementId)}`
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 120);
  return json(result.pdf as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Content-Length": String(result.pdf.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Poppy-Statement-Sha256": result.sha256,
    },
  });
}

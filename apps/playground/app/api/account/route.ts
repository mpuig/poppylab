import { companyProfile } from "@poppy-lab/pap-core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  connect,
  sendApproval,
  recordOperation,
  clientFor,
  agentFor,
  type Operation,
  type Run,
  accountConfiguration,
  usesDpop,
  revokeRefreshToken,
  pushAuthorizationRequest,
  fdxEntry,
  setExtension,
  fdxConsentRecord,
  revokeFdxConsent,
  fdxUserTools,
  fdxStatementDownload,
  espiAuthorizationTarget,
  espiAuthorizationRecord,
  revokeEspiAuthorization,
} from "@/lib/runtime";
import { extensionByKey, extensionsOn } from "@/lib/domain-extension";
import { fdxStatementsByAccount } from "@/lib/demo-fdx";
import { forgetLostAccount, recordOutcome } from "@/lib/transcript";
import { refusalFacts } from "@/lib/protocol-log";
import {
  applyingLine,
  keepLines,
  notAppliedLine,
  statementLine,
} from "@/lib/inspector-log";
import { shownTasks } from "@/lib/shown-tasks";
import {
  accountRecovery,
  accountUnavailableNotice,
} from "../../../lib/account-recovery";
import { canChange, consentScopes } from "../../../lib/account-permissions";
import {
  randomId,
  createIdentity,
  ProtocolError,
  validFdxId,
} from "@poppy-lab/pap-client";
import { isAccountCompany, serving } from "@/lib/deployment";
import {
  acquireRun,
  createRun,
  readConversation,
  releaseRun,
  secureCookies,
  visitorOf,
  type Held,
} from "@/lib/runs";
import { overBudget } from "@/lib/limits";
import {
  coveredBy,
  notCovered,
  parseInstruction,
} from "@/lib/standing-instructions";
import {
  allowanceReason,
  BUDGET_FACTOR,
  MAX_PER_HOUR,
} from "@/lib/auto-approval";
import { statedReason } from "@/lib/operation-presentation";
import { directState } from "@/lib/direct-state";
export const runtime = "nodejs";
const issuer = "http://juniper.localhost:4100";

/**
 * The run as sign-out leaves it (§5.5): no account tokens, scopes, FDX
 * consent or ESPI subscription, and nothing Iris read with them. The
 * conversation is emptied, what was said signed out included, and the
 * Inspector's lines with it. The Session continues signed out.
 */
function signedOutLocally(run: Run) {
  delete run.accountToken;
  delete run.token;
  delete run.tokenType;
  delete run.tokenExpires;
  delete run.accountUnavailable;
  // §4.5: the tokens for single services go with the account's.
  delete run.resourceTokens;
  delete run.scopes;
  delete run.fdxConsent;
  delete run.espiResourceUri;
  delete run.espiAuthorizationUri;
  delete run.auth;
  run.operations = {};
  run.history = [];
  delete run.transcript;
  delete run.publicHistory;
  // The Inspector's lines follow the conversation: none of an exchange the
  // page no longer shows. The lines of this request are kept after it.
  delete run.log;
  // History lists it under its first request, which is gone with the rest.
  delete run.title;
  // Iris forgets it; the Company keeps the conversation open (§5.5).
  delete run.conversation;
}

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
    return NextResponse.json(
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
  return NextResponse.json(
    { accounts, trace },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * An approval was sent and nothing was performed, and the terms wait for
 * the User. The sentence stays with the operation, where its card shows it
 * until the operation changes, and not in a message above the transcript
 * that the next action clears.
 */
function notPerformed(
  op: Operation,
  why: NonNullable<Operation["notPerformed"]>,
  summary: string,
) {
  op.notPerformed = why;
  op.result = { summary };
  return summary;
}
/** Drops that sentence: the terms no longer wait, or a new approval is out. */
function forgetRefusal(op: Operation) {
  if (!op.notPerformed) return;
  delete op.notPerformed;
  delete op.result;
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
 * the run is signed out here without revoking the dead refresh token.
 * Anything else keeps the sign-in.
 */
async function revocationAnswer(
  run: Run,
  revoke: (run: Run, trace: string[]) => Promise<void>,
  what: { name: string; code: string; named: Record<string, unknown> },
  trace: string[],
) {
  try {
    await revoke(run, trace);
  } catch (error) {
    // The Company no longer takes this sign-in's tokens: the grant has
    // ended already. Its refresh token is dead too, so it isn't revoked.
    if (accessEnded(error)) {
      signedOutLocally(run);
      trace.push(`${what.name} already ended · signed out`);
      return NextResponse.json(
        { signedIn: false, revoked: "already_ended", ...what.named, trace },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
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
  signedOutLocally(run);
  return NextResponse.json(
    { signedIn: false, revoked: "revoked", ...what.named, trace },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** One conversation, named by `?conversation=`: running, or ended and read-only. */
export async function GET(request: Request) {
  if (!serving())
    return NextResponse.json(
      { error: "Account access is disabled on this deployment." },
      { status: 403 },
    );
  const store = await cookies();
  const visitor = visitorOf(store);
  const id = new URL(request.url).searchParams.get("conversation");
  const run = visitor ? await readConversation(visitor, id) : undefined;
  return NextResponse.json(
    {
      // Unknown here: never started in this browser, or past its keep time.
      missing: !run,
      conversation: run ? id : undefined,
      readOnly: !!run?.archived,
      keptUntil: run?.archived ? run.keepUntil : undefined,
      company: run?.company,
      // What the page showed, to show again: the transcript, with Company
      // content and each answer's label, steps and data. Not the model's
      // context, except in a run that has no transcript yet.
      history: run?.transcript ?? run?.history ?? [],
      // The Inspector's "Session & API calls" lines, to list again.
      log: run?.log ?? [],
      // §9.1: the tasks its current Session read, for "Tasks not offered".
      excludedTasks: run ? shownTasks(run) : [],
      url: run?.url,
      scopes: run?.scopes,
      // Use FDX (poppylab.dev/fdx v1), a setting of this conversation.
      fdx: !!run?.fdx,
      // The FDX consent of this sign-in, for the page to show and revoke
      // with Use FDX on.
      fdxConsent:
        run?.accountToken && !run.accountUnavailable
          ? run.fdxConsent
          : undefined,
      // Use ESPI (poppylab.dev/espi v1), the same setting at a utility, and
      // the id of this sign-in's authorization, to show and revoke with it.
      espi: !!run?.espi,
      espiAuthorization: run ? espiAuthorizationTarget(run)?.id : undefined,
      consentVersion: run?.consentVersion ?? 0,
      recovery: run?.accountUnavailable ? accountUnavailableNotice : undefined,
      signedIn:
        !!run?.accountToken &&
        !run.accountUnavailable &&
        run.expires > Date.now(),
      authPending: !!run?.auth || !!run?.busy,
      // §8.10: a reload must not send the User's words for the Company to
      // Iris. Under its own name: `conversation` here is the ID.
      directConversation: run ? directState(run) : undefined,
      // An ended conversation shows how its proposals ended.
      operations:
        run && (run.archived || run.expires > Date.now())
          ? Object.values(run.operations ?? {})
          : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
/** Names the conversation in a header, so the page can keep its address. */
export async function POST(request: Request) {
  const started: { id?: string } = {};
  const response = await act(request, started);
  if (started.id) response.headers.set("X-Poppy-Conversation", started.id);
  return response;
}
async function act(request: Request, started: { id?: string }) {
  if (
    !serving() ||
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return NextResponse.json(
      { error: "Same-origin requests required" },
      { status: 403 },
    );
  const store = await cookies();
  const visitor = visitorOf(store, true);
  const limited = await overBudget(request, visitor, "account");
  if (limited) return limited;
  const current = await acquireRun(
    visitor,
    request.headers.get("x-poppy-conversation") ?? undefined,
  );
  if (current === "busy")
    return NextResponse.json(
      { error: "Wait for the current request." },
      { status: 409 },
    );
  let held: Held | undefined = current;
  if (!held) {
    let origin: string;
    try {
      const input = new URL(request.headers.get("x-pap-company") ?? issuer);
      if (input.username || input.password || !isAccountCompany(input.origin))
        throw Error();
      origin = input.origin;
    } catch {
      return NextResponse.json(
        { error: "Unsupported account Company." },
        { status: 400 },
      );
    }
    held = await createRun(visitor, origin);
  }
  started.id = held.id;
  const run = held.run;
  if (!isAccountCompany(new URL(run.url).origin)) {
    await releaseRun(visitor, held);
    return NextResponse.json(
      { error: "Connect to a supported account Company first." },
      { status: 400 },
    );
  }
  let operationRequested = false;
  // The lines this request writes for the Inspector. The answer carries
  // them, and they are kept with the conversation (`finally`) as lines of
  // the account that was signed in when the request began.
  const trace: string[] = [];
  const withAccount = !!run.accountToken;
  /** Lines of one answer, kept as well. */
  const said = (...lines: string[]) => {
    trace.push(...lines);
    return lines;
  };
  // A line the page writes itself, because no answer can carry it: kept
  // in the same words, and never answered, or the page would list it twice.
  const written: string[] = [];
  // Iris already knew that the Company no longer takes the sign-in. An
  // action in which it learns that drops what it showed with the account.
  const knewLost = !!run.accountUnavailable;
  try {
    // All actions have a tiny fixed schema; bound the stream before parsing.
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request timed out")), 3000);
    });
    try {
      while (true) {
        const r = await Promise.race([reader.read(), deadline]);
        if (r.done) break;
        size += r.value.byteLength;
        if (size > 2048) throw new Error();
        chunks.push(r.value);
      }
    } finally {
      clearTimeout(timer!);
      void reader.cancel();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      action: string;
      access?: unknown;
      id?: string;
      revision?: string;
      /**
       * The User's standing instruction: for an agent approval (§5), or for
       * the line about terms it leaves to the User (`not_applied`).
       */
      instruction?: unknown;
      /** `not_applied`: the hour's limit the page says holds the terms back. */
      allowance?: unknown;
      /** `fdx`, `espi`: Use FDX or Use ESPI on or off. */
      enabled?: unknown;
      /** `fdx_statement`: which statement of which shared account. */
      accountId?: unknown;
      statementId?: unknown;
    };
    const extension = extensionByKey(body.action);
    if (extension) {
      // Use FDX, Use ESPI. §3.3: only for a Company that lists a valid
      // entry of that extension (v1). A change starts a new Session (§3.4);
      // sign-in is kept.
      if (typeof body.enabled !== "boolean") throw new Error();
      if (body.enabled && !run.company?.profile?.extensions?.[extension.name])
        return NextResponse.json(
          {
            error: `This Company doesn't offer the ${extension.shape} extension.`,
          },
          { status: 400 },
        );
      setExtension(run, extension.key, body.enabled);
      const on = !!run[extension.key];
      return NextResponse.json(
        {
          [extension.key]: on,
          sessionId: run.sessionId,
          trace: said(
            `Use ${extension.label} ${on ? "on" : "off"} · new Session · ${extension.name} ${on ? "v1 declared" : "not declared"}`,
          ),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (body.action === "fdx_consent" || body.action === "fdx_revoke") {
      // poppylab.dev/fdx v1: the User's own look at, and revocation of, the
      // consent of this sign-in. The endpoint and id come from the
      // validated entry and the token response, never from this body.
      if (run.accountToken && run.accountUnavailable)
        return NextResponse.json(accountUnavailableNotice, {
          status: accountUnavailableNotice.status,
          headers: { "Cache-Control": "no-store" },
        });
      if (!fdxEntry(run) || !run.fdxConsent || !run.accountToken)
        return NextResponse.json(
          {
            code: "no_fdx_consent",
            error: !run.accountToken
              ? "Sign in first: there is no FDX consent to revoke."
              : !fdxEntry(run)
                ? "Turn on Use FDX to manage the FDX consent."
                : "This sign-in has no FDX consent. Sign in again to share accounts over FDX.",
          },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      if (body.action === "fdx_consent") {
        const record = await fdxConsentRecord(run, trace);
        const resources = Array.isArray(record.resources)
          ? (record.resources as Array<{ resourceId?: unknown }>)
          : [];
        return NextResponse.json(
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
      // Awaited here: the run is saved (`finally`) only once it is signed
      // out and the revocation's lines are written.
      return await revocationAnswer(
        run,
        revokeFdxConsent,
        {
          name: "FDX consent",
          code: "fdx_revoke_failed",
          named: { consent: run.fdxConsent },
        },
        trace,
      );
    }
    if (body.action === "espi_authorization" || body.action === "espi_revoke") {
      // poppylab.dev/espi v1: the User's own look at, and revocation of,
      // the authorization of this sign-in, which is its subscription. The
      // URI comes from the token response, checked against the entry,
      // never from this body.
      if (run.accountToken && run.accountUnavailable)
        return NextResponse.json(accountUnavailableNotice, {
          status: accountUnavailableNotice.status,
          headers: { "Cache-Control": "no-store" },
        });
      const target = espiAuthorizationTarget(run);
      if (!target)
        return NextResponse.json(
          {
            code: "no_espi_authorization",
            error: !run.accountToken
              ? "Sign in first: there is no ESPI authorization to revoke."
              : !run.espi
                ? "Turn on Use ESPI to manage the ESPI authorization."
                : "This sign-in has no ESPI authorization. Sign in again to share meters over ESPI.",
          },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      if (body.action === "espi_revoke")
        // Awaited for the same reason as the FDX consent's.
        return await revocationAnswer(
          run,
          revokeEspiAuthorization,
          {
            name: "ESPI authorization",
            code: "espi_revoke_failed",
            named: { authorization: target.id },
          },
          trace,
        );
      const { authorization, meters } = await espiAuthorizationRecord(
        run,
        trace,
      );
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);
      const points = Array.isArray(meters?.usagePoints)
        ? (meters.usagePoints as Array<Record<string, unknown>>)
        : undefined;
      const known = authorization.authorizationId === target.id;
      return NextResponse.json(
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
    if (body.action === "fdx_statements" || body.action === "fdx_statement") {
      // poppylab.dev/fdx v1: the User's own statements, listed and
      // downloaded through the native adapter. The URL comes from the
      // validated entry and the ids alone; the model never gets the PDF.
      if (run.accountToken && run.accountUnavailable)
        return NextResponse.json(accountUnavailableNotice, {
          status: accountUnavailableNotice.status,
          headers: { "Cache-Control": "no-store" },
        });
      if (!fdxEntry(run) || !run.accountToken)
        return NextResponse.json(
          {
            code: "no_fdx_access",
            error: !run.accountToken
              ? "Sign in first: statements come from the accounts you share over FDX."
              : "Turn on Use FDX to see statements.",
          },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      if (body.action === "fdx_statements") {
        const answer = (await fdxStatementsByAccount(
          fdxUserTools(run, trace),
        )) as { accounts?: unknown; error?: unknown };
        return fdxStatementsAnswer(answer, trace);
      }
      // The adapter's own id rule, before anything is sent.
      if (!validFdxId(body.accountId) || !validFdxId(body.statementId))
        return NextResponse.json(
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
        run,
        body.accountId,
        body.statementId,
        asked,
      );
      if (!result.pdf) {
        const refusal = fdxRefusal(result);
        return NextResponse.json(
          { code: refusal.code, error: refusal.error, trace: said(...asked) },
          { status: refusal.status, headers: { "Cache-Control": "no-store" } },
        );
      }
      written.push(statementLine(body.statementId, result.pdf.byteLength));
      // Our own file name, from the checked ids: never the Company's header.
      const name =
        `statement-${String(body.accountId)}-${String(body.statementId)}`
          .replace(/[^A-Za-z0-9._-]/g, "_")
          .slice(0, 120);
      return new Response(result.pdf as Uint8Array<ArrayBuffer>, {
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
    if (body.action === "signin") {
      // §4.2: plain OAuth Direct Sign-In. It doesn't know the Session;
      // the callback starts a new Session for the signed-in account.
      const candidate = { ...run, history: [] } as Run;
      await connect(candidate, []);
      const profile = companyProfile(candidate.company!);
      // §3.2 auth.disabled, or no Direct Sign-In grant: never start one.
      if (!profile.signIn.direct)
        return NextResponse.json(
          { error: "This Company doesn't offer sign-in to Personal Agents." },
          { status: 400 },
        );
      let scopes: string;
      try {
        // A domain extension's scopes (the FDX-shaped data clusters, the
        // ESPI-shaped scopes) only with it on (RFC 9700 §2.3).
        scopes = consentScopes(profile, body.access, extensionsOn(candidate));
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "This Company does not advertise the requested permissions.",
          },
          { status: 400 },
        );
      }
      run.company = candidate.company!;
      const config = accountConfiguration(run);
      const clientId = clientFor(run),
        agentOrigin = agentFor(run);
      const state = randomId();
      const verifier = randomId() + randomId();
      run.auth = {
        state,
        verifier,
        expires: Date.now() + 300000,
        issuer: config.issuer,
        scopes,
        ...(usesDpop(run) ? { dpop: (await createIdentity()).privateKey } : {}),
      };
      store.set("pap_oauth", state, {
        httpOnly: true,
        secure: secureCookies(),
        sameSite: "lax",
        path: "/api/account/callback",
        maxAge: 300,
      });
      const params = {
        response_type: "code",
        client_id: clientId,
        redirect_uri: `${agentOrigin}/api/account/callback`,
        scope: scopes,
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        // §4.2: the redirect can come back on another device, so the
        // Company shows its consent page even for scopes granted before.
        prompt: "consent",
      };
      const url = new URL(config.authorization_endpoint!);
      if (config.pushed_authorization_request_endpoint) {
        // §4.2, RFC 9126: push the request with the client assertion (and a
        // DPoP proof that binds the code), then open only client_id and
        // request_uri. Used whenever the Company offers it.
        const pushed = await pushAuthorizationRequest(
          run,
          params,
          run.auth.dpop,
        );
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("request_uri", pushed);
      } else
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return NextResponse.json(
        { url: url.toString(), consentVersion: run.consentVersion ?? 0 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (body.action === "signout") {
      // §5.5: sign-out revokes every refresh token held for the account.
      if (run.accountToken) await revokeRefreshToken(run, run.accountToken);
      signedOutLocally(run);
      return NextResponse.json({
        signedIn: false,
        trace: said("Account grant revoked · Session signed out"),
      });
    }
    if (!["approve", "decline", "retry", "not_applied"].includes(body.action))
      throw new Error();
    const op = run.operations?.[body.id ?? ""];
    if (!op || body.revision !== op.revision) throw new Error();
    if (body.action === "not_applied") {
      // The User's standing instruction lives in the browser, so the page
      // is the one to see that it leaves these terms to the User. The check
      // is made again here and the line is written in its words, once for
      // each reason: a reload then lists it as it was, and asks for nothing.
      const instruction = parseInstruction(body.instruction);
      if (!instruction) throw new Error();
      // An approval the Company declined or answered with new terms got
      // its own line then.
      const answered = op.agentDeclined || op.agentSuperseded;
      // Only the hour's allowance can hold back terms the instruction
      // covers. The page counts it over every conversation with the
      // Company and this run over its own, so the page says which limit.
      const reason = answered
        ? undefined
        : (notCovered(op, instruction) ??
          (coveredBy(op, instruction) &&
          (body.allowance === "count" || body.allowance === "total")
            ? allowanceReason(body.allowance, instruction)
            : undefined));
      const lines: string[] = [];
      if (reason && op.notApplied !== reason) {
        op.notApplied = reason;
        lines.push(...said(notAppliedLine(reason)));
      }
      return NextResponse.json(
        { operation: op, trace: lines },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    // Declining is local: the Company kept nothing to cancel (Operations v3).
    if (body.action === "decline") {
      if (op.state !== "proposed") throw new Error();
      op.state = "declined";
      op.changed = Date.now();
      op.result = { summary: "Declined. Nothing was sent to the Company." };
      delete op.notPerformed;
      delete op.request;
      return NextResponse.json(
        {
          operation: op,
          trace: said(`Operation ${op.state} · revision ${op.revision}`),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!run.accountToken) throw new ProtocolError(401, undefined);
    // Approving needs a scope that can change something (Company hints).
    if (!canChange(companyProfile(run.company!), run.scopes ?? ""))
      throw new ProtocolError(403, "insufficient_scope");
    if (
      body.action === "approve" &&
      (op.state !== "proposed" || Date.parse(op.expires_at) <= Date.now())
    ) {
      if (op.state === "proposed") {
        op.state = "expired";
        forgetRefusal(op);
      }
      return NextResponse.json(
        {
          code: "proposal_expired",
          next: "status",
          error:
            "This proposal has expired or was already handled. Nothing was submitted. Ask for the change again to get fresh terms.",
        },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Only an uncertain approval is resent, and only the one that was sent
    // (§7). Without it there is nothing to retry: a new approval, in the
    // User's name or Iris's, is only ever made by "approve".
    if (body.action === "retry" && (op.state !== "uncertain" || !op.approval))
      throw new Error();
    // Operations v3 §5, agent approval: only on the User's own instruction,
    // checked here against these exact terms, never on the model's word,
    // and never again once the Company declined one for this operation or
    // answered one with new terms.
    let approver: "user" | "agent" =
      body.action === "retry" ? (op.approval?.approver ?? "user") : "user";
    let rule: string | undefined;
    let ruleCents = 0;
    if (body.action === "approve" && body.instruction !== undefined) {
      const instruction = parseInstruction(body.instruction);
      const covered = instruction && coveredBy(op, instruction);
      // The page wrote this line before it asked.
      if (covered) written.push(applyingLine(covered.text));
      const recent = (run.agentApprovals ?? []).filter(
        (a) => a.at > Date.now() - 3_600_000,
      );
      run.agentApprovals = recent;
      const spent = recent.reduce((sum, a) => sum + a.cents, 0);
      const refusal = op.agentDeclined
        ? "The Company declined an approval on your standing instruction for this. Approve it yourself if you want it."
        : op.agentSuperseded
          ? "The Company answered an approval on your standing instruction with new terms. Approve them yourself if you want them."
          : !covered
            ? "Your standing instruction doesn't cover these exact terms. Approve them yourself if you want them."
            : recent.length >= MAX_PER_HOUR
              ? `Your standing instruction approved ${MAX_PER_HOUR} changes in the last hour. Approve this one yourself.`
              : spent + covered.cents > instruction!.maxCents * BUDGET_FACTOR
                ? `Your standing instruction approved more than ${BUDGET_FACTOR} times its limit in the last hour. Approve this one yourself.`
                : undefined;
      if (refusal || !covered) {
        // The page asks only when its own check and its own hour allow the
        // approval, so here this run's hour is what holds it back. The
        // Inspector says that as it does when the page sees it, once.
        const held =
          covered && !op.agentDeclined && !op.agentSuperseded
            ? allowanceReason(
                recent.length >= MAX_PER_HOUR ? "count" : "total",
                instruction!,
              )
            : undefined;
        if (held && op.notApplied !== held) {
          op.notApplied = held;
          said(notAppliedLine(held));
        }
        return NextResponse.json(
          { code: "not_covered", operation: op, error: refusal, trace },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      approver = "agent";
      rule = covered.text;
      ruleCents = covered.cents;
    }
    // An agent approval counts toward the hour's limits once, when it is
    // first sent and performed or possibly performed. Its retry is the same
    // approval (§7), not another one, and has no amount of its own.
    const countAgentApproval = () => {
      if (approver === "agent" && body.action === "approve")
        run.agentApprovals = [
          ...(run.agentApprovals ?? []),
          { at: Date.now(), cents: ruleCents },
        ].slice(-20);
    };
    // This approval gets its own answer, and however the Company answers
    // it, this operation is the one something happened to last.
    forgetRefusal(op);
    op.changed = Date.now();
    // The request that carries the approval, for the page's log: its method
    // and path, as a tool's own line names it. Read now, since an answer
    // that ends the operation forgets the request.
    const sent = op.request?.conversation
      ? `${op.request.conversation.endpoint}/${op.request.conversation.id}/messages`
      : op.request?.url;
    /**
     * The log's line for a request the Company refused: its status and
     * error code, never its words or a header.
     */
    const refusedTrace = (error: unknown) => {
      if (!(error instanceof ProtocolError)) return [];
      // Both are short tokens by the time they get here (`ProtocolError`).
      const code = error.code ?? error.companyCode;
      return said(
        `POST ${sent ? new URL(sent).pathname : "approval"} · refused by the Company · HTTP ${error.status}${code ? ` ${code}` : ""}`,
      );
    };
    operationRequested = true;
    try {
      const result = (await sendApproval(run, op, approver)) as {
        summary?: unknown;
      } | null;
      op.state = "succeeded";
      op.result = {
        summary:
          typeof result?.summary === "string"
            ? result.summary.slice(0, 2000)
            : "The Company performed the approved operation.",
      };
      op.approvedBy = {
        approver,
        ...(rule ? { rule } : {}),
        ...(op.approval?.reference ? { reference: op.approval.reference } : {}),
      };
      countAgentApproval();
      delete op.request;
    } catch (error) {
      if (
        error instanceof ProtocolError &&
        error.status === 403 &&
        error.code === "approval_declined"
      ) {
        if (approver === "agent") {
          // §6: the Company won't take Iris's approval. Nothing was done;
          // the User decides now, with an approval of their own.
          op.agentDeclined = {
            ...(error.declined?.reason
              ? { reason: error.declined.reason.slice(0, 300) }
              : {}),
          };
          delete op.approval;
          // A declined retry is a known outcome too (§7). With no approval
          // left to resend, it goes back to waiting for the User's Approve,
          // without what an earlier retry left about an unknown outcome.
          op.state = "proposed";
          delete op.result;
          recordOutcome(
            run,
            op,
            "declined",
            `The Company declined the approval Iris sent on the user's standing instruction; nothing was performed, and it's waiting for the user.${statedReason(error.declined?.reason)}`,
          );
          return NextResponse.json(
            {
              operation: op,
              code: "agent_approval_declined",
              trace: said(
                "Company declined the approval on your standing instruction · waiting for you",
              ),
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        // Operations v3 §6: nothing performed; never send this approval again.
        op.state = "refused";
        op.result = {
          summary: `${run.company?.document.organization.name ?? "The Company"} declined this approval and did nothing.${statedReason(error.declined?.reason)}`,
        };
        delete op.request;
        recordOutcome(
          run,
          op,
          "declined",
          `Company declined the approval; nothing was performed. ${op.result.summary}`,
        );
        return NextResponse.json(
          {
            operation: op,
            code: "approval_declined",
            trace: said("Approval declined by the Company · nothing performed"),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      // §6: the Company returned other terms. Never approve them for the User.
      let next: ReturnType<typeof recordOperation> | undefined;
      if (
        error instanceof ProtocolError &&
        error.status === 403 &&
        error.code === "approval_required"
      ) {
        const named = (error.operation ?? {}) as {
          operation_id?: unknown;
          revision?: unknown;
        };
        if (
          body.action === "retry" &&
          (named.operation_id !== op.operation_id ||
            named.revision !== op.revision)
        ) {
          // §7: a new operation or revision in answer to a retry doesn't
          // say whether the approval sent first was performed, and until
          // that is known nothing new is approved or put to the User. The
          // new terms aren't kept: the operation stays uncertain, with the
          // approval Retry resends. Only a website's operation has a status
          // to look up (§6), so here the User checks the Company's records.
          // Asked for again in this conversation, the same operation stays
          // uncertain (recordOperation), so the note points to a new one.
          const company = run.company?.document.organization.name;
          // §5: when the terms come back, Iris's rule doesn't approve them.
          if (approver === "agent") op.agentSuperseded = true;
          op.result = {
            summary: `${company ?? "The Company"} answered the retry with new terms instead of a result. That doesn't say whether the approval sent first was performed, so the new terms aren't offered for approval. Check ${company ? `${company}'s` : "the Company's"} own records to see whether the change was made, such as by asking Iris to read your account. If it wasn't, ask for the change in a new conversation to get terms you can approve.`,
          };
          return NextResponse.json(
            {
              // Not `outcome_unknown`, for which the page shows its own
              // copy of the operation, without this note.
              code: "new_terms_after_retry",
              next: "status",
              operation: op,
              error: op.result.summary,
              trace: said(
                "Retry answered with new terms · outcome still unknown",
              ),
            },
            { status: 409, headers: { "Cache-Control": "no-store" } },
          );
        }
        try {
          // The answer to the approval itself: for a retry too, it settles
          // an unknown outcome (the same revision; nothing was performed).
          // Only for the operation approved: another one's approval, if it
          // is out with an unknown outcome, isn't answered by this (§7).
          next = recordOperation(
            run,
            error.operation,
            op.request!,
            named.operation_id === op.operation_id,
          );
          // That other operation offers nothing to approve: a refusal, below.
          if (next.state === "uncertain") next = undefined;
        } catch {
          // Terms Poppy can't show or that have expired: a refusal, below.
        }
      }
      if (next) {
        // §8.10: terms that answer an approval sent to the User's Direct
        // Conversation were proposed there too.
        if (op.direct) next.direct = true;
        const sameOperation = next.operation_id === op.operation_id;
        if (sameOperation && next.revision === op.revision) {
          // §6 forbids this answer, so the approval is never sent again in
          // a loop. The Company performed nothing and the outcome is known
          // (§7): the terms wait for the User, who may approve them anew.
          delete next.approval;
          const again =
            "The Company asked for approval of the same terms again instead of performing them. Nothing was performed. Approve them again yourself if you still want this, or decline.";
          // After Iris's approval the card has its own note for this.
          if (approver === "agent") next.agentDeclined = {};
          else notPerformed(next, "refused", again);
          return NextResponse.json(
            {
              code: "approval_not_accepted",
              next: "review",
              operation: next,
              error: again,
              trace: said(
                "Approval answered with the same terms again · nothing performed",
              ),
            },
            { status: 409, headers: { "Cache-Control": "no-store" } },
          );
        }
        const company =
          run.company?.document.organization.name ?? "The Company";
        // §5: new terms in answer to Iris's approval are never approved on
        // the same instruction, even when it covers them. The User decides.
        if (approver === "agent") next.agentSuperseded = true;
        if (!sameOperation) {
          // Operations v3 §4 keeps the ID when terms change, but a Company
          // may answer with another one. The approved terms are then over:
          // the Company refused their approval and offers these instead.
          // What it told Iris about the action goes with the new terms.
          if (op.agentDeclined) next.agentDeclined = op.agentDeclined;
          if (op.agentSuperseded) next.agentSuperseded = true;
          op.state = "superseded";
          op.result = {
            summary: `${company} offered new terms instead of performing these, so they can no longer be approved.`,
          };
          // Never sent again.
          delete op.request;
          delete op.approval;
        }
        // The new terms say what they answer. After Iris's approval the
        // card has its own note for that, so only the reason is kept.
        const changed = `${company} returned these new terms instead of performing the ones ${approver === "agent" ? "Iris approved on your standing instruction" : "you approved"}. Nothing was performed. Approve them if you still want this, or decline.`;
        if (approver === "agent") next.notPerformed = "new_terms";
        else notPerformed(next, "new_terms", changed);
        return NextResponse.json(
          {
            code: "terms_changed",
            next: "review",
            operation: next,
            // The retired operation, for the page to show as it now is.
            ...(sameOperation ? {} : { replaced: op }),
            error: changed,
            trace: said("Approval answered with new terms · nothing performed"),
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      // The operation's conversation refused the message that carried the
      // approval: nothing was performed. That outcome is known, not lost.
      const refusal =
        error instanceof ProtocolError && op.request?.conversation
          ? error.code
          : undefined;
      if (refusal === "direct_conversation_open")
        // §8.10: the conversation takes messages again once the User leaves
        // the Direct Conversation, so the operation waits as it was.
        return NextResponse.json(
          {
            code: refusal,
            next: "review",
            operation: op,
            error: notPerformed(
              op,
              "refused",
              "The Company says a direct conversation with you is still open, and it takes no approval in this one until that ends. Nothing was performed. Leave the direct conversation, then try again.",
            ),
            trace: refusedTrace(error),
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      if (
        // §8.12, §8.3: closed for good, and a message the Company had
        // accepted would have got its first answer again.
        refusal === "conversation_closed" ||
        // The Company no longer has it. Only a first send is known then.
        (refusal === "conversation_not_found" && body.action === "approve")
      ) {
        op.state = "expired";
        op.result = {
          summary:
            "The conversation this was proposed in has ended, so it can't be approved any more. Nothing was performed. Ask for the change again to get fresh terms.",
        };
        // Never sent again: new terms get a new approval.
        delete op.request;
        delete op.approval;
        return NextResponse.json(
          {
            code: refusal,
            next: "status",
            operation: op,
            error: op.result.summary,
            trace: refusedTrace(error),
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (
        !(error instanceof ProtocolError) ||
        error.status >= 500 ||
        error.status === 429 ||
        // A timeout, even when the Company is the one reporting it.
        error.status === 408 ||
        // §8.3: a conversation accepts the message, then reads the reply.
        // An error about the cursor comes after the approval was taken.
        refusal === "invalid_cursor" ||
        refusal === "cursor_expired"
      ) {
        // Lost response, timeout, 503 in progress: the outcome is unknown.
        op.state = "uncertain";
        // It may have been performed, so it uses the allowance now.
        countAgentApproval();
      } else if (body.action === "approve" && !accountRecovery(error)) {
        // Any other 4xx is the Company refusing the request: it performed
        // nothing, and no allowance is used. The terms and the approval
        // stay, so the User can send it again or ask for new terms. Only a
        // first send is known this way: a refused retry doesn't say what
        // became of the approval sent before it. Sign-in and permission
        // errors keep their own answers.
        const code = error.code ?? error.companyCode;
        // A number it gave with the refusal, as the chat's error says it.
        const facts = refusalFacts(error.body).join(", ");
        return NextResponse.json(
          {
            code: "not_performed",
            next: "review",
            operation: op,
            // The Company's status and error code, never its own words. A
            // code of its own, such as insufficient_funds, says what to fix,
            // and the balance or the limit it gave says by how much.
            error: notPerformed(
              op,
              "refused",
              `${run.company?.document.organization.name ?? "The Company"} refused this request (HTTP ${error.status}${code ? `, ${code}` : ""}${facts ? `; ${facts}` : ""}). Nothing was performed. The terms still wait for you: approve them again once what stopped it is sorted out, or ask for the change again to get fresh terms.`,
            ),
            trace: refusedTrace(error),
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      throw error;
    }
    recordOutcome(
      run,
      op,
      "performed",
      `Company operation succeeded: ${op.result.summary}`,
    );
    return NextResponse.json(
      {
        operation: op,
        trace: said(`Operation ${op.state} · revision ${op.revision}`),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // A request that failed answers with the lines written before it did,
    // as a chat turn does: the page lists what is kept.
    const recovery = accountRecovery(error);
    if (recovery) {
      if (recovery.next === "signin") run.accountUnavailable = true;
      // With the message about the lost access goes what the page still
      // shows: the answers and proposals Iris got with the account are gone.
      return NextResponse.json(
        { ...recovery, trace, ...forgetLostAccount(run, knewLost) },
        {
          status: recovery.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (
      error instanceof ProtocolError &&
      error.retryAt &&
      error.retryAt > Date.now()
    )
      return NextResponse.json(
        {
          error: `${error.message}. Wait before trying again. An uncertain approval is retried with the same approval, never a new proposal.`,
          trace,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.ceil((error.retryAt - Date.now()) / 1000),
            ),
            "Cache-Control": "no-store",
          },
        },
      );
    if (
      error instanceof Error &&
      error.message.startsWith("Set AGENT_PUBLIC_ORIGIN ")
    )
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(
      {
        code: operationRequested ? "outcome_unknown" : "account_request_failed",
        next: operationRequested ? "status" : "signin",
        error: operationRequested
          ? "The Company's response is unknown. The change may already have completed. Use Retry the same approval; it is performed at most once. Don't ask for a new proposal yet."
          : "Account request failed. Retry sign-in, or reconnect if the Company restarted.",
        trace,
      },
      {
        status: operationRequested ? 502 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } finally {
    keepLines(run, [...written, ...trace], Date.now(), withAccount);
    // However the action ended: a request inside it may have been the one
    // in which the Company refused the sign-in. After the lines are kept,
    // so those written with the account go with the rest.
    forgetLostAccount(run, knewLost);
    await releaseRun(visitor, held).catch(() => {});
  }
}

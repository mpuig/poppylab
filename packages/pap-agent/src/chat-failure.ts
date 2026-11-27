import { ModelRequestError } from "@poppy-lab/llm-adapters/server";
import { ProtocolError } from "@poppy-lab/pap-client";
import { PapDiscoveryError } from "@poppy-lab/pap-core";
import { accountRecovery } from "./account-recovery";
import type { TurnScope } from "./chat-turn";
import { companyRef, originOf } from "./connections";
import { companiesView, lostAccess } from "./conversation-view";
import { refusalFacts } from "./protocol-log";
import { UserFacingError } from "./user-error";
import { json, type Reply } from "./web";

/**
 * The answer to a turn that failed: what went wrong in words safe to
 * show, with every line the turn wrote and what it had done to the
 * conversation's Companies before it failed.
 */
export function failedTurn(error: unknown, scope: TurnScope): Reply {
  const { run, connection, parts, trace, did, stage } = scope;
  const recovery = accountRecovery(error);
  // In a turn with several Companies, the one this failed at: the answer
  // is about that one, and what it knew of its sign-in.
  const at =
    scope.failure && scope.failure.error === error
      ? scope.failure.connection
      : connection;
  const knew =
    parts.find((part) => part.connection === at)?.knewLost ?? scope.knewLost;
  // Every line the turn wrote, each Company's too.
  const lines = [...trace, ...parts.flatMap((part) => part.trace)];
  // The Company the turn that failed was with, when it had got to one,
  // and what the User's words had done to the Companies before it.
  const turn = {
    ...(run && at ? { from: companyRef(run, originOf(at)) } : {}),
    ...(run && at && parts.length
      ? {
          traces: [
            ...(trace.length
              ? [{ from: companyRef(run, originOf(at)), trace }]
              : []),
            ...parts.map((part) => ({ from: part.ref, trace: part.trace })),
          ],
        }
      : {}),
    ...(did.before ? { before: did.before } : {}),
    ...(run && did.changed ? companiesView(run) : {}),
    ...did.left,
  };
  // Signed out, a token error means the Company refused the Session
  // itself: there is no account access to renew (often a different draft).
  if (
    recovery &&
    at &&
    !at.accountToken &&
    error instanceof ProtocolError &&
    error.code === "invalid_token"
  )
    return json(
      {
        error:
          "The Company refused this signed-out Poppy 1.0 Session. It may implement another version of the protocol; check its discovery in the Inspector.",
        code: "session_refused",
        stage,
        trace: lines,
        ...turn,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  // Signed out, a plain sign-in challenge is not lost access.
  if (recovery && at && !at.accountToken)
    return json(
      {
        error:
          "This needs your account at the Company, which didn't take the request without it. Use Sign in in the chat if the Company offers it, then ask again.",
        code: "sign_in_required",
        next: "signin",
        stage,
        trace: lines,
        ...turn,
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  if (recovery) {
    if (at && recovery.next === "signin") at.accountUnavailable = true;
    // With the message about the lost access goes what the page still
    // shows: the answers Iris read with the account are gone from it.
    const lost = run && at ? lostAccess(run, at, knew) : undefined;
    return json(
      { ...recovery, stage, trace: lines, ...turn, ...lost },
      { status: recovery.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof ModelRequestError) {
    return json(
      {
        error: error.message,
        code: error.code,
        stage: "provider",
        trace: lines,
        ...turn,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  // A Company's protocol error: its status and code are safe to show
  // (never its free text) and are what an interop report needs.
  if (error instanceof ProtocolError) {
    const code = /^[A-Za-z0-9_.:-]{1,64}$/.test(error.code ?? "")
      ? error.code
      : undefined;
    // A code of the Company's own, such as insufficient_funds, is shown
    // too; `code` below stays the protocol's.
    const shown = code ?? error.companyCode;
    // And a number it gave, in our own words (`refusalFacts`).
    const facts = refusalFacts(error.body);
    return json(
      {
        error: `${at?.company?.document.organization.name ?? "The Company"} answered HTTP ${error.status}${shown ? ` ${shown}` : ""}${facts.length ? ` (${facts.join(", ")})` : ""}. Nothing was retried; see the Inspector.`,
        code: code ?? "company_error",
        stage,
        trace: lines,
        ...turn,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const message = error instanceof Error ? error.message : "Chat failed";
  // Operator log: stage and error class only; never the request, keys or tokens.
  console.error(
    "chat_failed",
    stage,
    error instanceof Error ? `${error.name}: ${message.slice(0, 160)}` : "",
  );
  // Only messages written for the visitor are shown; discovery errors are
  // ours too (the same text the Connect step shows).
  const safe =
    error instanceof UserFacingError ||
    error instanceof PapDiscoveryError ||
    // Local provider configuration hints from the adapters, nothing else.
    (stage === "provider" &&
      /^(Set [A-Z_]+_API_KEY|Unknown model)/.test(message))
      ? message
      : "Chat request failed. Check the Company is running and the selected provider is configured; retry with Protocol demo.";
  return json(
    { error: safe, stage, trace: lines, ...turn },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

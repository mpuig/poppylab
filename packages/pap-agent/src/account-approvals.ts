import { ProtocolError } from "@poppy-lab/pap-client";
import { companyProfile } from "@poppy-lab/pap-core";
import { agentName } from "./agent";
import { canChange } from "./account-permissions";
import { accountRecovery } from "./account-recovery";
import type { AccountRequest } from "./account-request";
import { allowanceReason, BUDGET_FACTOR, MAX_PER_HOUR } from "./auto-approval";
import { applyingLine, notAppliedLine } from "./inspector-log";
import { inheritOperationAccounts, operationAccounts } from "./operation-store";
import { statedReason } from "./operation-presentation";
import { refusalFacts } from "./protocol-log";
import { recordOperation, sendApproval, type Operation } from "./runtime";
import {
  coveredBy,
  notCovered,
  parseInstruction,
} from "./standing-instructions";
import { proposalName } from "./approval-question";
import { companyName, originOf } from "./connections";
import { languageOf } from "./language";
import { say } from "./lines";
import { recordOutcome, settleQuestion, shownTranscript } from "./transcript";
import { json } from "./web";

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

/**
 * `approve`, `decline`, `retry`, `not_applied`: the User's decision on one
 * proposal, at the revision the page shows. Approving sends the approval
 * (Operations v3 §6), in the User's name or, on their standing
 * instruction, Iris's (§5); a retry resends the very approval whose
 * outcome isn't known (§7).
 */
export async function decide(request: AccountRequest) {
  const { run, connection, body, trace, said, written } = request;
  const op = connection.operations?.[body.id ?? ""];
  if (!op || body.revision !== op.revision) throw new Error();
  request.others = operationAccounts(connection, op.operation_id);
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
    return json(
      { operation: op, trace: lines },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  // Declining is local: the Company kept nothing to cancel (Operations v3).
  if (body.action === "decline") {
    if (op.state !== "proposed") throw new Error();
    op.state = "declined";
    op.changed = Date.now();
    op.result = { summary: "Declined. No approval was sent to the Company." };
    delete op.notPerformed;
    delete op.request;
    return json(
      {
        operation: op,
        trace: said(`Operation ${op.state} · revision ${op.revision}`),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!connection.accountToken) throw new ProtocolError(401, undefined);
  // Approving needs a scope that can change something (Company hints).
  if (!canChange(companyProfile(connection.company!), connection.scopes ?? ""))
    throw new ProtocolError(403, "insufficient_scope");
  if (
    body.action === "approve" &&
    (op.state !== "proposed" || Date.parse(op.expires_at) <= Date.now())
  ) {
    if (op.state === "proposed") {
      op.state = "expired";
      forgetRefusal(op);
    }
    return json(
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
    const recent = (connection.agentApprovals ?? []).filter(
      (a) => a.at > Date.now() - 3_600_000,
    );
    connection.agentApprovals = recent;
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
      return json(
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
      connection.agentApprovals = [
        ...(connection.agentApprovals ?? []),
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
  request.operationRequested = true;
  try {
    // How the User answered: in words in the chat, or with a button.
    const input = body.input === "typed" ? "typed" : "tap";
    const result = (await sendApproval(connection, op, approver, input)) as {
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
          connection,
          op,
          "declined",
          `The Company declined the approval ${agentName()} sent on the user's standing instruction; nothing was performed, and it's waiting for the user.${statedReason(error.declined?.reason)}`,
        );
        return json(
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
        summary: `${connection.company?.document.organization.name ?? "The Company"} declined this approval and did nothing.${statedReason(error.declined?.reason)}`,
      };
      delete op.request;
      recordOutcome(
        run,
        connection,
        op,
        "declined",
        `Company declined the approval; nothing was performed. ${op.result.summary}`,
      );
      return json(
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
        const company = connection.company?.document.organization.name;
        // §5: when the terms come back, Iris's rule doesn't approve them.
        if (approver === "agent") op.agentSuperseded = true;
        op.result = {
          summary: `${company ?? "The Company"} answered the retry with new terms instead of a result. That doesn't say whether the approval sent first was performed, so the new terms aren't offered for approval. Check ${company ? `${company}'s` : "the Company's"} own records to see whether the change was made, such as by asking ${agentName()} to read your account. If it wasn't, ask for the change in a new conversation to get terms you can approve.`,
        };
        return json(
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
          connection,
          error.operation,
          op.request!,
          named.operation_id === op.operation_id,
        );
        // That other operation offers nothing to approve: a refusal, below.
        if (next.state === "uncertain") next = undefined;
        // The new terms answer the request the approved ones were for.
        else
          inheritOperationAccounts(
            connection,
            op.operation_id,
            next.operation_id,
          );
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
        return json(
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
        connection.company?.document.organization.name ?? "The Company";
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
      const changed = `${company} returned these new terms instead of performing the ones ${approver === "agent" ? `${agentName()} approved on your standing instruction` : "you approved"}. Nothing was performed. Approve them if you still want this, or decline.`;
      if (approver === "agent") next.notPerformed = "new_terms";
      else notPerformed(next, "new_terms", changed);
      return json(
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
      return json(
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
      return json(
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
      return json(
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
            `${connection.company?.document.organization.name ?? "The Company"} refused this request (HTTP ${error.status}${code ? `, ${code}` : ""}${facts ? `; ${facts}` : ""}). Nothing was performed. The terms still wait for you: approve them again once what stopped it is sorted out, or ask for the change again to get fresh terms.`,
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
    connection,
    op,
    "performed",
    `Company operation succeeded: ${op.result.summary}`,
  );
  // Iris's question about it, asked a moment ago, was answered by the
  // User's standing instruction: it no longer asks, it says what Iris did.
  const settled =
    approver === "agent" &&
    settleQuestion(
      run,
      (ref) => {
        const other = run.connections.find((c) => originOf(c) === ref.company);
        const asked = other?.operations?.[ref.proposal];
        return !!asked && asked.state !== "proposed";
      },
      say(languageOf(run), "approvedOnInstruction", {
        what: proposalName(op, companyName(connection), languageOf(run)),
      }),
    );
  return json(
    {
      operation: op,
      trace: said(`Operation ${op.state} · revision ${op.revision}`),
      // What the page shows now, with that question's words changed.
      ...(settled ? { history: shownTranscript(run) } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

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
  type Run,
  accountConfiguration,
  usesDpop,
  revokeRefreshToken,
  pushAuthorizationRequest,
} from "@/lib/runtime";
import { record } from "@/lib/transcript";
import {
  accountRecovery,
  accountUnavailableNotice,
} from "../../../lib/account-recovery";
import { canChange, consentScopes } from "../../../lib/account-permissions";
import { randomId, createIdentity, ProtocolError } from "@poppy-lab/pap-client";
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
import { coveredBy, parseInstruction } from "@/lib/standing-instructions";
import { BUDGET_FACTOR, MAX_PER_HOUR } from "@/lib/auto-approval";
import { directState } from "@/lib/direct-state";
export const runtime = "nodejs";
const issuer = "http://juniper.localhost:4100";
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
      history: run?.transcript ?? run?.history ?? [],
      url: run?.url,
      scopes: run?.scopes,
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
      /** The User's standing instruction, for an agent approval (§5). */
      instruction?: unknown;
    };
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
        scopes = consentScopes(profile, body.access);
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
      // §5.5: the Session continues signed out.
      delete run.accountToken;
      delete run.token;
      delete run.tokenType;
      delete run.tokenExpires;
      // §4.5: the tokens for single services go with the account's.
      delete run.resourceTokens;
      delete run.scopes;
      delete run.auth;
      run.operations = {};
      run.history = [];
      delete run.transcript;
      delete run.publicHistory;
      // Iris forgets it; the Company keeps the conversation open (§5.5).
      delete run.conversation;
      return NextResponse.json({ signedIn: false });
    }
    if (!["approve", "decline", "retry"].includes(body.action))
      throw new Error();
    const op = run.operations?.[body.id ?? ""];
    if (!op || body.revision !== op.revision) throw new Error();
    // Declining is local: the Company kept nothing to cancel (Operations v3).
    if (body.action === "decline") {
      if (op.state !== "proposed") throw new Error();
      op.state = "declined";
      op.result = { summary: "Declined. Nothing was sent to the Company." };
      delete op.request;
      return NextResponse.json(
        { operation: op },
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
      if (op.state === "proposed") op.state = "expired";
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
    // Only an uncertain approval is resent, with the same approval (§7).
    if (body.action === "retry" && op.state !== "uncertain") throw new Error();
    // Operations v3 §5, agent approval: only on the User's own instruction,
    // checked here against these exact terms, never on the model's word,
    // and never again once the Company declined one for this operation.
    let approver: "user" | "agent" =
      body.action === "retry" ? (op.approval?.approver ?? "user") : "user";
    let rule: string | undefined;
    let ruleCents = 0;
    if (body.action === "approve" && body.instruction !== undefined) {
      const instruction = parseInstruction(body.instruction);
      const covered = instruction && coveredBy(op, instruction);
      const recent = (run.agentApprovals ?? []).filter(
        (a) => a.at > Date.now() - 3_600_000,
      );
      run.agentApprovals = recent;
      const spent = recent.reduce((sum, a) => sum + a.cents, 0);
      const refusal = op.agentDeclined
        ? "The Company declined an approval on your standing instruction for this. Approve it yourself if you want it."
        : !covered
          ? "Your standing instruction doesn't cover these exact terms. Approve them yourself if you want them."
          : recent.length >= MAX_PER_HOUR
            ? `Your standing instruction approved ${MAX_PER_HOUR} changes in the last hour. Approve this one yourself.`
            : spent + covered.cents > instruction!.maxCents * BUDGET_FACTOR
              ? `Your standing instruction approved more than ${BUDGET_FACTOR} times its limit in the last hour. Approve this one yourself.`
              : undefined;
      if (refusal || !covered)
        return NextResponse.json(
          { code: "not_covered", operation: op, error: refusal },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      approver = "agent";
      rule = covered.text;
      ruleCents = covered.cents;
    }
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
      if (approver === "agent")
        run.agentApprovals = [
          ...(run.agentApprovals ?? []),
          { at: Date.now(), cents: ruleCents },
        ].slice(-20);
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
          record(run, {
            role: "assistant",
            content: `The Company declined the approval Iris sent on the user's standing instruction; nothing was performed, and it's waiting for the user.${error.declined?.reason ? ` Its reason: ${error.declined.reason}` : ""}`,
          });
          return NextResponse.json(
            { operation: op, code: "agent_approval_declined" },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        // Operations v3 §6: nothing performed; never send this approval again.
        op.state = "refused";
        op.result = {
          summary: `${run.company?.document.organization.name ?? "The Company"} declined this approval and did nothing.${error.declined?.reason ? ` Its reason: ${error.declined.reason}` : ""}`,
        };
        delete op.request;
        record(run, {
          role: "assistant",
          content: `Company declined the approval; nothing was performed. ${op.result.summary}`,
        });
        return NextResponse.json(
          { operation: op, code: "approval_declined" },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (
        error instanceof ProtocolError &&
        error.status === 403 &&
        error.code === "approval_required"
      ) {
        // §6: the Company returned other terms. Never approve them for the User.
        const next = recordOperation(run, error.operation, op.request!);
        if (next.revision === op.revision) {
          // §6 forbids this answer, so the approval is never sent again in
          // a loop. The Company performed nothing and the outcome is known
          // (§7): the terms wait for the User, who may approve them anew.
          delete next.approval;
          if (approver === "agent") next.agentDeclined = {};
          return NextResponse.json(
            {
              code: "approval_not_accepted",
              next: "review",
              operation: next,
              error:
                "The Company asked for approval of the same terms again instead of performing them. Nothing was performed. Approve them again yourself if you still want this, or decline.",
            },
            { status: 409, headers: { "Cache-Control": "no-store" } },
          );
        }
        return NextResponse.json(
          {
            code: "terms_changed",
            next: "review",
            operation: next,
            error:
              "The Company returned new terms. Nothing was performed. Review the new revision and approve it separately.",
          },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (
        !(error instanceof ProtocolError) ||
        error.status >= 500 ||
        error.status === 429
      )
        // Lost response, timeout, 503 in progress: the outcome is unknown.
        op.state = "uncertain";
      throw error;
    }
    record(run, {
      role: "assistant",
      content: `Company operation succeeded: ${op.result.summary}`,
    });
    return NextResponse.json(
      { operation: op },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const recovery = accountRecovery(error);
    if (recovery) {
      if (recovery.next === "signin") run.accountUnavailable = true;
      return NextResponse.json(recovery, {
        status: recovery.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (
      error instanceof ProtocolError &&
      error.retryAt &&
      error.retryAt > Date.now()
    )
      return NextResponse.json(
        {
          error: `${error.message}. Wait before trying again. An uncertain approval is retried with the same approval, never a new proposal.`,
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
      },
      {
        status: operationRequested ? 502 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } finally {
    await releaseRun(visitor, held).catch(() => {});
  }
}

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
} from "@/lib/runtime";
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
  loadRun,
  releaseRun,
  secureCookies,
  visitorOf,
  type Held,
} from "@/lib/runs";
import { overBudget } from "@/lib/limits";
export const runtime = "nodejs";
const issuer = "http://juniper.localhost:4100";
export async function GET() {
  if (!serving())
    return NextResponse.json(
      { error: "Account access is disabled on this deployment." },
      { status: 403 },
    );
  const store = await cookies();
  const visitor = visitorOf(store);
  const run = visitor
    ? (await loadRun(visitor, store.get("pap_run")?.value))?.run
    : undefined;
  return NextResponse.json(
    {
      company: run?.company,
      history: run?.history ?? [],
      url: run?.url,
      scopes: run?.scopes,
      consentVersion: run?.consentVersion ?? 0,
      recovery: run?.accountUnavailable ? accountUnavailableNotice : undefined,
      signedIn:
        !!run?.accountToken &&
        !run.accountUnavailable &&
        run.expires > Date.now(),
      authPending: !!run?.auth || !!run?.busy,
      operations:
        run?.expires && run.expires > Date.now()
          ? Object.values(run.operations ?? {})
          : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
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
  const current = await acquireRun(visitor, store.get("pap_run")?.value);
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
    store.set("pap_run", held.id, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "strict",
      path: "/",
      maxAge: 1800,
    });
  }
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
    };
    if (body.action === "signin") {
      // 0.3 §4.2: plain OAuth Direct Sign-In. It doesn't know the Session;
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
      const url = new URL(config.authorization_endpoint!);
      for (const [k, v] of Object.entries({
        response_type: "code",
        client_id: clientId,
        redirect_uri: `${agentOrigin}/api/account/callback`,
        scope: scopes,
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      }))
        url.searchParams.set(k, v);
      return NextResponse.json(
        { url: url.toString(), consentVersion: run.consentVersion ?? 0 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (body.action === "signout") {
      // 0.3 §5.5: sign-out revokes every refresh token held for the account.
      if (run.accountToken) await revokeRefreshToken(run, run.accountToken);
      // 0.3 §5.5: the Session continues signed out.
      delete run.accountToken;
      delete run.token;
      delete run.tokenType;
      delete run.tokenExpires;
      delete run.scopes;
      delete run.auth;
      run.operations = {};
      run.history = [];
      delete run.publicHistory;
      return NextResponse.json({ signedIn: false });
    }
    if (!["approve", "decline", "retry"].includes(body.action))
      throw new Error();
    const op = run.operations?.[body.id ?? ""];
    if (!op || body.revision !== op.revision) throw new Error();
    // Declining is local: the Company kept nothing to cancel (Operations v2).
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
    operationRequested = true;
    try {
      const result = (await sendApproval(run, op)) as {
        summary?: unknown;
      } | null;
      op.state = "succeeded";
      op.result = {
        summary:
          typeof result?.summary === "string"
            ? result.summary.slice(0, 2000)
            : "The Company performed the approved operation.",
      };
      delete op.request;
    } catch (error) {
      if (
        error instanceof ProtocolError &&
        error.status === 403 &&
        error.code === "approval_required"
      ) {
        // §6: the Company returned other terms. Never approve them for the User.
        const next = recordOperation(run, error.operation, op.request!);
        if (next.revision === op.revision)
          throw new Error("Approval loop", { cause: error });
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
    run.history.push({
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

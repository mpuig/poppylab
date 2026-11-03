import { cookies } from "next/headers";
import {
  identity,
  clientFor,
  agentFor,
  localOrigins,
  accountConfiguration,
  newSession,
  revokeRefreshToken,
  usesDpop,
} from "@/lib/runtime";
import { assertion, proof, protocolRequest } from "@poppy-lab/pap-client";
import { tokenResponse } from "../../../../lib/token-response";
import { serving } from "@/lib/deployment";
import {
  acquireRun,
  releaseRun,
  runForState,
  secureCookies,
  visitorOf,
} from "@/lib/runs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const store = await cookies();
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const cookie = store.get("pap_oauth")?.value;
  // Only the visitor who started this sign-in can complete it.
  const visitor = visitorOf(store);
  const found =
    visitor && state && cookie === state && serving()
      ? await runForState(visitor, state)
      : undefined;
  const held =
    found && visitor ? await acquireRun(visitor, found.id) : undefined;
  const fail = () =>
    new Response(
      "Sign-in failed or was declined. Close this tab and retry Sign in in the playground.",
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  if (!held || held === "busy" || !visitor || held.run.auth?.state !== state)
    return fail();
  const { id, run } = held;
  const pending = run.auth!;
  delete run.auth;
  store.delete("pap_oauth");
  if (
    url.searchParams.get("iss") !== pending.issuer ||
    url.searchParams.has("error") ||
    !url.searchParams.get("code")
  ) {
    await releaseRun(visitor, held);
    return fail();
  }
  try {
    const clientId = clientFor(run),
      agentOrigin = agentFor(run);
    const config = accountConfiguration(run);
    const issuer = config.issuer;
    if (issuer !== pending.issuer) throw Error("Issuer changed");
    const endpoint = config.token_endpoint;
    const keys = await identity();
    const dpop = usesDpop(run) ? pending.dpop : undefined;
    if (usesDpop(run) && !dpop) throw Error("Missing DPoP key");
    // 0.3 §4.2: authorization_code with PKCE and private_key_jwt; no session_id.
    const raw = (await protocolRequest(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(dpop ? { DPoP: await proof(dpop, endpoint, "POST") } : {}),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_assertion_type:
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          client_assertion: await assertion(
            keys.privateKey,
            clientId,
            clientId,
            issuer,
          ),
          code: url.searchParams.get("code")!,
          redirect_uri: `${agentOrigin}/api/account/callback`,
          code_verifier: pending.verifier,
        }).toString(),
      },
      localOrigins,
      dpop
        ? {
            key: dpop,
            assertions: { key: keys.privateKey, client: clientId, issuer },
          }
        : undefined,
    )) as Record<string, unknown>;
    const result = tokenResponse(raw, pending.scopes, !!dpop, true);
    const replaced = run.accountToken;
    // Preserve the conversation from public access, including across later
    // consent. Account-specific turns and approvals cannot cross accounts.
    if (!run.accountToken)
      run.publicHistory = structuredClone(run.history.slice(-10));
    // §5.4: a new sign-in may be another account, so start a new Session.
    newSession(run);
    delete run.accountUnavailable;
    run.consentVersion = (run.consentVersion ?? 0) + 1;
    run.history = structuredClone(run.publicHistory ?? []);
    run.operations = {};
    run.scopes = result.scope;
    run.token = result.accessToken;
    run.tokenType = result.tokenType;
    run.tokenExpires = result.expires;
    run.accountToken = result.refreshToken!;
    if (dpop) run.dpop = dpop;
    // §4.7: revoke the refresh token the new sign-in replaced (best effort;
    // revoking a replaced token isn't sign-out).
    if (replaced) void revokeRefreshToken(run, replaced).catch(() => undefined);
    store.set("pap_run", id, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "strict",
      path: "/",
      maxAge: Math.max(1, Math.floor((run.expires - Date.now()) / 1000)),
    });
    return new Response(
      "Signed in to the Company account. Close this tab and return to Poppy Lab.",
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Type": "text/plain",
        },
      },
    );
  } catch {
    return fail();
  } finally {
    await releaseRun(visitor, held).catch(() => {});
  }
}

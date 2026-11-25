import { cookies } from "next/headers";
import {
  identity,
  clientFor,
  agentFor,
  localOrigins,
  accountConfiguration,
  newSession,
  papRequest,
  revokeRefreshToken,
  usesDpop,
  type Run,
} from "@/lib/runtime";
import { assertion, proof, protocolRequest } from "@poppy-lab/pap-client";
import { keepTokenFields, tokenResponse } from "../../../../lib/token-response";
import { serving } from "@/lib/deployment";
import { acquireRun, releaseRun, runForState, visitorOf } from "@/lib/runs";
export const runtime = "nodejs";

/**
 * §8.2: a conversation that used an account belongs to it, and a token
 * response doesn't say which account a sign-in is for. The Company does: it
 * answers `conversation_not_found` to another account. So each thread is
 * read once with the new sign-in, from its saved cursor, which changes
 * nothing here. Any answer but the events counts as no.
 */
async function sameOwner(run: Run) {
  const conversation = run.conversation;
  if (!conversation?.id) return false;
  try {
    for (const thread of [conversation, conversation.direct]) {
      if (!thread) continue;
      const url = new URL(`${conversation.endpoint}/${thread.id}/events`);
      if (thread.cursor) url.searchParams.set("cursor", thread.cursor);
      await papRequest(run, url.href, "GET");
    }
    return true;
  } catch {
    return false;
  }
}

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
  const { run } = held;
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
    // §4.2: authorization_code with PKCE and private_key_jwt; no session_id.
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
    delete run.transcript;
    run.operations = {};
    run.scopes = result.scope;
    run.token = result.accessToken;
    run.tokenType = result.tokenType;
    run.tokenExpires = result.expires;
    run.accountToken = result.refreshToken!;
    // poppylab.dev/fdx v1: the consent id of this grant, when it has one;
    // poppylab.dev/espi v1: its subscription and authorization URIs.
    keepTokenFields(run, result, true);
    if (dpop) run.dpop = dpop;
    // §4.5: per-service tokens were issued to the sign-in this one replaces:
    // its account, scopes and DPoP key. None is sent again.
    delete run.resourceTokens;
    // The conversation with the Company's agent, and the User's Direct
    // Conversation in it (§8.10), may belong to the account of the sign-in
    // this one replaces. The same account goes on in it (§8.11); for
    // another, Iris forgets it, as at sign-out. Signed out before, no
    // account had used it.
    if (replaced && !(await sameOwner(run))) delete run.conversation;
    // §4.7: revoke the refresh token the new sign-in replaced (best effort;
    // revoking a replaced token isn't sign-out).
    if (replaced) void revokeRefreshToken(run, replaced).catch(() => undefined);
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

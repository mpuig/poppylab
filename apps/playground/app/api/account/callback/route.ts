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
import {
  assertion,
  proof,
  protocolRequest,
  ProtocolError,
} from "@poppy-lab/pap-client";
import { keepTokenFields, tokenResponse } from "../../../../lib/token-response";
import { serving } from "@/lib/deployment";
import { acquireRun, releaseRun, runForState, visitorOf } from "@/lib/runs";
import { keepSignedOutTranscript } from "@/lib/transcript";
import { keepLines } from "@/lib/inspector-log";
export const runtime = "nodejs";

/** A thread's events from its saved cursor: a read that changes nothing here. */
const events = (endpoint: string, thread: { id?: string; cursor?: string }) => {
  const url = new URL(`${endpoint}/${thread.id}/events`);
  if (thread.cursor) url.searchParams.set("cursor", thread.cursor);
  return url.href;
};

/**
 * §8.2: a conversation that used an account belongs to it, and a token
 * response doesn't say which account a sign-in is for. The Company does: it
 * answers `conversation_not_found` to another account. So each thread is
 * read once with the new sign-in. Any answer but the events counts as no.
 */
async function sameOwner(run: Run) {
  const conversation = run.conversation;
  if (!conversation?.id) return false;
  try {
    for (const thread of [conversation, conversation.direct]) {
      if (!thread) continue;
      await papRequest(run, events(conversation.endpoint, thread), "GET");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the conversation with the Company's agent has used the account of
 * the sign-in the run holds, asked before a new one replaces it. Only then
 * does `sameOwner` say the new sign-in is for that account: a conversation
 * no account has used answers any sign-in (§8.2).
 *
 * Signed out, the Company refuses one that used an account with a challenge
 * (§8.11), and answers one that didn't. That one is left as it is: read
 * with the old sign-in it would become its account's. Then the old sign-in
 * must still read it, which only that account's can. Any other answer
 * counts as no.
 */
async function usedThisAccount(run: Run) {
  const conversation = run.conversation;
  if (!run.accountToken || !conversation?.id) return false;
  const url = events(conversation.endpoint, conversation);
  try {
    await papRequest(run, url, "GET", undefined, { signedOut: true });
    return false;
  } catch (error) {
    if (!(
      error instanceof ProtocolError &&
      error.status === 401 &&
      !error.code
    ))
      return false;
  }
  try {
    await papRequest(run, url, "GET");
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the tab goes once the code is spent or refused: a page of ours at an
 * address that carries nothing from the query, so the one-time code doesn't
 * stay in the address bar or the history of a tab left open. The outcome is
 * one of two fixed words, which the page turns into its own fixed text. The
 * address is relative: the browser resolves it against the callback's.
 */
const leave = (result: "done" | "failed") =>
  new Response(null, {
    status: 303,
    headers: {
      Location: `/playground/sign-in/${result}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

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
  if (!held || held === "busy" || !visitor || held.run.auth?.state !== state)
    return leave("failed");
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
    return leave("failed");
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
    // Asked while the run still holds the sign-in this one replaces.
    const used = await usedThisAccount(run);
    const replaced = run.accountToken;
    // Preserve the conversation from public access, including across later
    // consent. Account-specific turns and approvals cannot cross accounts.
    if (!run.accountToken)
      run.publicHistory = structuredClone(run.history.slice(-10));
    // §5.4: a new sign-in may be another account, so start a new Session.
    newSession(run);
    delete run.accountUnavailable;
    run.consentVersion = (run.consentVersion ?? 0) + 1;
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
    const same = !!replaced && (await sameOwner(run));
    if (replaced && !same) delete run.conversation;
    // What Iris read and showed with the account, and the proposals it
    // got, stay only for a sign-in the Company's answers show to be for
    // the same account: the conversation had used it, and still takes this
    // one. Any other may be someone else's, or there is no way to tell,
    // and the conversation goes back to what it was before any account
    // access. The page keeps that public part as it showed it.
    if (!(used && same)) {
      run.history = structuredClone(run.publicHistory ?? []);
      keepSignedOutTranscript(run);
      run.operations = {};
    }
    // §4.7: revoke the refresh token the new sign-in replaced (best effort;
    // revoking a replaced token isn't sign-out).
    if (replaced) void revokeRefreshToken(run, replaced).catch(() => undefined);
    // The Inspector's line for it, which the page lists once it sees the
    // sign-in is complete.
    keepLines(run, [
      `Direct Sign-In completed · PKCE + issuer validation · ${dpop ? "DPoP" : "Bearer"} account Session`,
    ]);
    return leave("done");
  } catch {
    return leave("failed");
  } finally {
    await releaseRun(visitor, held).catch(() => {});
  }
}

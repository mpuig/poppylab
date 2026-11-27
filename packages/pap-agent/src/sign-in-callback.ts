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
  type Connection,
} from "./runtime";
import { connectionForState, originOf } from "./connections";
import { labCompanies } from "./lab-companies";
import { APP_SIGN_IN_END, appSignIn } from "./sign-in-cookie";
import {
  assertion,
  proof,
  protocolRequest,
  ProtocolError,
} from "@poppy-lab/pap-client";
import { keepTokenFields, tokenResponse } from "./token-response";
import { serving } from "./deployment";
import { acquireRun, releaseRun, runForState } from "./runs";
import { browserCaller, type CookieStore } from "./web";
import { backToPublic, keepPublicHistory } from "./transcript";
import { keepLines } from "./inspector-log";

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
async function sameOwner(connection: Connection) {
  const conversation = connection.conversation;
  if (!conversation?.id) return false;
  try {
    for (const thread of [conversation, conversation.direct]) {
      if (!thread) continue;
      await papRequest(
        connection,
        events(conversation.endpoint, thread),
        "GET",
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the conversation with the Company's agent has used the account of
 * the sign-in the connection holds, asked before a new one replaces it. Only then
 * does `sameOwner` say the new sign-in is for that account: a conversation
 * no account has used answers any sign-in (§8.2).
 *
 * Signed out, the Company refuses one that used an account with a challenge
 * (§8.11), and answers one that didn't. That one is left as it is: read
 * with the old sign-in it would become its account's. Then the old sign-in
 * must still read it, which only that account's can. Any other answer
 * counts as no.
 */
async function usedThisAccount(connection: Connection) {
  const conversation = connection.conversation;
  if (!connection.accountToken || !conversation?.id) return false;
  const url = events(conversation.endpoint, conversation);
  try {
    await papRequest(connection, url, "GET", undefined, { signedOut: true });
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
    await papRequest(connection, url, "GET");
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
const leaveTab = (result: "done" | "failed") =>
  new Response(null, {
    status: 303,
    headers: {
      Location: `/playground/sign-in/${result}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
/**
 * An app's sign-in (`sign-in-links.ts`) ends at the one address the app
 * watches for, with the outcome and, for one of the lab's Companies, the
 * lab's key for it, so the page can name it. Fixed words only.
 */
const leaveApp = (result: "done" | "failed", company?: string) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: `${APP_SIGN_IN_END}?result=${result}${company ? `&company=${company}` : ""}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

/**
 * `GET /api/account/callback`: where the Company sends the browser back
 * after its consent page (§4.2), with the code or the refusal.
 */
export async function signInCallback(request: Request, cookies: CookieStore) {
  const caller = await browserCaller(request, cookies);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  // Only the visitor who started this sign-in can complete it, in the
  // browser that started it: it holds this very sign-in's cookie. A
  // sign-in under way at another Company has its own, and is left alone.
  // An app's sign-in is its account's, which this browser has no cookie
  // for: the agent noted whose when the app's link was opened here.
  const app =
    state && caller.signIns.holds(state) ? await appSignIn(state) : undefined;
  const visitor = app ?? caller.user();
  const leave = (result: "done" | "failed", company?: string) =>
    app ? leaveApp(result, company) : leaveTab(result);
  const found =
    visitor && state && caller.signIns.holds(state) && serving()
      ? await runForState(visitor, state)
      : undefined;
  const held =
    found && visitor ? await acquireRun(visitor, found.id) : undefined;
  // The sign-in is one Company's: its connection is the one that waits for
  // this state, and the tokens are kept there and nowhere else.
  const connection =
    held && held !== "busy" && state
      ? connectionForState(held.run, state)
      : undefined;
  if (!held || held === "busy" || !visitor || !connection)
    return leave("failed");
  const { run } = held;
  const pending = connection.auth!;
  delete connection.auth;
  // Spent, whatever comes of it: the cookie goes with the pending sign-in.
  caller.signIns.release(state!);
  if (
    url.searchParams.get("iss") !== pending.issuer ||
    url.searchParams.has("error") ||
    !url.searchParams.get("code")
  ) {
    await releaseRun(visitor, held).catch(() => {});
    return leave("failed");
  }
  try {
    const clientId = clientFor(connection),
      agentOrigin = agentFor(connection);
    const config = accountConfiguration(connection);
    const issuer = config.issuer;
    if (issuer !== pending.issuer) throw Error("Issuer changed");
    const endpoint = config.token_endpoint;
    const keys = await identity();
    const dpop = usesDpop(connection) ? pending.dpop : undefined;
    if (usesDpop(connection) && !dpop) throw Error("Missing DPoP key");
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
    // Asked while the connection still holds the sign-in this one replaces.
    const used = await usedThisAccount(connection);
    const replaced = connection.accountToken;
    // Preserve the conversation from public access, including across later
    // consent. Account-specific turns and approvals cannot cross accounts.
    if (!connection.accountToken) keepPublicHistory(run, connection);
    // §5.4: a new sign-in may be another account, so start a new Session.
    newSession(connection);
    delete connection.accountUnavailable;
    connection.consentVersion = (connection.consentVersion ?? 0) + 1;
    connection.scopes = result.scope;
    connection.token = result.accessToken;
    connection.tokenType = result.tokenType;
    connection.tokenExpires = result.expires;
    connection.accountToken = result.refreshToken!;
    // poppylab.dev/fdx v1: the consent id of this grant, when it has one;
    // poppylab.dev/espi v1: its subscription and authorization URIs.
    keepTokenFields(connection, result, true);
    if (dpop) connection.dpop = dpop;
    // §4.5: per-service tokens were issued to the sign-in this one replaces:
    // its account, scopes and DPoP key. None is sent again.
    delete connection.resourceTokens;
    // The conversation with the Company's agent, and the User's Direct
    // Conversation in it (§8.10), may belong to the account of the sign-in
    // this one replaces. The same account goes on in it (§8.11); for
    // another, Iris forgets it, as at sign-out. Signed out before, no
    // account had used it.
    const same = !!replaced && (await sameOwner(connection));
    if (replaced && !same) delete connection.conversation;
    // What Iris read and showed with the account, and the proposals it
    // got, stay only for a sign-in the Company's answers show to be for
    // the same account: the conversation had used it, and still takes this
    // one. Any other may be someone else's, or there is no way to tell,
    // and the conversation goes back to what it was before any account
    // access. The page keeps that public part as it showed it.
    if (!(used && same)) backToPublic(run, connection);
    // §4.7: revoke the refresh token the new sign-in replaced (best effort;
    // revoking a replaced token isn't sign-out).
    if (replaced)
      void revokeRefreshToken(connection, replaced).catch(() => undefined);
    // The Inspector's line for it, which the page lists once it sees the
    // sign-in is complete. It says only that a sign-in happened, and how:
    // nothing an account holds. So it is kept as a line written signed
    // out is, and a later sign-in lists it whoever that one is for.
    keepLines(
      run,
      connection,
      [
        `Direct Sign-In completed · PKCE + issuer validation · ${dpop ? "DPoP" : "Bearer"} account Session`,
      ],
      Date.now(),
      false,
    );
    return leave(
      "done",
      labCompanies(caller.origin).find(
        (c) => originOf(c) === originOf(connection),
      )?.id,
    );
  } catch {
    return leave("failed");
  } finally {
    await releaseRun(visitor, held).catch(() => {});
  }
}

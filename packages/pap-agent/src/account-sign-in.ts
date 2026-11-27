import { createHash } from "node:crypto";
import { createIdentity, randomId } from "@poppy-lab/pap-client";
import { companyProfile } from "@poppy-lab/pap-core";
import { consentScopes } from "./account-permissions";
import type { AccountRequest } from "./account-request";
import { afterReset, wordsView } from "./conversation-view";
import { extensionsOn } from "./domain-extension";
import {
  accountConfiguration,
  agentFor,
  clientFor,
  connect,
  pushAuthorizationRequest,
  revokeRefreshToken,
  usesDpop,
  type Connection,
  type Run,
} from "./runtime";
import { agentName } from "./agent";
import { answerLabel } from "./company-commands";
import { companyName, originOf } from "./connections";
import { forgetCompany, recordAsked } from "./transcript";
import { json } from "./web";

/**
 * The conversation as sign-out at a Company leaves it (§5.5): no account
 * tokens, scopes, FDX consent or ESPI subscription in its connection, and
 * nothing Iris read with them. What the conversation holds from that
 * Company is emptied, what was said signed out included, and the
 * Inspector's lines with it. The Session continues signed out. Returns
 * whether proposals at other Companies went with it (`forgetCompany`).
 */
export function signedOutLocally(run: Run, connection: Connection) {
  delete connection.accountToken;
  delete connection.token;
  delete connection.tokenType;
  delete connection.tokenExpires;
  delete connection.accountUnavailable;
  // §4.5: the tokens for single services go with the account's.
  delete connection.resourceTokens;
  delete connection.scopes;
  delete connection.fdxConsent;
  delete connection.espiResourceUri;
  delete connection.espiAuthorizationUri;
  delete connection.auth;
  connection.operations = {};
  delete connection.operationAccounts;
  // A request that waited for a sign-in here, and the agent's question
  // about anything here, go with the account.
  delete connection.resume;
  const asked = run.asking;
  const here = (url: string) => {
    try {
      return new URL(url).origin === new URL(connection.url).origin;
    } catch {
      return false;
    }
  };
  if (
    asked &&
    (("approve" in asked && asked.approve.some((ref) => here(ref.company))) ||
      ("signin" in asked && here(asked.signin.company)) ||
      ("resume" in asked && here(asked.resume)) ||
      ("invitation" in asked && here(asked.invitation)) ||
      ("signout" in asked && asked.signout.some(here)))
  )
    delete run.asking;
  // The words, and the Inspector's lines with them: none of an exchange
  // the page no longer shows. The lines of this request are kept after it.
  // History lists the conversation under its first request, which is gone
  // with the rest.
  const withdrew = forgetCompany(run, connection);
  // Iris forgets it; the Company keeps the conversation open (§5.5).
  delete connection.conversation;
  return withdrew;
}

/**
 * §4.2: plain OAuth Direct Sign-In. It doesn't know the Session; the
 * callback starts a new Session for the signed-in account.
 */
export async function signIn({
  run,
  connection,
  caller,
  body,
}: AccountRequest) {
  const candidate = { ...connection };
  await connect(candidate, []);
  const profile = companyProfile(candidate.company!);
  // §3.2 auth.disabled, or no Direct Sign-In grant: never start one.
  if (!profile.signIn.direct)
    return json(
      { error: "This Company doesn't offer sign-in to Personal Agents." },
      { status: 400 },
    );
  let scopes: string;
  try {
    // A domain extension's scopes (the FDX-shaped data clusters, the
    // ESPI-shaped scopes) only with it on (RFC 9700 §2.3).
    scopes = consentScopes(profile, body.access, extensionsOn(candidate));
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "This Company does not advertise the requested permissions.",
      },
      { status: 400 },
    );
  }
  connection.company = candidate.company!;
  const config = accountConfiguration(connection);
  const clientId = clientFor(connection),
    agentOrigin = agentFor(connection);
  const state = randomId();
  const verifier = randomId() + randomId();
  // A sign-in already under way at this Company is replaced, and its
  // cookie goes with it. One under way at another Company is not.
  if (connection.auth) caller.signIns.release(connection.auth.state);
  connection.auth = {
    state,
    verifier,
    expires: Date.now() + 300000,
    issuer: config.issuer,
    scopes,
    ...(usesDpop(connection)
      ? { dpop: (await createIdentity()).privateKey }
      : {}),
  };
  // The callback completes this sign-in only for the browser that
  // holds its cookie (`sign-in-cookie.ts`).
  caller.signIns.bind(state);
  const params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: `${agentOrigin}/api/account/callback`,
    scope: scopes,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
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
      connection,
      params,
      connection.auth.dpop,
    );
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("request_uri", pushed);
  } else
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return json(
    {
      url: url.toString(),
      consentVersion: connection.consentVersion ?? 0,
      ...answered(run, connection, body),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * The agent asked the User to sign in here, and this sign-in is their
 * answer: the question's button, or their own "yes", which the page read
 * in the same keystroke to open the Company's tab (a browser opens one
 * only then). The question is answered, and the User's line is kept with
 * the agent's: the label of the button as the agent words it, never as
 * the request carries it, or what they typed. The agent's line is given
 * back for the page to show.
 */
function answered(
  run: AccountRequest["run"],
  connection: AccountRequest["connection"],
  body: AccountRequest["body"],
) {
  const asked = run.asking;
  if (
    !asked ||
    !("signin" in asked) ||
    originOf({ url: asked.signin.company }) !== originOf(connection)
  )
    return {};
  delete run.asking;
  const typed =
    typeof body.said === "string" ? body.said.trim().slice(0, 200) : "";
  const access = body.access === "write" ? "write" : "read";
  const said =
    typed ||
    (body.said === true
      ? answerLabel(
          run,
          { signin: { company: originOf(connection), access } },
          [],
        )
      : "");
  if (!said) return {};
  const name = companyName(connection);
  const text = `${name}'s own page is open in a new tab${access === "write" ? ", for the change permission" : ""}. You sign in there, and ${agentName()} never sees your password.`;
  recordAsked(run, undefined, [], { said, text });
  return { said: text };
}

/** §5.5: sign-out revokes every refresh token held for the account. */
export async function signOut({ run, connection, said }: AccountRequest) {
  if (connection.accountToken)
    await revokeRefreshToken(connection, connection.accountToken);
  const withdrew = signedOutLocally(run, connection);
  return json({
    signedIn: false,
    trace: said("Account grant revoked · Session signed out"),
    // What the conversation still shows: with other Companies, what
    // came from them. This request's own lines are kept after it.
    ...wordsView(run),
    // And the Companies as they are now, when a proposal at another
    // one went with this account.
    ...afterReset(run, withdrew),
  });
}

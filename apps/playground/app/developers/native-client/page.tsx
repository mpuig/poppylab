import type { Metadata } from "next";
import { EXAMPLES } from "@/lib/api-examples";
import { apiReference } from "@/lib/api-reference";
import { codeBlock } from "@/lib/learn-code";
import { SITE_NAME, pageMetadata } from "@/lib/site";
import { SiteBar, SiteFoot } from "../../site-chrome";
import { ApiNav, Example, REFERENCE } from "../api-parts";
import "../../site.css";
import "../../learn/learn.css";
import "../api.css";

export const metadata: Metadata = pageMetadata({
  title: `Build a native client · Developers · ${SITE_NAME}`,
  description:
    "How an iPhone app signs in to an agent account with a passkey, keeps its session, connects a Company with ASWebAuthenticationSession, approves proposals and follows events over /api/v1.",
  path: "/developers/native-client",
  image: "developers",
});

/** Swift, shown as it is: Learn colours no Swift. */
const swift = (code: string) => (
  <div dangerouslySetInnerHTML={{ __html: codeBlock(code, "swift") }} />
);

export default function NativeClient() {
  const { document } = apiReference();
  const example = (key: keyof typeof EXAMPLES) => (
    <Example document={document} example={EXAMPLES[key]} />
  );
  const ref = (anchor: string, text: string) => (
    <a href={`${REFERENCE}#${anchor}`}>
      <code>{text}</code>
    </a>
  );
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar current="developers" />
      <main id="main" className="learn">
        <ApiNav current="native-client" />
        <article className="learn-article api-article">
          <h1>Build a native client</h1>
          <p className="lead reading-lead">
            An app signs in to an agent account with a passkey, keeps a session
            of its own, and works in the same conversations as the playground.
            This guide follows an iPhone app; any platform with passkeys and a
            browser sheet of its own works the same way.
          </p>
          <div className="learn-body">
            <p>
              Every request goes to <code>https://poppylab.dev/api/v1</code> and
              sends no <code>Origin</code> header: that is what makes it an
              app&apos;s and not a browser&apos;s. The examples are requests and
              answers in the shapes the API gives, shortened where they show{" "}
              <code>…</code>. The <a href={REFERENCE}>reference</a> has every
              operation and type.
            </p>

            <h2 id="before">Before you start</h2>
            <p>
              The system offers an app passkeys only for a domain that vouches
              for it. The app needs the Associated Domains entitlement{" "}
              <code>webcredentials:poppylab.dev</code>, and the site must serve{" "}
              <code>/.well-known/apple-app-site-association</code> listing the
              app as <code>{"<Team ID>.<bundle ID>"}</code>. poppylab.dev serves
              no such file yet; it will list an app once that app&apos;s ID is
              given. Until it does, an iPhone app can&apos;t make or use a
              passkey for poppylab.dev, and the requests below are the same for
              any app it lists.
            </p>
            <p>
              The relying party is <code>poppylab.dev</code>. The clientDataJSON
              an iOS app sends has the origin <code>https://poppylab.dev</code>,
              which the API expects.
            </p>

            <h2 id="create">Create an account</h2>
            <p>
              Ask for the options of a new passkey. <code>label</code> is an
              optional name the person chooses for the account; the account has
              no email, password or name.
            </p>
            {example("accountOptions")}
            <p>
              Pass <code>options.challenge</code> and{" "}
              <code>options.user.id</code>, both base64url, to the platform
              provider, with user verification required:
            </p>
            {swift(`let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
  relyingPartyIdentifier: "poppylab.dev")
let request = provider.createCredentialRegistrationRequest(
  challenge: challenge, name: "Home", userID: userID)
request.userVerificationPreference = .required`)}
            <p>
              Send the result as a RegistrationResponseJSON (<code>id</code>,{" "}
              <code>rawId</code>, <code>type</code>,{" "}
              <code>response.clientDataJSON</code>,{" "}
              <code>response.attestationObject</code>,{" "}
              <code>response.transports</code>) with the <code>ceremony</code>,
              within five minutes and once. <code>device</code> names the device
              in its own words. The answer is the account and the device&apos;s
              tokens: keep them in the Keychain.
            </p>
            {example("createAccount")}

            <h2 id="sign-in">Sign in on another device</h2>
            <p>
              Ask for sign-in options and pass the challenge to{" "}
              <code>createCredentialAssertionRequest(challenge:)</code> with no
              allowed credentials, so the system offers every passkey for the
              site and no username is needed.
            </p>
            {example("signInOptions")}
            <p>
              Send the AuthenticationResponseJSON (
              <code>response.clientDataJSON</code>,{" "}
              <code>response.authenticatorData</code>,{" "}
              <code>response.signature</code>, <code>response.userHandle</code>
              ). The user handle is the account&apos;s ID. An answer that proves
              no account is refused with <code>passkey_not_verified</code>,
              whatever the reason.
            </p>
            {example("signIn")}

            <h2 id="session">Keep the session</h2>
            <p>
              Send <code>Authorization: Bearer</code> with the access token on
              every request. It lasts 15 minutes. Before{" "}
              <code>accessTokenExpiresAt</code>, or when a request is refused
              with <code>invalid_token</code>, exchange the refresh token for a
              new pair and keep both. Refresh one request at a time: a refresh
              token works once.
            </p>
            {example("refreshSession")}
            <p>
              A refresh token sent a second time ends the whole session, on this
              device and wherever a copy of it is. On{" "}
              <code>session_revoked</code>, sign in again with the passkey.
            </p>
            {example("refreshReused")}
            <p>
              A session unused for 30 days ends, and every session ends after a
              year. An account keeps at most 25: signing in on one more device
              ends the one used least recently.
            </p>

            <h2 id="talk">Start a conversation</h2>
            <p>
              A conversation starts empty or with one Company, named by its
              origin, connected signed out. It belongs to the account, so the
              playground in a browser signed in to it shows the same one.
            </p>
            {example("startConversation")}
            <p>
              Send what the person says. The answer is what the turn added, the
              person&apos;s line first, and the conversation as it is after it.
              Show each message by its <code>from</code>: <code>user</code>,{" "}
              <code>agent</code>, or <code>company</code> for a Company&apos;s
              own words, which are shown as the Company&apos;s and never as the
              agent&apos;s. Without a <code>model</code> a turn runs in demo
              mode, which runs the scripted examples only.
            </p>
            {example("sendMessage")}
            <p>
              A message can carry <code>choices</code>. Show each{" "}
              <code>label</code> as a button, and when it is pressed send its{" "}
              <code>answer</code> to {ref("answerChoice", "answers")}, never the
              label as a message.
            </p>
            {example("answerChoice")}

            <h2 id="company">Connect a Company</h2>
            <p>
              The person signs in on the Company&apos;s own page; the agent
              never sees a password. Ask for a sign-in link with the
              Company&apos;s origin and the access it needs, <code>read</code>{" "}
              or <code>write</code>:
            </p>
            {example("startSignIn")}
            <p>
              Open <code>url</code> at once, and only once, in an{" "}
              <code>ASWebAuthenticationSession</code> that comes back to{" "}
              <code>endUrl</code>. Send no header with it: the link needs none.
              It works once, for three minutes, for this account, conversation,
              Company and access. The agent&apos;s page goes straight on to the
              Company&apos;s consent page, which names the agent and says what
              it asks for.
            </p>
            {swift(`let session = ASWebAuthenticationSession(
  url: URL(string: signIn.url)!,
  callback: .https(host: "poppylab.dev", path: "/playground/sign-in/app")
) { callbackURL, error in
  // result=done or result=failed: a hint. Read the conversation for the outcome.
}
session.prefersEphemeralWebBrowserSession = true
session.presentationContextProvider = self
session.start()`)}
            <p>
              The <code>.https</code> callback needs iOS 17.4 or later and the
              same <code>webcredentials:poppylab.dev</code> association as the
              passkeys. An ephemeral session keeps the Company&apos;s cookies
              out of Safari. There is no custom URL scheme: the agent sends the
              browser only to its own fixed address. On earlier iOS, start the
              session with no callback; it ends when the person closes the
              sheet, and the app reads the conversation then.
            </p>
            <p>
              Take <code>result=done</code> or <code>result=failed</code> in the
              callback as a hint, and the outcome from the conversation:{" "}
              <code>signin.completed</code> or <code>signin.failed</code> on the
              events, or the Company&apos;s <code>signedIn</code> in{" "}
              {ref("getConversation", "GET /conversations/{id}")}. A sheet
              closed early leaves the sign-in waiting until it ends with{" "}
              <code>signin.failed</code> after five minutes; asking for a new
              link replaces it.
            </p>

            <h2 id="proposals">Proposals and decisions</h2>
            <p>
              A change a Company would make comes as a proposal, in the
              conversation&apos;s <code>proposals</code> and as{" "}
              <code>proposal.created</code> on the events. Show its{" "}
              <code>summary</code> as the Company&apos;s words and its exact{" "}
              <code>terms</code>, with an approve and a decline. Nothing is
              performed until the person approves, and an approval covers
              exactly the <code>revision</code> it names: when the Company
              answers with other terms, the proposal comes back with a new
              revision, which waits for the person again.
            </p>
            {example("decideProposal")}

            <h2 id="events">Follow the events</h2>
            <p>
              Some things happen after a turn has answered: the sign-in in the
              browser sheet, a proposal that runs out, a Company that writes in
              a Direct Conversation. Open the event stream while the person is
              in the conversation.
            </p>
            {example("conversationEvents")}
            <p>
              <code>state</code> comes first; every event after it is a change
              to it. The stream closes after five minutes or when the
              conversation ends: open it again and start from the new{" "}
              <code>state</code>. It ends with <code>session.ended</code> when
              the device&apos;s sign-in does: refresh and open it again on{" "}
              <code>invalid_token</code>, sign in again on{" "}
              <code>session_revoked</code>. An account keeps at most ten streams
              open on all its devices. Every event type is in the{" "}
              <a href={`${REFERENCE}#event-types`}>reference</a>.
            </p>

            <h2 id="sign-out">Sign out</h2>
            <p>
              Signing out ends this device&apos;s session only; the
              account&apos;s other devices stay signed in. Remove the tokens
              from the Keychain.
            </p>
            {example("signOut")}

            <h2 id="coming">What is coming</h2>
            <p>
              The API is <code>v1</code> and still changing until it is frozen.
              Three things a phone needs are not in it yet:
            </p>
            <ul>
              <li>
                <strong>Spoken text.</strong> A message will carry a form of its
                text written to be read aloud, for a client that speaks its
                answers.
              </li>
              <li>
                <strong>Streaming.</strong> A turn answers once, when it is
                done. Its text will come as it is written.
              </li>
              <li>
                <strong>Push.</strong> Events reach an app only while its stream
                is open. A device will register for push notifications on its
                own session, so they stop when the session ends.
              </li>
            </ul>
            <p>
              Each will be in the document, and on the{" "}
              <a href={REFERENCE}>reference</a>, when it is in the API.
            </p>
          </div>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}

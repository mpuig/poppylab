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
              it for the apps set in the site&apos;s configuration (
              <code>APPLE_APP_IDS</code>); another app has to be added there
              before it can make or use a passkey for poppylab.dev. The requests
              below are the same for any app it lists. While you develop, add{" "}
              <code>?mode=developer</code> to the entitlement (
              <code>webcredentials:poppylab.dev?mode=developer</code>) and turn
              on Associated Domains Development on the device, so iOS reads the
              file from the site rather than Apple&apos;s cache.
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
              mode, which runs the scripted examples only. A{" "}
              {ref("type-ModelChoice", "model")} of{" "}
              <code>openai-compatible</code> or <code>anthropic</code> carries
              the person&apos;s own key; <code>free</code>, the lab&apos;s free
              model, takes a Cloudflare Turnstile token made on poppylab.dev for
              the action <code>chat</code>, and without a good one the turn runs
              in demo mode and says why.
            </p>
            {example("sendMessage")}
            <p>
              A message can carry <code>choices</code>. Show each{" "}
              <code>label</code> as a button, and when it is pressed send its{" "}
              <code>answer</code> to {ref("answerChoice", "answers")}, never the
              label as a message. A <code>signin</code> answer is the app&apos;s
              to carry out: ask for a sign-in link (below) for that Company and
              access instead.
            </p>
            {example("answerChoice")}
            <p>
              The person can also answer the agent&apos;s question in words.
              Send them as a message: &quot;yes&quot;, &quot;no&quot;,
              &quot;approve the Lantern one&quot;. The agent&apos;s code, never
              the model, reads a short answer to the question just asked; any
              other message drops the question and goes on as a message. A voice
              client sends a spoken &quot;yes&quot; the same way, as text.
            </p>

            <h2 id="voice">Hear the answer as it is written</h2>
            <p>
              A model takes seconds to write a whole answer. Send{" "}
              <code>Accept: text/event-stream</code> with the message, or with
              an answer, and the same request answers each of the agent&apos;s
              sentences as soon as it is written, as a{" "}
              <code>message.delta</code> event: the message&apos;s ID, the
              sentence&apos;s <code>index</code>, its <code>text</code> and its{" "}
              <code>spoken</code> form. The last event is <code>turn</code>,
              with the same result the JSON answer has, in which each of the
              agent&apos;s messages carries as <code>id</code> the ID its
              sentences came under, or <code>error</code> when the turn failed
              after it began.
            </p>
            {example("sendMessageStreamed")}
            <p>
              A voice client says each sentence&apos;s <code>spoken</code> as it
              arrives, in order, and skips one that is empty (a table row, a
              bare address). The sentences are the whole answer, so it does not
              say the message&apos;s own <code>spoken</code> again when{" "}
              <code>turn</code> comes. Demo mode and the agent&apos;s own lines,
              a question about a proposal say, are there at once: they come as
              sentences too, all together just before <code>turn</code>, so one
              path speaks everything the agent says. A Company&apos;s own words
              are never sentences of the agent&apos;s: they come whole in the
              result, as the Company&apos;s message, to be shown or said as the
              Company&apos;s.
            </p>
            {swift(`var request = URLRequest(url: messagesURL)
request.httpMethod = "POST"
request.setValue("Bearer \\(accessToken)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
request.httpBody = try JSONEncoder().encode(message)
let (bytes, response) = try await URLSession.shared.bytes(for: request)
// Refused before anything was said: JSON with its status, as without the header.
guard (response as? HTTPURLResponse)?.mimeType == "text/event-stream" else { … }
for try await line in bytes.lines where line.hasPrefix("data: ") {
  let event = try decoder.decode(TurnEvent.self, from: Data(line.dropFirst(6).utf8))
  switch event {
  case .delta(let sentence) where !sentence.spoken.isEmpty:
    synthesizer.speak(AVSpeechUtterance(string: sentence.spoken))
  case .turn(let result): show(result)  // the same TurnResult as the JSON answer
  case .error(let failure): stopSpeaking(); show(failure.error)
  default: break
  }
}`)}
            <p>
              A request refused before anything was said, because another
              request holds the conversation say, is answered as it would be
              without the header: its status and an <code>Error</code>. The
              conversation&apos;s event stream carries the agent&apos;s message
              whole, as <code>message</code>, for the account&apos;s other
              devices; the sentences go only to the request that sent it.
            </p>

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
            <p>
              When a request stopped for the sign-in, the agent asks once it is
              done whether to go on with it, and sends nothing until the person
              says so. The question comes on the events as a{" "}
              <code>message</code> with a <code>resume</code> choice; the person
              presses it or says &quot;yes&quot; within 30 minutes.
            </p>

            <h2 id="proposals">Proposals and decisions</h2>
            <p>
              A change a Company would make comes as a proposal, in the
              conversation&apos;s <code>proposals</code> and as{" "}
              <code>proposal.created</code> on the events. Show its{" "}
              <code>summary</code> as the Company&apos;s words and its exact{" "}
              <code>terms</code>, with an approve and a decline. Nothing is
              performed until the person approves, and an approval covers
              exactly the <code>revision</code> it names.
            </p>
            {example("decideProposal")}
            <p>
              When the Company answers the approval with other terms, nothing is
              performed: the decision is refused with 409{" "}
              <code>terms_changed</code>, and the proposal comes back with a new
              revision, as <code>proposal.replaced</code> on the events, which
              waits for the person again. A proposal past its{" "}
              <code>expiresAt</code> or already decided is refused with 410{" "}
              <code>proposal_expired</code>.
            </p>
            <p>
              The agent also asks about each proposal in the conversation, in
              its own words from the terms: a message with an approve and a
              decline among its <code>choices</code>, whose <code>spoken</code>{" "}
              says what the change is and asks &quot;Approve it?&quot;. Pressing
              one, or answering &quot;yes&quot; or &quot;decline the
              transfer&quot;, decides it through the same check as the decision
              request.
            </p>

            <h2 id="events">Follow the events</h2>
            <p>
              Some things happen after a turn has answered: the sign-in in the
              browser sheet and the question after it, a proposal that runs out,
              another device&apos;s message. Open the event stream while the
              person is in the conversation.
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
              One thing a phone needs is not in it yet: push. Events reach an
              app only while its stream is open. A device will register for push
              notifications on its own session, so they stop when the session
              ends. It will be in the document, and on the{" "}
              <a href={REFERENCE}>reference</a>, when it is in the API.
            </p>
          </div>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}

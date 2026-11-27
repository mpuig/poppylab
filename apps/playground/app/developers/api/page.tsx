import type { Metadata } from "next";
import { EXAMPLES, type ApiExample } from "@/lib/api-examples";
import {
  ERROR_CODES,
  apiReference,
  eventAnchor,
  fields,
  typeParts,
  type ApiDocument,
  type Body,
  type Operation,
} from "@/lib/api-reference";
import { codeBlock } from "@/lib/learn-code";
import { SITE_NAME, pageMetadata } from "@/lib/site";
import { SiteBar, SiteFoot } from "../../site-chrome";
import {
  ApiNav,
  Example,
  FieldList,
  Inline,
  SchemaView,
  TypeText,
  exampleText,
} from "../api-parts";
import "../../site.css";
import "../../learn/learn.css";
import "../api.css";

export const metadata: Metadata = pageMetadata({
  title: `The agent's API · Developers · ${SITE_NAME}`,
  description:
    "The reference of /api/v1, the Personal Agent's own HTTP API: conversations, proposals, sign-in at a Company, events, and agent accounts with passkeys. Built from its OpenAPI document.",
  path: "/developers/api",
  image: "developers",
});

const DOCUMENT = "/api/v1/openapi.json";

/** First schema-verified example per operation, shown inline in the reference. */
const EXAMPLE_BY_OP = new Map<string, ApiExample>();
for (const example of Object.values(EXAMPLES)) {
  if (!EXAMPLE_BY_OP.has(example.operation))
    EXAMPLE_BY_OP.set(example.operation, example);
}

/** Whether a body's members are written in place, to list under it. */
const inPlace = (body: Body) => !!body.schema.oneOf || !!fields(body.schema);

/** A body in a few words: its type, and its media type when it isn't JSON. */
function BodyType({ body }: { body: Body }) {
  return (
    <>
      {inPlace(body) ? (
        <code>
          {body.schema.oneOf ? "one of" : (body.schema.type ?? "object")}
        </code>
      ) : (
        <TypeText parts={typeParts(body.schema)} />
      )}
      {body.type !== "application/json" && (
        <>
          {" as "}
          <code>{body.type}</code>
        </>
      )}
    </>
  );
}

/** One operation: its method and path, what it does, what it takes and answers. */
function OperationView({
  op,
  document,
}: {
  op: Operation;
  document: ApiDocument;
}) {
  const body = op.body;
  const example = EXAMPLE_BY_OP.get(op.id);
  const rendered = example ? exampleText(document, example) : undefined;
  return (
    <section className="api-op" id={op.id} aria-labelledby={`${op.id}-title`}>
      <h3 id={`${op.id}-title`} data-method={op.method}>
        <span className="api-method">{op.method}</span> <code>{op.path}</code>
      </h3>
      <p className="api-meta">
        <a href={`#${op.id}`}>
          <code>{op.id}</code>
        </a>
        {op.security.map((name) => (
          <span key={name}>
            {" · "}
            <a href="#authentication">
              <code>{name}</code>
            </a>
          </span>
        ))}
      </p>
      <p className="api-summary">
        <Inline text={op.summary} />
      </p>
      {op.description && (
        <p className="api-desc">
          <Inline text={op.description} />
        </p>
      )}
      {op.parameters.length > 0 && (
        <>
          <p className="api-label">Parameters</p>
          <FieldList
            list={op.parameters.map((p) => ({
              name: p.name,
              required: !!p.required,
              type: [
                ...(p.schema ? typeParts(p.schema) : []),
                { text: `${p.schema ? ", " : ""}${p.in}` },
              ],
              ...(p.description ? { description: p.description } : {}),
            }))}
          />
        </>
      )}
      {body && (
        <>
          <p className="api-label">
            Request body{" "}
            <span className="api-type">
              <BodyType body={body} />
            </span>
          </p>
          {inPlace(body) && <SchemaView schema={body.schema} />}
        </>
      )}
      <p className="api-label">Responses</p>
      <dl className="api-fields api-answers">
        {op.answers.map((answer) => (
          <div key={answer.status} data-status={answer.status[0]}>
            <dt>
              <code className="api-name">{answer.status}</code>{" "}
              <span className="api-type">
                {answer.body ? <BodyType body={answer.body} /> : "no body"}
                {answer.headers.map((h) => (
                  <span key={h.name}>
                    {" · "}
                    <code>{h.name}</code>
                  </span>
                ))}
              </span>
            </dt>
            <dd>
              <p>
                <Inline text={answer.description} />
              </p>
              {answer.body && inPlace(answer.body) && (
                <SchemaView schema={answer.body.schema} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {rendered && (
        <details className="api-ex-toggle">
          <summary>Example request &amp; response</summary>
          <div className="api-example">
            <div
              dangerouslySetInnerHTML={{
                __html: codeBlock(rendered.request, "http"),
              }}
            />
            {rendered.answer && (
              <div
                dangerouslySetInnerHTML={{
                  __html: codeBlock(rendered.answer, "http"),
                }}
              />
            )}
          </div>
        </details>
      )}
    </section>
  );
}

export default function ApiReference() {
  const { document, groups, events, types, schemes } = apiReference();
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar current="developers" />
      <main id="main" className="learn">
        <ApiNav current="reference" groups={groups} />
        <article className="learn-article api-article">
          <h1>The agent&apos;s API</h1>
          <p className="lead reading-lead">
            The Personal Agent&apos;s own HTTP API, for building a client of it:
            a phone app, a messaging channel, anything that isn&apos;t the
            playground&apos;s page. Every client, the page too, works in the
            same conversations, so what one does, the others see.
          </p>
          <p className="reading-meta">
            {document.info.title} {document.info.version} · OpenAPI{" "}
            {document.openapi} · <a href={DOCUMENT}>{DOCUMENT}</a>
          </p>
          <div className="learn-body">
            <h2 id="what">What it is for</h2>
            <p>
              <Inline text={document.info.description ?? ""} />
            </p>
            <p>
              Everything is under <code>https://poppylab.dev/api/v1</code>, and
              every body is JSON except the event stream&apos;s. The version is
              in the path: <code>v1</code> is still changing, and a member or a
              route can still be added, renamed or removed until it is frozen.
              Until then, a client ignores a member it doesn&apos;t know, and
              reads the document again when it is updated.
            </p>
            <p>
              This page is built from the same document the API serves at{" "}
              <a href={DOCUMENT}>
                <code>{DOCUMENT}</code>
              </a>
              , so every operation and type on it is the document&apos;s. To
              build an app on it step by step, read{" "}
              <a href="/developers/native-client">Build a native client</a>.
            </p>

            <h2 id="authentication">Authentication</h2>
            <p>
              A request is a browser&apos;s or a client app&apos;s, and the two
              prove who they are differently.
            </p>
            <ul>
              <li>
                <strong>A browser</strong> on the playground&apos;s own origin
                uses cookies: the visitor&apos;s, which needs no account, or{" "}
                <code>__Host-poppy_account</code> once it signs in to an agent
                account. A request that changes anything must come from the
                playground&apos;s origin; one from another origin is refused
                with 403 before its body is read.
              </li>
              <li>
                <strong>A client app</strong> sends no <code>Origin</code>. It
                creates an account or signs in with a passkey, in two requests
                each: the WebAuthn options (
                <a href="#accountOptions">
                  <code>POST /accounts/options</code>
                </a>{" "}
                or{" "}
                <a href="#signInOptions">
                  <code>POST /sessions/options</code>
                </a>
                ), then the authenticator&apos;s answer to them (
                <a href="#createAccount">
                  <code>POST /accounts</code>
                </a>{" "}
                or{" "}
                <a href="#signIn">
                  <code>POST /sessions</code>
                </a>
                ). The answer carries the device&apos;s{" "}
                <a href="#type-SessionTokens">
                  <code>tokens</code>
                </a>
                : an access token, sent as <code>Authorization: Bearer</code>,
                which lasts 15 minutes, and a refresh token, exchanged at{" "}
                <a href="#refreshSession">
                  <code>POST /sessions/refresh</code>
                </a>{" "}
                for a new pair. Each refresh token works once; one used twice
                ends the session on every device that holds it.
              </li>
            </ul>
            <p>
              Passkeys are for <code>poppylab.dev</code>, discoverable, with
              user verification and no attestation, so signing in needs no
              username. An account has no email, password or name. A session
              unused for 30 days ends, and every session ends after a year.
            </p>
            {schemes.map((scheme) => (
              <dl className="api-fields" key={scheme.name}>
                <div>
                  <dt>
                    <code className="api-name">{scheme.name}</code>{" "}
                    <span className="api-type">
                      <code>{scheme.type}</code>
                      {scheme.scheme ? (
                        <>
                          , <code>{scheme.scheme}</code>
                        </>
                      ) : null}
                    </span>
                  </dt>
                  {scheme.description && (
                    <dd>
                      <p>
                        <Inline text={scheme.description} />
                      </p>
                    </dd>
                  )}
                </div>
              </dl>
            ))}

            <h2 id="errors">Errors</h2>
            <p>
              A refusal has a status and an{" "}
              <a href="#type-Error">
                <code>Error</code>
              </a>{" "}
              body, <code>{"{ code, error }"}</code>. <code>error</code> is
              written for the person and can be shown as it is;{" "}
              <code>code</code> is what a client acts on. Each operation below
              lists the statuses it answers. These are the codes a client most
              needs to tell apart:
            </p>
            <dl className="api-fields">
              {ERROR_CODES.map(([code, status, text]) => (
                <div key={code}>
                  <dt>
                    <code className="api-name">{code}</code>{" "}
                    <span className="api-type">{status}</span>
                  </dt>
                  <dd>
                    <p>
                      <Inline text={text} />
                    </p>
                  </dd>
                </div>
              ))}
            </dl>

            {groups.map((group) => (
              <section
                key={group.id}
                className="api-group"
                aria-labelledby={group.id}
              >
                <h2 id={group.id}>{group.title}</h2>
                {group.intro && (
                  <p>
                    <Inline text={group.intro} />
                  </p>
                )}
                {group.operations.map((op) => (
                  <OperationView key={op.id} op={op} document={document} />
                ))}
                {group.id === "conversations" && (
                  <section
                    className="api-op"
                    id="streamed-answers"
                    aria-labelledby="streamed-answers-title"
                  >
                    <h3 id="streamed-answers-title">
                      The answer as it is written
                    </h3>
                    <p>
                      With <code>Accept: text/event-stream</code>,{" "}
                      <a href="#sendMessage">
                        <code>POST …/messages</code>
                      </a>{" "}
                      and{" "}
                      <a href="#answerChoice">
                        <code>POST …/answers</code>
                      </a>{" "}
                      answer Server-Sent Events: a{" "}
                      <a href="#type-MessageDelta">
                        <code>message.delta</code>
                      </a>{" "}
                      for each of the agent&apos;s sentences as soon as the
                      model has written it, then <code>turn</code> with the same{" "}
                      <a href="#type-TurnResult">
                        <code>TurnResult</code>
                      </a>{" "}
                      as the JSON answer, or <code>error</code>. Each agent
                      message of the result carries as <code>id</code> the ID
                      its sentences came under; drop shown sentences whose ID no
                      message carries. Demo mode and the agent&apos;s own lines
                      come as sentences too, all together before{" "}
                      <code>turn</code>, so a client has one path. A
                      Company&apos;s own words never come as sentences: they are
                      in the result, as the Company&apos;s message.
                    </p>
                    <p>
                      A voice client says each sentence&apos;s{" "}
                      <code>spoken</code> as it arrives and doesn&apos;t say the
                      message&apos;s <code>spoken</code> again. A request
                      refused before anything was said is answered as without
                      the header, with its status and an{" "}
                      <a href="#type-Error">
                        <code>Error</code>
                      </a>
                      . The sentences go only to the request that sent the
                      message; the event stream below carries the message whole,
                      as <code>message</code>, to the account&apos;s other
                      devices.
                    </p>
                    <Example
                      document={document}
                      example={EXAMPLES.sendMessageStreamed}
                    />
                  </section>
                )}
                {group.id === "events" && (
                  <section
                    className="api-op"
                    id="event-types"
                    aria-labelledby="event-types-title"
                  >
                    <h3 id="event-types-title">The stream and its events</h3>
                    <p>
                      The stream sends <code>retry: 3000</code>, then each event
                      with its <code>type</code> as the SSE event name and the
                      whole{" "}
                      <a href="#type-AgentEvent">
                        <code>AgentEvent</code>
                      </a>{" "}
                      as its <code>data</code>, and a comment after every
                      reading of the conversation. It reads the stored
                      conversation every two seconds, so it learns of what
                      another device or the browser did without being told. It
                      closes after five minutes or when the conversation ends:
                      open it again and start from the new <code>state</code>.
                    </p>
                    <dl className="api-fields">
                      {events.map((event) => (
                        <div key={event.type} id={eventAnchor(event.type)}>
                          <dt>
                            <code className="api-name">{event.type}</code>{" "}
                            {event.carries.length > 0 && (
                              <span className="api-type">
                                with{" "}
                                {event.carries.map((member, i) => (
                                  <span key={member}>
                                    {i ? ", " : ""}
                                    <code>{member}</code>
                                  </span>
                                ))}
                              </span>
                            )}
                          </dt>
                          {event.text && (
                            <dd>
                              <p>
                                <Inline text={event.text} />
                              </p>
                            </dd>
                          )}
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              </section>
            ))}

            <section className="api-group" aria-labelledby="types">
              <h2 id="types">Types</h2>
              <p>
                The named types of the document, which the operations above link
                to. A member marked optional can be absent; a client ignores
                members it doesn&apos;t know.
              </p>
              {types.map(({ name, schema }) => (
                <section
                  key={name}
                  className="api-op"
                  id={`type-${name}`}
                  aria-labelledby={`type-${name}-title`}
                >
                  <h3 id={`type-${name}-title`}>
                    <code>{name}</code>
                  </h3>
                  {schema.description && (
                    <p>
                      <Inline text={schema.description} />
                    </p>
                  )}
                  <SchemaView schema={schema} />
                </section>
              ))}
            </section>
          </div>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}

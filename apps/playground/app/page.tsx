import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { FlowDiagram } from "./flow-diagram";
import { SequenceFigure } from "./sequence-figure";
import { SPEC_URL, SiteBar, SiteFoot, companies, connect } from "./site-chrome";
import "./site.css";

/** From "no agents" to "the agent is you": Poppy is the three steps between. */
const ladder = [
  { tone: 0, title: "Blocked", text: "No agents allowed." },
  { tone: 1, title: "Browse the catalogue", text: "Any agent, no sign-in." },
  {
    tone: 2,
    title: "See your orders",
    text: "After you sign in on Juniper's own page.",
  },
  {
    tone: 3,
    title: "Move a delivery",
    text: "Only with your approval of the exact change.",
  },
  { tone: 0, title: "Full access", text: "The agent acts as you." },
] as const;

/** Who holds what, without a protocol and with one: Figure 4. */
const parties = ["You", "Your agent", "The company"] as const;
const holdings: ReadonlyArray<{
  what: string;
  without: readonly number[];
  with: readonly number[];
}> = [
  { what: "Your password", without: [0, 1], with: [0] },
  { what: "The decision on each change", without: [1], with: [0] },
  { what: "A permission you can limit and take back", without: [], with: [1] },
  { what: "A way to know which agent is calling", without: [], with: [2] },
  { what: "The change, held until you approve it", without: [], with: [2] },
];

/** What that means for each side, in the order of the figure's columns. */
const gets = [
  [
    "People.",
    "You keep your password and the final say. In this lab access starts read-only, and you can take it back at any time.",
  ],
  [
    "Agent builders.",
    "Your agent carries a permission, never a password. Discovery, sign-in and approval work the same way at every company, through APIs.",
  ],
  [
    "Companies.",
    "You know which agent is calling and who approved each change, and you perform it at most once. You start with what you have: a website, APIs or your own agent.",
  ],
] as const;

const never = [
  [
    "See your secrets.",
    "Passwords, access tokens and keys are handled by ordinary code. The AI model never sees them.",
  ],
  [
    "Approve its own request.",
    "The model can read and propose. A change is approved only when you click, and nothing typed in the chat counts as approval.",
  ],
  [
    "Be talked into it.",
    "Whatever a company's reply says, it can't make the model approve a change or reveal a secret.",
  ],
  [
    "Link you across companies.",
    "Each company knows you by a different ID, so two companies can't match their records through the agent.",
  ],
] as const;

/** Who does what inside Iris: the model, ordinary code, and the person. */
const duties = [
  ["Read the company's replies and propose a change", 0],
  ["Hold the access tokens and keys", 1],
  ["Sign each request and send it", 1],
  ["Sign in, on the company's own page", 2],
  ["Approve a change", 2],
] as const;
const actors = ["The AI model", "Plain code", "You"] as const;

function Points({
  items,
}: {
  items: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <ul className="points">
      {items.map(([title, text]) => (
        <li key={title}>
          <strong>{title}</strong> {text}
        </li>
      ))}
    </ul>
  );
}

function Delta({ before, after }: { before: string; after: string }) {
  return (
    <span className="delta">
      {before ? (
        <>
          <s>{before}</s>
          <ArrowRight size={14} aria-label="becomes" />
        </>
      ) : null}
      {after}
    </span>
  );
}

export default function Home() {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar />

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">
              How AI agents and companies agree on the rules.
            </h1>
            <p className="lead">
              Personal Agent Protocol, Poppy for short, is an open protocol for
              how personal agents and companies work together. Poppy Lab is an
              independent place to watch it work, with one agent and four
              fictional companies.
            </p>
            <div className="actions">
              <a className="button" href="/playground">
                Try the live demo <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="button ghost" href="#why">
                Why it exists
              </a>
            </div>
            <p className="fine">
              Not affiliated with the protocol&apos;s authors. Nothing here is
              charged, shipped or transferred.
            </p>
          </div>
          <SequenceFigure />
        </section>

        <section id="why" className="sec" aria-labelledby="why-title">
          <div className="sec-head">
            <h2 id="why-title">Today it is all or nothing</h2>
            <p>
              When you ask an AI agent to deal with a company, the company has
              two options. It blocks the agent, or the agent signs in as you and
              can do anything you can. Poppy adds the steps in between, and the
              company decides how far each one goes.
            </p>
          </div>
          <figure className="spectrum">
            <ol>
              {ladder.map((step, i) => (
                <li
                  key={step.title}
                  className={
                    step.tone
                      ? `on tone-${step.tone}${i === 1 ? " first" : ""}${i === 3 ? " last" : ""}`
                      : "off"
                  }
                >
                  <span className="group">
                    <span>
                      {step.tone ? "With Poppy" : "Without a protocol"}
                    </span>
                  </span>
                  <span className="swatch" aria-hidden="true" />
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
            <figcaption>
              <b>Figure 2.</b> What an agent may do at Juniper Market, one of
              the lab&apos;s fictional companies. The three middle steps are
              what you can try in the demo.
            </figcaption>
          </figure>
        </section>

        <section id="how" className="sec" aria-labelledby="how-title">
          <div className="sec-head">
            <h2 id="how-title">How it works</h2>
            <p>
              There are three parties, and each keeps its own job (Figure 3).
              The steps are the same at a grocery, a bank or an airline.
            </p>
          </div>
          <FlowDiagram />
          <ol className="steps">
            <li>
              <div
                className="mini"
                role="img"
                aria-label="A discovery file that lists a company's APIs, sign-in and own agent"
              >
                <p className="mini-head">
                  <code>/.well-known/poppy.json</code>
                </p>
                <ul>
                  <li>
                    APIs <code>/openapi.json</code>
                  </li>
                  <li>
                    Sign-in <code>/oauth/authorize</code>
                  </li>
                  <li>
                    Company agent <code>/poppy/conversations</code>
                  </li>
                </ul>
              </div>
              <h3>
                <span>1</span>You ask, your agent finds the company
              </h3>
              <p>
                The company publishes one small file that says how agents can
                reach it. Your agent reads it and introduces itself with an
                identity the company can check.
              </p>
            </li>
            <li>
              <div
                className="mini"
                role="img"
                aria-label="A company's sign-in page: Iris from poppylab.dev asks to read your account, and proposing changes is a separate permission"
              >
                <p className="mini-head">
                  Juniper Market <span>Sign-in page</span>
                </p>
                <p>Iris from poppylab.dev asks to:</p>
                <ul>
                  <li className="check">
                    <span className="box on">
                      <Check size={11} strokeWidth={3.5} />
                    </span>
                    Read your account
                  </li>
                  <li className="check later">
                    <span className="box" />
                    Propose changes, added later
                  </li>
                </ul>
                <p className="mini-actions">
                  <span className="pill">Allow access</span>
                  <span className="pill quiet">Don&apos;t allow</span>
                </p>
              </div>
              <h3>
                <span>2</span>You sign in on the company&apos;s own page
              </h3>
              <p>
                The company shows which agent is asking and what it wants, and
                you decide what to allow. Your password never passes through the
                agent.
              </p>
            </li>
            <li>
              <div
                className="mini"
                role="img"
                aria-label="A proposal held by the company: recurring delivery from Thursday to Saturday, waiting for you to approve or decline"
              >
                <p className="mini-head">
                  Juniper Market{" "}
                  <span className="waiting">Waiting for you</span>
                </p>
                <p>Recurring delivery</p>
                <Delta before="Thursday" after="Saturday" />
                <p className="mini-actions">
                  <span className="pill">Approve</span>
                  <span className="pill quiet">Decline</span>
                </p>
              </div>
              <h3>
                <span>3</span>Changes wait for your approval
              </h3>
              <p>
                The agent proposes exact terms. The company holds the change
                until you approve it, then performs it once.
              </p>
            </li>
          </ol>
          <p className="note">
            Want the endpoints, headers and spec sections behind each step?{" "}
            <a href="/developers">See the developer guide</a>.
          </p>
        </section>

        <section id="who" className="sec split" aria-labelledby="who-title">
          <div className="sec-head">
            <h2 id="who-title">What each side gets</h2>
            <p>
              Poppy 1.0 was published on 14 November 2026, so there are no
              adoption figures to quote. Everything below is something you can
              watch happen in the demo.
            </p>
          </div>
          <figure className="matrix holds">
            <p className="key" aria-hidden="true">
              <span className="ring" /> Without a protocol
              <span className="dot" /> With Poppy
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">What is held</span>
                  </th>
                  {parties.map((party) => (
                    <th scope="col" key={party}>
                      {party}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map((row) => (
                  <tr key={row.what}>
                    <th scope="row">{row.what}</th>
                    {parties.map((party, i) => {
                      const before = row.without.includes(i);
                      const after = row.with.includes(i);
                      return (
                        <td key={party}>
                          {before ? (
                            <span className="ring">
                              <span className="sr-only">
                                Without a protocol
                              </span>
                            </span>
                          ) : null}
                          {after ? (
                            <span className="dot">
                              <span className="sr-only">With Poppy</span>
                            </span>
                          ) : null}
                          {before || after ? null : (
                            <span className="none">
                              <span className="sr-only">Neither</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <figcaption>
              <b>Figure 4.</b> Who holds what. Without a protocol the agent ends
              up with your password and the decision. With Poppy each party
              holds its own part.
            </figcaption>
          </figure>
          <Points items={gets} />
        </section>

        <section id="try" className="sec" aria-labelledby="try-title">
          <div className="sec-head">
            <h2 id="try-title">Try it in four industries</h2>
            <p>
              The lab&apos;s personal agent is called Iris. Pick a company, sign
              in as a test customer, ask Iris for a change and approve it
              yourself.
            </p>
          </div>
          <div className="cases">
            {companies.map((c) => (
              <article className="case" key={c.id}>
                <h3>
                  {c.name}
                  <span className="sector">{c.sector}</span>
                </h3>
                <p className="ask">“{c.ask}”</p>
                <div className="change">
                  <p className="change-head">
                    What you approve
                    <span className="waiting">Waiting for you</span>
                  </p>
                  <dl>
                    {c.change.map((row) => (
                      <div key={row.what}>
                        <dt>{row.what}</dt>
                        <dd>
                          <Delta before={row.before} after={row.after} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <p className="shows">{c.shows}</p>
                <div className="case-links">
                  <a className="button small" href={connect(c.url)}>
                    Try this request
                  </a>
                  <a href={c.site.href}>
                    {c.site.label} <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                </div>
                <p className="people">Test customers: {c.people}</p>
              </article>
            ))}
          </div>
          <p className="note">
            Each visitor gets a private copy of the test customers. An idle copy
            starts again after 24 hours. Never enter real banking, travel or
            payment details.
          </p>
        </section>

        <section
          id="safety"
          className="sec split"
          aria-labelledby="safety-title"
        >
          <div className="sec-head">
            <h2 id="safety-title">What the AI can never do</h2>
            <p>
              Iris keeps the language model away from anything sensitive. Plain
              code holds the credentials and signs the requests, and you do the
              approving.
            </p>
          </div>
          <Points items={never} />
          <figure className="matrix">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Job</span>
                  </th>
                  {actors.map((actor) => (
                    <th scope="col" key={actor}>
                      {actor}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {duties.map(([job, who]) => (
                  <tr key={job}>
                    <th scope="row">{job}</th>
                    {actors.map((actor, i) => (
                      <td key={actor}>
                        {i === who ? (
                          <span className={i === 2 ? "dot you" : "dot"}>
                            <span className="sr-only">Yes</span>
                          </span>
                        ) : (
                          <span className="none">
                            <span className="sr-only">No</span>
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <figcaption>
              <b>Figure 5.</b> Who does what inside Iris. The model never holds
              a credential, and only you can approve.
            </figcaption>
          </figure>
        </section>

        <section className="closing" aria-labelledby="closing-title">
          <div>
            <h2 id="closing-title">See it for yourself</h2>
            <p>
              You don&apos;t need an account or a model key. If you are building
              an agent or a company, the developer guide has the endpoints and
              the spec sections, and the <a href={SPEC_URL}>specification</a>{" "}
              has the rest.
            </p>
          </div>
          <div className="actions">
            <a className="button" href="/playground">
              Try the live demo <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="button ghost" href="/developers">
              Developer guide
            </a>
          </div>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}

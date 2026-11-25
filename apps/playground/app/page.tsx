import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { FlowDiagram } from "./flow-diagram";
import { SequenceFigure } from "./sequence-figure";
import { SPEC_URL, SiteBar, SiteFoot, companies, connect } from "./site-chrome";
import { specLink } from "./spec-ref";
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

/** What changes for each side: one sentence for today, one with the protocol. */
const sides = [
  {
    who: "People",
    without:
      "Your agent signs in as you, with your password, and can do anything you can.",
    with: "You sign in at the company yourself. The agent gets a permission you can take back, and each change waits for your approval.",
  },
  {
    who: "Companies",
    without:
      "You block agents, or one signs in as the customer and you can't tell them apart.",
    with: "You know which agent is calling and what the customer approved, and you perform each change once.",
  },
  {
    who: "Agent builders",
    without:
      "You build one integration for each company, through pages built for people, holding the person's password.",
    with: "One protocol works at every company, through its APIs, with no password to hold.",
  },
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
              independent place to watch it work, with one agent, called Iris,
              and five fictional companies.
            </p>
            <div className="actions">
              <a className="button" href="/playground">
                Try the live demo <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
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
              What an agent may do at Juniper Market, one of the lab&apos;s
              fictional companies. The three middle steps are what you can try
              in the demo.
            </figcaption>
          </figure>
        </section>

        <section id="how" className="sec" aria-labelledby="how-title">
          <div className="sec-head">
            <h2 id="how-title">How it works</h2>
            <p>
              There are three parties, and each keeps its own job. The steps are
              the same at a grocery, a bank or an airline.
            </p>
          </div>
          <FlowDiagram />
          <ol className="steps">
            <li>
              <span className="step-n" aria-hidden="true">
                1
              </span>
              <div className="step-text">
                <h3>You ask, your agent finds the company</h3>
                <p>
                  The company publishes one small file that says how agents can
                  reach it. Your agent reads it and introduces itself with an
                  identity the company can check.
                </p>
              </div>
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
            </li>
            <li>
              <span className="step-n" aria-hidden="true">
                2
              </span>
              <div className="step-text">
                <h3>You sign in on the company&apos;s own page</h3>
                <p>
                  The company shows which agent is asking and what it wants, and
                  you decide what to allow. Your password never passes through
                  the agent.
                </p>
              </div>
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
            </li>
            <li>
              <span className="step-n" aria-hidden="true">
                3
              </span>
              <div className="step-text">
                <h3>Changes wait for your approval</h3>
                <p>
                  The agent proposes exact terms. The company holds the change
                  until you approve it, then performs it once.
                </p>
              </div>
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
            </li>
          </ol>
          <p className="note">
            Want the endpoints, headers and spec sections behind each step?{" "}
            <a href="/developers">See the developer guide</a>.
          </p>
        </section>

        <section id="who" className="sec" aria-labelledby="who-title">
          <div className="sec-head">
            <h2 id="who-title">What each side gets</h2>
            <p>
              The same steps change something different for the person, for the
              company and for whoever builds the agent.
            </p>
          </div>
          <table className="compare">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Side</span>
                </th>
                <th scope="col">Without a protocol</th>
                <th scope="col" className="on">
                  With Poppy
                </th>
              </tr>
            </thead>
            <tbody>
              {sides.map((side) => (
                <tr key={side.who}>
                  <th scope="row">{side.who}</th>
                  <td data-label="Without a protocol">{side.without}</td>
                  <td className="with" data-label="With Poppy">
                    {side.with}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="try" className="sec" aria-labelledby="try-title">
          <div className="sec-head">
            <h2 id="try-title">Try it in five industries</h2>
            <p>
              Five companies that look nothing alike, and one agent that works
              at all of them. Pick one, sign in as a test customer, ask Iris for
              a change and approve it yourself.
            </p>
          </div>
          <div className="cases">
            {companies.map((c) => (
              <article
                className="case"
                key={c.id}
                style={{ "--brand": c.brand } as React.CSSProperties}
              >
                <header className="case-head">
                  <h3>{c.name}</h3>
                  <span className="sector">{c.sector}</span>
                </header>
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
              </article>
            ))}
          </div>
          <p className="note">
            The companies are fictional: nothing is charged, shipped or
            transferred. Each visitor gets a private copy of the test customers,
            and an idle copy starts again after 24 hours. Never enter real
            banking, travel, utility or payment details.
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
              Who does what inside Iris. The model never holds a credential, and
              only you can approve.
            </figcaption>
          </figure>
        </section>

        <section className="closing" aria-labelledby="closing-title">
          <div>
            <h2 id="closing-title">See it for yourself</h2>
            <p>
              You don&apos;t need an account or a model key. If you are building
              an agent or a company, the developer guide has the endpoints and
              the spec sections, and the{" "}
              <a href={SPEC_URL} {...specLink}>
                specification
              </a>{" "}
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

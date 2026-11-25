import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FlowDiagram } from "./flow-diagram";
import { TrackingSlip } from "./tracking-slip";
import { SPEC_URL, SiteBar, SiteFoot, companies, connect } from "./site-chrome";
import "./site.css";

/** From "no agents" to "the agent is you": Poppy is the three steps between. */
const ladder = [
  { on: false, title: "Blocked", text: "No agents allowed." },
  { on: true, title: "Browse the catalogue", text: "Any agent, no sign-in." },
  {
    on: true,
    title: "See your orders",
    text: "After you sign in on Juniper's own page.",
  },
  {
    on: true,
    title: "Move a delivery",
    text: "Only with your approval of the exact change.",
  },
  { on: false, title: "Full access", text: "The agent acts as you." },
] as const;

const people = [
  [
    "No shared passwords.",
    "You sign in at the company, as you do today. The agent gets a permission, not your login.",
  ],
  [
    "You choose what it may do.",
    "In this lab, access starts read-only. Proposing changes is a separate permission you add later.",
  ],
  [
    "Nothing changes without you.",
    "The agent proposes exact terms: what, when and how much. Only your click approves.",
  ],
  [
    "Take it back any time.",
    "The company's site lists the agents you connected, and their access can be revoked.",
  ],
] as const;

const forCompanies = [
  [
    "Start with what you have.",
    "A website, APIs or your own agent. One discovery file describes them to every agent that follows the protocol.",
  ],
  [
    "Know who is calling.",
    "Each request is signed by the agent, so you can tell agents apart and decide which ones you serve.",
  ],
  [
    "Changes you can stand behind.",
    "A change arrives with who approved it and when, and you perform it at most once, even if the request is repeated.",
  ],
  [
    "Draw your own lines.",
    "Sign-in and consent stay on your pages, and you decide which tasks agents may not do.",
  ],
] as const;

const builders = [
  [
    "One protocol across companies.",
    "The same discovery, sign-in and approval at a grocery, a bank or an airline, instead of one integration each.",
  ],
  [
    "Sign-in without the password.",
    "The person signs in on the company's page. Your agent never holds their credentials.",
  ],
  [
    "Structured access.",
    "APIs and conversations with the company's own agent, instead of clicking through pages built for people.",
  ],
  [
    "A place to test.",
    "Four companies with different permissions and approval rules, and a trace of every step.",
  ],
] as const;

const never = [
  [
    "See your secrets.",
    "Passwords, access tokens and keys are handled by ordinary code. The AI model never sees them.",
  ],
  [
    "Approve its own request.",
    "The model can read and propose. Only your click approves; nothing typed in the chat counts.",
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
            <p className="eyebrow">Personal Agent Protocol 1.0</p>
            <h1 id="hero-title">
              How AI agents and companies agree on the rules.
            </h1>
            <p className="lead">
              Personal Agent Protocol, Poppy for short, is an open protocol for
              how personal agents and companies work together. Poppy Lab is an
              independent place to watch it work: one agent, four fictional
              companies, and every step in plain view.
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
              Independent lab, not affiliated with the protocol&apos;s authors.
              Nothing is charged, shipped or transferred.
            </p>
          </div>
          <TrackingSlip />
        </section>

        <section id="why" className="band" aria-labelledby="why-title">
          <div className="section-head">
            <h2 id="why-title">Today it is all or nothing</h2>
            <p>
              When you ask an AI agent to deal with a company, the company has
              two options. It blocks the agent, or the agent signs in as you and
              can do anything you can. Poppy adds the steps in between, and the
              company decides how far each one goes.
            </p>
          </div>
          <ol className="ladder">
            {ladder.map((step) => (
              <li key={step.title} className={step.on ? "on" : "off"}>
                <span>{step.on ? "With Poppy" : "Without a protocol"}</span>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="note">
            Example from Juniper Market, one of the lab&apos;s fictional
            companies. The three middle steps are what you can try in the demo.
          </p>
        </section>

        <section id="how" className="band" aria-labelledby="how-title">
          <div className="section-head">
            <h2 id="how-title">How it works</h2>
            <p>
              Three parties, and each keeps its own job. The same three steps
              apply at a grocery, a bank or an airline.
            </p>
          </div>
          <FlowDiagram />
          <ol className="steps">
            <li>
              <span>Step 1</span>
              <h3>You ask, your agent finds the company</h3>
              <p>
                The company publishes one small file that says how agents can
                reach it. Your agent reads it and introduces itself with an
                identity the company can check.
              </p>
            </li>
            <li>
              <span>Step 2</span>
              <h3>You sign in on the company&apos;s own page</h3>
              <p>
                The company shows which agent is asking and what it wants. You
                decide what to allow. Your password never passes through the
                agent.
              </p>
            </li>
            <li>
              <span>Step 3</span>
              <h3>Changes wait for your approval</h3>
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

        <section id="who" className="band" aria-labelledby="who-title">
          <div className="section-head">
            <h2 id="who-title">What each side gets</h2>
            <p>
              Poppy 1.0 was published on 14 November 2026, so there are no
              adoption figures to quote. Everything below is something you can
              watch happen in the demo.
            </p>
          </div>
          <div className="cols">
            <article>
              <h3>People</h3>
              <Points items={people} />
            </article>
            <article>
              <h3>Companies</h3>
              <Points items={forCompanies} />
            </article>
            <article>
              <h3>Agent builders</h3>
              <Points items={builders} />
            </article>
          </div>
        </section>

        <section id="try" className="band" aria-labelledby="try-title">
          <div className="section-head">
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
                <p className="sector">{c.sector}</p>
                <h3>{c.name}</h3>
                <p className="ask">“{c.ask}”</p>
                <p className="shows">{c.shows}</p>
                <div className="case-links">
                  <a className="button dark small" href={connect(c.url)}>
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

        <section id="safety" className="below" aria-labelledby="safety-title">
          <div>
            <h2 id="safety-title">What the AI can never do</h2>
            <p className="aside">
              Iris is built so that the language model sits above a line it
              can&apos;t cross. Signing in, sending credentials and approving
              are done by plain code and by you.
            </p>
          </div>
          <ul>
            {never.map(([title, text]) => (
              <li key={title}>
                <strong>{title}</strong> {text}
              </li>
            ))}
          </ul>
        </section>

        <section className="closing" aria-labelledby="closing-title">
          <div>
            <h2 id="closing-title">See it for yourself</h2>
            <p>
              No account or model key needed. Building an agent or a company?
              The developer guide has the endpoints and the spec sections, and
              the <a href={SPEC_URL}>specification</a> has the rest.
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

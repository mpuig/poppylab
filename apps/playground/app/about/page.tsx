import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import {
  ABOUT_AUTHOR,
  FEEDBACK_URL,
  SITE_NAME,
  pageMetadata,
} from "@/lib/site";
import { SiteBar, SiteFoot, companies } from "../site-chrome";
import "../site.css";

export const metadata: Metadata = pageMetadata({
  title: `About · ${SITE_NAME}`,
  description: `What ${SITE_NAME} is: a working lab where anyone can watch a Personal Agent and five fictional companies speak Personal Agent Protocol 1.0.`,
  path: "/about",
});

/** "A, B, C and D". */
const list = (items: readonly string[]) =>
  `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

export default function About() {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar />
      <main id="main" className="reading">
        <article className="learn-article">
          <h1>About {SITE_NAME}</h1>
          <p className="lead reading-lead">
            {SITE_NAME} is a working lab for Personal Agent Protocol 1.0. Anyone
            can watch a Personal Agent and five fictional companies speak the
            protocol, request by request.
          </p>
          <div className="learn-body">
            <h2 id="why">Why it exists</h2>
            <p>
              Personal Agent Protocol, Poppy for short, is an open protocol for
              how personal agents and companies work together. A specification
              says what should happen; a lab shows it happening. {SITE_NAME}{" "}
              follows the published text of version 1.0 and runs it end to end,
              so you can see what each side sends, what the person approves and
              what the company does with it.
            </p>

            <h2 id="inside">What is in it</h2>
            <ul>
              <li>
                <a href="/playground">The playground</a>. Iris, a Personal
                Agent, connects to the companies you pick. You sign in on each
                company&apos;s own page and approve each change yourself, and
                the inspector shows every request and reply.
              </li>
              <li>
                <a href="/learn">Learn</a>. How the protocol works, from one
                task followed request by request to building a Company or a
                Personal Agent of your own.
              </li>
              <li>
                <a href="/learn/validator">The validator results</a>. What the
                protocol&apos;s own validator reports for each of the five
                companies.
              </li>
              <li>
                <a href="/api/v1/openapi.json">The agent API</a>. Iris&apos;s
                own HTTP API, described in OpenAPI: conversations, messages,
                approvals and events. Today it answers the playground&apos;s
                page in your browser; access for other clients comes next.
              </li>
            </ul>

            <h2 id="fictional">Everything here is fictional</h2>
            <p>
              {list(companies.map((c) => c.name))} are not real companies. Their
              customers, orders, accounts, flights and bills are made up, and
              nothing you do here buys, pays or moves anything real. Please
              don&apos;t enter real passwords, card numbers or account details.
            </p>

            <h2 id="personal">A personal project</h2>
            <p>
              {SITE_NAME} is a personal project; views are my own. It is not
              affiliated with or endorsed by the protocol&apos;s authors, and it
              makes no claim of conformance or production security.
              {ABOUT_AUTHOR ? (
                <>
                  {" "}
                  It is made by{" "}
                  <a href={ABOUT_AUTHOR.url} rel="noopener">
                    {ABOUT_AUTHOR.handle}
                  </a>
                  .
                </>
              ) : null}{" "}
              <a href="/privacy">Privacy</a> says what the site keeps while you
              use it.
            </p>

            <h2 id="feedback">Feedback</h2>
            <p>
              If something is wrong, unclear or broken, please{" "}
              <a href={FEEDBACK_URL} rel="noopener">
                open an issue on GitHub
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
              . Say which page or company it was, what you did and what you saw.
            </p>
          </div>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}

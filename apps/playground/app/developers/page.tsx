import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import {
  DEMOS_URL,
  SiteBar,
  SiteFoot,
  companies,
  connect,
  host,
} from "../site-chrome";
import { SpecRef } from "../spec-ref";
import "../site.css";

export const metadata: Metadata = {
  title: "Developers · Poppy Lab",
  description:
    "Endpoints, scopes and spec sections for the five fictional Poppy 1.0 Companies, and how to test your own Company or Personal Agent against the lab.",
};

const legend = [
  ["DI", "Discovery", "/.well-known/poppy.json", "§3"],
  ["RS", "Protected resource", "/.well-known/oauth-protected-resource", "§3.2"],
  [
    "AS",
    "Authorization server",
    "/.well-known/oauth-authorization-server",
    "§3.2",
  ],
  ["ID", "Your agent's identity", "HTTPS client_id, metadata and JWKS", "§4.1"],
  [
    "SI",
    "Direct Sign-In",
    "POST /oauth/par, then /oauth/authorize · PKCE S256",
    "§4.2",
  ],
  [
    "TK",
    "Tokens and refresh",
    "POST /oauth/token · private_key_jwt, DPoP",
    "§4.4–4.5",
  ],
  ["RV", "Revocation", "POST /oauth/revoke", "§4.6"],
  [
    "SH",
    "Session header",
    "Poppy-Session and Poppy-Version: 1.0 on every request",
    "§3.4, §5.2–5.3",
  ],
  ["AP", "APIs", "/openapi.json · OpenAPI 3.1", "§7"],
  ["TS", "Tasks", "GET /poppy/tasks · excluded tasks per Session", "§9"],
  [
    "CV",
    "Conversations",
    "/poppy/conversations · the Company's own agent",
    "§8",
  ],
  [
    "OP",
    "Approvals",
    '403 approval_required → resend with Poppy-Approval (approver="user")',
    "Operations v3",
  ],
] as const;

const covers = [
  [
    "Discovery, versions and identity.",
    "poppy.json 1.0 with supported_versions, protected-resource and authorization-server metadata, and an HTTPS client_id with metadata and JWKS.",
    "§3, §4.1",
  ],
  [
    "Sessions.",
    "A delegated ES256 Poppy-Session header on every request, DPoP-bound access tokens, refresh with the same DPoP key, and revocation.",
    "§5",
  ],
  [
    "Direct Sign-In.",
    "A pushed authorization request when offered, with consent on the Company's own page: read-only first, change proposals as a separate step.",
    "§4.2",
  ],
  [
    "Approvals.",
    "A change comes back as approval_required with exact terms. The Company performs it only when the same request returns with the user's approval, at most once.",
    "Operations v3",
  ],
  [
    "Conversations.",
    "Each Company has its own deterministic agent that takes structured requests and can ask for sign-in or propose an operation.",
    "§8",
  ],
] as const;

export default function Developers() {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar current="developers" />

      <main id="main">
        <section className="dev-hero" aria-labelledby="dev-title">
          <div className="dev-copy">
            <h1 id="dev-title">
              Test your agent or your Company against the lab
            </h1>
            <p className="lead">
              Poppy Lab runs both sides of Personal Agent Protocol 1.0 with
              Operations v3. Point Iris at your own Company, or point your own
              Personal Agent at the five fictional ones.
            </p>
            <div className="actions">
              <a className="button" href="/playground">
                Open the playground <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
          </div>
          <figure
            className="pairs"
            role="img"
            aria-label="Two ways to test: Iris, the lab's agent, against your Company; or your Personal Agent against the lab's five Companies"
          >
            <div className="pair">
              <span className="party">
                Iris<small>the lab&apos;s Personal Agent</small>
              </span>
              <span className="reach" />
              <span className="party company yours">
                Your Company<small>any address you enter</small>
              </span>
            </div>
            <div className="pair">
              <span className="party yours">
                Your Personal Agent<small>an HTTPS client_id</small>
              </span>
              <span className="reach" />
              <span className="party company">
                The five test Companies
                <small>grocery, restaurant, bank, airline, utility</small>
              </span>
            </div>
            <figcaption>
              Two ways to test. A dashed outline is the side you bring.
            </figcaption>
          </figure>
        </section>

        <section className="below" aria-labelledby="iris-title">
          <div>
            <h2 id="iris-title">Test a Company with Iris</h2>
            <p className="aside">
              Iris is the lab&apos;s Personal Agent, at{" "}
              <code>poppylab.dev/playground</code>. Enter any Company URL,
              choose a model with your own key or the keyless protocol demo, and
              open the Inspector for the discovery document, the Session and
              every API call, each labelled with its spec section. Approval
              cards show exact terms; the model can&apos;t press them.
            </p>
            <a className="button ghost" href="/playground">
              Open the playground <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
          <dl className="facts">
            <div>
              <dt>Models</dt>
              <dd>OpenAI-compatible · Anthropic · keyless demo</dd>
            </div>
            <div>
              <dt>Your key</dt>
              <dd>Sent per request, never stored on the server</dd>
            </div>
            <div>
              <dt>Identity</dt>
              <dd>
                <a href="/agent/client.json">/agent/client.json</a>
                {" · "}
                <a href="/agent/jwks.json">/agent/jwks.json</a>
              </dd>
            </div>
            <div>
              <dt>Shown as</dt>
              <dd>Iris from poppylab.dev</dd>
            </div>
          </dl>
        </section>

        <section className="agents" aria-labelledby="companies-title">
          <div className="agents-intro">
            <h2 id="companies-title">The five test Companies</h2>
            <p>
              Each one is a separate deployment with its own scopes and consent
              page, and the same two fictional customers: Elena Maren and Robin
              Ito. Every visitor gets a private copy of them; an idle copy
              starts again after 24 hours.
            </p>
          </div>
          <div
            className="legend stack"
            role="region"
            aria-label="Test Companies"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Host</th>
                  <th scope="col">Scopes</th>
                  <th scope="col">Playground</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{c.name}</th>
                    <td data-label="Host">
                      <a href={c.url}>
                        <code>{host(c.url)}</code>
                      </a>
                    </td>
                    <td data-label="Scopes">{c.scopes}</td>
                    <td data-label="Playground">
                      <a href={connect(c.url)}>Connect</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="agents" aria-labelledby="agents-title">
          <div className="agents-intro">
            <h2 id="agents-title">Bring your own agent</h2>
            <p>
              All five Companies accept any Personal Agent with an HTTPS{" "}
              <code>client_id</code> that serves its metadata and keys, with
              redirect URIs from that metadata. All five speak Operations v3.
              Replace <code>{"{company}"}</code> with one of the hosts above.
            </p>
          </div>
          <div
            className="legend"
            role="region"
            aria-label="Endpoint legend"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">What</th>
                  <th scope="col">Where, on https://{"{company}"}</th>
                  <th scope="col">Spec</th>
                </tr>
              </thead>
              <tbody>
                {legend.map(([code, what, where, spec]) => (
                  <tr key={code}>
                    <td>
                      <span className="code">{code}</span>
                    </td>
                    <th scope="row">{what}</th>
                    <td>
                      <code>{where}</code>
                    </td>
                    <td className="spec">
                      <SpecRef reference={spec} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="below" aria-labelledby="covers-title">
          <div>
            <h2 id="covers-title">What the lab implements</h2>
            <p className="aside">
              Poppy Lab makes no claim of conformance. The draft changes, and
              interop findings are expected output. Other implementations are
              listed in the{" "}
              <a href={DEMOS_URL}>protocol&apos;s community demos</a>. How each
              side is built, and what the official validator found, is in{" "}
              <a href="/learn">Learn</a>.
            </p>
          </div>
          <ul>
            {covers.map(([title, text, spec]) => (
              <li key={title}>
                <strong>{title}</strong> {text}{" "}
                <SpecRef className="spec-ref" reference={spec} />
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}

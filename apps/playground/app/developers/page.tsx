import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { LAB_REPOSITORY } from "@poppy-lab/pap-core";
import {
  DEMOS_URL,
  SPEC_URL,
  SiteBar,
  SiteFoot,
  companies,
  connect,
  host,
} from "../site-chrome";
import "../site.css";

export const metadata: Metadata = {
  title: "Developers · Poppy Lab",
  description:
    "Endpoints, scopes and spec sections for the four fictional Poppy 1.0 Companies, and how to test your own Company or Personal Agent against the lab.",
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
          <p className="eyebrow">Developer guide</p>
          <h1 id="dev-title">
            Test your agent or your Company against the lab
          </h1>
          <p className="lead">
            Poppy Lab runs both sides of Personal Agent Protocol 1.0 with
            Operations v3. Point Iris at your own Company, or point your own
            Personal Agent at the four fictional ones.
          </p>
          <div className="actions">
            <a className="button" href="/playground">
              Open the playground <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="button ghost" href="/learn">
              Learn how it works
            </a>
            <a className="button ghost" href={SPEC_URL}>
              Specification <ArrowUpRight size={16} aria-hidden="true" />
            </a>
            <a className="button ghost" href={LAB_REPOSITORY}>
              Source on GitHub <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
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
            <a className="button dark" href="/playground">
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
            <h2 id="companies-title">The four test Companies</h2>
            <p>
              Each one is a separate deployment with its own customers, scopes
              and consent page. Every visitor gets a private copy of the
              fictional customers; an idle copy starts again after 24 hours.
            </p>
          </div>
          <div
            className="legend scroll"
            role="region"
            aria-label="Test Companies"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Host</th>
                  <th scope="col">Scopes</th>
                  <th scope="col">Customers</th>
                  <th scope="col">Links</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{c.name}</th>
                    <td>
                      <code>{host(c.url)}</code>
                    </td>
                    <td>{c.scopes}</td>
                    <td>{c.people.replace(" or ", ", ")}</td>
                    <td className="row-links">
                      <a href={connect(c.url)}>Connect</a>
                      <a href={`${c.url}${c.agents.path}`}>{c.agents.label}</a>
                      <a href={c.site.href}>{c.site.label}</a>
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
              All four Companies accept any Personal Agent with an HTTPS{" "}
              <code>client_id</code> that serves its metadata and keys, with
              redirect URIs from that metadata. All four speak Operations v3.
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
                    <td className="spec">{spec}</td>
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
                <span className="spec-ref">{spec}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}

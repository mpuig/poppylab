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
import { SITE_NAME, pageMetadata } from "@/lib/site";
import { SpecRef } from "../spec-ref";
import "../site.css";

export const metadata: Metadata = pageMetadata({
  title: `Developers · ${SITE_NAME}`,
  description:
    "Endpoints, scopes and spec sections for the five fictional Poppy 1.0 Companies, and how to test your own Company or Personal Agent against the lab.",
  path: "/developers",
  image: "developers",
});

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
  [
    "DS",
    "Device Sign-In",
    "POST /oauth/device, the same consent page · not at Harborline",
    "§4.3",
  ],
  ["AP", "APIs", "/openapi.json · OpenAPI 3.1", "§7"],
  [
    "MC",
    "MCP",
    "/mcp, with /.well-known/oauth-protected-resource/mcp · a token for that resource only",
    "§7",
  ],
  [
    "BJ",
    "Browser join",
    "/poppy/browser-session · poppy:browser-sign-in, read-only",
    "§6",
  ],
  [
    "EX",
    "Domain extensions",
    "poppylab.dev/fdx v1 at Harborline · poppylab.dev/espi v1 at Fernwick",
    "§3.3",
  ],
  [
    "TS",
    "Tasks",
    "GET /poppy/tasks per Session · excluded tasks, skills, feedback endpoint",
    "§9",
  ],
  [
    "CV",
    "Conversations",
    "/poppy/conversations · the Company's agent, SSE event streams (Accept: text/event-stream) and Direct Conversations",
    "§8, §8.6, §8.10",
  ],
  [
    "OP",
    "Approvals",
    '403 approval_required → resend with Poppy-Approval (approver="user", or "agent" under a standing instruction)',
    "Operations v3",
  ],
] as const;

const coverGroups = [
  {
    title: "Identity and Sessions",
    items: [
      [
        "Discovery, versions and identity.",
        "poppy.json 1.0 with supported_versions, protected-resource and authorization-server metadata, and an HTTPS client_id with metadata and JWKS.",
        "§3, §4.1",
      ],
      [
        "Sessions and DPoP.",
        "A delegated ES256 Poppy-Session header on every request, DPoP-bound access tokens, refresh with the same DPoP key, and revocation.",
        "§5",
      ],
      [
        "Operator signatures.",
        "Iris signs each request with HTTP Message Signatures and names its key directory in Signature-Agent.",
        "§5.3",
      ],
    ],
  },
  {
    title: "Sign-In and Consent",
    items: [
      [
        "Direct Sign-In.",
        "A pushed authorization request when offered, with consent on the Company's own page: read-only first, change proposals as a separate step.",
        "§4.2",
      ],
      [
        "Device Sign-In.",
        "The agent shows a link and a short code, and the person signs in on the Company's own page on any device. Four Companies offer it; Harborline doesn't.",
        "§4.3",
      ],
      [
        "Browser join.",
        "A Personal Agent's browser can join its Session on the Company's website with poppy:browser-sign-in, seeing what the token's scopes cover. A joined browser changes nothing.",
        "§6",
      ],
    ],
  },
  {
    title: "Tools and Extensions",
    items: [
      [
        "APIs and MCP.",
        "Each Company serves OpenAPI 3.1 endpoints and an MCP server at /mcp with its own protected resource metadata, a per-resource token, and the same approvals.",
        "§7",
      ],
      [
        "Domain extensions.",
        "Harborline serves FDX-shaped bank data (poppylab.dev/fdx v1) and Fernwick ESPI-shaped energy data (poppylab.dev/espi v1), each with its own scopes and consent.",
        "§3.3",
      ],
      [
        "Tasks and skills.",
        "Each Company exposes per-Session GET /poppy/tasks (excluded tasks and feedback) and publishes skills listed in the Inspector; Iris loads none yet.",
        "§9, §9.4",
      ],
    ],
  },
  {
    title: "Conversations and Approvals",
    items: [
      [
        "Approvals.",
        "A change comes back as approval_required with exact server-computed terms. The Company performs it only once, when the same request returns with the user's approval.",
        "Operations v3",
      ],
      [
        "Agent approvals.",
        'Under a standing instruction set for one Company, Iris approves within its limits with approver="agent". Harborline declines agent approvals for payments and transfers.',
        "Operations §6",
      ],
      [
        "Conversations, streaming and handoff.",
        "Each Company's deterministic agent handles structured requests, streams live events over SSE (Last-Event-ID), proposes operations, and supports handoff and Direct Conversations.",
        "§8, §8.6, §8.9–8.10",
      ],
    ],
  },
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
              <code>poppylab.dev/playground</code>. Enter any Company URL, use
              the small free model, a model with your own key or the keyless
              protocol demo, and open the Inspector for the discovery document,
              the Session and every API call, each labelled with its spec
              section. Approval cards show exact terms; the model can&apos;t
              press them.
            </p>
            <a className="button ghost" href="/playground">
              Open the playground <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
          <dl className="facts">
            <div>
              <dt>Models</dt>
              <dd>
                Free (limited) · OpenAI-compatible · Anthropic · keyless demo
              </dd>
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
              <dt>Signatures</dt>
              <dd>
                <a href="/.well-known/http-message-signatures-directory">
                  /.well-known/http-message-signatures-directory
                </a>
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
              starts again after 24 hours. The scopes are each Company&apos;s
              own API&apos;s; every Company also offers{" "}
              <code>poppy:browser-sign-in</code>, and Harborline and Fernwick
              their extensions&apos; scopes. Each Company&apos;s For agents page
              has its endpoints, MCP tools and skills.
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
                  <th scope="col">For agents</th>
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
                    <td data-label="For agents">
                      <a href={`${c.url}/for-agents`}>
                        <code>/for-agents</code>
                      </a>
                    </td>
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

        <section className="below" aria-labelledby="api-title">
          <div>
            <h2 id="api-title">The agent&apos;s API</h2>
            <p className="aside">
              Iris has an HTTP API of its own, for a client that isn&apos;t the
              playground&apos;s page: a phone app, a voice client or a messaging
              channel, in the same conversations. An app signs in with a passkey
              and holds a session per device. It is <code>v1</code>, and still
              changing until it is frozen.
            </p>
            <a className="button ghost" href="/developers/api">
              Read the reference <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
          <dl className="facts">
            <div>
              <dt>Reference</dt>
              <dd>
                <a href="/developers/api">/developers/api</a>
              </dd>
            </div>
            <div>
              <dt>Guide</dt>
              <dd>
                <a href="/developers/native-client">
                  /developers/native-client
                </a>
              </dd>
            </div>
            <div>
              <dt>Document</dt>
              <dd>
                <a href="/api/v1/openapi.json">/api/v1/openapi.json</a> ·
                OpenAPI 3.1
              </dd>
            </div>
            <div>
              <dt>Streaming</dt>
              <dd>
                SSE turn deltas · live conversation events · spoken text for
                voice
              </dd>
            </div>
            <div>
              <dt>Sign-in</dt>
              <dd>
                Passkeys for poppylab.dev · rotating tokens · app Company
                sign-in links
              </dd>
            </div>
          </dl>
        </section>

        <section className="agents" aria-labelledby="covers-title">
          <div className="agents-intro">
            <h2 id="covers-title">What the lab implements</h2>
            <p>
              Poppy Lab makes no claim of conformance, and interop findings are
              expected output. Other implementations are listed in the{" "}
              <a href={DEMOS_URL}>protocol&apos;s community demos</a>. How each
              side is built is in <a href="/learn">Learn</a>, and{" "}
              <a href="/learn/validator">what the official validator found</a>{" "}
              is on its own page.
            </p>
          </div>
          <div className="covers-grid">
            {coverGroups.map((group) => (
              <div className="covers-group" key={group.title}>
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map(([title, text, spec]) => (
                    <li key={title}>
                      <strong>{title}</strong> {text}{" "}
                      <SpecRef className="spec-ref" reference={spec} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFoot />
    </div>
  );
}

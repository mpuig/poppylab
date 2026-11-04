import { ArrowRight, ArrowUpRight } from "lucide-react";
import { LAB_REPOSITORY, labSites } from "@poppy-lab/pap-core";
import { Barcode, TrackingSlip } from "./tracking-slip";
import "./site.css";

// Inlined at build time: local Companies in development, poppylab.dev when deployed.
const juniper =
  process.env.NEXT_PUBLIC_JUNIPER_URL ?? "http://juniper.localhost:4100";
const lantern =
  process.env.NEXT_PUBLIC_LANTERN_URL ?? "http://noodles.localhost:4200";
const host = (url: string) => new URL(url).host;
const connect = (url: string) =>
  `/playground?company=${encodeURIComponent(url)}`;

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
  ["SI", "Direct Sign-In", "GET /oauth/authorize · PKCE S256", "§4.2"],
  [
    "TK",
    "Tokens and refresh",
    "POST /oauth/token · private_key_jwt, DPoP",
    "§4.4–4.5",
  ],
  ["RV", "Revocation", "POST /oauth/revoke", "§4.6"],
  ["SH", "Session header", "Poppy-Session on every API request", "§5.2–5.3"],
  ["AP", "APIs", "/openapi.json · OpenAPI 3.1", "§7"],
  ["EX", "Excluded tasks", "/poppy/excluded-tasks.json", "§9.1"],
  [
    "OP",
    "Approvals",
    "403 approval_required → resend with Poppy-Approval",
    "Operations v2",
  ],
] as const;

/** The top of an address label: test-Company code and its barcode. */
function LabelStrip({ code, bars }: { code: string; bars: string }) {
  return (
    <div className="label-strip">
      <span>{code}</span>
      <Barcode code={bars} />
    </div>
  );
}

export default function Home() {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="bar">
        <a className="wordmark" href="/">
          Poppy Lab <span className="tag">PAP 0.3</span>
        </a>
        <nav aria-label="Sections">
          <a href="#route">How it works</a>
          <a href="#sites">Sites</a>
          <a href="#agents">For agents</a>
        </nav>
        <a className="button small" href="/playground">
          <span className="long">Open the playground</span>
          <span className="short">Playground</span>
        </a>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">
              Send an agent to the shops. Nothing changes until you sign.
            </h1>
            <p className="lead">
              Poppy Lab is an independent test bench for the Personal Agent
              Protocol, draft 0.3. Run Iris, its Personal Agent, with your own
              model key, point it at two fictional Companies, and watch every
              step it takes: discovery, sign-in, signed Sessions, and changes
              that wait for your approval.
            </p>
            <div className="actions">
              <a className="button" href="/playground">
                Open the playground <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="button ghost" href="#sites">
                See the test Companies
              </a>
            </div>
            <p className="fine">
              Bring an OpenAI or Anthropic key, or try the keyless protocol
              demo. The shops are fictional: nothing is charged or shipped.
            </p>
          </div>
          <TrackingSlip />
        </section>

        <section id="route" className="route" aria-labelledby="route-title">
          <h2 id="route-title">The route of one request</h2>
          <ol className="stops">
            <li data-stop="1">
              <h3>Your agent finds the Company</h3>
              <p>
                Poppy reads <code>/.well-known/poppy.json</code>, checks the
                Company&apos;s own sign-in server, and starts a Session signed
                with its own key.
              </p>
            </li>
            <li data-stop="2">
              <h3>You sign in on the Company&apos;s page</h3>
              <p>
                The Company shows which agent is asking. Pick a fictional
                customer; access is read-only unless you also allow change
                proposals.
              </p>
            </li>
            <li data-stop="3">
              <h3>Changes wait for your signature</h3>
              <p>
                The agent proposes exact terms. The Company holds them until you
                approve in Poppy, then performs them at most once.
              </p>
            </li>
          </ol>
        </section>

        <section id="sites" className="sites" aria-labelledby="sites-title">
          <h2 id="sites-title">Three sites, one lab</h2>
          <article className="label label-agent">
            <div className="label-main">
              <h3>The playground</h3>
              <p className="address">poppylab.dev/playground</p>
              <p>
                Iris, a chat-first Personal Agent. Choose GPT-6 Luna or Sonnet 5
                with your own key, connect a Company, and open the Inspector for
                the discovery document, the Session and every API call. Approval
                cards show exact terms; the model can&apos;t press them.
              </p>
            </div>
            <div className="label-side">
              <dl>
                <div>
                  <dt>Models</dt>
                  <dd>OpenAI-compatible · Anthropic</dd>
                </div>
                <div>
                  <dt>Your key</dt>
                  <dd>Sent per request, never stored on the server</dd>
                </div>
              </dl>
              <a className="button dark" href="/playground">
                Open the playground <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
          </article>

          <div className="label-pair">
            <article className="label">
              <LabelStrip code="JM · PAP 0.3 · Ops v2" bars="JUNIPER" />
              <h3>Juniper Market</h3>
              <p className="address">{host(juniper)}</p>
              <p>
                A neighbourhood grocery with a full customer account: basket,
                recurring delivery, orders, simulated invoices, profile and
                support cases. The website and your agent share the same data.
              </p>
              <dl className="facts">
                <div>
                  <dt>Customers</dt>
                  <dd>Alex, Maya, Leo</dd>
                </div>
                <div>
                  <dt>Scopes</dt>
                  <dd>
                    <code>poppy:read</code> <code>poppy:write</code>
                  </dd>
                </div>
              </dl>
              <p className="try">“Move my recurring delivery to Saturday.”</p>
              <div className="label-links">
                <a className="button dark" href={connect(juniper)}>
                  Connect in the playground
                </a>
                <a href={`${juniper}/account`}>
                  Customer website <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              </div>
            </article>
            <article className="label">
              <LabelStrip code="LN · PAP 0.3 · Ops v2" bars="LANTERN" />
              <h3>Lantern Noodle Bar</h3>
              <p className="address">{host(lantern)}</p>
              <p>
                A noodle bar with a menu, delivery slots and scheduled orders.
                Change dishes or the slot; the approval shows the price
                difference first.
              </p>
              <dl className="facts">
                <div>
                  <dt>Customers</dt>
                  <dd>Sam, Robin</dd>
                </div>
                <div>
                  <dt>Scopes</dt>
                  <dd>
                    <code>orders:read</code> <code>orders:write</code>
                  </dd>
                </div>
              </dl>
              <p className="try">
                “Add a matcha ice cream and move it to Sunday lunchtime.”
              </p>
              <div className="label-links">
                <a className="button dark" href={connect(lantern)}>
                  Connect in the playground
                </a>
                <a href={lantern}>
                  Company page <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              </div>
            </article>
          </div>
          <p className="note">
            Every visitor gets a separate copy of the fictional customers. An
            idle copy starts again after 24 hours.
          </p>
        </section>

        <section className="below" aria-labelledby="below-title">
          <h2 id="below-title">What stays below the model</h2>
          <ul>
            <li>
              <strong>Keys and tokens.</strong> Code signs and sends them. The
              model never sees an access token, a private key or your model key.
            </li>
            <li>
              <strong>Approvals.</strong> The model can read and propose. Only
              your click approves; words in the chat never do.
            </li>
            <li>
              <strong>Company content.</strong> Whatever a Company returns, the
              model still can&apos;t approve a change or see a secret.
            </li>
            <li>
              <strong>Your session.</strong> Each browser has its own agent,
              User IDs and conversation, unlinkable across Companies.
            </li>
          </ul>
        </section>

        <section id="agents" className="agents" aria-labelledby="agents-title">
          <div className="agents-intro">
            <h2 id="agents-title">Bring your own agent</h2>
            <p>
              Juniper and Lantern accept any Personal Agent with an HTTPS{" "}
              <code>client_id</code> that serves its metadata and keys, with
              redirect URIs from that metadata. Both speak Operations v2.
              Replace <code>{"{company}"}</code> with{" "}
              <code>{host(juniper)}</code> or <code>{host(lantern)}</code>.
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
          <p className="note">
            Poppy&apos;s own identity:{" "}
            <a href="/agent/client.json">/agent/client.json</a> and{" "}
            <a href="/agent/jwks.json">/agent/jwks.json</a>.
          </p>
        </section>
      </main>

      <footer className="foot">
        <div>
          <p className="wordmark">Poppy Lab</p>
          <p>
            An independent experiment with Personal Agent Protocol draft 0.3,
            following the text as published on 3 November 2026. The draft still
            changes. Poppy Lab makes no claim of conformance or production
            security.
          </p>
        </div>
        <nav aria-label="Poppy Lab sites" className="lab-nav">
          {labSites(juniper)
            .filter((s) => s.id !== "home")
            .map((s) => (
              <a key={s.id} href={s.url}>
                {s.label}
              </a>
            ))}
          <a href={LAB_REPOSITORY}>
            Source on GitHub <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </nav>
        <nav aria-label="Elsewhere">
          <a href="https://personalagentprotocol.org/docs/0.3/spec">
            Specification <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <a href="https://papsandbox.com">
            PAP Sandbox <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </nav>
        <p className="disclaimer">
          Not affiliated with or endorsed by the protocol&apos;s authors.
          “Personal Agent Protocol” and “Poppy” are their names. PAP Sandbox is
          a separate, independent site.
        </p>
      </footer>
    </div>
  );
}

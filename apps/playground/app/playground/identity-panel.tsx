import { ArrowUpRight } from "lucide-react";

/** The public metadata a Company uses to verify this agent. */
export function IdentityPanel() {
  return (
    <section className="identity-panel">
      <dl>
        <div>
          <dt>Agent</dt>
          <dd>Iris, the Poppy Lab agent</dd>
        </div>
        <div>
          <dt>Authentication</dt>
          <dd>Signed assertions · ES256</dd>
        </div>
        <div>
          <dt>Client metadata</dt>
          <dd>
            <a href="/agent/client.json" target="_blank" rel="noreferrer">
              /agent/client.json <ArrowUpRight size={13} />
            </a>
          </dd>
        </div>
        <div>
          <dt>Public keys</dt>
          <dd>
            <a href="/agent/jwks.json" target="_blank" rel="noreferrer">
              /agent/jwks.json <ArrowUpRight size={13} />
            </a>
          </dd>
        </div>
      </dl>
      <p className="privacy-note">
        Only public metadata is exposed. Private signing keys stay on the
        server.
      </p>
    </section>
  );
}

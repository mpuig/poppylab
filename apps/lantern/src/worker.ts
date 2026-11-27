/**
 * Lantern Noodle Bar on Cloudflare Workers. Every request goes to one
 * Durable Object, which is the single writer of the Company's state and
 * persists what each request touched in its SQLite-backed storage.
 */
import { DurableObject } from "cloudflare:workers";
import { createWorkerCompany } from "@poppy-lab/pap-company";
import { lantern } from "./lantern.ts";

type Env = {
  LANTERN: DurableObjectNamespace<LanternCompany>;
  PUBLIC_ORIGIN: string;
  LANTERN_PASSWORD_HASH?: string;
  /** `wrangler dev` only: accept the local Poppy over plain HTTP. */
  DEV_HTTP_CLIENT?: string;
};

export class LanternCompany extends DurableObject<Env> {
  private company = createWorkerCompany(lantern, {
    storage: this.ctx.storage,
    origin: this.env.PUBLIC_ORIGIN,
    devHttpClient: this.env.DEV_HTTP_CLIENT,
    passwordHash: this.env.LANTERN_PASSWORD_HASH,
    // Every playground visitor is the lab's one agent: give it room so
    // the playground isn't refused before other clients are.
    clientShares: { "https://poppylab.dev/agent/client.json": 0.6 },
  });
  override fetch(request: Request) {
    return this.company.fetch(request);
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.LANTERN.get(env.LANTERN.idFromName("lantern")).fetch(request);
  },
} satisfies ExportedHandler<Env>;

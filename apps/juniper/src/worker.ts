/**
 * Juniper Market on Cloudflare Workers. Every request goes to one
 * Durable Object, which is the single writer of the Company's state and
 * persists what each request touched in its SQLite-backed storage.
 */
import { DurableObject } from "cloudflare:workers";
import { createWorkerCompany } from "@poppy-lab/pap-company";
import { juniperCompany } from "./juniper.js";

type Env = {
  JUNIPER: DurableObjectNamespace<JuniperCompany>;
  PUBLIC_ORIGIN: string;
  JUNIPER_PASSWORD_HASH?: string;
  /** `wrangler dev` only: accept the local Poppy over plain HTTP. */
  DEV_HTTP_CLIENT?: string;
};

export class JuniperCompany extends DurableObject<Env> {
  private company = createWorkerCompany(
    () => juniperCompany({ portal: true, workers: true }),
    {
      storage: this.ctx.storage,
      origin: this.env.PUBLIC_ORIGIN,
      devHttpClient: this.env.DEV_HTTP_CLIENT,
      passwordHash: this.env.JUNIPER_PASSWORD_HASH,
    },
  );
  override fetch(request: Request) {
    return this.company.fetch(request);
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.JUNIPER.get(env.JUNIPER.idFromName("juniper")).fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Fernwick Power & Light on Cloudflare Workers with one single-writer Durable Object. */
import { DurableObject } from "cloudflare:workers";
import { createWorkerCompany } from "@poppy-lab/pap-company";
import { fernwick } from "./fernwick.ts";

type Env = {
  FERNWICK: DurableObjectNamespace<FernwickCompany>;
  PUBLIC_ORIGIN: string;
  FERNWICK_PASSWORD_HASH?: string;
  /** `wrangler dev` only: accept the local Poppy over plain HTTP. */
  DEV_HTTP_CLIENT?: string;
};

export class FernwickCompany extends DurableObject<Env> {
  private company = createWorkerCompany(fernwick, {
    storage: this.ctx.storage,
    origin: this.env.PUBLIC_ORIGIN,
    devHttpClient: this.env.DEV_HTTP_CLIENT,
    passwordHash: this.env.FERNWICK_PASSWORD_HASH,
  });
  override fetch(request: Request) {
    return this.company.fetch(request);
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.FERNWICK.get(env.FERNWICK.idFromName("fernwick")).fetch(request);
  },
} satisfies ExportedHandler<Env>;

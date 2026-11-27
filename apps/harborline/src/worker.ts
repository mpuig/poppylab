/** Harborline Bank on Cloudflare Workers with one single-writer Durable Object. */
import { DurableObject } from "cloudflare:workers";
import { createWorkerCompany } from "@poppy-lab/pap-company";
import { harborline } from "./harborline.ts";

type Env = {
  HARBORLINE: DurableObjectNamespace<HarborlineCompany>;
  PUBLIC_ORIGIN: string;
  HARBORLINE_PASSWORD_HASH?: string;
  /** `wrangler dev` only: accept the local Poppy over plain HTTP. */
  DEV_HTTP_CLIENT?: string;
};

export class HarborlineCompany extends DurableObject<Env> {
  private company = createWorkerCompany(harborline, {
    storage: this.ctx.storage,
    origin: this.env.PUBLIC_ORIGIN,
    devHttpClient: this.env.DEV_HTTP_CLIENT,
    passwordHash: this.env.HARBORLINE_PASSWORD_HASH,
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
    return env.HARBORLINE.get(env.HARBORLINE.idFromName("harborline")).fetch(
      request,
    );
  },
} satisfies ExportedHandler<Env>;

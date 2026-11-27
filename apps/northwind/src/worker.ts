/** Northwind Air on Cloudflare Workers and a SQLite-backed Durable Object. */
import { DurableObject } from "cloudflare:workers";
import { createWorkerCompany } from "@poppy-lab/pap-company";
import { northwind } from "./northwind.ts";

type Env = {
  NORTHWIND: DurableObjectNamespace<NorthwindCompany>;
  PUBLIC_ORIGIN: string;
  NORTHWIND_PASSWORD_HASH?: string;
  /** `wrangler dev` only: accept the local Poppy over plain HTTP. */
  DEV_HTTP_CLIENT?: string;
};

export class NorthwindCompany extends DurableObject<Env> {
  private company = createWorkerCompany(northwind, {
    storage: this.ctx.storage,
    origin: this.env.PUBLIC_ORIGIN,
    devHttpClient: this.env.DEV_HTTP_CLIENT,
    passwordHash: this.env.NORTHWIND_PASSWORD_HASH,
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
    return env.NORTHWIND.get(env.NORTHWIND.idFromName("northwind")).fetch(
      request,
    );
  },
} satisfies ExportedHandler<Env>;

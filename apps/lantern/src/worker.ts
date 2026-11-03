/**
 * Lantern Noodle Bar on Cloudflare Workers. Every request goes to one
 * Durable Object, which is the single writer of the Company's state and
 * persists what each request touched in its SQLite-backed storage.
 */
import { DurableObject } from "cloudflare:workers";
import { createCompany, splitStore } from "@poppy-lab/pap-company";
import type { Hono } from "hono";
import { lantern } from "./lantern.ts";

type Env = {
  LANTERN: DurableObjectNamespace<LanternCompany>;
  PUBLIC_ORIGIN: string;
  PUBLIC_DOMAIN: string;
  LANTERN_PASSWORD_HASH?: string;
  /** `wrangler dev` only: accept the local Poppy over plain HTTP. */
  DEV_HTTP_CLIENT?: string;
};
const MAX_BYTES = 64 * 1024;

/** HTTPS only, no redirects, bounded size and time (Workers can't reach private networks). */
async function fetchJson(url: string, devOrigin?: string): Promise<unknown> {
  if (new URL(url).protocol !== "https:" && new URL(url).origin !== devOrigin)
    throw new Error("HTTPS required");
  const response = await fetch(url, {
    redirect: "manual",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // Bound before reading: the declared length, then the bytes themselves.
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES)
    throw new Error("Response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

export class LanternCompany extends DurableObject<Env> {
  private app?: Hono;
  private async company() {
    if (this.app) return this.app;
    // Protocol state under `state`, each visitor's copy under its own key.
    const store = await splitStore(this.ctx.storage);
    // Only honoured when the Company itself runs on a local origin.
    const dev =
      this.env.DEV_HTTP_CLIENT &&
      /^http:\/\/[a-z0-9.-]*localhost(:\d+)?$/.test(this.env.PUBLIC_ORIGIN)
        ? this.env.DEV_HTTP_CLIENT
        : undefined;
    this.app = createCompany(lantern, {
      origin: this.env.PUBLIC_ORIGIN,
      domain: this.env.PUBLIC_DOMAIN,
      store,
      // Public: every agent user gets a fresh copy of the fictional customers.
      isolation: "visitor",
      fetchJson: (url) => fetchJson(url, dev ? new URL(dev).origin : undefined),
      ...(dev ? { httpClients: [dev] } : {}),
      ...(this.env.LANTERN_PASSWORD_HASH
        ? { passwordHash: this.env.LANTERN_PASSWORD_HASH }
        : {}),
    });
    return this.app;
  }
  override async fetch(request: Request) {
    return (await this.company()).fetch(request);
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.LANTERN.get(env.LANTERN.idFromName("lantern")).fetch(request);
  },
} satisfies ExportedHandler<Env>;

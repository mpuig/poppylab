/** Harborline Bank on Cloudflare Workers with one single-writer Durable Object. */
import { DurableObject } from "cloudflare:workers";
import { createCompany, splitStore } from "@poppy-lab/pap-company";
import type { Hono } from "hono";
import { harborline } from "./harborline.ts";

type Env = {
  HARBORLINE: DurableObjectNamespace<HarborlineCompany>;
  PUBLIC_ORIGIN: string;
  HARBORLINE_PASSWORD_HASH?: string;
  DEV_HTTP_CLIENT?: string;
};
const MAX_BYTES = 64 * 1024;
async function fetchJson(url: string, devOrigin?: string): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.origin !== devOrigin)
    throw new Error("HTTPS required");
  const response = await fetch(url, {
    redirect: "manual",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

export class HarborlineCompany extends DurableObject<Env> {
  private app?: Hono;
  private async company() {
    if (this.app) return this.app;
    const store = await splitStore(this.ctx.storage);
    const dev =
      this.env.DEV_HTTP_CLIENT &&
      /^http:\/\/[a-z0-9.-]*localhost(:\d+)?$/.test(this.env.PUBLIC_ORIGIN)
        ? this.env.DEV_HTTP_CLIENT
        : undefined;
    this.app = createCompany(harborline, {
      origin: this.env.PUBLIC_ORIGIN,
      store,
      // After a failed save, the next request starts again from storage.
      discard: () => {
        delete this.app;
      },
      isolation: "visitor",
      fetchJson: (url) => fetchJson(url, dev ? new URL(dev).origin : undefined),
      ...(dev ? { httpClients: [dev] } : {}),
      ...(this.env.HARBORLINE_PASSWORD_HASH
        ? { passwordHash: this.env.HARBORLINE_PASSWORD_HASH }
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
    return env.HARBORLINE.get(env.HARBORLINE.idFromName("harborline")).fetch(
      request,
    );
  },
} satisfies ExportedHandler<Env>;

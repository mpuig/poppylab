/**
 * A Company on Cloudflare Workers, as each Company's Durable Object starts
 * it: the state in the object's own storage (`splitStore`), the Personal
 * Agents' documents fetched over HTTPS only, and a plain-HTTP Personal Agent
 * accepted only while the Company itself runs on a local origin. The
 * Durable Object class stays in each Company's `worker.ts`, because only a
 * Worker can import `cloudflare:workers`.
 */
import type { Hono } from "hono";
import { createCompany } from "./gateway.ts";
import type { CompanyDefinition } from "./gateway/types.ts";
import { splitStore, type KeyValue } from "./split-store.ts";

const MAX_BYTES = 64 * 1024;

/**
 * HTTPS only, no redirects, bounded size and time (Workers can't reach
 * private networks). `devOrigin` is the one origin also reached over plain
 * HTTP, in development.
 */
export async function workerFetchJson(
  url: string,
  devOrigin?: string,
): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.origin !== devOrigin)
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

/** What a Company's Worker reads from its Durable Object and its `env`. */
export type WorkerConfig = {
  /** The Durable Object's storage (`this.ctx.storage`). */
  storage: KeyValue;
  /** `PUBLIC_ORIGIN`. */
  origin: string;
  /** `DEV_HTTP_CLIENT`: `wrangler dev` only, the local Poppy's client_id. */
  devHttpClient?: string | undefined;
  /** The Company's `*_PASSWORD_HASH` secret, when it has one. */
  passwordHash?: string | undefined;
  /**
   * Trusted clients' share of the caps, by exact client_id (see
   * `Deployment.clientShares`): every other client keeps a fifth.
   */
  clientShares?: Record<string, number>;
};

/**
 * The Company a Durable Object serves, started on its first request. Every
 * request waits on the same start, so two that arrive cold make one
 * gateway. After a failed save, or a start that failed, the next request
 * starts again from storage. A definition given as a function is called on
 * each start.
 */
export function createWorkerCompany(
  def: CompanyDefinition | (() => CompanyDefinition),
  config: WorkerConfig,
) {
  // Only honoured when the Company itself runs on a local origin.
  const dev =
    config.devHttpClient &&
    /^http:\/\/[a-z0-9.-]*localhost(:\d+)?$/.test(config.origin)
      ? config.devHttpClient
      : undefined;
  const devOrigin = dev ? new URL(dev).origin : undefined;
  let ready: Promise<Hono> | undefined;
  const start = () => {
    const started: Promise<Hono> = (async () => {
      // Protocol state under `state`, each visitor's copy under its own key.
      const store = await splitStore(config.storage);
      return createCompany(typeof def === "function" ? def() : def, {
        origin: config.origin,
        store,
        // Only this gateway's own failure drops it, never a later one.
        discard: () => {
          if (ready === started) ready = undefined;
        },
        // Public: every agent user gets a fresh copy of the fictional customers.
        isolation: "visitor",
        fetchJson: (url) => workerFetchJson(url, devOrigin),
        ...(dev ? { httpClients: [dev] } : {}),
        ...(config.passwordHash ? { passwordHash: config.passwordHash } : {}),
        ...(config.clientShares ? { clientShares: config.clientShares } : {}),
      });
    })();
    started.catch(() => {
      if (ready === started) ready = undefined;
    });
    return started;
  };
  return {
    async fetch(request: Request): Promise<Response> {
      return (await (ready ??= start())).fetch(request);
    },
  };
}

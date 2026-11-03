/**
 * TEST ONLY. A Fastify-like `inject`/`listen`/`close` over the Hono apps, so
 * tests exercise the same handlers that run in Node and Cloudflare Workers.
 */
import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import {
  createCompany,
  emptyState,
  type Deployment,
  type GatewayState,
  type Store,
} from "@poppy-lab/pap-company";
import { router } from "./router.js";
import { juniperCompany } from "./juniper.js";

export type Injected = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  json: () => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
type InjectOptions = {
  method?: string;
  url: string;
  headers?: Record<string, string | undefined>;
  payload?: unknown;
};
function injector(fetch: (r: Request) => Response | Promise<Response>) {
  return async (input: InjectOptions | string): Promise<Injected> => {
    const o = typeof input === "string" ? { url: input } : input;
    const headers = new Headers();
    for (const [k, v] of Object.entries(o.headers ?? {}))
      if (v !== undefined) headers.set(k, v);
    let body: string | undefined;
    if (o.payload !== undefined) {
      if (typeof o.payload === "string") body = o.payload;
      else if (o.url.startsWith("/oauth/") && o.method === "POST") {
        body = new URLSearchParams(
          o.payload as Record<string, string>,
        ).toString();
        if (!headers.has("content-type"))
          headers.set("content-type", "application/x-www-form-urlencoded");
      } else {
        body = JSON.stringify(o.payload);
        if (!headers.has("content-type"))
          headers.set("content-type", "application/json");
      }
    }
    const response = await fetch(
      new Request(new URL(o.url, "http://test.invalid"), {
        method: o.method ?? "GET",
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: "manual",
      }),
    );
    const text = await response.text();
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((v, k) => {
      out[k] = k === "set-cookie" ? response.headers.getSetCookie() : v;
    });
    return {
      statusCode: response.status,
      headers: out,
      body: text,
      json: () => JSON.parse(text),
    };
  };
}
function lifecycle(
  fetch: (r: Request) => Response | Promise<Response>,
  drop?: (request: Request, response: Response) => boolean,
) {
  let server: ServerType | undefined;
  // The network path can lose a response after it was produced (committed).
  const network = async (request: Request) => {
    const response = await fetch(request.clone() as Request);
    if (!drop?.(request, response)) return response;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("connection lost"));
        },
      }),
      { status: response.status, headers: response.headers },
    );
  };
  return {
    inject: injector(fetch),
    async listen(_options?: unknown) {
      return new Promise<string>((resolve) => {
        server = serve(
          { fetch: network, port: 0, hostname: "127.0.0.1" },
          (info) => resolve(`http://127.0.0.1:${info.port}`),
        );
      });
    },
    async close() {
      await new Promise<void>((resolve) =>
        server ? server.close(() => resolve()) : resolve(),
      );
      server = undefined;
    },
  };
}

/** Business modules alone: a Router plus inject. */
export function testApp() {
  const hono = new Hono();
  return { ...router(hono), ...lifecycle((r) => hono.fetch(r)), hono };
}

/** The full Juniper Company (gateway included) for protocol tests. */
export function juniperApp(
  options: {
    origin?: string;
    store?: Store;
    fetchJson: Deployment["fetchJson"];
    portal?: boolean;
    drop?: (request: Request, response: Response) => boolean;
  } & Partial<Pick<Deployment, "passwordHash" | "dpopNonces" | "isolation">>,
) {
  const origin = options.origin ?? "http://juniper.localhost:4100";
  const app = createCompany(
    juniperCompany({ portal: options.portal ?? true }),
    {
      origin,
      domain: new URL(origin).hostname,
      store: options.store ?? memory(),
      // Test fixtures may omit redirect_uris: default to the local Poppy's.
      fetchJson: async (url) => {
        const value = (await options.fetchJson(url)) as Record<string, unknown>;
        return value && "client_id" in value && !("redirect_uris" in value)
          ? { ...value, redirect_uris: localClient.redirect_uris }
          : value;
      },
      httpClients: ["http://localhost:3000/agent/client.json"],
      ...(options.passwordHash ? { passwordHash: options.passwordHash } : {}),
      ...(options.dpopNonces ? { dpopNonces: options.dpopNonces } : {}),
      ...(options.isolation ? { isolation: options.isolation } : {}),
    },
  );
  // Requests come for the Company's own origin (Hosts aren't checked).
  return { ...lifecycle((r) => app.fetch(r), options.drop), app };
}
export const memory = (value: GatewayState = emptyState()): Store => ({
  value,
  save() {},
});
export const localClient = {
  client_id: "http://localhost:3000/agent/client.json",
  client_name: "Poppy Lab",
  jwks_uri: "http://localhost:3000/agent/jwks.json",
  redirect_uris: ["http://localhost:3000/api/account/callback"],
};

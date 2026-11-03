/**
 * A small request/reply facade over Hono, so Juniper's business modules keep
 * a framework-neutral `(req, reply)` style and run on Node and on Cloudflare
 * Workers. It implements only what those modules use: JSON or form bodies,
 * params, query, headers, status, headers, text/JSON/HTML bodies, redirects
 * and per-router preHandler/onSend hooks.
 */
import type { Context, Hono } from "hono";

/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are validated by each handler */
export type Req<B = any, P = any, Q = any> = {
  body: B;
  params: P;
  query: Q;
  headers: Record<string, string | undefined>;
  url: string;
  method: string;
  /** The Hono context, for the gateway (Session, Operations v2 gate). */
  ctx: Context;
};
export type Generic = {
  Body?: unknown;
  Params?: unknown;
  Querystring?: unknown;
};
type ReqOf<G extends Generic> = Req<
  unknown extends G["Body"] ? any : G["Body"],
  unknown extends G["Params"] ? any : G["Params"],
  unknown extends G["Querystring"] ? any : G["Querystring"]
>;

export class Reply {
  statusCode = 200;
  private headers = new Headers();
  private contentType?: string;
  response?: Response;
  code(status: number) {
    this.statusCode = status;
    return this;
  }
  status(status: number) {
    return this.code(status);
  }
  private late = new Headers();
  header(name: string, value: string | string[]) {
    // After send() (onSend hooks), headers apply to the built response.
    const target = this.response ? this.late : this.headers;
    if (Array.isArray(value)) for (const v of value) target.append(name, v);
    else target.set(name, value);
    return this;
  }
  hasHeader(name: string) {
    return this.headers.has(name);
  }
  type(contentType: string) {
    this.contentType = contentType;
    return this;
  }
  redirect(url: string, status = 302) {
    this.statusCode = status;
    this.headers.set("Location", url);
    return this.send();
  }
  send(body?: unknown) {
    let payload: BodyInit | null;
    if (body === undefined || body === null) payload = null;
    else if (typeof body === "string") {
      payload = body;
      this.contentType ??= "text/plain; charset=utf-8";
    } else {
      payload = JSON.stringify(body);
      this.contentType ??= "application/json; charset=utf-8";
    }
    if (this.contentType && !this.headers.has("Content-Type"))
      this.headers.set("Content-Type", this.contentType);
    this.response = new Response(payload, {
      status: this.statusCode,
      headers: this.headers,
    });
    return this;
  }
  /** Headers set after send() (onSend hooks). */
  finish() {
    if (!this.response) return undefined;
    this.late.forEach((v, k) => {
      if (k === "set-cookie") this.response!.headers.append(k, v);
      else this.response!.headers.set(k, v);
    });
    return this.response;
  }
}

export type Handler<G extends Generic = Generic> = (
  req: ReqOf<G>,
  reply: Reply,
) => unknown;

async function request(c: Context): Promise<Req> {
  const type = c.req.header("content-type") ?? "";
  let body: unknown = undefined;
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    try {
      if (type.startsWith("application/json")) body = await c.req.json();
      else if (
        type.startsWith("application/x-www-form-urlencoded") ||
        type.startsWith("multipart/form-data")
      )
        body = await c.req.parseBody();
    } catch {
      body = undefined;
    }
  }
  const url = new URL(c.req.url);
  return {
    body,
    params: c.req.param() as Record<string, string>,
    query: c.req.query(),
    headers: Object.fromEntries(
      [...c.req.raw.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]),
    ),
    url: url.pathname + url.search,
    method: c.req.method,
    ctx: c,
  };
}

export function router(app: Hono) {
  const preHandlers: Handler[] = [];
  const onSend: Handler[] = [];
  const wrap =
    (handler: Handler<Generic>) =>
    async (c: Context): Promise<Response> => {
      const req = await request(c);
      const reply = new Reply();
      const respond = async (out: unknown) => {
        if (out instanceof Response) return out;
        if (!reply.response) reply.send(out === reply ? undefined : out);
        for (const hook of onSend) await hook(req, reply);
        return reply.finish()!;
      };
      for (const hook of preHandlers) {
        const out = await hook(req, reply);
        if (out instanceof Response) return out;
        if (reply.response) return respond(out);
      }
      return respond(await handler(req as never, reply));
    };
  const api = {
    get<G extends Generic = Generic>(path: string, handler: Handler<G>) {
      app.get(path, wrap(handler as Handler));
      return api;
    },
    post<G extends Generic = Generic>(path: string, handler: Handler<G>) {
      app.post(path, wrap(handler as Handler));
      return api;
    },
    route<G extends Generic = Generic>(r: {
      method: "GET" | "POST";
      url: string;
      handler: Handler<G>;
    }) {
      return r.method === "GET"
        ? api.get(r.url, r.handler)
        : api.post(r.url, r.handler);
    },
    addHook(name: "preHandler" | "onSend", hook: Handler) {
      (name === "preHandler" ? preHandlers : onSend).push(hook);
      return api;
    },
  };
  return api;
}
export type Router = ReturnType<typeof router>;

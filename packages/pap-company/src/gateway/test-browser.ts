/**
 * TEST ONLY. The parts of a browser join (§6) that the gateway's tests
 * share: the page as the validator loads it, a browser that keeps its
 * cookies, the Personal Agent's authorization, a second Personal Agent, and
 * a small Company website that says who it serves and takes changes.
 */
import { Hono, type Context } from "hono";
import { expect, vi } from "vitest";
import {
  createIdentity,
  createSessionKey,
  newSessionId,
  randomId,
  signSessionHeader,
} from "@poppy-lab/pap-client/core";
import { origin, type setup } from "./test-company.ts";
import { hash, type BrowserJoin, type CompanyDefinition } from "./types.ts";

export const PAGE = "/poppy/browser-session";
export const AUTHORIZE = `${PAGE}/authorize`;
export const JOIN = "__Host-poppy_join";
export const SESSION = "__Host-poppy_session";
export const BROWSER_SCOPE = "poppy:browser-sign-in";
/** A cookie the validator sends, to see whether the page changes it. */
export const PROBE = "validator_probe=1";

export type Lab = Awaited<ReturnType<typeof setup>>;
export const error = async (r: Response) =>
  ((await r.json()) as { error?: string }).error;
export const codeOf = (html: string) =>
  /<input type="hidden" name="code" value="([^"]+)">/.exec(html)?.[1] ?? "";
/** A Set-Cookie header's name, value and attributes (names in lowercase). */
export function parse(line: string) {
  const [pair, ...rest] = line.split(/;\s*/);
  const at = pair!.indexOf("=");
  return {
    name: pair!.slice(0, at),
    value: pair!.slice(at + 1),
    attributes: new Map(
      rest.map((a) => {
        const i = a.indexOf("=");
        return [
          (i < 0 ? a : a.slice(0, i)).toLowerCase(),
          i < 0 ? "" : a.slice(i + 1),
        ] as const;
      }),
    ),
  };
}
export const removes = (cookie: ReturnType<typeof parse>) =>
  Number(cookie.attributes.get("max-age") ?? 1) <= 0;
/** The cookies a response sets, without the ones it only removes. */
export const sets = (r: Response) =>
  r.headers
    .getSetCookie()
    .map(parse)
    .filter((c) => !removes(c));

/** The page as the validator loads it: with its probe cookie. */
export async function page(x: Lab) {
  const response = await x.app.request(PAGE, {
    headers: { accept: "text/html", cookie: PROBE },
  });
  const cookies = sets(response);
  return {
    response,
    code: codeOf(await response.clone().text()),
    cookies,
    cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
  };
}
/** The form's request, with the cookies given and nothing else. */
export const submit = (x: Lab, code: string, cookie?: string) =>
  x.app.request(PAGE, {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body: `code=${encodeURIComponent(code)}`,
  });
/** Whose Session authorizes, and the access token it sends, if any. */
export type Who = { user?: string; session?: string; access?: string };
/** Step 2 as the Personal Agent sends it. */
export const authorize = (x: Lab, code: string, who: Who = {}) =>
  x.call(AUTHORIZE, { method: "POST", body: { code }, ...who });
/** What the validator accepts as a refused form: an error, no cookie set. */
export async function refused(form: Response) {
  expect(form.status).toBeGreaterThanOrEqual(400);
  expect(sets(form)).toEqual([]);
  expect(form.headers.get("content-type")).toContain("text/html");
}

/** A second Personal Agent, at its own address and with its own keys. */
export async function stranger(x: Lab) {
  const id = "https://other.test/client.json";
  const keys = await createIdentity();
  x.metadata.other = (url) =>
    url === id
      ? {
          client_id: id,
          client_name: "Other",
          jwks_uri: "https://other.test/jwks.json",
          redirect_uris: ["https://other.test/callback"],
        }
      : url === "https://other.test/jwks.json"
        ? { keys: [keys.publicKey] }
        : undefined;
  const key = await createSessionKey(keys.privateKey, id);
  const sessionId = newSessionId();
  /** Step 2 from that agent; `signer` signs with another delegated key. */
  const send = async (code: string, signer = key) =>
    x.app.request(AUTHORIZE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Poppy-Version": "1.0",
        "Poppy-Session": await signSessionHeader({
          key: signer,
          clientId: id,
          audience: origin,
          sessionId,
          userId: "usr_other",
          method: "POST",
          url: origin + AUTHORIZE,
        }),
      },
      body: JSON.stringify({ code }),
    });
  /** A key the delegation in the header doesn't name. */
  const unnamed = {
    ...key,
    privateKey: (await createSessionKey(keys.privateKey, id)).privateKey,
  };
  return { send, unnamed };
}

/**
 * Moves the clock on; only `Date` is faked, so requests still resolve. A
 * test file that calls it restores the clock after each test.
 */
export function later(ms: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + ms);
}

/**
 * A website with two customers. It logs a browser in, says which copy of
 * the Company it shows, who it serves and through which join, lists and
 * disconnects that customer's agents, and takes changes by every method.
 * Its logins are kept as every Company keeps them: under `webSessions`, by
 * the hash of the login's cookie.
 */
export const site: Partial<CompanyDefinition> = {
  persona: (id) => (id === "elena" || id === "tomas" ? { id } : undefined),
  mount: (app, ctx) => {
    const logins = (ctx.state.webSessions ??= {}) as Record<
      string,
      { account: string }
    >;
    ctx.state.copy ??= randomId();
    const notes = (ctx.state.notes ??= []) as string[];
    const web = (c: Context) =>
      hash(/\bweb=(\w+)/.exec(c.req.header("cookie") ?? "")?.[1] ?? "");
    // §6: the join's account first, then the browser's own login.
    const account = (c: Context) =>
      ctx.browser(c)?.account ?? logins[web(c)]?.account ?? null;
    app.post("/site/login", (c) => {
      logins[web(c)] = { account: c.req.query("as") ?? "elena" };
      return c.body(null, 204);
    });
    app.post("/site/logout", (c) => {
      delete logins[web(c)];
      return c.body(null, 204);
    });
    app.get("/site/state", (c) =>
      c.json({
        account: account(c),
        join: ctx.browser(c) ?? null,
        copy: ctx.state.copy,
        notes,
      }),
    );
    const write = (c: Context) => {
      notes.push(`${c.req.method} ${new URL(c.req.url).pathname}`);
      return c.json({ saved: true });
    };
    app.post("/site/notes", write);
    app.put("/site/notes/:id", write);
    app.patch("/site/notes/:id", write);
    app.delete("/site/notes/:id", write);
    app.post("/account", write);
    app.get("/site/agents", (c) => c.json(ctx.grants.list(account(c) ?? "")));
    app.post("/site/agents/:id/revoke", (c) =>
      c.json({
        revoked: ctx.grants.revoke(account(c) ?? "", c.req.param("id")),
      }),
    );
    app.get("/api/copy", (c) => c.json({ copy: ctx.state.copy }));
  },
};
export type Seen = {
  account: string | null;
  join: BrowserJoin | null;
  copy: string;
  notes: string[];
};

/**
 * A browser: it keeps the cookies it is given and sends them back. `sends`
 * are headers of its own on every request that isn't a read, such as the
 * `Origin` a real browser adds and a header a page's script sets.
 */
export function browser(
  x: Lab,
  cookies: Record<string, string> = {},
  sends: Record<string, string> = {},
) {
  const jar = new Map(Object.entries(cookies));
  let app = x.app;
  const headers = () =>
    jar.size
      ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }
      : undefined;
  const keep = (r: Response) => {
    for (const cookie of r.headers.getSetCookie().map(parse))
      if (removes(cookie)) jar.delete(cookie.name);
      else jar.set(cookie.name, cookie.value);
    return r;
  };
  const get = async (path: string, accept?: string) =>
    keep(
      await app.request(path, {
        headers: { ...(accept ? { accept } : {}), ...headers() },
      }),
    );
  return {
    jar,
    get,
    /** The same browser at the Company after a restart. */
    at(next: Lab) {
      app = next.app;
    },
    /** A form post; `accept` says what the browser asks for. */
    post: async (
      path: string,
      form: Record<string, string> = {},
      accept?: string,
    ) =>
      keep(
        await app.request(path, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            ...(accept ? { accept } : {}),
            ...sends,
            ...headers(),
          },
          body: new URLSearchParams(form).toString(),
        }),
      ),
    /** A request by another method, as a page's script sends it. */
    send: async (method: string, path: string) =>
      keep(
        await app.request(path, {
          method,
          headers: {
            "content-type": "application/json",
            ...sends,
            ...headers(),
          },
          body: "{}",
        }),
      ),
    state: async () => (await (await get("/site/state")).json()) as Seen,
    /** Step 1: the page's code. */
    load: async () => codeOf(await (await get(PAGE)).text()),
  };
}
export type Browser = ReturnType<typeof browser>;
/** The whole join of a browser to a User's Session; the form's response. */
export async function join(x: Lab, b: Browser, who: Who = {}) {
  const code = await b.load();
  expect((await authorize(x, code, who)).status).toBe(204);
  return b.post(PAGE, { code });
}
/**
 * Every route of a Company that isn't a read, as `[method, path]` with a
 * value in place of each parameter: the Company's routes are mounted on an
 * app of their own, with nothing behind them, and listed.
 */
export function writingRoutes(def: CompanyDefinition) {
  const probe = new Hono();
  const none = () => {
    throw new Error("Only the routes are listed");
  };
  def.mount(probe, {
    sessionFor: none,
    state: {},
    gate: none,
    refused: none,
    grants: { list: () => [], revoke: () => false },
    grantFor: () => undefined,
    origin,
    operations: () => ({}),
    activity: () => [],
    converse: () => {},
    feedback: () => [],
    browser: () => undefined,
  });
  const seen = new Set<string>();
  return probe.routes.flatMap(({ method, path }) => {
    // Middleware is no route, and a read changes nothing.
    if (path === "*" || path === "/*" || ["GET", "HEAD"].includes(method))
      return [];
    const route: [string, string] = [
      method === "ALL" ? "POST" : method,
      path.replace(/:[A-Za-z_]+(\{[^}]*\})?\??/g, "x"),
    ];
    if (seen.has(route.join(" "))) return [];
    seen.add(route.join(" "));
    return [route];
  });
}
/** Whether a path is a Company website's: its account page or under /site. */
export const websitePath = (path: string) =>
  path === "/account" || path.startsWith("/site/");

/** Logs a browser in through a Company website's own login form. */
export async function websiteLogin(b: Browser, account: string) {
  const html = await (await b.get("/site/login")).text();
  const token = /name="login_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
  const answer = await b.post("/site/login", { login_token: token, account });
  expect(answer.status).toBe(302);
}

/** The copy of the Company an agent user has. */
export const copyOf = async (x: Lab, user?: string) =>
  (
    (await (
      await x.call("/api/copy", { ...(user ? { user } : {}) })
    ).json()) as { copy: string }
  ).copy;

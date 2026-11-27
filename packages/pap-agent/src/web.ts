/**
 * What the core needs of an HTTP channel, and what it answers one. The
 * core's functions take a `Caller` (who asks, from where) and answer a
 * `Reply` (a status, a JSON body and its headers); a channel turns its
 * own request into the one and the other into its own response. These
 * helpers do it for the Fetch API's `Request` and `Response`, which the
 * playground's routes, a Worker and Node all have.
 */
import { onWorkers } from "@poppy-lab/pap-client";
import { BROWSER_MS, sessionOfCookie } from "./api-sessions";
import { secureCookies, visitorOf } from "./runs";
import { signInCookie, signInCookieOptions } from "./sign-in-cookie";
import { UserFacingError } from "./user-error";

/** An answer of the core's, before any channel puts it on the wire. */
export type Reply<T = unknown> = {
  status: number;
  body: T;
  headers: Record<string, string>;
};
/** As `Response.json` takes it. */
export const json = <T>(
  body: T,
  init: { status?: number; headers?: Record<string, string> } = {},
): Reply<T> => ({
  status: init.status ?? 200,
  body,
  headers: { ...init.headers },
});
/** A body of bytes (a statement's PDF) goes as it is; any other as JSON. */
export const toResponse = (reply: Reply) =>
  reply.body instanceof Uint8Array
    ? new Response(reply.body as Uint8Array<ArrayBuffer>, {
        status: reply.status,
        headers: reply.headers,
      })
    : Response.json(reply.body, {
        status: reply.status,
        headers: reply.headers,
      });

/**
 * The client's address, for budgets counted per source: Cloudflare's
 * `cf-connecting-ip`, which it sets in front of a Worker. Anywhere else
 * any client can send that header, so nothing is taken from it there, as
 * at the Companies' gateway.
 */
export const clientAddress = (request: Request) =>
  onWorkers() ? request.headers.get("cf-connecting-ip") : null;

/** A cookie jar as Next's `cookies()` and the core's tests give one. */
export type CookieStore = {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options: Record<string, string | number | boolean>,
  ): unknown;
};

/**
 * Who a request is from, as a channel vouches for it.
 *
 * `user` is the agent user the request is for, the key every
 * conversation is kept under: in the playground, the SHA-256 of the
 * visitor cookie (`visitorOf`). `create` makes one when the channel has
 * none for this person yet; without it, undefined means a stranger.
 * `authentic` says the channel trusts the request is the user's own (a
 * same-origin browser request, an API session's bearer token), and
 * `origin` is where the agent is served, which says where the lab's
 * Companies are. A request signed in to an agent account is the
 * account's: `user` is the account's agent user, on every device.
 */
export type Caller = {
  user(create: true): string;
  user(create?: boolean): string | undefined;
  authentic: boolean;
  origin: string;
  /** Development on the developer's own machine: their environment key may answer. */
  localDev: boolean;
  /** The client's address, for the public budgets (`clientAddress`). */
  ip: string | null;
  /**
   * Binds a sign-in to the person who started it: the callback completes
   * one only for the caller that `holds` its OAuth `state`. In a browser,
   * a cookie for each sign-in (`sign-in-cookie.ts`).
   */
  signIns: {
    bind(state: string): void;
    holds(state: string): boolean;
    release(state: string): void;
  };
  /**
   * The agent account the request is signed in to (`api-sessions.ts`):
   * by the browser's cookie, or by an app's bearer token.
   */
  account?: { id: string; session: string; via: "cookie" | "bearer" };
};

/** The cookie that holds a browser's session of an agent account. */
export const accountCookie = () =>
  secureCookies() ? "__Host-poppy_account" : "poppy_account";
export const accountCookieOptions = (maxAge = BROWSER_MS / 1000) => ({
  httpOnly: true,
  secure: secureCookies(),
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
/**
 * The agent account this browser is signed in to, if its cookie still
 * names a session; one that ended (signed out on another device, say)
 * takes its cookie with it.
 */
export async function browserAccount(cookies: CookieStore) {
  const value = cookies.get(accountCookie())?.value;
  if (!value) return undefined;
  const session = await sessionOfCookie(value);
  if (!session) cookies.set(accountCookie(), "", accountCookieOptions(0));
  return session;
}
/**
 * Whom a browser's requests are for: the account it is signed in to, or
 * else its visitor (made when `create` and there is none).
 */
export async function browserUser(
  cookies: CookieStore,
  create: true,
): Promise<string>;
export async function browserUser(
  cookies: CookieStore,
  create?: boolean,
): Promise<string | undefined>;
export async function browserUser(cookies: CookieStore, create = false) {
  return (await browserAccount(cookies))?.user ?? visitorOf(cookies, create);
}

/** A browser request to the playground's own routes, as a `Caller`. */
export async function browserCaller(
  request: Request,
  cookies: CookieStore,
): Promise<Caller> {
  const url = new URL(request.url);
  const session = await browserAccount(cookies);
  return {
    user: (session
      ? () => session.user
      : (create?: boolean) => visitorOf(cookies, create)) as Caller["user"],
    ...(session
      ? { account: { id: session.account, session: session.id, via: "cookie" } }
      : {}),
    authentic: request.headers.get("origin") === url.origin,
    origin: url.origin,
    localDev:
      process.env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1"].includes(url.hostname),
    ip: clientAddress(request),
    signIns: cookieSignIns(cookies),
  };
}

/** A sign-in bound to a browser by a cookie of its own (`sign-in-cookie.ts`). */
export const cookieSignIns = (cookies: CookieStore): Caller["signIns"] => ({
  bind: (state) => {
    const name = signInCookie(state);
    if (name) cookies.set(name, state, signInCookieOptions());
  },
  holds: (state) => {
    const name = signInCookie(state);
    return !!name && cookies.get(name)?.value === state;
  },
  release: (state) => {
    const name = signInCookie(state);
    if (name) cookies.set(name, "", signInCookieOptions(0));
  },
});

/**
 * A JSON body of at most `limit` bytes, read within three seconds; a
 * larger or slower one is refused before it is parsed. Every route that
 * takes a body reads it with this.
 */
export async function readJson(
  request: Request,
  limit: number,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new UserFacingError("Use JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new UserFacingError("Missing request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new UserFacingError("Request timed out")),
      3000,
    );
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new UserFacingError("Request too large");
      chunks.push(chunk.value);
    }
  } finally {
    clearTimeout(timer!);
    void reader.cancel();
  }
  // Decoded once: a character split between two chunks stays whole.
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** A `Set-Cookie` header in the words Next writes it, for a plain Response. */
export function setCookie(
  response: Response,
  name: string,
  value: string,
  options: {
    path?: string;
    maxAge?: number;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: string;
  },
) {
  const attributes = [
    options.path && `Path=${options.path}`,
    options.maxAge &&
      `Expires=${new Date(Date.now() + options.maxAge * 1000).toUTCString()}`,
    typeof options.maxAge === "number" && `Max-Age=${options.maxAge}`,
    options.secure && "Secure",
    options.httpOnly && "HttpOnly",
    options.sameSite && `SameSite=${options.sameSite}`,
  ].filter(Boolean);
  response.headers.append(
    "Set-Cookie",
    [`${name}=${encodeURIComponent(value)}`, ...attributes].join("; "),
  );
}

/**
 * What the core needs of an HTTP channel, and what it answers one. The
 * core's functions take a `Caller` (who asks, from where) and answer a
 * `Reply` (a status, a JSON body and its headers); a channel turns its
 * own request into the one and the other into its own response. These
 * helpers do it for the Fetch API's `Request` and `Response`, which the
 * playground's routes, a Worker and Node all have.
 */
import { visitorOf } from "./runs";
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
export const toResponse = (reply: Reply) =>
  Response.json(reply.body, { status: reply.status, headers: reply.headers });

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
 * same-origin browser request; later, an API session), and `origin` is
 * where the agent is served, which says where the lab's Companies are.
 */
export type Caller = {
  user(create: true): string;
  user(create?: boolean): string | undefined;
  authentic: boolean;
  origin: string;
  /** Development on the developer's own machine: their environment key may answer. */
  localDev: boolean;
  /** The client's address, for the public budgets (Cloudflare's `cf-connecting-ip`). */
  ip: string | null;
};

/** A browser request to the playground's own routes, as a `Caller`. */
export function browserCaller(request: Request, cookies: CookieStore): Caller {
  const url = new URL(request.url);
  return {
    user: ((create?: boolean) => visitorOf(cookies, create)) as Caller["user"],
    authentic: request.headers.get("origin") === url.origin,
    origin: url.origin,
    localDev:
      process.env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1"].includes(url.hostname),
    ip: request.headers.get("cf-connecting-ip"),
  };
}

/**
 * A JSON body of at most `limit` bytes, read within three seconds; a
 * larger or slower one is refused before it is parsed.
 */
export async function readJson(
  request: Request,
  limit: number,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new UserFacingError("Use JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new UserFacingError("Missing request");
  let data = "";
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
      data += Buffer.from(chunk.value).toString("utf8");
      if (Buffer.byteLength(data) > limit)
        throw new UserFacingError("Request too large");
    }
  } finally {
    clearTimeout(timer!);
    void reader.cancel();
  }
  return JSON.parse(data) as unknown;
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

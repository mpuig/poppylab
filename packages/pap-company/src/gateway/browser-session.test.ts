/**
 * Browser join (§6). First what the protocol's Company validator checks at
 * a browser-session endpoint, each test named by the check it mirrors and
 * sending what that check sends. Then the join itself, what an access token
 * gets, and which copy of the Company a joined browser sees when every
 * agent user has its own.
 */
import type { Context } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import {
  createIdentity,
  createSessionKey,
  newSessionId,
  randomId,
  signSessionHeader,
} from "@poppy-lab/pap-client/core";
import { restartingStore } from "../memory.ts";
import { client, origin, redirect, setup } from "./test-company.ts";
import { hash, SESSION_MS, type CompanyDefinition } from "./types.ts";

const PAGE = "/poppy/browser-session";
const AUTHORIZE = `${PAGE}/authorize`;
const JOIN = "__Host-poppy_join";
const SESSION = "__Host-poppy_session";
/** A cookie the validator sends, to see whether the page changes it. */
const PROBE = "validator_probe=1";

type Lab = Awaited<ReturnType<typeof setup>>;
const error = async (r: Response) =>
  ((await r.json()) as { error?: string }).error;
const codeOf = (html: string) =>
  /<input type="hidden" name="code" value="([^"]+)">/.exec(html)?.[1] ?? "";
/** A Set-Cookie header's name, value and attributes (names in lowercase). */
function parse(line: string) {
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
const removes = (cookie: ReturnType<typeof parse>) =>
  Number(cookie.attributes.get("max-age") ?? 1) <= 0;
/** The cookies a response sets, without the ones it only removes. */
const sets = (r: Response) =>
  r.headers
    .getSetCookie()
    .map(parse)
    .filter((c) => !removes(c));

/** The page as the validator loads it: with its probe cookie. */
async function page(x: Lab) {
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
const submit = (x: Lab, code: string, cookie?: string) =>
  x.app.request(PAGE, {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body: `code=${encodeURIComponent(code)}`,
  });
/** Step 2 as the Personal Agent sends it. */
const authorize = (
  x: Lab,
  code: string,
  options: { user?: string; session?: string; access?: string } = {},
) => x.call(AUTHORIZE, { method: "POST", body: { code }, ...options });
/** What the validator accepts as a refused form: an error, no cookie set. */
async function refused(form: Response) {
  expect(form.status).toBeGreaterThanOrEqual(400);
  expect(sets(form)).toEqual([]);
  expect(form.headers.get("content-type")).toContain("text/html");
}

/** A second Personal Agent, at its own address and with its own keys. */
async function stranger(x: Lab) {
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

afterEach(() => {
  vi.useRealTimers();
});
/** Moves the clock on; only `Date` is faked, so requests still resolve. */
function later(ms: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + ms);
}

// ---- The validator's twelve checks -----------------------------------------

it("web.page-headers: the page can't be cached, framed, or kept as a window reference", async () => {
  const x = await setup();
  const { response, code } = await page(x);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(code).not.toBe("");
  expect(response.headers.get("cache-control")).toMatch(/\bno-store\b/);
  const ancestors = (response.headers.get("content-security-policy") ?? "")
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.startsWith("frame-ancestors"));
  expect(ancestors).toEqual(["frame-ancestors 'none'"]);
  expect([
    "same-origin",
    "same-origin-allow-popups",
    "noopener-allow-popups",
  ]).toContain(response.headers.get("cross-origin-opener-policy"));
});

it("web.page-headers-suggested: the page has the headers the guides suggest", async () => {
  const x = await setup();
  const { response } = await page(x);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers.get("cross-origin-opener-policy")).toBe(
    "same-origin",
  );
});

it("web.join-cookie: forms on other sites don't send the join cookie, and other hosts can't set it", async () => {
  const x = await setup();
  const { cookies } = await page(x);
  expect(cookies).toHaveLength(1);
  const [cookie] = cookies;
  expect(["strict", "lax"]).toContain(
    cookie!.attributes.get("samesite")?.toLowerCase(),
  );
  expect(cookie!.attributes.has("domain")).toBe(false);
  // What a browser asks of a `__Host-` cookie, or it rejects it.
  expect(cookie!.name.startsWith("__Host-")).toBe(true);
  expect(cookie!.attributes.has("secure")).toBe(true);
  expect(cookie!.attributes.get("path")).toBe("/");
});

it("web.join-cookie-suggested: the join cookie is the one the guides suggest", async () => {
  const x = await setup();
  const { cookies, code } = await page(x);
  const [cookie] = cookies;
  expect(cookie!.name).toBe(JOIN);
  expect(cookie!.attributes.has("secure")).toBe(true);
  expect(cookie!.attributes.has("httponly")).toBe(true);
  expect(cookie!.attributes.get("samesite")).toBe("Strict");
  // No longer than the code lasts, and the code is not its value.
  expect(Number(cookie!.attributes.get("max-age"))).toBe(60);
  expect(cookie!.value).not.toContain(code);
});

it("web.page-cookies: loading the page changes no other cookie and no Session", async () => {
  // Where every visitor has its own copy, a website page gives a browser
  // its `pap_browser` cookie. This page doesn't.
  const x = await setup({ isolation: "visitor" });
  await authorize(x, "bc_unknown");
  const before = structuredClone(x.store.value.sessions);
  expect(Object.keys(before)).toHaveLength(1);
  const first = await page(x);
  expect(
    first.response.headers.getSetCookie().map((line) => parse(line).name),
  ).toEqual([JOIN]);
  expect(x.store.value.sessions).toEqual(before);
  // Nothing is kept for a page load, so loading it again writes nothing.
  const saves = x.store.saves;
  const second = await page(x);
  expect(second.code).not.toBe(first.code);
  expect(second.cookie).not.toBe(first.cookie);
  expect(x.store.saves).toBe(saves);
  expect(x.store.value.joins ?? {}).toEqual({});
});

it("web.authorize: authorizing the page's code with the Session header returns 204", async () => {
  const x = await setup();
  const { code } = await page(x);
  const r = await authorize(x, code);
  expect(r.status).toBe(204);
  expect(await r.text()).toBe("");
});

it("web.authorize-reused: a code can be authorized once", async () => {
  const x = await setup();
  const { code } = await page(x);
  expect((await authorize(x, code)).status).toBe(204);
  const again = await authorize(x, code);
  expect(again.status).toBe(400);
  expect(await error(again)).toBe("invalid_request");
});

it("web.authorize-unknown: a code the endpoint never issued is refused", async () => {
  const x = await setup();
  await page(x);
  const unknown = await authorize(x, `bc_validator${randomId()}`);
  expect(unknown.status).toBe(400);
  expect(await error(unknown)).toBe("invalid_request");
});

it("web.authorize-session: authorizing needs a valid Session header", async () => {
  const x = await setup();
  const other = await stranger(x);
  const { code } = await page(x);
  const none = await x.app.request(AUTHORIZE, {
    method: "POST",
    headers: { "content-type": "application/json", "Poppy-Version": "1.0" },
    body: JSON.stringify({ code }),
  });
  expect(none.status).toBe(400);
  expect(await error(none)).toBe("invalid_session");
  const bad = await other.send(code, other.unnamed);
  expect(bad.status).toBe(400);
  expect(await error(bad)).toBe("invalid_session");
  // The Session comes first: an empty body with a bad header is the same
  // error (the validator's `session.invalid-everywhere`).
  const empty = await x.app.request(AUTHORIZE, {
    method: "POST",
    headers: { "content-type": "application/json", "Poppy-Version": "1.0" },
    body: "{}",
  });
  expect(await error(empty)).toBe("invalid_session");
  // Neither attempt used the code up.
  expect((await authorize(x, code)).status).toBe(204);
});

it("web.form-without-cookie: the form without the join cookie gets an error page and no cookie", async () => {
  const x = await setup();
  const { code } = await page(x);
  expect((await authorize(x, code)).status).toBe(204);
  await refused(await submit(x, code, PROBE));
});

it("web.form-code-used: a code is used by the first request that submits it", async () => {
  const x = await setup();
  const first = await page(x);
  expect((await authorize(x, first.code)).status).toBe(204);
  await refused(await submit(x, first.code, PROBE));
  // Now with the page's own cookie: the failed attempt used the code.
  await refused(await submit(x, first.code, first.cookie));
  expect(x.store.value.browsers ?? {}).toEqual({});
});

it("web.cookie-code-pairing: a code with the cookie of another page load is refused", async () => {
  const x = await setup();
  await page(x);
  const second = await page(x);
  const third = await page(x);
  expect((await authorize(x, third.code)).status).toBe(204);
  await refused(await submit(x, third.code, second.cookie));
});

// ---- The join --------------------------------------------------------------

it("joins the browser that loaded the page to the Session that authorized its code", async () => {
  const x = await setup();
  const { code, cookie } = await page(x);
  // Not before the Personal Agent has authorized it; a second page's code
  // shows that, since a refused form uses its code up.
  const early = await page(x);
  await refused(await submit(x, early.code, early.cookie));
  const refusedLater = await authorize(x, early.code);
  expect(refusedLater.status).toBe(400);
  expect(await error(refusedLater)).toBe("invalid_request");

  expect((await authorize(x, code)).status).toBe(204);
  const joined = await submit(x, code, cookie);
  expect(joined.status).toBe(303);
  expect(joined.headers.get("location")).toBe("/");
  expect(joined.headers.get("cache-control")).toBe("no-store");
  const lines = joined.headers.getSetCookie().map(parse);
  // The Session's cookie, and the join cookie cleared.
  expect(lines.map((c) => c.name).sort()).toEqual([JOIN, SESSION]);
  expect(removes(lines.find((c) => c.name === JOIN)!)).toBe(true);
  const session = lines.find((c) => c.name === SESSION)!;
  expect(session.attributes.has("secure")).toBe(true);
  expect(session.attributes.has("httponly")).toBe(true);
  expect(session.attributes.get("path")).toBe("/");
  expect(session.attributes.has("domain")).toBe(false);
  // It doesn't outlive the Session, which an hour without a request ends.
  const age = Number(session.attributes.get("max-age"));
  expect(age).toBeGreaterThan(0);
  expect(age).toBeLessThanOrEqual(SESSION_MS / 1000);
  // Kept by its hash, for the Session that authorized the code.
  const record = x.store.value.browsers![hash(session.value)]!;
  expect(record).toMatchObject({ client });
  expect(Object.keys(x.store.value.sessions)).toContain(record.session);
  // The code is used: the same form again changes nothing.
  await refused(await submit(x, code, cookie));
  expect(Object.keys(x.store.value.browsers!)).toHaveLength(1);
});

it("keeps codes and cookies out of what it stores", async () => {
  const x = await setup();
  const { code, cookie } = await page(x);
  await authorize(x, code);
  const joined = await submit(x, code, cookie);
  const session = sets(joined)[0]!.value;
  const stored = JSON.stringify(x.store.value);
  for (const secret of [code, cookie.split("=")[1]!, session])
    expect(stored).not.toContain(secret);
});

it("refuses a code after its minute, at both steps", async () => {
  const x = await setup();
  const late = await page(x);
  const authorized = await page(x);
  expect((await authorize(x, authorized.code)).status).toBe(204);
  later(61000);
  const r = await authorize(x, late.code);
  expect(r.status).toBe(400);
  expect(await error(r)).toBe("invalid_request");
  await refused(await submit(x, authorized.code, authorized.cookie));
  expect(x.store.value.browsers ?? {}).toEqual({});
});

it("refuses a form or a request it can't read", async () => {
  const x = await setup();
  const { cookie } = await page(x);
  await refused(await submit(x, "", cookie));
  await refused(
    await x.app.request(PAGE, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    }),
  );
  for (const body of [{}, { code: 7 }, { code: "x".repeat(300) }]) {
    const r = await x.call(AUTHORIZE, { method: "POST", body });
    expect(r.status).toBe(400);
    expect(await error(r)).toBe("invalid_request");
  }
});

it("holds a join through a restart between its steps", async () => {
  const load = restartingStore();
  const x = await setup({ store: load() });
  const { code, cookie } = await page(x);
  expect((await authorize(x, code)).status).toBe(204);
  const y = await setup({ store: load() });
  expect((await submit(y, code, cookie)).status).toBe(303);
});

it("bounds the codes one agent user can have waiting", async () => {
  const x = await setup();
  for (let i = 0; i < 10; i++)
    expect((await authorize(x, (await page(x)).code)).status).toBe(204);
  const over = await authorize(x, (await page(x)).code);
  expect(over.status).toBe(429);
  expect(over.headers.get("retry-after")).toBe("60");
  // Another User of the same agent isn't held up, and a minute clears it.
  const other = { user: "usr_b", session: newSessionId() };
  expect((await authorize(x, (await page(x)).code, other)).status).toBe(204);
  later(61000);
  expect((await authorize(x, (await page(x)).code)).status).toBe(204);
});

// ---- Access tokens ---------------------------------------------------------

it("refuses an access token at step 2, and leaves the code for a join without one", async () => {
  const x = await setup();
  const tokens = await x.signIn("things:read things:write");
  if ("refused" in tokens) throw new Error("refused");
  const { code, cookie } = await page(x);
  const signedIn = await authorize(x, code, { access: tokens.access_token });
  // §6: a token without poppy:browser-sign-in, as at an API (§7).
  expect(signedIn.status).toBe(403);
  expect(await error(signedIn)).toBe("insufficient_scope");
  expect(signedIn.headers.get("www-authenticate")).toBe(
    'DPoP error="insufficient_scope", scope="poppy:browser-sign-in"',
  );
  expect(x.store.value.joins ?? {}).toEqual({});
  expect((await authorize(x, code)).status).toBe(204);
  expect((await submit(x, code, cookie)).status).toBe(303);
  // The joined browser is tied to no account.
  const [record] = Object.values(x.store.value.browsers!);
  expect(record).not.toHaveProperty("account");
});

it("grants a sign-in that asks for poppy:browser-sign-in without it", async () => {
  const x = await setup();
  const tokens = await x.signIn("things:read poppy:browser-sign-in");
  if ("refused" in tokens) throw new Error("refused");
  expect(tokens.scope).toBe("things:read");
  // Asked for alone, there is nothing to grant.
  const alone = await x.app.request(
    `/oauth/authorize?${new URLSearchParams({
      client_id: client,
      redirect_uri: redirect,
      response_type: "code",
      scope: "poppy:browser-sign-in",
      state: "s".repeat(32),
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
    })}`,
  );
  expect(alone.status).toBe(400);
  expect(await error(alone)).toBe("invalid_scope");
  const metadata = (await (
    await x.app.request("/.well-known/oauth-authorization-server")
  ).json()) as { scopes_supported: string[] };
  expect(metadata.scopes_supported).toEqual(["things:read", "things:write"]);
});

it("doesn't run as a Company that lists poppy:browser-sign-in among its scopes", async () => {
  await expect(
    setup(
      {},
      { scopes: ["things:read", "things:write", "poppy:browser-sign-in"] },
    ),
  ).rejects.toThrow("poppy:browser-sign-in");
});

// ---- A copy per visitor ----------------------------------------------------

/**
 * A website that logs a browser in as Elena and says which copy of the
 * Company it shows. Its logins are kept as every Company keeps them: under
 * `webSessions`, by the hash of the login's cookie.
 */
const site: Partial<CompanyDefinition> = {
  mount: (app, ctx) => {
    const logins = (ctx.state.webSessions ??= {}) as Record<
      string,
      { account: string }
    >;
    ctx.state.copy ??= randomId();
    const web = (c: Context) =>
      hash(/\bweb=(\w+)/.exec(c.req.header("cookie") ?? "")?.[1] ?? "");
    app.post("/site/login", (c) => {
      logins[web(c)] = { account: "elena" };
      return c.body(null, 204);
    });
    app.get("/site/state", (c) =>
      c.json({
        account: logins[web(c)]?.account ?? null,
        copy: ctx.state.copy,
      }),
    );
    app.get("/api/copy", (c) => c.json({ copy: ctx.state.copy }));
  },
};
type Seen = { account: string | null; copy: string };

/** A browser: it keeps the cookies it is given and sends them back. */
function browser(x: Lab, cookies: Record<string, string> = {}) {
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
  const get = async (path: string) =>
    keep(await app.request(path, { headers: { ...headers() } }));
  return {
    jar,
    get,
    /** The same browser at the Company after a restart. */
    at(next: Lab) {
      app = next.app;
    },
    post: async (path: string, form: Record<string, string> = {}) =>
      keep(
        await app.request(path, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            ...headers(),
          },
          body: new URLSearchParams(form).toString(),
        }),
      ),
    state: async () => (await (await get("/site/state")).json()) as Seen,
    /** Step 1: the page's code. */
    load: async () => codeOf(await (await get(PAGE)).text()),
  };
}
/** The whole join of a browser to a User's Session; the form's response. */
async function join(
  x: Lab,
  b: ReturnType<typeof browser>,
  who: { user?: string; session?: string } = {},
) {
  const code = await b.load();
  expect((await authorize(x, code, who)).status).toBe(204);
  return b.post(PAGE, { code });
}
/** The copy of the Company an agent user has. */
const copyOf = async (x: Lab, user?: string) =>
  (
    (await (
      await x.call("/api/copy", { ...(user ? { user } : {}) })
    ).json()) as { copy: string }
  ).copy;

it("shows a joined browser the copy of the Session's agent user, and no other", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const mine = await copyOf(x);
  const theirs = await copyOf(x, "usr_b");
  expect(theirs).not.toBe(mine);
  const b = browser(x);
  expect((await join(x, b)).status).toBe(303);
  // The Session's cookie alone: the join gave the browser no other.
  expect([...b.jar.keys()]).toEqual([SESSION]);
  expect(await b.state()).toEqual({ account: null, copy: mine });
  // A browser that didn't join has its own copy, and so has one that sends
  // a cookie the Company never set.
  for (const one of [browser(x), browser(x, { [SESSION]: randomId() })]) {
    const seen = await one.state();
    expect([mine, theirs]).not.toContain(seen.copy);
    expect(seen.account).toBeNull();
  }
});

it("lets only the browser that loaded the page submit its code", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const mine = await copyOf(x);
  const loaded = browser(x);
  const code = await loaded.load();
  expect((await authorize(x, code)).status).toBe(204);
  // Another browser has the code, and a join cookie of its own page.
  const thief = browser(x);
  await thief.load();
  await refused(await thief.post(PAGE, { code }));
  expect(thief.jar.has(SESSION)).toBe(false);
  expect((await thief.state()).copy).not.toBe(mine);
  // Its attempt used the code, so the first browser starts again.
  await refused(await loaded.post(PAGE, { code }));
  expect((await join(x, loaded)).status).toBe(303);
  expect((await loaded.state()).copy).toBe(mine);
});

it("lets no other User or agent authorize a code that a Session authorized", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const other = await stranger(x);
  const mine = await copyOf(x);
  const theirs = await copyOf(x, "usr_b");
  const b = browser(x);
  const code = await b.load();
  expect((await authorize(x, code)).status).toBe(204);
  const second = await authorize(x, code, {
    user: "usr_b",
    session: newSessionId(),
  });
  expect(second.status).toBe(400);
  expect(await error(second)).toBe("invalid_request");
  const third = await other.send(code);
  expect(third.status).toBe(400);
  expect(await error(third)).toBe("invalid_request");
  // The browser joins the Session that authorized it first.
  expect((await b.post(PAGE, { code })).status).toBe(303);
  const seen = await b.state();
  expect(seen.copy).toBe(mine);
  expect(seen.copy).not.toBe(theirs);
});

it("stops showing the agent user's copy when the Session ends", async () => {
  const load = restartingStore();
  const x = await setup({ isolation: "visitor", store: load() }, site);
  const mine = await copyOf(x);
  const b = browser(x);
  const own = (await b.state()).copy;
  expect((await join(x, b)).status).toBe(303);
  expect((await b.state()).copy).toBe(mine);
  // A restart keeps the join.
  b.at(await setup({ isolation: "visitor", store: load() }, site));
  expect((await b.state()).copy).toBe(mine);
  // An hour without a request from the agent ends the Session (§5.5): the
  // browser still sends the cookie, and gets its own copy again.
  later(SESSION_MS + 1000);
  expect(b.jar.has(SESSION)).toBe(true);
  expect((await b.state()).copy).toBe(own);
});

it("replaces the cookie of an earlier join", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const mine = await copyOf(x);
  const theirs = await copyOf(x, "usr_b");
  const b = browser(x);
  await join(x, b);
  const first = b.jar.get(SESSION)!;
  expect((await b.state()).copy).toBe(mine);
  const other = { user: "usr_b", session: newSessionId() };
  expect((await join(x, b, other)).status).toBe(303);
  expect(b.jar.get(SESSION)).not.toBe(first);
  expect((await b.state()).copy).toBe(theirs);
  // The first cookie is no longer anyone's.
  expect(Object.keys(x.store.value.browsers!)).toEqual([
    hash(b.jar.get(SESSION)!),
  ]);
  expect((await browser(x, { [SESSION]: first }).state()).copy).not.toBe(mine);
});

it("leaves a login the browser has on the website as it is", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const mine = await copyOf(x);
  const b = browser(x, { web: "abc" });
  await b.post("/site/login");
  const own = await b.state();
  expect(own.account).toBe("elena");
  const cookies = new Map(b.jar);

  const joined = await join(x, b);
  expect(joined.status).toBe(303);
  // The join set the Session's cookie and touched no other.
  expect(
    joined.headers
      .getSetCookie()
      .map((line) => parse(line).name)
      .sort(),
  ).toEqual([JOIN, SESSION]);
  for (const [name, value] of cookies) expect(b.jar.get(name)).toBe(value);
  // Still logged in, now on the agent user's copy.
  expect(await b.state()).toEqual({ account: "elena", copy: mine });
  // Its own copy keeps the login too: the join copied it, and moved nothing.
  expect(await browser(x, Object.fromEntries(cookies)).state()).toEqual(own);
  // When the Session ends the browser has its own copy and login again.
  later(SESSION_MS + 1000);
  expect(await b.state()).toEqual(own);
});

it("shows a browser that follows another agent user's copy the Session's copy while it is joined", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  // The browser approved a consent for the first User, whose agent used it:
  // from then on it sees that User's copy, logged in.
  const b = browser(x, { web: "abc" });
  await b.post("/site/login");
  const tokens = await x.signIn(
    "things:read",
    {},
    `__Host-pap_browser=${b.jar.get("__Host-pap_browser")}`,
  );
  if ("refused" in tokens) throw new Error("refused");
  const first = (
    (await (
      await x.call("/api/copy", { access: tokens.access_token })
    ).json()) as { copy: string }
  ).copy;
  expect(await b.state()).toEqual({ account: "elena", copy: first });
  // So does a second browser of that User, with a login of its own.
  const c = browser(x, { web: "def" });
  await c.post("/site/login");
  const more = await x.signIn(
    "things:read",
    {},
    `__Host-pap_browser=${c.jar.get("__Host-pap_browser")}`,
  );
  if ("refused" in more) throw new Error("refused");
  await x.call("/api/copy", { access: more.access_token });
  expect(await c.state()).toEqual({ account: "elena", copy: first });
  const links = structuredClone(x.store.value.links);

  // It joins a Session of another User.
  const other = { user: "usr_b", session: newSessionId() };
  const second = await copyOf(x, "usr_b");
  expect((await join(x, b, other)).status).toBe(303);
  expect(await b.state()).toEqual({ account: "elena", copy: second });
  // Only its own login went along, not the other browser's.
  const tenant = x.store.value.tenants[hash(`${client}\nusr_b`)]!;
  expect(Object.keys(tenant.business.webSessions as object)).toEqual([
    hash("abc"),
  ]);
  expect(await c.state()).toEqual({ account: "elena", copy: first });
  // The first User's copy is as it was, and what leads the browser to it.
  expect(await copyOf(x)).toBe(first);
  expect(
    Object.fromEntries(
      Object.entries(x.store.value.links!).map(([k, v]) => [k, v.tenant]),
    ),
  ).toEqual(
    Object.fromEntries(Object.entries(links!).map(([k, v]) => [k, v.tenant])),
  );
  later(SESSION_MS + 1000);
  expect(await b.state()).toEqual({ account: "elena", copy: first });
});

it("changes nothing on a website that has one copy for everyone", async () => {
  const x = await setup({}, site);
  const b = browser(x, { web: "abc" });
  await b.post("/site/login");
  const before = await b.state();
  expect((await join(x, b)).status).toBe(303);
  expect(b.jar.has(SESSION)).toBe(true);
  expect(await b.state()).toEqual(before);
  expect(before.copy).toBe(await copyOf(x));
});

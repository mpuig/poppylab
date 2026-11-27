/**
 * The agent account over `/api/v1`, as the playground's page and a
 * client app each use it: a passkey creates the account and signs a
 * device in, a browser keeps a cookie and an app a pair of tokens, each
 * device's session ends on its own, and conversations follow the
 * account from device to device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
});
import { loadAccount } from "./account-store";
import {
  configureLinkingChannel,
  forgetLinkingChannels,
} from "./agent-account-http";
import { v1 } from "./api-http";
import { channelUser, configureBackend, memoryBackend } from "./runs";
import { softwareAuthenticator } from "./webauthn-fixture";

const site = "http://localhost:3991";
let store: ReturnType<typeof memoryBackend>;
beforeEach(() => {
  store = memoryBackend();
  configureBackend(store);
});
afterEach(() => {
  vi.useRealTimers();
  forgetLinkingChannels();
});

/** A browser's cookies, as Next's `cookies()` keeps them for a request. */
function jar(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  return {
    map,
    get: (name: string) =>
      map.has(name) ? { value: map.get(name)! } : undefined,
    set: (name: string, value: string, options: { maxAge?: number }) => {
      if (options.maxAge === 0 || !value) map.delete(name);
      else map.set(name, value);
    },
  };
}
type Jar = ReturnType<typeof jar>;
type Data = Record<string, unknown> & {
  code?: string;
  tokens?: Record<string, string | number>;
};

/**
 * A request as a client makes it: the page sends its Origin and its
 * cookies; an app sends neither, and its token when it has one.
 */
async function call(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: {
    body?: unknown;
    origin?: string | null;
    cookies?: Jar;
    token?: string;
    ip?: string;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (options.origin) headers.origin = options.origin;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.ip) headers["cf-connecting-ip"] = options.ip;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await v1(
    new Request(`${site}/api/v1${path}`, {
      method,
      headers,
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    }),
    options.cookies ?? jar(),
  );
  return {
    status: response.status,
    headers: response.headers,
    data: (await response.json()) as Data,
  };
}
const page = (cookies: Jar) => ({ origin: site, cookies });
const visitor = () => jar({ poppy_visitor: "v".repeat(43) });

/** Creates an account with a new passkey, from the page or from an app. */
async function create(
  from: { origin?: string; cookies?: Jar },
  authenticator = softwareAuthenticator(site),
  label?: string,
) {
  const started = await call("POST", "/accounts/options", {
    ...from,
    body: label ? { label } : {},
  });
  expect(started.status).toBe(200);
  const { ceremony, options } = started.data as {
    ceremony: string;
    options: Parameters<typeof authenticator.create>[0];
  };
  const created = await call("POST", "/accounts", {
    ...from,
    body: {
      ceremony,
      credential: await authenticator.create(options),
      device: from.origin ? "Chrome on macOS" : "iPhone",
    },
  });
  return { authenticator, ...created };
}
/** Signs in with the authenticator's passkey. */
async function signIn(
  from: { origin?: string; cookies?: Jar },
  authenticator: ReturnType<typeof softwareAuthenticator>,
  device = "iPhone",
) {
  const started = await call("POST", "/sessions/options", {
    ...from,
    body: {},
  });
  const { ceremony, options } = started.data as {
    ceremony: string;
    options: { challenge: string };
  };
  return call("POST", "/sessions", {
    ...from,
    body: {
      ceremony,
      credential: await authenticator.get(options),
      device,
    },
  });
}

describe("in a browser", () => {
  it("creates an account with a passkey and keeps its session in a cookie, never in the body", async () => {
    const cookies = visitor();
    const created = await create(page(cookies), undefined, "Home");
    expect(created.status).toBe(201);
    expect(created.data).not.toHaveProperty("tokens");
    expect(created.data.account).toMatchObject({
      label: "Home",
      passkeys: [{ name: "Chrome on macOS", synced: false }],
      unclaimed: 0,
    });
    expect(cookies.map.get("poppy_account")).toMatch(/^poppy_bs\./);
    const read = await call("GET", "/account", { cookies });
    expect(read.status).toBe(200);
    expect(read.data.id).toBe((created.data.account as { id: string }).id);

    const out = await call("POST", "/account/sign-out", {
      ...page(cookies),
      body: {},
    });
    expect(out.status).toBe(200);
    expect(cookies.map.has("poppy_account")).toBe(false);
    expect((await call("GET", "/account", { cookies })).data.code).toBe(
      "not_signed_in",
    );
  });

  it("refuses another origin everything that changes something, before anything is read", async () => {
    const cookies = visitor();
    await create(page(cookies));
    const elsewhere = { origin: "https://evil.example", cookies };
    for (const [method, path] of [
      ["POST", "/accounts/options"],
      ["POST", "/sessions/options"],
      ["POST", "/sessions/refresh"],
      ["POST", "/account/sign-out"],
      ["POST", "/account/claim"],
      ["POST", "/account/link-codes"],
      ["POST", "/account/passkeys/options"],
      ["DELETE", "/account/sessions"],
    ] as const) {
      const refused = await call(method, path, { ...elsewhere, body: {} });
      expect(refused.status, `${method} ${path}`).toBe(403);
    }
    expect((await call("GET", "/account", { cookies })).status).toBe(200);
  });

  it("brings the browser's conversations into the account in one explicit step, and only then", async () => {
    const cookies = visitor();
    const started = await call("POST", "/conversations", {
      ...page(cookies),
      body: {},
    });
    expect(started.status).toBe(201);
    const id = started.data.id as string;

    const created = await create(page(cookies));
    expect(created.data.account).toMatchObject({ unclaimed: 1 });
    // Signed in, the browser is the account's: the visitor's isn't moved.
    expect(
      (await call("GET", `/conversations/${id}`, { cookies })).status,
    ).toBe(404);
    const claimed = await call("POST", "/account/claim", {
      ...page(cookies),
      body: {},
    });
    expect(claimed.data).toMatchObject({
      moved: 1,
      skipped: 0,
      account: { unclaimed: 0 },
    });
    expect(
      (await call("GET", `/conversations/${id}`, { cookies })).status,
    ).toBe(200);

    // On the phone, signed in to the same account, the same conversation.
    const phone = await signIn({}, created.authenticator);
    const token = phone.data.tokens!.accessToken as string;
    const there = await call("GET", `/conversations/${id}`, { token });
    expect(there.status).toBe(200);
    expect(
      (
        await call("POST", `/conversations/${id}/messages`, {
          token,
          body: { text: "hello from the phone" },
        })
      ).status,
    ).toBe(200);
    const back = await call("GET", `/conversations/${id}`, { cookies });
    expect(JSON.stringify(back.data.messages)).toContain(
      "hello from the phone",
    );

    // Signing out of the browser leaves the phone signed in.
    await call("POST", "/account/sign-out", { ...page(cookies), body: {} });
    expect(
      (await call("GET", `/conversations/${id}`, { cookies })).status,
    ).toBe(404);
    expect((await call("GET", `/conversations/${id}`, { token })).status).toBe(
      200,
    );
  });

  it("starts the account's own conversations, which the visitor doesn't see", async () => {
    const cookies = visitor();
    await create(page(cookies));
    const started = await call("POST", "/conversations", {
      ...page(cookies),
      body: {},
    });
    const id = started.data.id as string;
    cookies.map.delete("poppy_account");
    expect(
      (await call("GET", `/conversations/${id}`, { cookies })).status,
    ).toBe(404);
  });
});

describe("in a client app", () => {
  it("creates an account and is given tokens, which open the API", async () => {
    const created = await create({});
    expect(created.status).toBe(201);
    const tokens = created.data.tokens!;
    expect(tokens).toEqual({
      session: expect.any(String),
      accessToken: expect.stringMatching(/^poppy_at\./),
      accessTokenExpiresAt: expect.any(Number),
      refreshToken: expect.stringMatching(/^poppy_rt\./),
      refreshTokenExpiresAt: expect.any(Number),
    });
    expect(
      Number(tokens.accessTokenExpiresAt) - Date.now(),
    ).toBeLessThanOrEqual(15 * 60000);
    expect(created.data.account).not.toHaveProperty("unclaimed");
    const token = tokens.accessToken as string;
    expect((await call("GET", "/account", { token })).status).toBe(200);
    const started = await call("POST", "/conversations", { token, body: {} });
    expect(started.status).toBe(201);
    // Without the token, the same request is a stranger's.
    expect((await call("POST", "/conversations", { body: {} })).status).toBe(
      403,
    );
    expect((await call("GET", "/account")).data.code).toBe("not_signed_in");
  });

  it("refuses a token that isn't one, saying so in the header too", async () => {
    for (const token of ["x", "poppy_at.a.b.c", "poppy_rt.x"]) {
      const refused = await call("GET", "/account", { token });
      expect(refused.status).toBe(401);
      expect(refused.data.code).toBe("invalid_token");
      expect(refused.headers.get("www-authenticate")).toBe(
        'Bearer error="invalid_token"',
      );
    }
  });

  it("refreshes, rotating the refresh token, and ends the session when an old one comes back", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const created = await create({});
    const first = created.data.tokens!;
    vi.setSystemTime(Date.now() + 15 * 60000 + 1);
    expect(
      (await call("GET", "/account", { token: first.accessToken as string }))
        .data.code,
    ).toBe("invalid_token");

    const refreshed = await call("POST", "/sessions/refresh", {
      body: { refreshToken: first.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    const second = refreshed.data as unknown as Record<string, string>;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.session).toBe(first.session);
    expect(
      (await call("GET", "/account", { token: second.accessToken! })).status,
    ).toBe(200);

    // The first refresh token, shown again: copied, so the session ends.
    const reused = await call("POST", "/sessions/refresh", {
      body: { refreshToken: first.refreshToken },
    });
    expect(reused).toMatchObject({
      status: 401,
      data: { code: "session_revoked" },
    });
    expect(
      (await call("GET", "/account", { token: second.accessToken! })).status,
    ).toBe(401);
    expect(
      (
        await call("POST", "/sessions/refresh", {
          body: { refreshToken: second.refreshToken },
        })
      ).data.code,
    ).toBe("invalid_token");
  });

  it("can't start a company's sign-in, which comes back to a browser", async () => {
    const created = await create({});
    const token = created.data.tokens!.accessToken as string;
    const started = await call("POST", "/conversations", { token, body: {} });
    const refused = await call(
      "POST",
      `/conversations/${started.data.id as string}/sign-ins`,
      { token, body: { company: "https://bank.example" } },
    );
    expect(refused).toMatchObject({
      status: 409,
      data: { code: "sign_in_needs_browser" },
    });
  });

  it("can't bring conversations: it has none of its own", async () => {
    const created = await create({});
    const token = created.data.tokens!.accessToken as string;
    expect(
      (await call("POST", "/account/claim", { token, body: {} })).data.code,
    ).toBe("browser_only");
  });
});

describe("devices", () => {
  it("lists each device's session and ends one or all", async () => {
    const cookies = visitor();
    const created = await create(page(cookies));
    const phone = await signIn({}, created.authenticator);
    const token = phone.data.tokens!.accessToken as string;
    const listed = await call("GET", "/account/sessions", { cookies });
    const sessions = listed.data.sessions as Array<{
      id: string;
      kind: string;
      device: string;
      current: boolean;
    }>;
    expect(sessions.map((s) => [s.kind, s.device, s.current]).sort()).toEqual([
      ["app", "iPhone", false],
      ["browser", "Chrome on macOS", true],
    ]);
    const app = sessions.find((s) => s.kind === "app")!;
    expect(
      (
        await call("DELETE", `/account/sessions/${app.id}`, {
          ...page(cookies),
        })
      ).status,
    ).toBe(200);
    expect((await call("GET", "/account", { token })).status).toBe(401);
    expect((await call("GET", "/account", { cookies })).status).toBe(200);
    expect(
      (await call("DELETE", `/account/sessions/${app.id}`, page(cookies))).data
        .code,
    ).toBe("session_not_found");

    const again = await signIn({}, created.authenticator);
    const all = await call("DELETE", "/account/sessions", {
      token: again.data.tokens!.accessToken as string,
    });
    expect(all.data).toEqual({ revoked: 2 });
    // The browser's cookie of an ended session goes with its next request.
    expect(cookies.map.has("poppy_account")).toBe(true);
    expect((await call("GET", "/account", { cookies })).status).toBe(401);
    expect(cookies.map.has("poppy_account")).toBe(false);
  });

  it("adds and removes passkeys, keeping the last one", async () => {
    const cookies = visitor();
    const created = await create(page(cookies));
    const started = await call("POST", "/account/passkeys/options", {
      ...page(cookies),
      body: {},
    });
    const { ceremony, options } = started.data as {
      ceremony: string;
      options: Parameters<
        ReturnType<typeof softwareAuthenticator>["create"]
      >[0];
    };
    const phone = softwareAuthenticator(site);
    const added = await call("POST", "/account/passkeys", {
      ...page(cookies),
      body: {
        ceremony,
        credential: await phone.create(options),
        device: "iPhone",
      },
    });
    expect(added.status).toBe(201);
    const passkeys = (added.data.account as { passkeys: Array<{ id: string }> })
      .passkeys;
    expect(passkeys).toHaveLength(2);
    const removed = await call(
      "DELETE",
      `/account/passkeys/${passkeys[0]!.id}`,
      page(cookies),
    );
    expect(removed.status).toBe(200);
    const last = await call(
      "DELETE",
      `/account/passkeys/${passkeys[1]!.id}`,
      page(cookies),
    );
    expect(last).toMatchObject({ status: 409, data: { code: "last_passkey" } });
    // The removed passkey signs in no one; the other does.
    expect((await signIn({}, created.authenticator)).data.code).toBe(
      "passkey_unknown",
    );
    expect((await signIn({}, phone)).status).toBe(201);
  });
});

describe("what is kept and said", () => {
  it("keeps only hashes of tokens and cookies, and logs none of them", async () => {
    const said: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) =>
        vi
          .spyOn(console, level)
          .mockImplementation(
            (...args: unknown[]) => void said.push(args.map(String).join(" ")),
          ),
    );
    try {
      const cookies = visitor();
      const created = await create(page(cookies));
      const phone = await signIn({}, created.authenticator);
      const tokens = phone.data.tokens!;
      const refreshed = await call("POST", "/sessions/refresh", {
        body: { refreshToken: tokens.refreshToken },
      });
      await call("POST", "/sessions/refresh", {
        body: { refreshToken: tokens.refreshToken },
      });
      const secrets = [
        cookies.map.get("poppy_account")!,
        tokens.accessToken as string,
        tokens.refreshToken as string,
        (refreshed.data as unknown as Record<string, string>).refreshToken!,
      ];
      const kept = JSON.stringify([...store.data].map(([k, v]) => [k, [...v]]));
      for (const secret of secrets) {
        expect(kept).not.toContain(secret);
        expect(kept).not.toContain(secret.split(".")[3]!);
        for (const line of said) expect(line).not.toContain(secret);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("counts ceremonies and refreshes per source, and says when to wait", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++)
      last = (
        await call("POST", "/accounts/options", { body: {}, ip: "203.0.113.9" })
      ).status;
    expect(last).toBe(429);
    // Another address isn't held to it.
    expect(
      (
        await call("POST", "/accounts/options", {
          body: {},
          ip: "203.0.113.10",
        })
      ).status,
    ).toBe(200);
    const refused: number[] = [];
    for (let i = 0; i < 31; i++)
      refused.push(
        (
          await call("POST", "/sessions/refresh", {
            body: { refreshToken: "poppy_rt.x" },
            ip: "198.51.100.4",
          })
        ).status,
      );
    expect(refused.at(-1)).toBe(429);
    expect(refused[0]).toBe(401);
  });

  it("counts sign-ins per account, from any address", async () => {
    const created = await create({});
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++)
      statuses.push((await signIn({}, created.authenticator)).status);
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses).toContain(429);
  });
});

describe("linking a channel with a one-time code", () => {
  it("binds the channel's user to the account once, and only for a channel this deployment knows", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const created = await create({});
    const token = created.data.tokens!.accessToken as string;
    const issued = await call("POST", "/account/link-codes", {
      token,
      body: {},
    });
    expect(issued.status).toBe(201);
    const code = issued.data.code as string;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(Number(issued.data.expiresAt) - Date.now()).toBe(5 * 60000);

    const redeem = (body: object, secret?: string) =>
      v1(
        new Request(`${site}/api/v1/link-codes/redeem`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(secret ? { "x-channel-secret": secret } : {}),
          },
          body: JSON.stringify(body),
        }),
        jar(),
      );
    const unknown = await redeem({ channel: "telegram", user: "chat-1", code });
    expect(unknown.status).toBe(401);
    configureLinkingChannel({
      name: "telegram",
      authenticate: (request) =>
        request.headers.get("x-channel-secret") === "s3cret",
    });
    expect(
      (await redeem({ channel: "telegram", user: "chat-1", code }, "wrong"))
        .status,
    ).toBe(401);
    const before = await channelUser("telegram", "chat-1");
    const linked = await redeem(
      { channel: "telegram", user: "chat-1", code: code.toLowerCase() },
      "s3cret",
    );
    expect(linked.status).toBe(200);
    const account = (created.data.account as { id: string }).id;
    expect(await linked.json()).toEqual({ account, linked: true });
    const { user } = (await loadAccount(account))!.account;
    expect(before).not.toBe(user);
    expect(await channelUser("telegram", "chat-1")).toBe(user);
    expect((await call("GET", "/account", { token })).data.channels).toEqual([
      { channel: "telegram", linked: expect.any(Number) },
    ]);

    // Once only.
    expect(
      (await redeem({ channel: "telegram", user: "chat-2", code }, "s3cret"))
        .status,
    ).toBe(400);
    // And for five minutes.
    const late = await call("POST", "/account/link-codes", { token, body: {} });
    vi.setSystemTime(Date.now() + 5 * 60000 + 1);
    expect(
      (
        await redeem(
          { channel: "telegram", user: "chat-3", code: late.data.code },
          "s3cret",
        )
      ).status,
    ).toBe(400);
  });
});

/**
 * End to end, in process: a client app signs in to Harborline, the lab's
 * real bank, from its API session. The app is given a link of the
 * agent's own, opens it in a browser of its own (as
 * ASWebAuthenticationSession is on iOS), and the sign-in completes in that
 * browser for the app's account, which the app learns from the
 * conversation's events. As in `two-companies.test.ts`, only the network
 * is replaced: DNS answers loopback and the pinned fetch hands each request
 * to the Company at its origin.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
type App = {
  request: (url: string, init?: RequestInit) => Response | Promise<Response>;
};
type Jar = Map<string, string>;
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    apps: {} as Record<string, App>,
    /** The cookies of the browser the request is from. */
    browser: new Map<string, string>() as Jar,
  };
});
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "127.0.0.1", family: 4 }],
}));
const undici = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  return createRequire(
    fileURLToPath(new URL("../../../packages/pap-client/", import.meta.url)),
  ).resolve("undici");
});
vi.mock(undici, () => ({
  Agent: class {
    destroy() {}
  },
  fetch: async (
    url: URL | string,
    init: RequestInit & { dispatcher?: unknown },
  ) => {
    const { dispatcher, ...rest } = init;
    void dispatcher;
    return net.apps[new URL(String(url)).origin]!.request(String(url), rest);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      net.browser.has(name) ? { value: net.browser.get(name)! } : undefined,
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (value && options?.maxAge !== 0) net.browser.set(name, value);
      else net.browser.delete(name);
    },
    delete: (name: string) => net.browser.delete(name),
  }),
}));
import { createIdentity } from "@poppy-lab/pap-client";
import { softwareAuthenticator } from "@poppy-lab/pap-agent/webauthn-fixture";
import * as harborline from "../../harborline/src/test-harness";
import { GET as callback } from "../app/api/account/callback/route";
import { GET, POST } from "../app/api/v1/[...path]/route";

const agent = "http://localhost:3000";
const bank = harborline.origin;
const END = "/playground/sign-in/app";

/** A request of the app's, with its token and no Origin and no cookies. */
async function api(
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: object,
) {
  net.browser = new Map();
  const response = await (method === "GET" ? GET : POST)(
    new Request(`${agent}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
}
/** A request in the app's own browser, which keeps its cookies. */
async function inBrowser(
  browser: Jar,
  handler: (request: Request) => Promise<Response>,
  url: string,
) {
  net.browser = browser;
  const response = await handler(new Request(url));
  return response.headers.get("Location");
}
/** The person on Harborline's consent page: Elena allows, or declines. */
async function consent(url: string, decision: "approve" | "deny") {
  const app = net.apps[bank]!;
  const page = await app.request(url);
  expect(page.status).toBe(200);
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const answered = await app.request(`${bank}/oauth/authorize`, {
    method: "POST",
    headers: {
      cookie,
      origin: bank,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      nonce: cookie.split("=")[1]!,
      decision,
      account: "elena",
    }).toString(),
  });
  expect(answered.status).toBe(302);
  return answered.headers.get("location")!;
}
/**
 * The conversation's event stream, read until an event of `type` comes
 * (or `within` milliseconds pass): the names of the events it sent.
 */
async function eventsUntil(
  token: string,
  conversation: string,
  type: string,
  meanwhile: () => Promise<void>,
  within = 10000,
) {
  net.browser = new Map();
  const abort = new AbortController();
  const response = await GET(
    new Request(`${agent}/api/v1/conversations/${conversation}/events`, {
      headers: { authorization: `Bearer ${token}` },
      signal: abort.signal,
    }),
  );
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const names: string[] = [];
  let text = "";
  const read = (async () => {
    const until = Date.now() + within;
    while (Date.now() < until && !names.includes(type)) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      names.splice(
        0,
        names.length,
        ...[...text.matchAll(/^event: (\S+)$/gm)].map((m) => m[1]!),
      );
    }
  })();
  await meanwhile();
  await read;
  abort.abort();
  await reader.cancel().catch(() => {});
  return { names, text };
}

describe("A client app signs in to Harborline from its API session", () => {
  let token = "";
  let conversation = "";

  beforeAll(async () => {
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    await harborline.setup({
      fetchJson: async (url: string) =>
        url.endsWith("client.json")
          ? {
              client_id: harborline.client,
              client_name: "Iris",
              jwks_uri: `${agent}/agent/jwks.json`,
              redirect_uris: [harborline.redirect],
            }
          : { keys: [keys.publicKey] },
    });
    net.apps[bank] = harborline.lab.app;
    // An account made on the phone, with a passkey: tokens, no cookie.
    const authenticator = softwareAuthenticator(agent);
    net.browser = new Map();
    const options = (await (
      await POST(
        new Request(`${agent}/api/v1/accounts/options`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      )
    ).json()) as {
      ceremony: string;
      options: Parameters<typeof authenticator.create>[0];
    };
    const created = (await (
      await POST(
        new Request(`${agent}/api/v1/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ceremony: options.ceremony,
            credential: await authenticator.create(options.options),
            device: "iPhone",
          }),
        }),
      )
    ).json()) as { tokens: { accessToken: string } };
    token = created.tokens.accessToken;
    const started = await api("POST", "/conversations", token, {
      company: bank,
    });
    expect(started.status).toBe(201);
    conversation = started.data.id as string;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  const harbor = async () =>
    (
      (await api("GET", `/conversations/${conversation}`, token)).data
        .companies as Array<{
        origin: string;
        signedIn: boolean;
        signingIn: boolean;
      }>
    ).find((c) => c.origin === bank)!;

  it("opens the link in its own browser, signs in there, and learns it from the events", async () => {
    const given = await api(
      "POST",
      `/conversations/${conversation}/sign-ins`,
      token,
      { company: bank },
    );
    expect(given.status).toBe(200);
    const { url, endUrl } = given.data as { url: string; endUrl: string };
    expect(new URL(url).origin).toBe(agent);
    expect(endUrl).toBe(`${agent}${END}`);
    // Asking for the link starts nothing: no request to the bank yet.
    expect(await harbor()).toMatchObject({ signedIn: false, signingIn: false });

    // ASWebAuthenticationSession, with no cookies of its own yet.
    const browser: Jar = new Map();
    const toBank = await inBrowser(browser, GET, url);
    // Pushed (PAR): the browser carries only client_id and request_uri.
    const authorize = new URL(toBank!);
    expect(authorize.origin).toBe(bank);
    expect([...authorize.searchParams.keys()].sort()).toEqual([
      "client_id",
      "request_uri",
    ]);
    // Bound to this browser, by the same cookie as the playground's.
    expect([...browser.keys()]).toEqual([expect.stringMatching(/^pap_oauth_/)]);
    expect(await harbor()).toMatchObject({ signedIn: false, signingIn: true });

    const seen = await eventsUntil(
      token,
      conversation,
      "signin.completed",
      async () => {
        const back = await consent(toBank!, "approve");
        expect(await inBrowser(browser, callback, back)).toBe(
          `${END}?result=done&company=harborline`,
        );
      },
    );
    expect(seen.names).toEqual(["state", "signin.completed"]);
    expect(seen.text).toContain('"name":"Harborline Bank"');
    // The cookie is spent, and the conversation is signed in, for the app.
    expect([...browser.keys()]).toEqual([]);
    expect(await harbor()).toMatchObject({ signedIn: true, signingIn: false });

    // The link works once.
    expect(await inBrowser(new Map(), GET, url)).toBe(`${END}?result=failed`);
  }, 20000);

  it("ends at the failed address, and says so on the events, when the person declines", async () => {
    const { url } = (
      await api("POST", `/conversations/${conversation}/sign-ins`, token, {
        company: bank,
        access: "write",
      })
    ).data as { url: string };
    const browser: Jar = new Map();
    const toBank = await inBrowser(browser, GET, url);
    const seen = await eventsUntil(
      token,
      conversation,
      "signin.failed",
      async () => {
        const back = await consent(toBank!, "deny");
        expect(await inBrowser(browser, callback, back)).toBe(
          `${END}?result=failed`,
        );
      },
    );
    expect(seen.names).toEqual(["state", "signin.failed"]);
    // Still signed in with what was allowed before.
    expect(await harbor()).toMatchObject({ signedIn: true, signingIn: false });
  }, 20000);

  it("leaves the playground's own sign-in as it was", async () => {
    // A browser with no app link: the callback for a state it doesn't
    // hold ends at the playground's page, as before.
    expect(
      await inBrowser(
        new Map([["poppy_visitor", "p".repeat(43)]]),
        callback,
        `${agent}/api/account/callback?state=unknown&code=x&iss=${encodeURIComponent(bank)}`,
      ),
    ).toBe("/playground/sign-in/failed");
  });
});

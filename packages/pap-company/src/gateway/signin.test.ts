/**
 * A pushed authorization request (RFC 9126) makes one consent page. The
 * browser that opened it can load it again; nobody else can, and it gives
 * one code at most. Last, which customer a consent page opens on.
 */
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { client, origin, redirect, setup } from "./test-company.ts";
import { hash } from "./types.ts";

const request = {
  response_type: "code",
  redirect_uri: redirect,
  scope: "things:read",
  state: "s".repeat(32),
  code_challenge: "c".repeat(43),
  code_challenge_method: "S256",
};
const error = async (r: Response) =>
  ((await r.json()) as { error?: string }).error;

/** A Company with one pushed request, and the browser's view of it. */
async function pushed(overrides: Parameters<typeof setup>[1] = {}) {
  const x = await setup({}, overrides);
  const push = async () =>
    x.form("/oauth/par", { ...request, ...(await x.credentials()) });
  const par = await push();
  expect(par.status).toBe(201);
  const { request_uri } = (await par.json()) as { request_uri: string };
  /** Loads the page, as a browser with that cookie, or with `headers`. */
  const open = (cookie?: string, headers?: Record<string, string>) =>
    x.app.request(
      `/oauth/authorize?${new URLSearchParams({ client_id: client, request_uri })}`,
      cookie || headers
        ? { headers: { ...(cookie ? { cookie } : {}), ...headers } }
        : {},
    );
  const answer = (cookie: string) =>
    x.form(
      "/oauth/authorize",
      { nonce: cookie.split("=")[1]!, decision: "approve", account: "elena" },
      { cookie, origin },
    );
  return { ...x, push, open, answer };
}

afterEach(() => vi.useRealTimers());

it("shows a pushed request's consent page again to the browser that opened it, and gives one code", async () => {
  const x = await pushed();
  const page = await x.open();
  expect(page.status).toBe(200);
  const html = await page.text();
  const cookie = page.headers.getSetCookie()[0]!.split(";")[0]!;

  // A reload: the same page, and nothing new to store.
  const saves = x.store.saves;
  const again = await x.open(cookie);
  expect(again.status).toBe(200);
  expect(await again.text()).toBe(html);
  expect(x.store.saves).toBe(saves);
  expect(Object.keys(x.store.value.consents!)).toHaveLength(1);

  // Another browser has no cookie for that page: used, as before.
  const other = await x.open();
  expect(other.status).toBe(400);
  expect(await error(other)).toBe("invalid_request_uri");

  const approved = await x.answer(cookie);
  expect(approved.status).toBe(302);
  expect(
    new URL(approved.headers.get("location")!).searchParams.get("code"),
  ).toBeTruthy();

  // Answered: no page and no second code, even for that browser.
  const late = await x.open(cookie);
  expect(late.status).toBe(400);
  expect(await error(late)).toBe("invalid_request_uri");
  expect((await x.answer(cookie)).status).toBe(400);
  expect(Object.keys(x.store.value.codes!)).toHaveLength(1);
});

it("makes one consent page when a pushed request is opened twice at once", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await pushed();
  // The client's metadata is cached for 60 seconds. After that both requests
  // wait for the coalesced metadata fetch: neither goes on until it resolves.
  vi.setSystemTime(Date.now() + 61000);
  let release!: () => void;
  const fetched = new Promise<void>((done) => (release = done));
  x.metadata.wait = () => fetched;
  const both = Promise.all([x.open(), x.open()]);
  await new Promise((done) => setTimeout(done, 0));
  release();
  const pages = await both;
  const shown = pages.filter((r) => r.status === 200);
  const refused = pages.filter((r) => r.status === 400);
  expect(shown).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect(await error(refused[0]!)).toBe("invalid_request_uri");
  expect(Object.keys(x.store.value.consents!)).toHaveLength(1);

  // The browser that got the page can load it again, and gets the one code.
  const cookies = shown[0]!.headers.getSetCookie();
  expect(cookies).toHaveLength(1);
  const cookie = cookies[0]!.split(";")[0]!;
  expect((await x.open(cookie)).status).toBe(200);
  expect((await x.answer(cookie)).status).toBe(302);
  expect(Object.keys(x.store.value.codes!)).toHaveLength(1);
});

it("refuses a pushed request nobody opened in its 90 seconds", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await pushed();
  vi.setSystemTime(Date.now() + 91000);
  const saves = x.store.saves;
  const late = await x.open();
  expect(late.status).toBe(400);
  expect(await error(late)).toBe("invalid_request_uri");
  expect(x.store.saves).toBe(saves);
  expect(x.store.value.consents).toEqual({});
});

it("shows a pushed request's consent page again for as long as the page lasts", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await pushed();
  const start = Date.now();
  // Opened a minute after the push, so the page is good for 300 seconds
  // from here: longer than the request's own 90.
  vi.setSystemTime(start + 60000);
  const page = await x.open();
  expect(page.status).toBe(200);
  const html = await page.text();
  const cookie = page.headers.getSetCookie()[0]!.split(";")[0]!;

  // 100 seconds after the push: the same page, and nothing new to store.
  vi.setSystemTime(start + 100000);
  const saves = x.store.saves;
  const again = await x.open(cookie);
  expect(again.status).toBe(200);
  expect(await again.text()).toBe(html);
  expect(again.headers.getSetCookie()).toHaveLength(0);
  expect(x.store.saves).toBe(saves);
  expect(Object.keys(x.store.value.consents!)).toHaveLength(1);

  // Another push drops the requests that ended, but not this one.
  expect((await x.push()).status).toBe(201);
  expect((await x.open(cookie)).status).toBe(200);

  // Still once for everyone else.
  const other = await x.open();
  expect(other.status).toBe(400);
  expect(await error(other)).toBe("invalid_request_uri");

  // The page's last second, then its end.
  vi.setSystemTime(start + 60000 + 299000);
  expect((await x.open(cookie)).status).toBe(200);
  vi.setSystemTime(start + 60000 + 301000);
  const late = await x.open(cookie);
  expect(late.status).toBe(400);
  expect(await error(late)).toBe("invalid_request_uri");
  expect((await x.answer(cookie)).status).toBe(400);
  expect(x.store.value.codes).toEqual({});
});

it("answers a consent page that ran out with a page of the Company, and a tool with the error", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const expired = "<h1>This page has expired</h1>";
  const x = await setup({}, { consentExpired: () => expired });
  const start = Date.now();
  /** Opens a consent page; the cookie its browser holds for five minutes. */
  const open = async (company = x) =>
    (
      await company.app.request(
        `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
      )
    ).headers
      .getSetCookie()[0]!
      .split(";")[0]!;
  const answerOf = (cookie: string) => ({
    nonce: cookie.split("=")[1]!,
    decision: "approve",
    account: "elena",
  });
  const cookie = await open();
  const answer = answerOf(cookie);
  /** The sheet's form, as a browser posts it. */
  const browser = { origin, accept: "text/html,application/xhtml+xml" };
  const page = async (r: Response) => {
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(await r.text()).toBe(expired);
  };

  // 540 seconds on: the browser has dropped the page's cookie (Max-Age=300).
  vi.setSystemTime(start + 540000);
  await page(await x.form("/oauth/authorize", answer, browser));
  // A browser that still sends the cookie gets the same page.
  await page(await x.form("/oauth/authorize", answer, { ...browser, cookie }));
  // The next consent page drops the one that ended: still that page.
  const second = await open();
  expect(x.store.value.consents).not.toHaveProperty(answer.nonce);
  await page(await x.form("/oauth/authorize", answer, browser));
  expect(x.store.value.codes).toEqual({});

  // Not a browser's post from the sheet: the protocol's error, as before.
  for (const headers of [
    {},
    { origin },
    { accept: "text/html" },
    { ...browser, origin: "https://other.test" },
  ]) {
    const refused = await x.form("/oauth/authorize", answer, headers);
    expect(refused.status).toBe(400);
    expect(await error(refused)).toBe("invalid_request");
  }

  // A page answered in time and posted again did not run out.
  const held = { ...browser, cookie: second };
  const allowed = await x.form("/oauth/authorize", answerOf(second), held);
  expect(allowed.status).toBe(302);
  const twice = await x.form("/oauth/authorize", answerOf(second), held);
  expect(twice.status).toBe(400);
  expect(await error(twice)).toBe("invalid_request");

  // A Company without that page answers as before.
  const y = await setup();
  const other = await open(y);
  vi.setSystemTime(start + 1080000);
  const plain = await y.form("/oauth/authorize", answerOf(other), browser);
  expect(plain.status).toBe(400);
  expect(await error(plain)).toBe("invalid_request");
});

it("answers a reload of a consent page that ran out with a page of the Company, and a tool with the error", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const asked: string[] = [];
  const x = await pushed({
    consentExpired: (how) => {
      asked.push(how);
      return "<h1>This page has expired</h1>";
    },
  });
  const start = Date.now();
  const page = await x.open();
  const cookie = page.headers.getSetCookie()[0]!.split(";")[0]!;
  const html = { accept: "text/html,application/xhtml+xml" };
  const shown = async (r: Response) => {
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toContain(
      "form-action 'none'",
    );
    expect(await r.text()).toBe("<h1>This page has expired</h1>");
  };

  // While the page is open, another browser still gets the error.
  expect(await error(await x.open(undefined, html))).toBe(
    "invalid_request_uri",
  );

  // Its five minutes over: the browser has dropped the cookie, and gets
  // the page; so does one that still sends it. A tool gets the error.
  vi.setSystemTime(start + 301000);
  await shown(await x.open(undefined, html));
  await shown(await x.open(cookie, html));
  expect(await error(await x.open(cookie))).toBe("invalid_request_uri");

  // Forgotten once the next push drops it: still the page.
  expect((await x.push()).status).toBe(201);
  expect(Object.keys(x.store.value.pushed!)).toHaveLength(1);
  await shown(await x.open(undefined, html));
  expect(asked.every((how) => how === "reopened")).toBe(true);
  expect(asked).toHaveLength(3);
  expect(x.store.value.codes).toEqual({});
});

it("keeps a used pushed request only while its consent page is open", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await pushed();
  const start = Date.now();
  const page = await x.open();
  const cookie = page.headers.getSetCookie()[0]!.split(";")[0]!;
  const stored = () => Object.keys(x.store.value.pushed!).length;

  // Past its 90 seconds with the page open: the next push keeps it.
  vi.setSystemTime(start + 91000);
  expect((await x.push()).status).toBe(201);
  expect(stored()).toBe(2);

  // Answered: the next push drops it, with the other one that ended.
  expect((await x.answer(cookie)).status).toBe(302);
  vi.setSystemTime(start + 182000);
  expect((await x.push()).status).toBe(201);
  expect(stored()).toBe(1);
  const late = await x.open(cookie);
  expect(late.status).toBe(400);
  expect(await error(late)).toBe("invalid_request_uri");
  expect(Object.keys(x.store.value.codes!)).toHaveLength(1);
});

it("stores nothing for a request_uri nobody pushed", async () => {
  const x = await setup();
  const saves = x.store.saves;
  const unknown = await x.app.request(
    `/oauth/authorize?${new URLSearchParams({
      client_id: client,
      request_uri: "urn:ietf:params:oauth:request_uri:unknown",
    })}`,
  );
  expect(unknown.status).toBe(400);
  expect(await error(unknown)).toBe("invalid_request_uri");
  expect(x.store.saves).toBe(saves);
});

it("opens a second consent on the customer this browser allowed this agent before", async () => {
  // Two customers, and a page that says which one it opens on.
  const x = await setup(
    { isolation: "visitor" },
    {
      persona: (id) =>
        id === "elena" || id === "robin" ? { id: String(id) } : undefined,
      consent: ({ nonce, account }) => `<p>${nonce} opens on ${account}</p>`,
    },
  );
  const verifier = "v".repeat(64);
  const authorize = (scope: string, cookie?: string) =>
    x.app.request(
      `/oauth/authorize?${new URLSearchParams({
        ...request,
        client_id: client,
        scope,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      })}`,
      cookie ? { headers: { cookie } } : {},
    );
  /** What the page says when that browser, or a new one, opens it. */
  const open = async (cookie?: string) =>
    (await authorize("things:read", cookie)).text();
  const cookieOf = (page: Response, name: string) =>
    page.headers
      .getSetCookie()
      .find((c) => c.includes(name))
      ?.split(";")[0];
  /** Allows the page as that customer; the agent then takes its tokens. */
  const allow = async (page: Response, browser: string, account: string) => {
    const consent = cookieOf(page, "pap_consent_")!;
    const approved = await x.form(
      "/oauth/authorize",
      { nonce: consent.split("=")[1]!, decision: "approve", account },
      { cookie: `${browser}; ${consent}`, origin },
    );
    expect(approved.status).toBe(302);
    return x.token({
      grant_type: "authorization_code",
      code: new URL(approved.headers.get("location")!).searchParams.get(
        "code",
      )!,
      code_verifier: verifier,
      redirect_uri: redirect,
    });
  };

  // The first consent: nothing is known, so the page chooses nobody.
  const first = await authorize("things:read");
  expect(await first.clone().text()).toContain("opens on undefined");
  const browser = cookieOf(first, "pap_browser")!;
  await allow(first, browser, "robin");

  // The agent asks for more: the page opens on Robin, not on the first.
  const second = await authorize("things:read things:write", browser);
  expect(await second.clone().text()).toContain("opens on robin");
  const more = await allow(second, browser, "robin");
  expect(await open(browser)).toContain("opens on robin");

  // Another browser has allowed nothing, whatever the agent holds.
  expect(await open()).toContain("opens on undefined");

  // The customer can still choose another: the newest permission counts.
  await allow(await authorize("things:read", browser), browser, "elena");
  expect(await open(browser)).toContain("opens on elena");

  // Only a permission this agent still holds counts.
  const grants = Object.values(x.store.value.grants);
  expect(grants.map((g) => g.account)).toEqual(["robin", "robin", "elena"]);
  grants[2]!.client = "https://other.test/client.json";
  expect(await open(browser)).toContain("opens on robin");
  grants[2]!.expires = 0;
  grants[0]!.expires = 0;
  expect(
    (
      await x.form("/oauth/revoke", {
        token: more.refresh_token,
        ...(await x.credentials()),
      })
    ).status,
  ).toBe(200);
  expect(await open(browser)).toContain("opens on undefined");
});

it("caps pending consent pages per source within a client with 429 + Retry-After without evicting other sources and hashes the source", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await setup({ sourceAddress: (c) => c.req.header("x-real-ip") });
  const open = (ip: string) =>
    x.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
      { headers: { "x-real-ip": ip } },
    );
  const approve = (cookie: string, ip: string) =>
    x.form(
      "/oauth/authorize",
      { nonce: cookie.split("=")[1]!, decision: "approve", account: "elena" },
      { cookie, origin, "x-real-ip": ip },
    );

  // Source B opens a legitimate consent page first.
  const victim = await open("198.51.100.2");
  expect(victim.status).toBe(200);
  const victimCookie = victim.headers.getSetCookie()[0]!.split(";")[0]!;

  // Source A opens 10 unanswered consent pages for the same client; the 11th gets 429 + Retry-After: 60.
  const attackerCookies: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await open("198.51.100.1");
    expect(r.status).toBe(200);
    attackerCookies.push(r.headers.getSetCookie()[0]!.split(";")[0]!);
  }
  const saves = x.store.saves;
  const refused = await open("198.51.100.1");
  expect(refused.status).toBe(429);
  expect(refused.headers.get("retry-after")).toBe("60");
  expect(await error(refused)).toBe("rate_limited");
  expect(x.store.saves).toBe(saves);
  expect(Object.keys(x.store.value.consents!)).toHaveLength(11);

  // Raw IP is never stored on consent records; only the SHA-256 hash is stored.
  const serialized = JSON.stringify(x.store.value.consents);
  expect(serialized).not.toContain("198.51.100.1");
  expect(serialized).not.toContain("198.51.100.2");
  const attackerSources = Object.values(x.store.value.consents!).filter(
    (p) => p.source === hash("198.51.100.1"),
  );
  expect(attackerSources).toHaveLength(10);
  expect(x.store.value.consents![victimCookie.split("=")[1]!]?.source).toBe(
    hash("198.51.100.2"),
  );

  // Another source can still open consent pages for the same client, and Source B's page was not evicted.
  const another = await open("198.51.100.3");
  expect(another.status).toBe(200);
  expect((await approve(victimCookie, "198.51.100.2")).status).toBe(302);

  // Once Source A answers one of its 10 pending pages, it can open another.
  expect((await approve(attackerCookies[0]!, "198.51.100.1")).status).toBe(302);
  expect((await open("198.51.100.1")).status).toBe(200);
  expect((await open("198.51.100.1")).status).toBe(429);
});

it("rate-limits consent page floods per source with Retry-After without locking out other sources", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await setup({ sourceAddress: (c) => c.req.header("x-real-ip") });
  const authorize = (ip?: string) =>
    x.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
      ip ? { headers: { "x-real-ip": ip } } : {},
    );
  const decline = (page: Response, ip?: string) => {
    const cookie = page.headers.getSetCookie()[0]!.split(";")[0]!;
    return x.form(
      "/oauth/authorize",
      { nonce: cookie.split("=")[1]!, decision: "decline", account: "elena" },
      { cookie, origin, ...(ip ? { "x-real-ip": ip } : {}) },
    );
  };

  // One source opens (and answers, staying below the 10-pending cap) 30 pages in a minute; the 31st gets 429 + Retry-After: 60.
  for (let i = 0; i < 30; i++) {
    const page = await authorize("198.51.100.1");
    expect(page.status).toBe(200);
    expect((await decline(page, "198.51.100.1")).status).toBe(302);
  }
  const saves = x.store.saves;
  const blocked = await authorize("198.51.100.1");
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("retry-after")).toBe("60");
  expect(await error(blocked)).toBe("rate_limited");
  expect(x.store.saves).toBe(saves);

  // Another source can still open and approve a consent page for the same client.
  const legitimate = await authorize("198.51.100.2");
  expect(legitimate.status).toBe(200);
  const cookie = legitimate.headers.getSetCookie()[0]!.split(";")[0]!;
  const approved = await x.form(
    "/oauth/authorize",
    { nonce: cookie.split("=")[1]!, decision: "approve", account: "elena" },
    { cookie, origin, "x-real-ip": "198.51.100.2" },
  );
  expect(approved.status).toBe(302);

  // After the one-minute window passes, the blocked source can open pages again.
  vi.setSystemTime(Date.now() + 61000);
  expect((await authorize("198.51.100.1")).status).toBe(200);

  // Without a configured source address, exceeding the 10-pending cap gets 429 with Retry-After: 60.
  const fallback = await setup();
  let last!: Response;
  for (let i = 0; i < 11; i++)
    last = await fallback.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
    );
  expect(last.status).toBe(429);
  expect(last.headers.get("retry-after")).toBe("60");
  expect(await error(last)).toBe("rate_limited");
});

it("enforces client share and global 500 cap without evicting existing consent pages", async () => {
  const seed = (clientId: string, count: number, prefix: string) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `${prefix}_${i}`,
        {
          client: clientId,
          redirect,
          state: request.state,
          scopes: request.scope,
          challenge: request.code_challenge,
          expires: Date.now() + 300000,
          source: hash(`198.51.100.${i + 1}`),
        },
      ]),
    );

  // When `client` already holds its 100-page default share, a new source gets 429 + Retry-After: 60 without evicting anyone's page.
  const atShare = await setup({
    sourceAddress: (c) => c.req.header("x-real-ip"),
  });
  Object.assign(atShare.store.value.consents!, {
    ...seed("https://other-1.test/client.json", 100, "o1"),
    ...seed(client, 100, "mine"),
  });
  const shareRefused = await atShare.app.request(
    `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
    { headers: { "x-real-ip": "198.51.100.200" } },
  );
  expect(shareRefused.status).toBe(429);
  expect(shareRefused.headers.get("retry-after")).toBe("60");
  expect(await error(shareRefused)).toBe("rate_limited");
  expect(atShare.store.value.consents).toHaveProperty("mine_0");
  expect(atShare.store.value.consents).toHaveProperty("o1_0");
  expect(Object.keys(atShare.store.value.consents!)).toHaveLength(200);

  // When 5 other clients fill all 500 slots, a 6th client gets 429 + Retry-After: 60 without evicting others.
  const saturated = await setup();
  Object.assign(saturated.store.value.consents!, {
    ...seed("https://other-1.test/client.json", 100, "o1"),
    ...seed("https://other-2.test/client.json", 100, "o2"),
    ...seed("https://other-3.test/client.json", 100, "o3"),
    ...seed("https://other-4.test/client.json", 100, "o4"),
    ...seed("https://other-5.test/client.json", 100, "o5"),
  });
  const refused = await saturated.app.request(
    `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
  );
  expect(refused.status).toBe(429);
  expect(refused.headers.get("retry-after")).toBe("60");
  expect(await error(refused)).toBe("rate_limited");
  expect(Object.keys(saturated.store.value.consents!)).toHaveLength(500);
});

it("respects clientShares for pending consent pages without evicting existing ones", async () => {
  const x = await setup({
    clientShares: { [client]: 0.03 }, // 15 of 500
    sourceAddress: (c) => c.req.header("x-real-ip"),
  });
  const open = (ip: string) =>
    x.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
      { headers: { "x-real-ip": ip } },
    );
  const nonces: string[] = [];
  for (let i = 0; i < 15; i++) {
    const r = await open(`198.51.100.${i + 1}`);
    expect(r.status).toBe(200);
    nonces.push(r.headers.getSetCookie()[0]!.split(";")[0]!.split("=")[1]!);
  }
  expect(Object.keys(x.store.value.consents!)).toHaveLength(15);

  // 16th distinct source hits the client's 15-page share and gets 429 without evicting existing pages.
  const sixteenth = await open("198.51.100.16");
  expect(sixteenth.status).toBe(429);
  expect(sixteenth.headers.get("retry-after")).toBe("60");
  expect(await error(sixteenth)).toBe("rate_limited");
  expect(Object.keys(x.store.value.consents!)).toHaveLength(15);
  expect(x.store.value.consents).toHaveProperty(nonces[0]!);
});

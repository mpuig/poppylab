/**
 * A pushed authorization request (RFC 9126) makes one consent page. The
 * browser that opened it can load it again; nobody else can, and it gives
 * one code at most. Last, which customer a consent page opens on.
 */
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { client, origin, redirect, setup } from "./test-company.ts";

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

it("evicts a client's oldest unanswered consent page when it hits its share instead of locking out sign-ins", async () => {
  const x = await setup();
  const open = async () => {
    const r = await x.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
    );
    const cookie = r.headers.getSetCookie()[0]?.split(";")[0];
    return { status: r.status, cookie };
  };
  const approve = (cookie: string) =>
    x.form(
      "/oauth/authorize",
      { nonce: cookie.split("=")[1]!, decision: "approve", account: "elena" },
      { cookie, origin },
    );

  // Fill the client's default share (20% of 500 = 100 pending consent pages).
  const pages: string[] = [];
  for (let i = 0; i < 100; i++) {
    const page = await open();
    expect(page.status).toBe(200);
    pages.push(page.cookie!);
  }
  expect(Object.keys(x.store.value.consents!)).toHaveLength(100);

  // The 101st request succeeds and evicts only the oldest unanswered page.
  const newest = await open();
  expect(newest.status).toBe(200);
  expect(Object.keys(x.store.value.consents!)).toHaveLength(100);

  // The evicted first page can no longer be approved; the second and newest still work.
  expect((await approve(pages[0]!)).status).toBe(400);
  expect((await approve(pages[1]!)).status).toBe(302);
  expect((await approve(newest.cookie!)).status).toBe(302);
});

it("keeps other clients' consent pages intact during per-client eviction and enforces the global 500 cap", async () => {
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
        },
      ]),
    );

  // 4 other clients hold 400 pages and `client` holds its 100-page share (500 total).
  const full = await setup();
  Object.assign(full.store.value.consents!, {
    ...seed("https://other-1.test/client.json", 100, "o1"),
    ...seed("https://other-2.test/client.json", 100, "o2"),
    ...seed("https://other-3.test/client.json", 100, "o3"),
    ...seed("https://other-4.test/client.json", 100, "o4"),
    ...seed(client, 100, "mine"),
  });
  const opened = await full.app.request(
    `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
  );
  expect(opened.status).toBe(200);
  expect(Object.keys(full.store.value.consents!)).toHaveLength(500);
  expect(full.store.value.consents).not.toHaveProperty("mine_0");
  expect(full.store.value.consents).toHaveProperty("mine_1");
  expect(full.store.value.consents).toHaveProperty("o1_0");
  expect(
    Object.values(full.store.value.consents!).filter(
      (p) => p.client !== client,
    ),
  ).toHaveLength(400);

  // When 5 other clients fill all 500 slots, a 6th client gets 429 without evicting others.
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
  expect(await error(refused)).toBe("rate_limited");
  expect(Object.keys(saturated.store.value.consents!)).toHaveLength(500);
});

it("respects clientShares when evicting a client's oldest pending consent page", async () => {
  const x = await setup({ clientShares: { [client]: 0.02 } }); // 10 of 500
  const open = async () => {
    const r = await x.app.request(
      `/oauth/authorize?${new URLSearchParams({ ...request, client_id: client })}`,
    );
    expect(r.status).toBe(200);
    return r.headers.getSetCookie()[0]!.split(";")[0]!.split("=")[1]!;
  };
  const nonces: string[] = [];
  for (let i = 0; i < 10; i++) nonces.push(await open());
  expect(Object.keys(x.store.value.consents!)).toHaveLength(10);

  const eleventh = await open();
  expect(Object.keys(x.store.value.consents!)).toHaveLength(10);
  expect(x.store.value.consents).not.toHaveProperty(nonces[0]!);
  expect(x.store.value.consents).toHaveProperty(nonces[1]!);
  expect(x.store.value.consents).toHaveProperty(eleventh);
});

/**
 * The customer portal every Company mounts: a test customer's login, which
 * requests may change the account, and what an agent's own browser is not
 * shown.
 */
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { ActivityItem } from "./gateway/activity.ts";
import type { BrowserJoin, GrantAccess } from "./gateway/types.ts";
import { mountCustomerPortal, type PortalLogin } from "./portal.ts";

const origin = "https://company.test";
const grant = {
  id: "g1",
  client: "https://agent.test/client.json",
  host: "agent.test",
  scopes: "things:read",
  expires_at: "2026-12-02T22:07:00.000Z",
  expires: "Dec 2, 22:07 UTC",
};
const proposal: ActivityItem = {
  id: "op1",
  state: "proposed",
  summary: "Move the order",
  at: "2026-11-27T10:00:00.000Z",
  when: "Nov 27, 10:00 UTC",
};

function portal() {
  const state: Record<string, unknown> = { webLogins: { old: 1 } };
  const revoked: string[] = [];
  const grants: GrantAccess = {
    list: () => (revoked.includes(grant.id) ? [] : [grant]),
    revoke: (_account, id) =>
      id === grant.id && !revoked.includes(id) && !!revoked.push(id),
  };
  const browser = { join: undefined as BrowserJoin | undefined };
  const app = new Hono();
  mountCustomerPortal(
    app,
    {
      state,
      grants,
      origin,
      activity: () => [proposal],
      browser: () => browser.join,
    },
    {
      name: "test",
      isCustomer: (account) => account === "elena",
      pages: {
        joined: () => "<p>joined</p>",
        form: (token) => `<input name="login_token" value="${token}">`,
        expired: () => "<p>expired</p>",
      },
      tooMany: "Too many sessions.",
      results: { waiting: (until) => `Waits until ${until}.`, unchanged: {} },
      permissions: (scopes) => [`May ${scopes}`],
      view: (viewer, lists) => ({ account_id: viewer.account, ...lists }),
      script: "start();",
    },
  );
  /** Opens the form and posts it, with `change` applied to the post. */
  const logIn = async (
    change: { origin?: string; token?: string; account?: string } = {},
  ) => {
    const page = await app.request("/site/login");
    const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
    const token = /value="([^"]+)"/.exec(await page.text())![1]!;
    return app.request("/site/login", {
      method: "POST",
      headers: {
        Origin: change.origin ?? origin,
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        login_token: change.token ?? token,
        account: change.account ?? "elena",
      }),
    });
  };
  /** The login cookie a successful login set. */
  const signedIn = async () => {
    const response = await logIn();
    expect(response.status).toBe(302);
    const web = response.headers
      .getSetCookie()
      .find((c) => c.startsWith("test_web="))!;
    return web.split(";")[0]!;
  };
  return { app, state, browser, revoked, logIn, signedIn };
}

afterEach(() => vi.useRealTimers());

it("logs a test customer in with the form's own token, from this site", async () => {
  const x = portal();
  // The nonces an older portal kept are dropped.
  expect(x.state.webLogins).toBeUndefined();
  const response = await x.logIn();
  expect(response.headers.get("location")).toBe("/account");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const cookies = response.headers.getSetCookie();
  expect(cookies).toContainEqual(
    "test_login=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure",
  );
  expect(cookies.find((c) => c.startsWith("test_web="))).toMatch(
    /^test_web=[\w-]{32}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=1800; Secure$/,
  );
  // Kept by the hash of the cookie, where the gateway looks for it.
  const sessions = x.state.webSessions as Record<string, PortalLogin>;
  expect(Object.values(sessions)).toEqual([
    { account: "elena", expires: expect.any(Number) },
  ]);
  const web = cookies.find((c) => c.startsWith("test_web="))!.split(";")[0]!;
  expect(Object.keys(sessions)).not.toContain(web.slice("test_web=".length));
});

it("refuses a form from another site, with another token or customer", async () => {
  const x = portal();
  for (const change of [{ origin: "https://other.test" }, { token: "x" }]) {
    const response = await x.logIn(change);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("<p>expired</p>");
  }
  expect((await x.logIn({ account: "robin" })).status).toBe(400);
  expect(x.state.webSessions).toEqual({});
});

it("keeps at most a thousand logins, and forgets ended ones", async () => {
  const x = portal();
  const sessions = x.state.webSessions as Record<string, PortalLogin>;
  for (let i = 0; i < 1000; i++)
    sessions[`h${i}`] = { account: "elena", expires: Date.now() + 60000 };
  const refused = await x.logIn();
  expect(refused.status).toBe(429);
  expect(await refused.text()).toBe("Too many sessions.");
  sessions.h0!.expires = Date.now() - 1;
  expect((await x.logIn()).status).toBe(302);
  expect(sessions.h0).toBeUndefined();
});

it("ends a login after thirty minutes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = portal();
  const cookie = await x.signedIn();
  const state = () =>
    x.app.request("/site/state", { headers: { Cookie: cookie } });
  expect((await state()).status).toBe(200);
  vi.setSystemTime(Date.now() + 1800001);
  expect((await state()).status).toBe(401);
});

it("disconnects an agent only from this site, for the account the page shows", async () => {
  const x = portal();
  const cookie = await x.signedIn();
  const revoke = (headers: Record<string, string>) =>
    x.app.request("/site/access/g1/revoke", {
      method: "POST",
      headers: { Cookie: cookie, ...headers },
    });
  expect((await revoke({ Origin: origin })).status).toBe(403);
  expect(
    (await revoke({ Origin: "https://other.test", "X-Test-Account": "elena" }))
      .status,
  ).toBe(403);
  expect(
    (await revoke({ Origin: origin, "X-Test-Account": "robin" })).status,
  ).toBe(403);
  expect(x.revoked).toEqual([]);
  const done = await revoke({ Origin: origin, "X-Test-Account": "elena" });
  expect(done.status).toBe(200);
  expect(x.revoked).toEqual(["g1"]);
  expect(
    (await revoke({ Origin: origin, "X-Test-Account": "elena" })).status,
  ).toBe(404);
});

it("logs out only from this site", async () => {
  const x = portal();
  const cookie = await x.signedIn();
  const out = (headers: Record<string, string>) =>
    x.app.request("/site/logout", {
      method: "POST",
      headers: { Cookie: cookie, ...headers },
    });
  expect((await out({})).status).toBe(403);
  expect((await out({ Origin: origin })).status).toBe(200);
  expect(
    (await x.app.request("/site/state", { headers: { Cookie: cookie } }))
      .status,
  ).toBe(401);
});

it("shows the customer's agents and their requests to the customer's own browser", async () => {
  const x = portal();
  const cookie = await x.signedIn();
  const state = await (
    await x.app.request("/site/state", { headers: { Cookie: cookie } })
  ).json();
  expect(state).toEqual({
    account_id: "elena",
    activity: [{ ...proposal, result: "Waits until Nov 27, 10:00 UTC." }],
    agents: [{ ...grant, permissions: ["May things:read"] }],
  });
  const access = await x.app.request("/site/access", {
    headers: { Cookie: cookie },
  });
  expect(await access.json()).toEqual({ grants: [grant] });
});

it("shows an agent's browser neither, and gives it no login form", async () => {
  const x = portal();
  x.browser.join = { scopes: [] };
  const page = await x.app.request("/site/login");
  expect(await page.text()).toBe("<p>joined</p>");
  expect(page.headers.get("set-cookie")).toBeNull();
  x.browser.join = { account: "elena", scopes: ["things:read"] };
  expect((await x.app.request("/site/login")).headers.get("location")).toBe(
    "/account",
  );
  const state = await (await x.app.request("/site/state")).json();
  expect(state).toEqual({ account_id: "elena", activity: [], agents: [] });
  expect((await x.app.request("/site/access")).status).toBe(403);
});

it("serves the account page's script", async () => {
  const response = await portal().app.request("/site/app.js");
  expect(await response.text()).toBe('"use strict";\nstart();');
  expect(response.headers.get("content-type")).toBe(
    "text/javascript; charset=utf-8",
  );
});

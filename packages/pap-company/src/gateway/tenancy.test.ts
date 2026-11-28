/**
 * Visitor tenancy: a website browser's own copy is created only when a
 * request may change state, not on unauthenticated read-only requests, and
 * `browser:` copies have their own eviction pool apart from agent-user
 * tenants.
 */
import type { Context } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { newSessionId, randomId } from "@poppy-lab/pap-client/core";
import { client, setup } from "./test-company.ts";
import { hash, SHARED_TENANT, type CompanyDefinition } from "./types.ts";

const site: Partial<CompanyDefinition> = {
  persona: (id) => (id === "elena" || id === "tomas" ? { id } : undefined),
  mount: (app, ctx) => {
    const logins = (ctx.state.webSessions ??= {}) as Record<string, string>;
    ctx.state.copy ??= randomId();
    const web = (c: Context) =>
      /\bweb=(\w+)/.exec(c.req.header("cookie") ?? "")?.[1] ?? "";
    app.get("/account", (c) =>
      c.html(`<p>${logins[web(c)] ?? "signed-out"}</p>`),
    );
    app.get("/site/login", (c) => c.html("<form></form>"));
    app.post("/site/login", (c) => {
      logins[web(c)] = c.req.query("as") ?? "elena";
      return c.body(null, 204);
    });
    app.get("/site/state", (c) =>
      c.json({ account: logins[web(c)] ?? null, copy: ctx.state.copy }),
    );
    app.get("/api/copy", (c) => c.json({ copy: ctx.state.copy }));
    app.get("/public", (c) => c.json({ copy: ctx.state.copy }));
  },
};

const browserCookieOf = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.includes("pap_browser="))
    ?.split(";")[0];

const browserTenants = (tenants: Record<string, unknown>) =>
  Object.keys(tenants).filter((k) => k.startsWith("browser:"));

afterEach(() => vi.useRealTimers());

it("serves unauthenticated read-only website requests without creating tenants or saving", async () => {
  const x = await setup({ isolation: "visitor", maxTenants: 2 }, site);
  // Seed an active agent-user tenant to confirm reads never evict it.
  const agent = (await (
    await x.call("/api/copy", { user: "usr_a", session: newSessionId() })
  ).json()) as { copy: string };
  const agentKey = hash(`${client}\nusr_a`);
  const savesBefore = x.store.saves;

  // Repeated GET /account and GET /site/login without cookies.
  for (let i = 0; i < 5; i++) {
    const account = await x.app.request("/account");
    expect(account.status).toBe(200);
    expect(browserCookieOf(account)).toBeTruthy();

    const login = await x.app.request("/site/login");
    expect(login.status).toBe(200);
    expect(browserCookieOf(login)).toBeTruthy();
  }
  expect(browserTenants(x.store.value.tenants)).toEqual([]);
  expect(x.store.saves).toBe(savesBefore);
  expect(x.store.value.tenants[agentKey]).toBeDefined();

  // Repeated GET /account and GET /site/login with rotating pap_browser cookies.
  for (let i = 0; i < 5; i++) {
    const cookie = `__Host-pap_browser=${randomId()}`;
    expect(
      (await x.app.request("/account", { headers: { cookie } })).status,
    ).toBe(200);
    expect(
      (await x.app.request("/site/login", { headers: { cookie } })).status,
    ).toBe(200);
  }
  expect(browserTenants(x.store.value.tenants)).toEqual([]);
  expect(x.store.saves).toBe(savesBefore);
  expect(x.store.value.tenants[agentKey]).toBeDefined();

  // HEAD and OPTIONS to /account and /site/login create no browser tenants
  // and evict nothing.
  for (const method of ["HEAD", "OPTIONS"] as const) {
    for (const path of ["/account", "/site/login"]) {
      const cookie = `__Host-pap_browser=${randomId()}`;
      await x.app.request(path, { method, headers: { cookie } });
    }
  }
  expect(browserTenants(x.store.value.tenants)).toEqual([]);
  expect(x.store.value.tenants[agentKey]).toBeDefined();
  const after = (await (
    await x.call("/api/copy", { user: "usr_a", session: newSessionId() })
  ).json()) as { copy: string };
  expect(after.copy).toBe(agent.copy);
});

it("creates a browser tenant on POST /site/login and serves subsequent GET /site/state from it", async () => {
  const x = await setup({ isolation: "visitor" }, site);

  // Opening the login page sets pap_browser without creating a tenant or saving.
  const page = await x.app.request("/site/login");
  expect(page.status).toBe(200);
  const browser = browserCookieOf(page)!;
  expect(browser).toBeTruthy();
  expect(browserTenants(x.store.value.tenants)).toEqual([]);
  expect(x.store.saves).toBe(0);

  // Logging in changes state, creating the browser's tenant and saving once.
  const cookie = `web=abc; ${browser}`;
  const login = await x.app.request("/site/login", {
    method: "POST",
    headers: { cookie },
  });
  expect(login.status).toBe(204);
  expect(browserTenants(x.store.value.tenants)).toHaveLength(1);
  expect(x.store.saves).toBe(1);

  // Subsequent reads use the existing browser tenant without saving again.
  const first = (await (
    await x.app.request("/site/state", { headers: { cookie } })
  ).json()) as { account: string | null; copy: string };
  const second = (await (
    await x.app.request("/site/state", { headers: { cookie } })
  ).json()) as { account: string | null; copy: string };
  expect(first.account).toBe("elena");
  expect(second).toEqual(first);
  expect(x.store.saves).toBe(1);
});

it("evicts only browser tenants when the browser pool overflows, never agent-user tenants", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await setup({ isolation: "visitor", maxTenants: 2 }, site);

  // Create SHARED_TENANT and two active agent-user tenants first (oldest used times).
  expect((await x.app.request("/public")).status).toBe(200);
  const copyA = (
    (await (
      await x.call("/api/copy", { user: "usr_a", session: newSessionId() })
    ).json()) as { copy: string }
  ).copy;
  vi.setSystemTime(Date.now() + 1000);
  const copyB = (
    (await (
      await x.call("/api/copy", { user: "usr_b", session: newSessionId() })
    ).json()) as { copy: string }
  ).copy;

  // Create 4 distinct browser tenants (cap is min(maxTenants=2, 200) = 2).
  const browsers: string[] = [];
  for (let i = 0; i < 4; i++) {
    vi.setSystemTime(Date.now() + 1000);
    const raw = randomId();
    const browser = `__Host-pap_browser=${raw}`;
    browsers.push(raw);
    const r = await x.app.request("/site/login", {
      method: "POST",
      headers: { cookie: `web=w${i}; ${browser}` },
    });
    expect(r.status).toBe(204);
  }

  // Only the 2 most recently used browser tenants remain.
  expect(browserTenants(x.store.value.tenants).sort()).toEqual(
    [`browser:${hash(browsers[2]!)}`, `browser:${hash(browsers[3]!)}`].sort(),
  );
  // Both older agent-user tenants and SHARED_TENANT are untouched.
  expect(x.store.value.tenants[SHARED_TENANT]).toBeDefined();
  expect(
    (
      (await (
        await x.call("/api/copy", { user: "usr_a", session: newSessionId() })
      ).json()) as { copy: string }
    ).copy,
  ).toBe(copyA);
  expect(
    (
      (await (
        await x.call("/api/copy", { user: "usr_b", session: newSessionId() })
      ).json()) as { copy: string }
    ).copy,
  ).toBe(copyB);

  // A 3rd agent-user tenant evicts only the LRU agent-user tenant, leaving
  // the browser tenants and SHARED_TENANT intact.
  vi.setSystemTime(Date.now() + 1000);
  const usrA = hash(`${client}\nusr_a`);
  const usrB = hash(`${client}\nusr_b`);
  const usrC = hash(`${client}\nusr_c`);
  // Touch usr_b so usr_a is least recently used.
  await x.call("/api/copy", { user: "usr_b", session: newSessionId() });
  vi.setSystemTime(Date.now() + 1000);
  await x.call("/api/copy", { user: "usr_c", session: newSessionId() });
  expect(x.store.value.tenants[usrA]).toBeUndefined();
  expect(x.store.value.tenants[usrB]).toBeDefined();
  expect(x.store.value.tenants[usrC]).toBeDefined();
  expect(x.store.value.tenants[SHARED_TENANT]).toBeDefined();
  expect(browserTenants(x.store.value.tenants)).toHaveLength(2);
});

it("serves an idle-expired browser tenant as signed out on read-only requests without saving", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await setup({ isolation: "visitor", tenantIdleMs: 60_000 }, site);
  const raw = randomId();
  const cookie = `web=abc; __Host-pap_browser=${raw}`;
  expect(
    (
      await x.app.request("/site/login", {
        method: "POST",
        headers: { cookie },
      })
    ).status,
  ).toBe(204);
  expect(
    (
      (await (
        await x.app.request("/site/state", { headers: { cookie } })
      ).json()) as { account: string | null }
    ).account,
  ).toBe("elena");

  const saves = x.store.saves;
  vi.setSystemTime(Date.now() + 61_000);
  const state = (await (
    await x.app.request("/site/state", { headers: { cookie } })
  ).json()) as { account: string | null };
  expect(state.account).toBeNull();
  expect(x.store.saves).toBe(saves);
});

it("does not keep a browser tenant for cross-origin or rejected website POSTs", async () => {
  const x = await setup(
    { isolation: "visitor" },
    {
      mount: (app, ctx) => {
        app.post("/site/login", (c) => {
          if (c.req.header("x-allow") !== "yes")
            return c.json({ error: "forbidden" }, 403);
          const sessions = (ctx.state.webSessions ??= {}) as Record<
            string,
            { account: string; expires: number }
          >;
          sessions.ok = { account: "elena", expires: Date.now() + 60_000 };
          return c.body(null, 204);
        });
      },
    },
  );
  // Cross-origin POST is served ephemerally and creates no browser tenant.
  const cross = await x.app.request("/site/login", {
    method: "POST",
    headers: {
      origin: "https://other.example",
      cookie: `__Host-pap_browser=${randomId()}`,
    },
  });
  expect(cross.status).toBe(403);
  expect(browserTenants(x.store.value.tenants)).toHaveLength(0);

  // Same-origin rejected POST does not leave an empty browser tenant behind.
  const rejected = await x.app.request("/site/login", {
    method: "POST",
    headers: {
      origin: "https://shop.example",
      cookie: `__Host-pap_browser=${randomId()}`,
    },
  });
  expect(rejected.status).toBe(403);
  expect(browserTenants(x.store.value.tenants)).toHaveLength(0);
});

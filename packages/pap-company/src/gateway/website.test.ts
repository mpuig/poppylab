/**
 * The Company website with a copy per visitor: a browser sees its own copy
 * until it approves an agent's consent, then the agent user's, and a login
 * made on the website before that goes with it. Its list of connected
 * agents has the agent that browser approved from the consent on, before
 * the agent uses the access.
 */
import type { Context } from "hono";
import { expect, it } from "vitest";
import { randomId } from "@poppy-lab/pap-client/core";
import { restartingStore } from "../memory.ts";
import { client, setup } from "./test-company.ts";
import type { CompanyDefinition } from "./types.ts";

/**
 * A website that logs a browser in (as Elena, or as `?as=`), says which
 * copy it shows, and lists and disconnects that customer's agents.
 */
const site: Partial<CompanyDefinition> = {
  persona: (id) => (id === "elena" || id === "tomas" ? { id } : undefined),
  mount: (app, ctx) => {
    const logins = (ctx.state.webSessions ??= {}) as Record<string, string>;
    ctx.state.copy ??= randomId();
    const web = (c: Context) =>
      /\bweb=(\w+)/.exec(c.req.header("cookie") ?? "")?.[1] ?? "";
    app.post("/site/login", (c) => {
      logins[web(c)] = c.req.query("as") ?? "elena";
      return c.body(null, 204);
    });
    app.post("/site/logout", (c) => {
      delete logins[web(c)];
      return c.body(null, 204);
    });
    app.get("/site/state", (c) =>
      c.json({ account: logins[web(c)] ?? null, copy: ctx.state.copy }),
    );
    app.get("/site/agents", (c) =>
      c.json(ctx.grants.list(logins[web(c)] ?? "")),
    );
    app.post("/site/agents/:id/revoke", async (c) => {
      // As a real website would: something read before the grant is found.
      await c.req.text();
      return c.json({
        revoked: ctx.grants.revoke(logins[web(c)] ?? "", c.req.param("id")),
      });
    });
    app.get("/api/copy", (c) => c.json({ copy: ctx.state.copy }));
  },
};
type Seen = { account: string | null; copy: string };
type Listed = { id: string; scopes: string };

/**
 * A browser on a website with a copy per visitor, logged in as `account`:
 * its `pap_browser` cookie, to approve consents with, and what its list of
 * connected agents shows and disconnects.
 */
async function visitor(
  x: Awaited<ReturnType<typeof setup>>,
  web: string,
  account = "elena",
) {
  const first = await x.app.request(`/site/login?as=${account}`, {
    method: "POST",
    headers: { cookie: `web=${web}` },
  });
  const browser = first.headers
    .getSetCookie()
    .find((c) => c.includes("pap_browser="))!
    .split(";")[0]!;
  const cookie = `web=${web}; ${browser}`;
  /** The same browser's cookies, logged in as another customer too. */
  const as = async (other: string, customer: string) => {
    const cookies = `web=${other}; ${browser}`;
    await x.app.request(`/site/login?as=${customer}`, {
      method: "POST",
      headers: { cookie: cookies },
    });
    return cookies;
  };
  const agents = async (cookies = cookie) =>
    (await (
      await x.app.request("/site/agents", { headers: { cookie: cookies } })
    ).json()) as Listed[];
  const disconnect = async (id: string) =>
    (
      (await (
        await x.app.request(`/site/agents/${id}/revoke`, {
          method: "POST",
          headers: { cookie },
        })
      ).json()) as { revoked: boolean }
    ).revoked;
  return { browser, as, agents, disconnect };
}

it("keeps a customer logged in on the website when their browser starts to see the agent user's copy", async () => {
  const load = restartingStore();
  const x = await setup({ isolation: "visitor", store: load() }, site);
  const first = await x.app.request("/site/login", {
    method: "POST",
    headers: { cookie: "web=abc" },
  });
  const browser = first.headers
    .getSetCookie()
    .find((c) => c.includes("pap_browser="))!
    .split(";")[0]!;
  const cookie = `web=abc; ${browser}`;
  const state = async (app = x.app) =>
    (await (
      await app.request("/site/state", { headers: { cookie } })
    ).json()) as Seen;
  const own = await state();
  expect(own.account).toBe("elena");

  // Approving the consent changes nothing yet: the agent has made no
  // signed-in request.
  const tokens = await x.signIn("things:read", {}, browser);
  if ("refused" in tokens) throw new Error("refused");
  expect(await state()).toEqual(own);

  const agent = (await (
    await x.call("/api/copy", { access: tokens.access_token })
  ).json()) as { copy: string };
  expect(agent.copy).not.toBe(own.copy);
  // The website now shows the agent user's copy, still logged in.
  expect(await state()).toEqual({ account: "elena", copy: agent.copy });

  // A restart loads the same, without the browser's own copy, which nothing
  // leads to any more. A logout after it holds through another restart.
  const loaded = load();
  expect(
    Object.keys(loaded.value.tenants).filter((k) => k.startsWith("browser:")),
  ).toEqual([]);
  const y = await setup({ isolation: "visitor", store: loaded }, site);
  expect(await state(y.app)).toEqual({ account: "elena", copy: agent.copy });
  await y.app.request("/site/logout", { method: "POST", headers: { cookie } });
  const z = await setup({ isolation: "visitor", store: load() }, site);
  expect(await state(z.app)).toEqual({ account: null, copy: agent.copy });
});

it("tells a website who an account's connected agents are, as the consent page named them", async () => {
  const x = await setup(
    {},
    {
      mount: (app, ctx) => {
        app.get("/site/agents", (c) => c.json(ctx.grants.list("elena")));
      },
    },
  );
  const tokens = await x.signIn("things:read things:write");
  if ("refused" in tokens) throw new Error("refused");
  const list = async () =>
    (await (await x.app.request("/site/agents")).json()) as Array<
      Record<string, unknown>
    >;
  expect(await list()).toMatchObject([
    {
      client,
      // The agent's own name for itself, and the host of its verified address.
      name: "Agent",
      host: "agent.test",
      scopes: "things:read things:write",
      // The same text for every viewer, whatever their locale.
      expires: expect.stringMatching(
        /^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC$/,
      ),
    },
  ]);
  // A grant stored before the name was kept has the verified host only.
  for (const grant of Object.values(x.store.value.grants)) delete grant.name;
  const [old] = await list();
  expect(old).not.toHaveProperty("name");
  expect(old).toMatchObject({ client, host: "agent.test" });
});

it("lists an agent for the browser that approved its consent before the agent uses the access, and for nobody else", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const elena = await visitor(x, "abc");
  const other = await visitor(x, "def");
  expect(await elena.agents()).toEqual([]);

  const tokens = await x.signIn("things:read", {}, elena.browser);
  if ("refused" in tokens) throw new Error("refused");
  // No signed-in request yet, so the grant has no agent user: only the
  // browser that approved it has it, for the customer it approved it for.
  const [grant] = Object.values(x.store.value.grants);
  expect(grant).not.toHaveProperty("holder");
  expect(await elena.agents()).toMatchObject([
    { id: grant!.id, client, name: "Agent", scopes: "things:read" },
  ]);
  // Another browser logged in as the same customer doesn't, nor does the
  // same browser logged in as another customer.
  expect(await other.agents()).toEqual([]);
  expect(await elena.agents(await elena.as("ghi", "tomas"))).toEqual([]);

  // Used: the browser sees the agent user's copy, with the agent once.
  await x.call("/api/copy", { access: tokens.access_token });
  expect(await elena.agents()).toMatchObject([{ id: grant!.id }]);
  expect(await other.agents()).toEqual([]);
});

it("lets the browser that approved a consent disconnect the agent before the agent uses the access", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const elena = await visitor(x, "abc");
  const other = await visitor(x, "def");
  const tokens = await x.signIn("things:read", {}, elena.browser);
  if ("refused" in tokens) throw new Error("refused");
  const id = Object.values(x.store.value.grants)[0]!.id;

  // Only that browser: for another one there is no such agent.
  expect(await other.disconnect(id)).toBe(false);
  expect(await elena.agents()).toHaveLength(1);
  expect(await elena.disconnect(id)).toBe(true);

  // The grant and its tokens are gone: no access, and no refresh.
  expect(await elena.agents()).toEqual([]);
  expect(x.store.value.grants).toEqual({});
  expect(x.store.value.tokens).toEqual({});
  const refused = await x.call("/api/copy", { access: tokens.access_token });
  expect(refused.status).toBe(401);
  await expect(
    x.token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  ).rejects.toThrow("invalid_grant");
});

it("shows the permissions of a second consent before the agent uses them, to the browser that approved it only", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const elena = await visitor(x, "abc");
  // Another browser of the same agent user: it sees that user's copy too.
  const second = await visitor(x, "def");
  for (const v of [elena, second]) {
    const tokens = await x.signIn("things:read", {}, v.browser);
    if ("refused" in tokens) throw new Error("refused");
    await x.call("/api/copy", { access: tokens.access_token });
  }
  const before = await elena.agents();
  expect(before).toHaveLength(2);
  expect(await second.agents()).toEqual(before);

  // The first browser allows more; the agent has yet to use it.
  const more = await x.signIn("things:read things:write", {}, elena.browser);
  if ("refused" in more) throw new Error("refused");
  const wider = (await elena.agents()).filter(
    (g) => g.scopes === "things:read things:write",
  );
  expect(wider).toHaveLength(1);
  expect(await elena.agents()).toHaveLength(3);
  // The other browser has the same copy, but did not approve this one.
  expect(await second.agents()).toEqual(before);
  expect(await second.disconnect(wider[0]!.id)).toBe(false);

  // Once the agent uses it, it is the agent user's, listed once.
  await x.call("/api/copy", { access: more.access_token });
  expect(await elena.agents()).toHaveLength(3);
  expect(await second.agents()).toEqual(await elena.agents());
});

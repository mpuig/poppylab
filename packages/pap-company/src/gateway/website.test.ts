/**
 * The Company website with a copy per visitor: a browser sees its own copy
 * until it approves an agent's consent, then the agent user's, and a login
 * made on the website before that goes with it.
 */
import type { Context } from "hono";
import { expect, it } from "vitest";
import { randomId } from "@poppy-lab/pap-client/core";
import { restartingStore } from "../memory.ts";
import { client, setup } from "./test-company.ts";
import type { CompanyDefinition } from "./types.ts";

/** A website that logs a browser in as Elena and says which copy it shows. */
const site: Partial<CompanyDefinition> = {
  mount: (app, ctx) => {
    const logins = (ctx.state.webSessions ??= {}) as Record<string, string>;
    ctx.state.copy ??= randomId();
    const web = (c: Context) =>
      /\bweb=(\w+)/.exec(c.req.header("cookie") ?? "")?.[1] ?? "";
    app.post("/site/login", (c) => {
      logins[web(c)] = "elena";
      return c.body(null, 204);
    });
    app.post("/site/logout", (c) => {
      delete logins[web(c)];
      return c.body(null, 204);
    });
    app.get("/site/state", (c) =>
      c.json({ account: logins[web(c)] ?? null, copy: ctx.state.copy }),
    );
    app.get("/api/copy", (c) => c.json({ copy: ctx.state.copy }));
  },
};
type Seen = { account: string | null; copy: string };

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

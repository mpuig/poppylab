/**
 * Extensions a request declares (§3.3, §3.4), routes a Company handles only
 * with one (`extension_required`), and what a consent grants beyond scopes
 * (`selectResources`), as a Company's routes see it (`grantFor`).
 */
import type { Context } from "hono";
import { expect, it } from "vitest";
import { newSessionId } from "@poppy-lab/pap-client/core";
import { setup } from "./test-company.ts";
import type { CompanyDefinition, GrantView } from "./types.ts";

const GIFT = { name: "example.com/gift-wrap", version: "2" };
const BOTH = '"operations";v="3", "example.com/gift-wrap";v="2"';

type View = {
  extensions: Record<string, string>;
  operations: boolean;
  grant: GrantView | null;
  /** What every other tenant's `grantFor` returns for this request. */
  others: Array<GrantView | null>;
};

/** A Company with gift-wrap routes, account resources and echo routes. */
function company(): Partial<CompanyDefinition> {
  const mounts: Array<{ grantFor: (c: Context) => GrantView | undefined }> = [];
  return {
    requiredExtension: ({ path }) =>
      path.startsWith("/api/gift/") || path === "/api/account/gift"
        ? GIFT
        : undefined,
    // A field naming accounts, each prefixed with the persona it belongs to.
    selectResources: ({ persona, body }) =>
      body.resources === undefined
        ? undefined
        : body.resources
            .split(",")
            .filter(Boolean)
            .map((r) => `${persona}:${r}`),
    mount: (app, ctx) => {
      mounts.push(ctx);
      const view = (c: Context) => {
        const s = ctx.sessionFor(c);
        return c.json({
          extensions: s.extensions,
          operations: s.operations,
          grant: ctx.grantFor(c) ?? null,
          others: mounts
            .filter((m) => m !== ctx)
            .map((m) => m.grantFor(c) ?? null),
        } satisfies View);
      };
      app.get("/api/echo", view);
      app.get("/api/gift/wrap", view);
      app.get("/api/account/things", view);
      app.get("/api/account/gift", view);
      app.post("/api/account/things", (c) => c.json({ ok: true }));
      app.get("/site/grant", (c) => c.json({ grant: ctx.grantFor(c) ?? null }));
    },
  };
}

const lab = (deploy = {}) => setup(deploy, company());
const json = async (r: Response) => (await r.json()) as View;
type Issued = { access_token: string; refresh_token: string };
const signedIn = (tokens: Issued | { refused: Response }) => {
  if ("refused" in tokens) throw new Error("consent refused");
  return tokens;
};

it("reads every declared extension into the Session, and Operations only at version 3", async () => {
  const x = await lab();
  const declared = async (extensions?: string) => {
    const r = await x.call("/api/echo", {
      ...(extensions !== undefined ? { extensions } : {}),
    });
    expect(r.status).toBe(200);
    const { extensions: e, operations } = await json(r);
    return { extensions: e, operations };
  };
  expect(await declared(BOTH)).toEqual({
    extensions: { operations: "3", "example.com/gift-wrap": "2" },
    operations: true,
  });
  expect(await declared('"operations";v="2"')).toEqual({
    extensions: { operations: "2" },
    operations: false,
  });
  // §3.4: a header that fails to parse declares nothing.
  expect(await declared("operations;v=3")).toEqual({
    extensions: {},
    operations: false,
  });
  expect(await declared()).toEqual({ extensions: {}, operations: false });
});

it("refuses a route that needs an undeclared extension version with extension_required in a JSON body", async () => {
  const x = await lab();
  for (const extensions of [undefined, '"example.com/gift-wrap";v="1"']) {
    const r = await x.call("/api/gift/wrap", {
      ...(extensions ? { extensions } : {}),
    });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({
      error: "extension_required",
      extension: "example.com/gift-wrap",
    });
    // §3.3: not an access token error.
    expect(r.headers.get("www-authenticate")).toBeNull();
  }
  const declared = await x.call("/api/gift/wrap", { extensions: BOTH });
  expect(declared.status).toBe(200);
  // Routes that need no extension don't change.
  expect((await x.call("/api/echo")).status).toBe(200);
});

it("checks the extension after the version and the Session, and before the token", async () => {
  const x = await lab();
  const raw = (headers: Record<string, string>) =>
    x.app.request("/api/gift/wrap", { headers });
  expect(await (await raw({ "Poppy-Session": "x" })).json()).toEqual({
    error: "version_unsupported",
  });
  expect(
    await (await raw({ "Poppy-Session": "x", "Poppy-Version": "1.0" })).json(),
  ).toEqual({ error: "invalid_session" });
  // Signed out, or with a token that isn't valid: a new Session that
  // declares the extension is the only fix, so that comes first.
  for (const access of [undefined, "not-a-token"]) {
    const r = await x.call("/api/account/gift", {
      ...(access ? { access } : {}),
    });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "extension_required" });
  }
  // A refused request starts no Session.
  expect(x.store.value.sessions).toEqual({});
  const challenge = await x.call("/api/account/gift", { extensions: BOTH });
  expect(challenge.status).toBe(401);
  expect(challenge.headers.get("www-authenticate")).toBe(
    'DPoP scope="things:read"',
  );
  const tokens = signedIn(await x.signIn());
  const served = await x.call("/api/account/gift", {
    extensions: BOTH,
    access: tokens.access_token,
  });
  expect(served.status).toBe(200);
});

it("keeps Operations v3 on account POSTs after the scopes, as before", async () => {
  const x = await lab();
  expect((await x.call("/api/account/things", { method: "POST" })).status).toBe(
    401,
  );
  const read = signedIn(await x.signIn("things:read"));
  const narrow = await x.call("/api/account/things", {
    method: "POST",
    access: read.access_token,
    session: newSessionId(),
  });
  expect(narrow.status).toBe(403);
  expect(await narrow.json()).toEqual({ error: "insufficient_scope" });
  const write = signedIn(await x.signIn("things:read things:write"));
  const undeclared = await x.call("/api/account/things", {
    method: "POST",
    access: write.access_token,
    session: newSessionId(),
  });
  expect(undeclared.status).toBe(403);
  expect(await undeclared.json()).toEqual({
    error: "extension_required",
    extension: "operations",
  });
  const declared = await x.call("/api/account/things", {
    method: "POST",
    access: write.access_token,
    session: newSessionId(),
    extensions: '"operations";v="3"',
  });
  expect(declared.status).toBe(200);
  expect(await declared.json()).toEqual({ ok: true });
});

it("carries the consent's resources to the code, the grant, its tokens and every refresh", async () => {
  const x = await lab();
  const tokens = signedIn(
    await x.signIn("things:read things:write", { resources: "acc_1,acc_2" }),
  );
  const first = (
    await json(
      await x.call("/api/account/things", { access: tokens.access_token }),
    )
  ).grant!;
  expect(first).toEqual({
    id: expect.any(String),
    scopes: ["things:read", "things:write"],
    resources: ["elena:acc_1", "elena:acc_2"],
    created_at: expect.any(String),
    expires_at: expect.any(String),
  });
  const [stored] = Object.values(x.store.value.grants);
  expect(stored).toMatchObject({
    id: first.id,
    resources: ["elena:acc_1", "elena:acc_2"],
  });
  // A refresh keeps the grant, and with it the resources, even with fewer
  // scopes in the new token.
  for (const scope of [undefined, "things:read"]) {
    const refreshed = await x.token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      ...(scope ? { scope } : {}),
    });
    const view = await json(
      await x.call("/api/account/things", {
        access: refreshed.access_token,
      }),
    );
    expect(view.grant).toEqual(first);
  }
  // Choosing nothing is a choice, unlike a grant without resources.
  const none = signedIn(await x.signIn("things:read", { resources: "" }));
  const empty = await json(
    await x.call("/api/account/things", {
      access: none.access_token,
      session: newSessionId(),
    }),
  );
  expect(empty.grant?.resources).toEqual([]);
  // What the Company returns is checked, since the form drives it.
  const repeated = await x.signIn("things:read", { resources: "a,a" });
  expect("refused" in repeated && repeated.refused.status).toBe(400);
});

it("keeps grants without resources working: from before them, and at Companies without selectResources", async () => {
  const x = await lab();
  const tokens = signedIn(
    await x.signIn("things:read", { resources: "acc_1" }),
  );
  // A grant persisted before `resources` existed.
  const [stored] = Object.values(x.store.value.grants);
  delete stored!.resources;
  const view = await json(
    await x.call("/api/account/things", { access: tokens.access_token }),
  );
  expect(view.grant).not.toHaveProperty("resources");
  expect(view.grant?.scopes).toEqual(["things:read"]);
  const refreshed = await x.token({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  const again = await json(
    await x.call("/api/account/things", { access: refreshed.access_token }),
  );
  expect(again.grant).toEqual(view.grant);

  const plain = company();
  delete plain.selectResources;
  const y = await setup({}, plain);
  const issued = signedIn(
    await y.signIn("things:read", { resources: "acc_1" }),
  );
  const seen = (await (
    await y.call("/api/account/things", { access: issued.access_token })
  ).json()) as View;
  expect(seen.grant).not.toHaveProperty("resources");
  expect(Object.values(y.store.value.grants)[0]).not.toHaveProperty(
    "resources",
  );
});

it("shows a request only its own grant: not signed out, not on the website, not to another tenant", async () => {
  const x = await lab({ isolation: "visitor" });
  const a = signedIn(await x.signIn("things:read", { resources: "acc_a" }));
  const b = signedIn(await x.signIn("things:read", { resources: "acc_b" }));
  const seen = async (user: string, access: string) =>
    json(await x.call("/api/account/things", { access, user }));
  await seen("usr_a", a.access_token);
  const ofB = await seen("usr_b", b.access_token);
  const ofA = await seen("usr_a", a.access_token);
  expect(ofA.grant?.resources).toEqual(["elena:acc_a"]);
  expect(ofB.grant?.resources).toEqual(["elena:acc_b"]);
  expect(ofA.grant?.id).not.toBe(ofB.grant?.id);
  // Each User has their own tenant; the other's grantFor sees nothing.
  expect(ofA.others).toEqual([null]);
  expect(ofB.others).toEqual([null]);
  // A's token serves only A (the grant's holder).
  expect(
    (
      await x.call("/api/account/things", {
        access: a.access_token,
        user: "usr_b",
      })
    ).status,
  ).toBe(401);
  expect((await json(await x.call("/api/echo", { user: "usr_c" }))).grant).toBe(
    null,
  );
  const website = await x.app.request("/site/grant");
  expect(await website.json()).toEqual({ grant: null });
});

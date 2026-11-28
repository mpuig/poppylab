/**
 * Account routes outside `/api/account` (`accountPrefixes`, §7), routes
 * that need a token but no particular scope, a Company's own token response
 * fields (`tokenFields`, RFC 6749 §5.1) and a consent the Company turns down
 * (`selectResources` → `{ refuse }`).
 */
import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { newSessionId } from "@poppy-lab/pap-client/core";
import { origin, setup } from "./test-company.ts";
import {
  MCP_PATH,
  SHARED_TENANT,
  type CompanyDefinition,
  type GrantView,
} from "./types.ts";

const DATA = { name: "example.com/data", version: "1" };

/** Data routes under `/data/v1/`, with their own scopes and a consent route. */
function company(): Partial<CompanyDefinition> {
  return {
    scopes: ["things:read", "things:write", "data:read"],
    accountPrefixes: ["/api/account", "/data/v1/"],
    requiredScopes: ({ path, method }) => {
      if (path.startsWith("/data/v1/consents/")) return [];
      if (path.startsWith("/data/v1/")) return ["data:read"];
      return [method === "POST" ? "things:write" : "things:read"];
    },
    requiredExtension: ({ path }) =>
      path.startsWith("/data/") ? DATA : undefined,
    selectResources: ({ persona, body, scopes }) => {
      if (!scopes.includes("data:read")) return undefined;
      const chosen = (body.resources ?? "").split(",").filter(Boolean);
      return chosen.length
        ? chosen.map((r) => `${persona}:${r}`)
        : { refuse: "Choose at least one record to share." };
    },
    tokenFields: (grant: GrantView, at: string) => ({
      ...(grant.scopes.includes("data:read")
        ? {
            consent_id: grant.id,
            consent_uri: `${at}/data/v1/consents/${grant.id}`,
          }
        : {}),
      // Never replaces a standard field.
      access_token: "spoofed",
      scope: "spoofed",
    }),
    mount: (app, ctx) => {
      const view = (c: Context) =>
        c.json({
          account: ctx.sessionFor(c).account ?? null,
          grant: ctx.grantFor(c) ?? null,
        });
      app.get("/data/v1/records", view);
      app.post("/data/v1/records", view);
      app.get("/data/v1/consents/:id", view);
      app.put("/data/v1/consents/:id/revocation", (c) => {
        const grant = ctx.grantFor(c);
        if (!grant || grant.id !== c.req.param("id"))
          return c.json({ error: "not_found" }, 404);
        ctx.grants.revoke(ctx.sessionFor(c).account!, grant.id);
        return c.body(null, 204);
      });
      app.get("/data-docs.json", (c) => c.json({ public: true }));
      app.get("/api/account/things", view);
    },
  };
}

const lab = () => setup({}, company());
const declare = '"example.com/data";v="1"';
type Issued = {
  access_token: string;
  refresh_token: string;
  scope?: string;
  consent_id?: string;
  consent_uri?: string;
};
const signedIn = (tokens: unknown) => {
  if (tokens && typeof tokens === "object" && "refused" in tokens)
    throw new Error("consent refused");
  return tokens as Issued;
};

describe("account prefixes", () => {
  it("verifies the Session, the extension, the token and the scopes on a Company's own prefix", async () => {
    const x = await lab();
    // No Session header: refused before anything else (§5.3).
    expect((await x.app.request("/data/v1/records")).status).toBe(400);
    const undeclared = await x.call("/data/v1/records");
    expect(undeclared.status).toBe(403);
    expect(await undeclared.json()).toEqual({
      error: "extension_required",
      extension: DATA.name,
    });
    const challenge = await x.call("/data/v1/records", { extensions: declare });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("www-authenticate")).toBe(
      'DPoP scope="data:read"',
    );
    const narrow = signedIn(await x.signIn("things:read"));
    const insufficient = await x.call("/data/v1/records", {
      extensions: declare,
      access: narrow.access_token,
    });
    expect(insufficient.status).toBe(403);
    expect(insufficient.headers.get("www-authenticate")).toContain(
      'scope="data:read"',
    );
    const wide = signedIn(
      await x.signIn("things:read data:read", { resources: "r1" }),
    );
    const served = await x.call("/data/v1/records", {
      extensions: declare,
      access: wide.access_token,
      session: newSessionId(),
    });
    expect(served.status).toBe(200);
    expect(await served.json()).toMatchObject({
      account: "elena",
      grant: { resources: ["elena:r1"] },
    });
  });

  it("keeps the default /api/account behavior and leaves other paths unguarded", async () => {
    const x = await lab();
    const challenge = await x.call("/api/account/things");
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("www-authenticate")).toBe(
      'DPoP scope="things:read"',
    );
    // Public paths outside every prefix need no Session.
    const docs = await x.app.request("/data-docs.json");
    expect(docs.status).toBe(200);
    expect(await docs.json()).toEqual({ public: true });
    // Without the option, a Company's `/data/v1/` routes aren't account
    // routes: no Session is verified there.
    const plain = company();
    delete plain.accountPrefixes;
    delete plain.requiredExtension;
    const y = await setup({}, plain);
    expect((await y.app.request("/data/v1/records")).status).not.toBe(400);
  });

  it("asks Operations v3 of POSTs on every prefix, and of no other method", async () => {
    const x = await lab();
    const tokens = signedIn(
      await x.signIn("things:read data:read", { resources: "r1" }),
    );
    const post = await x.call("/data/v1/records", {
      method: "POST",
      extensions: declare,
      access: tokens.access_token,
    });
    expect(post.status).toBe(403);
    expect(await post.json()).toEqual({
      error: "extension_required",
      extension: "operations",
    });
    // A PUT is not an operation: the route answers it.
    const put = await x.call(
      `/data/v1/consents/${tokens.consent_id}/revocation`,
      { method: "PUT", extensions: declare, access: tokens.access_token },
    );
    expect(put.status).toBe(204);
  });

  it("serves a route with no required scope to any token, and challenges without a scope when signed out", async () => {
    const x = await lab();
    const signedOut = await x.call("/data/v1/consents/x", {
      extensions: declare,
    });
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("www-authenticate")).toBe("DPoP");
    const tokens = signedIn(await x.signIn("things:read"));
    const served = await x.call("/data/v1/consents/x", {
      extensions: declare,
      access: tokens.access_token,
    });
    expect(served.status).toBe(200);
  });

  it("refuses prefixes over the sign-in, discovery or Poppy routes", async () => {
    for (const accountPrefixes of [[], ["/"], ["/oauth"], ["/popp"], ["x"]])
      await expect(
        setup({}, { ...company(), accountPrefixes }),
      ).rejects.toThrow(/accountPrefixes/);
  });

  it("defaults write methods on account routes to both readScope and writeScope when requiredScopes is omitted", async () => {
    const x = await setup(
      {},
      {
        mount: (app, ctx) => {
          app.get("/api/account/things", (c) =>
            c.json({ account: ctx.sessionFor(c).account, item: "secret-lamp" }),
          );
          app.post("/api/account/things", (c) =>
            ctx.gate(c, {
              key: "thing:1",
              terms: { current: "secret-lamp", next: "new-lamp" },
              summary: "Replace secret-lamp with new-lamp",
              perform: () => ({ summary: "Replaced", data: { ok: true } }),
              stale: () => false,
            }),
          );
          app.put("/api/account/things", (c) => c.json({ updated: true }));
        },
      },
    );
    const ops = '"operations";v="3"';
    const getChallenge = await x.call("/api/account/things");
    expect(getChallenge.status).toBe(401);
    expect(getChallenge.headers.get("www-authenticate")).toBe(
      'DPoP scope="things:read"',
    );
    const postChallenge = await x.call("/api/account/things", {
      method: "POST",
      extensions: ops,
    });
    expect(postChallenge.status).toBe(401);
    expect(postChallenge.headers.get("www-authenticate")).toBe(
      'DPoP scope="things:read things:write"',
    );
    const putChallenge = await x.call("/api/account/things", {
      method: "PUT",
    });
    expect(putChallenge.status).toBe(401);
    expect(putChallenge.headers.get("www-authenticate")).toBe(
      'DPoP scope="things:read things:write"',
    );

    const writeOnly = signedIn(await x.signIn("things:write"));
    expect(writeOnly.scope).toBe("things:write");
    const deniedPost = await x.call("/api/account/things", {
      method: "POST",
      extensions: ops,
      access: writeOnly.access_token,
    });
    expect(deniedPost.status).toBe(403);
    expect(await deniedPost.json()).toEqual({ error: "insufficient_scope" });
    expect(deniedPost.headers.get("www-authenticate")).toBe(
      'DPoP error="insufficient_scope", scope="things:read things:write"',
    );

    const deniedPut = await x.call("/api/account/things", {
      method: "PUT",
      access: writeOnly.access_token,
    });
    expect(deniedPut.status).toBe(403);
    expect(await deniedPut.json()).toEqual({ error: "insufficient_scope" });
    expect(deniedPut.headers.get("www-authenticate")).toBe(
      'DPoP error="insufficient_scope", scope="things:read things:write"',
    );

    const readOnly = signedIn(await x.signIn("things:read"));
    expect(
      (
        await x.call("/api/account/things", {
          access: readOnly.access_token,
        })
      ).status,
    ).toBe(200);
    const readOnlyPost = await x.call("/api/account/things", {
      method: "POST",
      extensions: ops,
      access: readOnly.access_token,
    });
    expect(readOnlyPost.status).toBe(403);
    expect(readOnlyPost.headers.get("www-authenticate")).toBe(
      'DPoP error="insufficient_scope", scope="things:read things:write"',
    );

    const readWrite = signedIn(await x.signIn("things:read things:write"));
    const proposal = await x.call("/api/account/things", {
      method: "POST",
      extensions: ops,
      access: readWrite.access_token,
    });
    expect(proposal.status).toBe(403);
    expect(await proposal.json()).toMatchObject({
      error: "approval_required",
      operation: { terms: { current: "secret-lamp", next: "new-lamp" } },
    });
    const updated = await x.call("/api/account/things", {
      method: "PUT",
      access: readWrite.access_token,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ updated: true });
  });
});

describe("token response fields", () => {
  it("adds the Company's fields at the code exchange and every refresh, never over standard ones", async () => {
    const x = await lab();
    const tokens = signedIn(
      await x.signIn("things:read data:read", { resources: "r1" }),
    );
    const grant = (
      (await (
        await x.call("/data/v1/records", {
          extensions: declare,
          access: tokens.access_token,
        })
      ).json()) as { grant: GrantView }
    ).grant;
    expect(tokens.consent_id).toBe(grant.id);
    // With the deployment's origin, for fields that are absolute URLs.
    expect(tokens.consent_uri).toBe(`${origin}/data/v1/consents/${grant.id}`);
    expect(tokens.access_token).not.toBe("spoofed");
    expect(tokens.scope).not.toBe("spoofed");
    for (const scope of [undefined, "data:read"]) {
      const refreshed = (await x.token({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        ...(scope ? { scope } : {}),
      })) as Issued;
      expect(refreshed.consent_id).toBe(grant.id);
      expect(refreshed.access_token).not.toBe("spoofed");
    }
    // A grant without the scope gets no consent_id.
    const plain = signedIn(await x.signIn("things:read"));
    expect(plain).not.toHaveProperty("consent_id");
  });

  it("revokes the grant from a Company route, so its tokens and refresh token stop working", async () => {
    const x = await lab();
    const tokens = signedIn(
      await x.signIn("things:read data:read", { resources: "r1" }),
    );
    const other = await x.call("/data/v1/consents/not-it/revocation", {
      method: "PUT",
      extensions: declare,
      access: tokens.access_token,
    });
    expect(other.status).toBe(404);
    const revoked = await x.call(
      `/data/v1/consents/${tokens.consent_id}/revocation`,
      { method: "PUT", extensions: declare, access: tokens.access_token },
    );
    expect(revoked.status).toBe(204);
    const after = await x.call("/data/v1/records", {
      extensions: declare,
      access: tokens.access_token,
    });
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain("invalid_token");
    await expect(
      x.token({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
    ).rejects.toThrow(/invalid_grant/);
  });
});

describe("refused consent", () => {
  it("turns an approval down with the Company's message, keeps the consent pending and issues nothing", async () => {
    const x = await lab();
    const refused = await x.signIn("things:read data:read", { resources: "" });
    expect("refused" in refused).toBe(true);
    if (!("refused" in refused)) return;
    expect(refused.refused.status).toBe(400);
    expect(await refused.refused.json()).toEqual({
      error: "invalid_request",
      error_description: "Choose at least one record to share.",
    });
    expect(x.store.value.codes).toEqual({});
    expect(Object.keys(x.store.value.consents ?? {})).toHaveLength(1);
    // Scopes the hook doesn't cover still sign in without resources.
    const plain = signedIn(await x.signIn("things:read", { resources: "" }));
    expect(plain.access_token).toEqual(expect.any(String));
  });
});

describe("canonical routed paths and default write scopes", () => {
  it("enforces session, extension, scope, tenancy and MCP guards on percent-encoded paths without decoding %2F", async () => {
    let saves = 0;
    const x = await setup(
      { isolation: "visitor" },
      {
        scopes: ["things:read", "things:write", "data:read"],
        accountPrefixes: ["/api/account", "/data/v1/"],
        discovery: (at) => ({
          apis: [{ type: "mcp", url: `${at}${MCP_PATH}` }],
        }),
        requiredScopes: ({ path }) => {
          if (path === "/api/account/secret") return ["things:write"];
          if (/^\/api\/account\/items\/[^/]+\/secret$/.test(path))
            return ["things:write"];
          if (path.startsWith("/data/v1/")) return ["data:read"];
          return ["things:read"];
        },
        requiredExtension: ({ path }) =>
          path.startsWith("/data/") ? DATA : undefined,
        mount: (app, ctx) => {
          app.get("/api/public", (c) => c.json({ ok: true }));
          app.get("/api/account/secret", (c) => c.json({ secret: true }));
          app.get("/api/account/items/:id", (c) =>
            c.json({ item: c.req.param("id") }),
          );
          app.get("/api/account/items/:id/secret", (c) =>
            c.json({ secretItem: c.req.param("id") }),
          );
          app.get("/data/v1/records", (c) => c.json({ records: [] }));
          app.get("/site/hello", (c) =>
            c.json({ note: ctx.state.note ?? null }),
          );
          app.post("/site/hello", (c) => {
            ctx.state.note = "visitor-only";
            return c.json({ saved: true });
          });
        },
      },
    );

    // Percent-encoded `/api/public` still requires a Poppy-Session header.
    const encodedPublic = await x.app.request("/%61pi/public");
    expect(encodedPublic.status).toBe(400);
    expect(await encodedPublic.json()).toEqual({ error: "invalid_session" });

    // Percent-encoded `/data/v1/records` still requires the declared extension.
    const encodedExt = await x.call("/%64ata/v1/records");
    expect(encodedExt.status).toBe(403);
    expect(await encodedExt.json()).toEqual({
      error: "extension_required",
      extension: DATA.name,
    });

    // Percent-encoded static segment `/api/account/%73ecret` requires `things:write`.
    const readOnly = signedIn(await x.signIn("things:read"));
    const encodedSecret = await x.call("/api/account/%73ecret", {
      access: readOnly.access_token,
    });
    expect(encodedSecret.status).toBe(403);
    expect(encodedSecret.headers.get("www-authenticate")).toContain(
      'scope="things:write"',
    );
    const encodedNestedSecret = await x.call("/api/account/items/a/%73ecret", {
      access: readOnly.access_token,
    });
    expect(encodedNestedSecret.status).toBe(403);
    expect(encodedNestedSecret.headers.get("www-authenticate")).toContain(
      'scope="things:write"',
    );

    // `%2F` is NOT decoded into an extra path segment: it stays inside `:id`
    // and never routes to `/api/account/items/:id/secret`.
    const encodedSlash = await x.call("/api/account/items/a%2Fsecret", {
      access: readOnly.access_token,
    });
    expect(encodedSlash.status).toBe(200);
    expect(await encodedSlash.json()).toEqual({ item: "a/secret" });

    // Percent-encoded `/%73ite/hello` still receives visitor tenancy isolation.
    const siteGet = await x.app.request("/%73ite/hello");
    expect(siteGet.status).toBe(200);
    const browserCookie = siteGet.headers
      .getSetCookie()
      .find((entry) => entry.includes("pap_browser="))
      ?.split(";")[0];
    expect(browserCookie).toBeDefined();
    expect(x.store.value.tenants[SHARED_TENANT]).toBeUndefined();
    const sitePost = await x.app.request("/%73ite/hello", {
      method: "POST",
      headers: { cookie: browserCookie!, origin },
    });
    expect(sitePost.status).toBe(200);
    expect(x.store.value.tenants[SHARED_TENANT]).toBeUndefined();
    const otherVisitor = await x.app.request("/site/hello");
    expect(await otherVisitor.json()).toEqual({ note: null });

    // Percent-encoded `/%6dcp` without Poppy-Session skips persistence writes like `/mcp`.
    const originalSave = x.store.save.bind(x.store);
    x.store.save = (changes) => {
      saves++;
      return originalSave(changes);
    };
    const mcpInit = await x.app.request("/%6dcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(mcpInit.status).toBe(200);
    expect(saves).toBe(0);
  });

  it("defaults PUT, PATCH and DELETE on account routes to readScope and writeScope when requiredScopes is absent", async () => {
    const x = await setup(
      {},
      {
        mount: (app) => {
          app.get("/api/account/item", (c) => c.json({ ok: "get" }));
          app.put("/api/account/item", (c) => c.json({ ok: "put" }));
          app.patch("/api/account/item", (c) => c.json({ ok: "patch" }));
          app.delete("/api/account/item", (c) => c.json({ ok: "delete" }));
        },
      },
    );
    const readOnly = signedIn(await x.signIn("things:read"));
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const denied = await x.call("/api/account/item", {
        method,
        access: readOnly.access_token,
      });
      expect(denied.status).toBe(403);
      expect(denied.headers.get("www-authenticate")).toContain(
        'scope="things:read things:write"',
      );
    }
    const writer = signedIn(await x.signIn("things:read things:write"));
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const allowed = await x.call("/api/account/item", {
        method,
        access: writer.access_token,
        session: newSessionId(),
      });
      expect(allowed.status).toBe(200);
    }
  });
});

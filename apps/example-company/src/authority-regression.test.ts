import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createIdentity,
  createSessionKey,
  newSessionId,
  signSessionHeader,
  assertion,
  proof,
  vault,
} from "@poppy-lab/pap-client";
import { emptyState } from "@poppy-lab/pap-company";
import { juniperApp } from "./test-app.js";
const disk = vi.hoisted(() => ({ fail: false, snapshot: "", directory: "" }));
vi.mock("@poppy-lab/pap-client", async (original) => {
  const actual = await original<typeof import("@poppy-lab/pap-client")>();
  return {
    ...actual,
    vault: (_name: string, initial: () => unknown) => {
      if (disk.directory) return actual.vault(_name, initial, disk.directory);
      const value = disk.snapshot ? JSON.parse(disk.snapshot) : initial();
      return {
        value,
        save() {
          if (disk.fail) throw Error("disk full");
          disk.snapshot = JSON.stringify(value);
        },
      };
    },
  };
});
const fetchJson = vi.fn();
// The mocked vault above: a durable snapshot, a failing disk, or a real directory.
const newStore = () => vault("juniper", emptyState);
const origin = "http://juniper.localhost:4100",
  client = "http://localhost:3000/agent/client.json",
  redirect = "http://localhost:3000/api/account/callback";
it.each([false, "1"])(
  "requires Operations v2 before returning operations (%s)",
  async (supported) => {
    const x = await setup(supported);
    try {
      expect(
        (await x.call(x.signed.access_token, "GET", "/api/account/profile"))
          .statusCode,
      ).toBe(200);
      for (const [method, url] of [
        ["POST", "/api/account/checkout"],
      ] as const) {
        const r = await x.call(
          x.signed.access_token,
          method,
          url,
          method === "POST" ? {} : undefined,
        );
        expect(r.statusCode).toBe(403);
        expect(r.json()).toMatchObject({
          error: "extension_required",
          extension: "operations",
        });
        expect(r.headers["www-authenticate"]).toContain(
          'extension="operations"',
        );
      }
    } finally {
      await x.app.close();
    }
  },
);
it("keeps one account per Session, continues signed out after revocation, and never mixes accounts", async () => {
  const x = await setup();
  try {
    const alex = x.signed.access_token;
    expect(
      (await x.call(alex, "GET", "/api/account/profile")).json().profile.name,
    ).not.toBe("Maya Sol");
    const maya = await x.sign("maya");
    // Sign-in doesn't know Sessions (0.3 §5.4): no session_id or signed_in.
    expect(maya).not.toHaveProperty("session_id");
    expect(maya).not.toHaveProperty("signed_in");
    // Reusing Alex's Session for Maya's token is refused.
    const mixed = await x.call(
      maya.access_token,
      "GET",
      "/api/account/profile",
      undefined,
      x.app,
      x.sidFor(alex),
    );
    expect(mixed.statusCode).toBe(400);
    expect(mixed.json()).toEqual({ error: "invalid_session" });
    expect(
      (await x.call(maya.access_token, "GET", "/api/account/profile")).json()
        .profile.name,
    ).toBe("Maya Sol");
    // Revoking Maya's refresh token ends its access tokens (RFC 7009 §2.1).
    await x.revoke(maya.refresh_token);
    expect(
      (await x.call(maya.access_token, "GET", "/api/account/profile"))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await x.token({
          grant_type: "refresh_token",
          refresh_token: maya.refresh_token,
        })
      ).json().error,
    ).toBe("invalid_grant");
    // The Session continues signed out.
    expect((await x.call("", "GET", "/api/products")).statusCode).toBe(200);
  } finally {
    await x.app.close();
  }
});
it("adds Retry-After to authorization rate limits", async () => {
  const x = await setup();
  try {
    const query = new URLSearchParams({
      client_id: client,
      redirect_uri: redirect,
      response_type: "code",
      state: "s".repeat(32),
      scope: "poppy:read poppy:write",
      code_challenge_method: "S256",
      code_challenge: "a".repeat(43),
    });
    let response = await x.app.inject("/oauth/authorize?" + query);
    for (let i = 0; i < 500 && response.statusCode !== 429; i++)
      response = await x.app.inject("/oauth/authorize?" + query);
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.json().error).toBe("rate_limited");
  } finally {
    await x.app.close();
  }
});
it("returns specific token errors and API challenges", async () => {
  const x = await setup();
  try {
    const base = {
      grant_type: "refresh_token",
      refresh_token: x.signed.refresh_token,
    };
    expect(
      (
        await x.token({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: "removed-in-0.3",
        })
      ).json().error,
    ).toBe("unsupported_grant_type");
    expect((await x.token({ ...base, scope: "admin" })).json().error).toBe(
      "invalid_scope",
    );
    expect((await x.token(base, true)).json().error).toBe("invalid_dpop_proof");
    expect(
      (
        await x.token({ ...base, resource: "https://unsupported.example" })
      ).json().error,
    ).toBe("invalid_target");
    const bad = await x.app.inject({
      url: "/api/account/profile",
      headers: { authorization: `DPoP ${x.signed.access_token}` },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: "invalid_session" });
    const out = await x.call(x.signedOut, "GET", "/api/account/profile");
    // RFC 6750 §3.1: a challenge with the needed scope, no error code.
    expect(out.statusCode).toBe(401);
    expect(out.headers["www-authenticate"]).toBe('DPoP scope="poppy:read"');
    const readonly = await x.refresh("poppy:read");
    const denied = await x.call(
      readonly.access_token,
      "POST",
      "/api/account/checkout",
      {},
    );
    expect(denied.headers["www-authenticate"]).toContain('scope="poppy:write"');
  } finally {
    await x.app.close();
  }
});
it("recovers a committed checkout after a real socket loss by resending the same approval, never a second order", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "juniper-lost-response-"));
  disk.directory = directory;
  let x: Awaited<ReturnType<typeof setup>> | undefined;
  let restored: ReturnType<typeof juniperApp> | undefined;
  try {
    x = await setup(true, true);
    const proposal = (
      await x.call(x.signed.access_token, "POST", "/api/account/checkout", {})
    ).json().operation;
    expect(proposal.operation_id).toBeTruthy();
    const address = await x.app.listen({ host: "127.0.0.1", port: 0 });
    // The approved request commits, then the socket dies before the response.
    await expect(x.approveOverNetwork(address, proposal)).rejects.toThrow();
    await x.app.close();
    restored = juniperApp({ fetchJson, store: newStore() });
    // §7: resending the same approval returns the first response.
    const first = await x.call(
      x.signed.access_token,
      "POST",
      "/api/account/checkout",
      {},
      restored,
      undefined,
      proposal,
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().operation_id).toBe(proposal.operation_id);
    const again = await x.call(
      x.signed.access_token,
      "POST",
      "/api/account/checkout",
      {},
      restored,
      undefined,
      proposal,
    );
    expect(again.json()).toEqual(first.json());
    expect(
      (
        await x.call(
          x.signed.access_token,
          "GET",
          "/api/account/orders",
          undefined,
          restored,
        )
      ).json().orders,
    ).toHaveLength(1);
  } finally {
    await x?.app.close();
    await restored?.close();
    disk.directory = "";
    rmSync(directory, { recursive: true, force: true });
  }
});
it("revises checkout with the same operation_id from a new Session, keeps accounts isolated and survives restart", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "juniper-revisions-"));
  disk.directory = directory;
  let x: Awaited<ReturnType<typeof setup>> | undefined,
    restored: ReturnType<typeof juniperApp> | undefined;
  try {
    x = await setup();
    const access = x.signed.access_token;
    const first = (
      await x.call(access, "POST", "/api/account/checkout", { day: "Thursday" })
    ).json().operation;
    // A new Session (new sid) of the same account can see and approve it.
    x.newSession();
    const second = (
      await x.call(access, "POST", "/api/account/checkout", { day: "Saturday" })
    ).json().operation;
    expect(second.operation_id).toBe(first.operation_id);
    expect(second.revision).not.toBe(first.revision);
    expect(second.terms.delivery_day).toBe("Saturday");
    // Another account never gets this operation, whatever it approves.
    const foreign = (await x.sign("maya")).access_token;
    const stolen = await x.call(
      foreign,
      "POST",
      "/api/account/checkout",
      { day: "Saturday" },
      x.app,
      undefined,
      second,
    );
    expect(stolen.statusCode).toBe(403);
    expect(stolen.json().operation.operation_id).not.toBe(first.operation_id);
    // A read-only token can't even receive the operation.
    const read = (
      await x.token({
        grant_type: "refresh_token",
        refresh_token: x.signed.refresh_token,
        scope: "poppy:read",
      })
    ).json().access_token;
    expect(
      (
        await x.call(
          read,
          "POST",
          "/api/account/checkout",
          { day: "Saturday" },
          x.app,
          undefined,
          second,
        )
      ).json().error,
    ).toBe("insufficient_scope");
    expect(
      (await x.call(access, "GET", "/api/account/orders")).json().orders,
    ).toEqual([]);
    await x.app.close();
    restored = juniperApp({ fetchJson, store: newStore() });
    const done = await x.call(
      access,
      "POST",
      "/api/account/checkout",
      { day: "Saturday" },
      restored,
      undefined,
      second,
    );
    expect(done.statusCode).toBe(200);
    expect(done.json().data).toMatchObject({
      delivery_day: "Saturday",
      total_cents: second.terms.total_cents,
    });
    expect(
      (
        await x.call(access, "GET", "/api/account/orders", undefined, restored)
      ).json().orders,
    ).toHaveLength(1);
  } finally {
    await x?.app.close();
    await restored?.close();
    disk.directory = "";
    rmSync(directory, { recursive: true, force: true });
  }
});
it("limits consent to requested scopes, upgrades explicitly and preserves old-token authority and independent revocation", async () => {
  const x = await setup(true, false, "poppy:read");
  try {
    const read = x.signed;
    expect(read.scope).toBe("poppy:read");
    expect(
      (await x.call(read.access_token, "GET", "/api/account/orders"))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await x.call(read.access_token, "POST", "/api/account/checkout", {
          day: "Saturday",
        })
      ).statusCode,
    ).toBe(403);
    const expanded = await x.sign("alex", true);
    expect(expanded.scope).toBe("poppy:read poppy:write");
    expect(
      (await x.call(read.access_token, "POST", "/api/account/checkout", {}))
        .statusCode,
    ).toBe(403);
    expect(await x.refresh("poppy:write")).toMatchObject({
      error: "invalid_scope",
    });
    const proposal = (
      await x.call(expanded.access_token, "POST", "/api/account/checkout", {
        day: "Saturday",
      })
    ).json().operation;
    expect(
      (await x.call(expanded.access_token, "GET", "/api/account/orders")).json()
        .orders,
    ).toEqual([]);
    await x.revoke();
    expect(
      (await x.call(read.access_token, "GET", "/api/account/orders"))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await x.call(
          expanded.access_token,
          "POST",
          "/api/account/checkout",
          { day: "Saturday" },
          x.app,
          undefined,
          proposal,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await x.call(expanded.access_token, "GET", "/api/account/orders")).json()
        .orders,
    ).toHaveLength(1);
  } finally {
    await x.app.close();
  }
});
async function setup(
  supportsOperations: boolean | string = true,
  dropResponse = false,
  initialScope = "poppy:read poppy:write",
) {
  disk.fail = false;
  disk.snapshot = "";
  const keys = await createIdentity(),
    dpop = await createIdentity();
  fetchJson.mockImplementation(async (url) =>
    url.endsWith("client.json")
      ? {
          client_id: client,
          jwks_uri: "http://localhost:3000/agent/jwks.json",
          extensions: supportsOperations
            ? {
                operations: {
                  version:
                    typeof supportsOperations === "string"
                      ? supportsOperations
                      : "2",
                },
              }
            : {},
        }
      : { keys: [keys.publicKey] },
  );
  const app = juniperApp({
    fetchJson,
    store: newStore(),
    // Over the network, lose the response after the approved change commits.
    ...(dropResponse
      ? {
          drop: (request: Request, response: Response) =>
            !!request.headers.get("poppy-approval") && response.status === 200,
        }
      : {}),
  });
  const token = async (body: Record<string, string>, badProof = false) =>
    app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: {
        DPoP: badProof
          ? "invalid"
          : await proof(dpop.privateKey, `${origin}/oauth/token`, "POST"),
      },
      payload: {
        ...body,
        client_id: client,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await assertion(
          keys.privateKey,
          client,
          client,
          origin,
        ),
      },
    });
  // PAP 0.3: a Session is the agent's sid in a delegated Session header.
  const sessionKey = await createSessionKey(keys.privateKey, client);
  let session_id = newSessionId();
  const newSession = () => (session_id = newSessionId());
  // An agent uses one Session per account (0.3 §5.4): map tokens to sids.
  const accountSids = new Map<string, string>([["alex", session_id]]);
  const tokenSids = new Map<string, string>();
  const verifier = "v".repeat(64);
  const sign = async (
    account = "alex",
    _fresh = false,
    scope = "poppy:read poppy:write",
  ) => {
    const page = await app.inject(
      `/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", state: "s".repeat(32), scope, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") })}`,
    );
    for (const phrase of [
      "Profile, address",
      "simulated billing documents",
      "Support cases and their messages",
      ...(scope.includes("poppy:write")
        ? ["Each change needs your separate approval"]
        : ["Read only."]),
    ])
      expect(page.body).toContain(phrase);
    const cookie = String(page.headers["set-cookie"]).split(";")[0]!;
    const consent = await app.inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { cookie, origin },
      payload: {
        nonce: cookie.split("=")[1],
        decision: "approve",
        write: "yes",
        account,
      },
    });
    const code = new URL(String(consent.headers.location)).searchParams.get(
      "code",
    )!;
    const result = (
      await token({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
      })
    ).json();
    if (!accountSids.has(account)) accountSids.set(account, newSessionId());
    tokenSids.set(result.access_token, accountSids.get(account)!);
    return result;
  };
  const signed = await sign("alex", false, initialScope);
  const call = async (
    access: string,
    method: "GET" | "POST",
    url: string,
    payload?: Record<string, unknown>,
    server = app,
    sid = (access && tokenSids.get(access)) || session_id,
    approval?: { operation_id: string; revision: string },
  ) =>
    server.inject({
      method,
      url,
      headers: {
        ...(approval
          ? {
              "Poppy-Approval": `operation_id="${approval.operation_id}", revision="${approval.revision}"`,
            }
          : {}),
        "Poppy-Session": await signSessionHeader({
          key: sessionKey,
          clientId: client,
          audience: origin,
          sessionId: sid,
          userId: "user",
          method,
          url: origin + url,
          ...(access ? { accessToken: access } : {}),
        }),
        ...(access
          ? {
              Authorization: `DPoP ${access}`,
              DPoP: await proof(dpop.privateKey, origin + url, method, access),
            }
          : {}),
      },
      ...(payload ? { payload } : {}),
    });
  return {
    app,
    token,
    signedOut: "",
    newSession,
    sidFor: (access: string) => tokenSids.get(access) ?? session_id,
    approveOverNetwork: async (
      address: string,
      op: { operation_id: string; revision: string },
    ) =>
      fetch(address + "/api/account/checkout", {
        method: "POST",
        headers: {
          "Poppy-Session": await signSessionHeader({
            key: sessionKey,
            clientId: client,
            audience: origin,
            sessionId: session_id,
            userId: "user",
            method: "POST",
            url: origin + "/api/account/checkout",
            accessToken: signed.access_token,
          }),
          Authorization: `DPoP ${signed.access_token}`,
          DPoP: await proof(
            dpop.privateKey,
            origin + "/api/account/checkout",
            "POST",
            signed.access_token,
          ),
          "Poppy-Approval": `operation_id="${op.operation_id}", revision="${op.revision}"`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }).then((r) => r.text()),
    sign,
    signed,
    call,
    refresh: async (scope?: string) =>
      (
        await token({
          grant_type: "refresh_token",
          refresh_token: signed.refresh_token,
          ...(scope === undefined ? {} : { scope }),
        })
      ).json(),
    revoke: async (token = signed.refresh_token) =>
      app.inject({
        method: "POST",
        url: "/oauth/revoke",
        payload: {
          client_id: client,
          token,
          client_assertion: await assertion(
            keys.privateKey,
            client,
            client,
            origin,
          ),
        },
      }),
  };
}
it("isolates profiles, orders, cases, Operations and browser grant revocation across personas", async () => {
  const x = await setup();
  try {
    const alex = x.signed.access_token;
    const orderOp = (
      await x.call(alex, "POST", "/api/account/checkout", { day: "Saturday" })
    ).json().operation;
    const result = (
      await x.call(
        alex,
        "POST",
        "/api/account/checkout",
        { day: "Saturday" },
        x.app,
        undefined,
        orderOp,
      )
    ).json();
    const orderId = result.data.id;
    const caseOp = (
      await x.call(alex, "POST", "/api/account/case-proposal", {
        subject: "Alex only",
        topic: "delivery",
        message: "Fictional",
        order_id: orderId,
      })
    ).json().operation;
    const incident = (
      await x.call(
        alex,
        "POST",
        "/api/account/case-proposal",
        {
          subject: "Alex only",
          topic: "delivery",
          message: "Fictional",
          order_id: orderId,
        },
        x.app,
        undefined,
        caseOp,
      )
    ).json().data;
    const maya = (await x.sign("maya")).access_token;
    expect(
      (await x.call(maya, "GET", "/api/account/profile")).json().profile.name,
    ).toBe("Maya Sol");
    expect(
      (await x.call(alex, "GET", "/api/account/profile")).json().profile.name,
    ).toBe("Alex Rivers");
    for (const path of [
      `/api/account/orders/${orderId}`,
      `/api/account/cases/${incident.id}`,
    ])
      expect((await x.call(maya, "GET", path)).statusCode).toBe(404);
    // Alex's approvals never replay or perform anything for Maya.
    for (const [url, op, body] of [
      ["/api/account/checkout", orderOp, { day: "Saturday" }],
      [
        "/api/account/case-proposal",
        caseOp,
        { subject: "Alex only", topic: "delivery", message: "Fictional" },
      ],
    ] as const) {
      const replayed = await x.call(
        maya,
        "POST",
        url,
        body,
        x.app,
        undefined,
        op,
      );
      expect(replayed.statusCode).not.toBe(200);
      expect(replayed.json().operation?.operation_id).not.toBe(op.operation_id);
    }
    expect(
      (
        await x.call(maya, "POST", "/api/account/case-proposal", {
          subject: "No access",
          topic: "delivery",
          message: "Test",
          order_id: orderId,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await x.call(maya, "GET", "/api/account/orders")).json().orders,
    ).toEqual([]);
    expect(
      (await x.call(maya, "GET", "/api/account/cases")).json().cases,
    ).toEqual([]);
    expect(
      (await x.call(maya, "GET", "/api/account/invoices")).json().invoices,
    ).toEqual([]);
    const login = async (account: string) => {
      const start = await x.app.inject("/site/login");
      const response = await x.app.inject({
        method: "POST",
        url: "/site/login",
        headers: {
          origin,
          cookie: String(start.headers["set-cookie"]).split(";")[0]!,
        },
        payload: { account },
      });
      return (response.headers["set-cookie"] as string[])
        .find((v) => v.startsWith("juniper_web="))!
        .split(";")[0]!;
    };
    const mayaCookie = await login("maya"),
      alexCookie = await login("alex");
    expect(
      (
        await x.app.inject({
          url: "/site/state",
          headers: { cookie: mayaCookie },
        })
      ).json().account_id,
    ).toBe("maya");
    const grants = (
      await x.app.inject({
        url: "/site/access",
        headers: { cookie: alexCookie },
      })
    ).json().grants;
    expect(grants).toHaveLength(1);
    expect(JSON.stringify(grants)).not.toContain(x.signed.refresh_token);
    const revoke = "/site/access/" + grants[0].id + "/revoke";
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: revoke,
          headers: { cookie: mayaCookie, origin, "x-juniper-account": "maya" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: revoke,
          headers: {
            cookie: alexCookie,
            origin: "https://evil.example",
            "x-juniper-account": "alex",
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/site/profile",
          headers: { cookie: mayaCookie, origin, "x-juniper-account": "alex" },
          payload: {
            version: 1,
            name: "Wrong draft",
            email: "wrong@example.invalid",
            address: "Fictional",
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: revoke,
          headers: { cookie: alexCookie, origin, "x-juniper-account": "alex" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await x.call(alex, "GET", "/api/account/profile")).statusCode).toBe(
      401,
    );
    expect((await x.call(maya, "GET", "/api/account/profile")).statusCode).toBe(
      200,
    );
    expect((await x.refresh()).error).toBe("invalid_grant");
    expect(
      (
        await x.app.inject({
          url: "/site/state",
          headers: { cookie: alexCookie },
        })
      ).statusCode,
    ).toBe(200);
    const leo = (await x.sign("leo", true)).access_token;
    expect(
      (await x.call(leo, "GET", "/api/account/profile")).json().profile.name,
    ).toBe("Leo Mar");
    expect(
      (await x.call(leo, "GET", `/api/account/orders/${orderId}`)).statusCode,
    ).toBe(404);
  } finally {
    await x.app.close();
  }
});
it("keeps token scopes immutable and enforces read scope independently of write", async () => {
  const x = await setup();
  try {
    const limited = await x.refresh("poppy:write");
    expect(
      (await x.call(limited.access_token, "GET", "/api/account/profile"))
        .statusCode,
    ).toBe(403);
    const reduced = await x.refresh("poppy:read");
    const write = () =>
      x.call(reduced.access_token, "POST", "/api/account/basket-change", {
        product_id: "coffee",
        quantity: 2,
      });
    expect((await write()).statusCode).toBe(403);
    await x.refresh();
    expect((await write()).statusCode).toBe(403);
    expect(
      (await x.call(reduced.access_token, "GET", "/api/account/profile"))
        .statusCode,
    ).toBe(200);
  } finally {
    await x.app.close();
  }
});
it("binds old tokens to their original grant across reconsent and revocation", async () => {
  const x = await setup();
  try {
    const newer = await x.sign();
    await x.revoke();
    expect(
      (await x.call(x.signed.access_token, "GET", "/api/account/profile"))
        .statusCode,
    ).toBe(401);
    expect(
      (await x.call(newer.access_token, "GET", "/api/account/profile"))
        .statusCode,
    ).toBe(200);
  } finally {
    await x.app.close();
  }
});
it("latches storage failure, never commits dirty memory later, and recovers only from durable state on restart", async () => {
  const x = await setup();
  try {
    const op = (
      await x.call(
        x.signed.access_token,
        "POST",
        "/api/account/basket-change",
        { product_id: "coffee", quantity: 2 },
      )
    ).json().operation;
    const durable = disk.snapshot;
    disk.fail = true;
    expect(
      (
        await x.call(
          x.signed.access_token,
          "POST",
          "/api/account/basket-change",
          { product_id: "coffee", quantity: 2 },
          x.app,
          undefined,
          op,
        )
      ).statusCode,
    ).toBe(503);
    disk.fail = false;
    expect((await x.app.inject("/site/state")).statusCode).toBe(503);
    expect(
      (await x.call(x.signed.access_token, "GET", "/api/account/basket"))
        .statusCode,
    ).toBe(503);
    expect(disk.snapshot).toBe(durable);
    const restarted = juniperApp({ fetchJson, store: newStore() });
    try {
      expect(
        (
          await x.call(
            x.signed.access_token,
            "GET",
            "/api/account/basket",
            undefined,
            restarted,
          )
        )
          .json()
          .items.find((p: { id: string }) => p.id === "coffee").quantity,
      ).toBe(1);
    } finally {
      await restarted.close();
    }
  } finally {
    disk.fail = false;
    await x.app.close();
  }
});

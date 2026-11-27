/**
 * A browser join with an access token (§6): the token needs
 * `poppy:browser-sign-in`, which a consent grants only on its own line. The
 * joined browser is then signed in to the token's account with the token's
 * scopes, for as long as the Session and the grant last, and can change
 * nothing on the website. A customer's own browser is left as it was.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { newSessionId } from "@poppy-lab/pap-client/core";
import {
  authorize,
  browser,
  BROWSER_SCOPE,
  copyOf,
  error,
  join,
  JOIN,
  later,
  page,
  parse,
  SESSION,
  site,
  submit,
  type Lab,
} from "./test-browser.ts";
import { client, redirect, setup } from "./test-company.ts";
import { SESSION_MS, type Deployment } from "./types.ts";

afterEach(() => {
  vi.useRealTimers();
});

/** One copy for everyone, and a copy for each agent user. */
const modes: Array<[string, Partial<Deployment>]> = [
  ["one copy for everyone", {}],
  ["a copy per visitor", { isolation: "visitor" }],
];
/** A sign-in that asks for the scope, with its line left allowed. */
async function signIn(
  x: Lab,
  scope = "things:read",
  consent: Record<string, string> = {},
  approver?: string,
) {
  const tokens = await x.signIn(
    `${scope} ${BROWSER_SCOPE}`,
    { allow_browser: "yes", ...consent },
    approver,
  );
  if ("refused" in tokens) throw new Error("refused");
  return tokens;
}
/** The agent revokes its refresh token, which is how it signs out (§5.5). */
const revoke = async (x: Lab, token: string) =>
  x.form("/oauth/revoke", { token, ...(await x.credentials()) });
/** Joined, and not signed in. */
const signedOut = { account: null, join: { scopes: [] } };
const REFUSAL =
  "This browser belongs to an agent's session, so it can't change anything at Test Company. Changes are made through the agent and wait for your approval there. Nothing has changed.";

// ---- The scope -------------------------------------------------------------

it("lists poppy:browser-sign-in with the Company's scopes", async () => {
  const x = await setup();
  for (const document of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
  ]) {
    const metadata = (await (await x.app.request(document)).json()) as {
      scopes_supported: string[];
    };
    expect(metadata.scopes_supported).toEqual([
      "things:read",
      "things:write",
      BROWSER_SCOPE,
    ]);
  }
  // A Company that names it among its own scopes lists it once.
  const y = await setup(
    {},
    { scopes: ["things:read", BROWSER_SCOPE, "things:write"] },
  );
  const listed = (await (
    await y.app.request("/.well-known/oauth-protected-resource")
  ).json()) as { scopes_supported: string[] };
  expect(listed.scopes_supported.filter((s) => s === BROWSER_SCOPE)).toEqual([
    BROWSER_SCOPE,
  ]);
});

it("grants the scope only when the agent asks for it and its line is left allowed", async () => {
  const shown: string[] = [];
  const asked: string[][] = [];
  const x = await setup(
    {},
    {
      consent: ({ nonce, scopes }) => {
        shown.push(scopes);
        return `<p>${nonce}</p>`;
      },
      // The Company's own choice is among its own scopes only.
      selectScopes: ({ requested }) => {
        asked.push(requested);
        return requested;
      },
    },
  );
  const scope = async (
    requested: string,
    consent: Record<string, string> = {},
  ) => {
    const tokens = await x.signIn(requested, consent);
    return "refused" in tokens ? tokens.refused.status : tokens.scope;
  };
  const both = `things:read ${BROWSER_SCOPE}`;
  expect(await scope(both, { allow_browser: "yes" })).toBe(both);
  // The consent page is told, so it can show the line.
  expect(shown).toEqual([both]);
  // Unticked, the rest is granted.
  expect(await scope(both)).toBe("things:read");
  expect(await scope(both, { allow_browser: "no" })).toBe("things:read");
  // Not asked for, a form that posts the field gets nothing more.
  expect(await scope("things:read", { allow_browser: "yes" })).toBe(
    "things:read",
  );
  // Alone: granted alone, or nothing to grant.
  expect(await scope(BROWSER_SCOPE, { allow_browser: "yes" })).toBe(
    BROWSER_SCOPE,
  );
  expect(await scope(BROWSER_SCOPE)).toBe(400);
  expect(asked.flat()).not.toContain(BROWSER_SCOPE);
});

it("refuses at step 2 an access token without the scope, and leaves the code for a join without one", async () => {
  const x = await setup();
  const tokens = await x.signIn("things:read things:write");
  if ("refused" in tokens) throw new Error("refused");
  const { code, cookie } = await page(x);
  const signedIn = await authorize(x, code, { access: tokens.access_token });
  // §6: as at an API (§7), naming the scope that is missing.
  expect(signedIn.status).toBe(403);
  expect(await error(signedIn)).toBe("insufficient_scope");
  expect(signedIn.headers.get("www-authenticate")).toBe(
    'DPoP error="insufficient_scope", scope="poppy:browser-sign-in"',
  );
  expect(x.store.value.joins ?? {}).toEqual({});
  expect((await authorize(x, code)).status).toBe(204);
  expect((await submit(x, code, cookie)).status).toBe(303);
  // The joined browser is tied to no account.
  const [record] = Object.values(x.store.value.browsers!);
  expect(record).not.toHaveProperty("account");
});

// ---- The signed-in join ----------------------------------------------------

describe.each(modes)("with %s", (_, deploy) => {
  it("signs the joined browser in to the token's account, with the token's scopes", async () => {
    const x = await setup(deploy, site);
    const mine = await copyOf(x);
    const tokens = await signIn(x, "things:read things:write");
    const b = browser(x);
    const joined = await join(x, b, { access: tokens.access_token });
    expect(joined.status).toBe(303);
    expect([...b.jar.keys()]).toEqual([SESSION]);
    expect(await b.state()).toEqual({
      account: "elena",
      join: {
        account: "elena",
        scopes: ["things:read", "things:write", BROWSER_SCOPE],
      },
      copy: mine,
      notes: [],
    });
    // The token itself is nowhere near the browser or its record.
    const stored = JSON.stringify(x.store.value.browsers);
    expect(stored).not.toContain(tokens.access_token);
    expect(stored).not.toContain(tokens.refresh_token);
    // A browser that didn't join is nobody.
    expect(await browser(x).state()).toMatchObject({
      account: null,
      join: null,
    });
  });

  it("acts with the token's scopes and the grant's resources, not more", async () => {
    const x = await setup(deploy, {
      ...site,
      selectResources: () => ["r1", "r2"],
    });
    const wide = await signIn(x, "things:read things:write");
    // A token the agent asked to be narrower than its grant.
    const narrow = await x.token({
      grant_type: "refresh_token",
      refresh_token: wide.refresh_token,
      scope: `things:read ${BROWSER_SCOPE}`,
    });
    const b = browser(x);
    await join(x, b, { access: narrow.access_token });
    expect((await b.state()).join).toEqual({
      account: "elena",
      scopes: ["things:read", BROWSER_SCOPE],
      resources: ["r1", "r2"],
    });
    // Without the scope, the narrower token signs no browser in.
    const without = await x.token({
      grant_type: "refresh_token",
      refresh_token: wide.refresh_token,
      scope: "things:read",
    });
    const refused = await authorize(x, await browser(x).load(), {
      access: without.access_token,
    });
    expect(refused.status).toBe(403);
  });

  it("keeps one account for a Session", async () => {
    const x = await setup(deploy, site);
    const elena = await signIn(x);
    const tomas = await signIn(x, "things:read", { account: "tomas" });
    const b = browser(x);
    await join(x, b, { access: elena.access_token });
    // §5.4: a second account in the same Session ends it for that request.
    const code = await b.load();
    const second = await authorize(x, code, { access: tomas.access_token });
    expect(second.status).toBe(400);
    expect(await error(second)).toBe("session_ended");
    expect((await b.state()).account).toBe("elena");
    // In a Session of its own, the other account joins a browser.
    const other = browser(x);
    const session = newSessionId();
    await join(x, other, { access: tomas.access_token, session });
    expect((await other.state()).account).toBe("tomas");
    expect((await b.state()).account).toBe("elena");
  });

  it("signs the browser in in place of a login it had, which doesn't come back", async () => {
    const x = await setup(deploy, site);
    const tokens = await signIn(x);
    const b = browser(x, { web: "abc" });
    await b.post("/site/login?as=tomas");
    expect((await b.state()).account).toBe("tomas");
    const before = Object.fromEntries(b.jar);

    const joined = await join(x, b, { access: tokens.access_token });
    expect(joined.status).toBe(303);
    // The Session's cookie, and the two it ends: the join's and the login's.
    const cookies = joined.headers.getSetCookie().map(parse);
    expect(cookies.map((c) => c.name).sort()).toEqual([JOIN, SESSION, "web"]);
    expect(b.jar.has("web")).toBe(false);
    expect((await b.state()).account).toBe("elena");
    // The login is gone where it was made, even for its old cookie.
    expect(await browser(x, before).state()).toMatchObject({
      account: null,
      join: null,
    });
    // §6: when the Session's sign-in ends the browser is signed out, not
    // back in its earlier login.
    await revoke(x, tokens.refresh_token);
    expect(await b.state()).toMatchObject(signedOut);
    b.jar.set("web", "abc");
    expect(await b.state()).toMatchObject(signedOut);
  });

  it("signs the browser out at once when the agent signs out", async () => {
    const x = await setup(deploy, site);
    const mine = await copyOf(x);
    const tokens = await signIn(x);
    const b = browser(x);
    await join(x, b, { access: tokens.access_token });
    expect((await b.state()).account).toBe("elena");
    expect((await revoke(x, tokens.refresh_token)).status).toBe(200);
    // Still the Session's browser, on the same copy, and nobody's account.
    expect(await b.state()).toMatchObject({ ...signedOut, copy: mine });
  });

  it("signs the browser out at once when the customer disconnects the agent on the website", async () => {
    const x = await setup(deploy, site);
    // The customer's own browser, which approved the consent.
    const customer = browser(x, { web: "abc" });
    await customer.post("/site/login");
    const approver = customer.jar.get("__Host-pap_browser");
    const tokens = await signIn(
      x,
      "things:read",
      {},
      approver ? `__Host-pap_browser=${approver}` : undefined,
    );
    const b = browser(x);
    await join(x, b, { access: tokens.access_token });
    expect((await b.state()).account).toBe("elena");

    const [grant] = (await (
      await customer.get("/site/agents")
    ).json()) as Array<{ id: string }>;
    const gone = await customer.post(`/site/agents/${grant!.id}/revoke`);
    expect(await gone.json()).toEqual({ revoked: true });
    expect(await b.state()).toMatchObject(signedOut);
  });

  it("signs the browser out when the grant ends, and the join ends with the Session", async () => {
    const x = await setup(deploy, { ...site, grantLifetime: () => 600000 });
    const mine = await copyOf(x);
    const tokens = await signIn(x);
    const b = browser(x);
    await join(x, b, { access: tokens.access_token });
    expect((await b.state()).account).toBe("elena");
    // Ten minutes on the grant is over; the Session isn't.
    later(601000);
    expect(await b.state()).toMatchObject({ ...signedOut, copy: mine });
    // Then the Session: the browser is no longer joined at all.
    later(SESSION_MS);
    expect(await b.state()).toMatchObject({ account: null, join: null });
  });

  it("signs the browser out when the agent joins it again without a token", async () => {
    const x = await setup(deploy, site);
    const tokens = await signIn(x);
    const b = browser(x);
    await join(x, b, { access: tokens.access_token });
    expect((await b.state()).account).toBe("elena");
    expect((await join(x, b)).status).toBe(303);
    expect(await b.state()).toMatchObject(signedOut);
    expect(Object.keys(x.store.value.browsers!)).toHaveLength(1);
  });

  // ---- Read only -----------------------------------------------------------

  it("refuses every change from a joined browser, signed in or not", async () => {
    const x = await setup(deploy, site);
    const tokens = await signIn(x, "things:read things:write");
    const signedIn = browser(x);
    await join(x, signedIn, { access: tokens.access_token });
    const out = browser(x);
    await join(x, out, { session: newSessionId() });
    const grants = structuredClone(x.store.value.grants);
    // Every writing route of the website, one that doesn't exist yet, and
    // the consent page, where a joined browser could allow its own agent.
    const writes: Array<[string, string]> = [
      ["POST", "/site/notes"],
      ["PUT", "/site/notes/1"],
      ["PATCH", "/site/notes/1"],
      ["DELETE", "/site/notes/1"],
      ["POST", "/account"],
      ["POST", "/site/login"],
      ["POST", "/site/logout"],
      ["POST", `/site/agents/${Object.values(grants)[0]!.id}/revoke`],
      ["POST", "/site/added-later"],
      ["POST", "/oauth/authorize"],
    ];
    for (const b of [signedIn, out])
      for (const [method, path] of writes) {
        const r = await b.send(method, path);
        expect([method, path, r.status]).toEqual([method, path, 403]);
        expect(await r.json()).toEqual({
          error: "read_only_browser",
          error_description: REFUSAL,
        });
        expect(r.headers.get("cache-control")).toBe("no-store");
        expect(r.headers.getSetCookie()).toEqual([]);
      }
    // A form gets a page that says the same.
    const form = await signedIn.post("/site/notes", {}, "text/html");
    expect(form.status).toBe(403);
    expect(form.headers.get("content-type")).toContain("text/html");
    expect(await form.text()).toContain(
      `<p>${REFUSAL.replace(/'/g, "&#39;")}</p>`,
    );
    // Nothing changed: no note, no login, the agent still connected, and
    // both browsers as they were. Reading still works.
    expect(await signedIn.state()).toMatchObject({
      account: "elena",
      notes: [],
    });
    expect(await out.state()).toMatchObject({ ...signedOut, notes: [] });
    expect(x.store.value.grants).toEqual(grants);
    // The one form a joined browser posts is the join's own.
    expect((await join(x, signedIn)).status).toBe(303);
  });

  it("leaves a customer's own browser with everything it could do", async () => {
    const x = await setup(deploy, site);
    const customer = browser(x, { web: "abc" });
    await customer.post("/site/login");
    const approver = customer.jar.get("__Host-pap_browser");
    const tokens = await signIn(
      x,
      "things:read",
      {},
      approver ? `__Host-pap_browser=${approver}` : undefined,
    );
    const mine = (
      (await (
        await x.call("/api/copy", { access: tokens.access_token })
      ).json()) as { copy: string }
    ).copy;
    const b = browser(x);
    await join(x, b, { access: tokens.access_token });

    // Same copy, same customer; the customer's browser isn't a Session's.
    expect(await customer.state()).toMatchObject({
      account: "elena",
      join: null,
      copy: mine,
    });
    expect((await customer.send("POST", "/site/notes")).status).toBe(200);
    expect((await customer.send("DELETE", "/site/notes/1")).status).toBe(200);
    // The agent's browser reads what the customer wrote, and adds nothing.
    expect((await b.send("POST", "/site/notes")).status).toBe(403);
    expect((await b.state()).notes).toEqual([
      "POST /site/notes",
      "DELETE /site/notes/1",
    ]);
    // Logging out is the customer's too, and ends only their login.
    expect((await customer.post("/site/logout")).status).toBe(204);
    expect((await customer.state()).account).toBeNull();
    expect((await b.state()).account).toBe("elena");
  });
});

it("never shows a joined browser another agent user's copy or account", async () => {
  const x = await setup({ isolation: "visitor" }, site);
  const elena = await signIn(x);
  const other = { user: "usr_b", session: newSessionId() };
  const tomas = await signIn(x, "things:read", { account: "tomas" });
  const first = browser(x);
  await join(x, first, { access: elena.access_token });
  const second = browser(x);
  await join(x, second, { ...other, access: tomas.access_token });
  const mine = await copyOf(x);
  const theirs = await copyOf(x, "usr_b");
  expect(theirs).not.toBe(mine);
  expect(await first.state()).toMatchObject({ account: "elena", copy: mine });
  expect(await second.state()).toMatchObject({
    account: "tomas",
    copy: theirs,
  });
  // A grant serves the agent user that first used it: the other User's
  // Session can't sign a browser in with it.
  const stolen = await authorize(x, await browser(x).load(), {
    ...other,
    session: newSessionId(),
    access: elena.access_token,
  });
  expect(stolen.status).toBe(401);
  expect(await error(stolen)).toBe("invalid_token");
});

it("asks for the scope in a sign-in pushed with PAR as well", async () => {
  const x = await setup();
  const par = await x.form("/oauth/par", {
    response_type: "code",
    redirect_uri: redirect,
    scope: `things:read ${BROWSER_SCOPE}`,
    state: "s".repeat(32),
    code_challenge: "c".repeat(43),
    code_challenge_method: "S256",
    ...(await x.credentials()),
  });
  expect(par.status).toBe(201);
  const { request_uri } = (await par.json()) as { request_uri: string };
  const consent = await x.app.request(
    `/oauth/authorize?${new URLSearchParams({ client_id: client, request_uri })}`,
  );
  expect(consent.status).toBe(200);
  const [pending] = Object.values(x.store.value.consents!);
  expect(pending!.scopes).toBe(`things:read ${BROWSER_SCOPE}`);
});

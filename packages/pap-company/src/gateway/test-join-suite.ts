/**
 * TEST ONLY. What every Company on the gateway does with an agent's browser
 * (§6), as one suite each Company runs with its own account page: the
 * endpoint and the scope are listed, the consent page gives the scope its
 * own line, a joined browser is signed in read only and sees what the
 * token's read scopes cover, every route that writes refuses it, and a
 * customer's own browser keeps everything it had.
 */
import { describe, expect, it } from "vitest";
import { AGENT_BROWSER_LOGIN, agentBrowserNotice } from "../site-viewer.ts";
import {
  browser,
  BROWSER_SCOPE,
  join,
  PAGE,
  websiteLogin,
  websitePath,
  writingRoutes,
  type Lab,
} from "./test-browser.ts";
import { client, origin, redirect, setup } from "./test-company.ts";
import type { CompanyDefinition, Deployment } from "./types.ts";

export type JoinSuite = {
  company: CompanyDefinition;
  /** The Company as its scope description names it: "Lantern". */
  name: string;
  /** A test customer, and the header its page's script names it with. */
  account: string;
  accountHeader: string;
  /** Every scope of the Company's own that the widest token here has. */
  scopes: string;
  /** What its consent form posts besides the gateway's fields. */
  consent?: Record<string, string>;
  /**
   * The parts of the account page an agent's browser sees with a scope:
   * its name on the page's notice, the scope, the ids of its elements, and
   * the fields of `/site/state` it fills with what they hold without it.
   */
  parts: Array<{
    name: string;
    scope: string;
    ids: string[];
    state: Record<string, unknown>;
  }>;
  /** Ids only a customer's own browser gets: its controls and its agents. */
  own: string[];
  /** Fields of `/site/state` that are the customer's own. */
  ownState: string[];
  /** Every route of the website that writes, so a new one is noticed. */
  writes: Array<[string, string]>;
};

const html = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const modes: Array<[string, Partial<Deployment>]> = [
  ["a copy per visitor", { isolation: "visitor" }],
  ["one copy for everyone", {}],
];

export function browserJoinSuite(suite: JoinSuite) {
  const { company, account } = suite;
  const lab = (deploy: Partial<Deployment> = { isolation: "visitor" }) =>
    setup(deploy, company);
  /** A sign-in for `scopes` and the browser's own, as the customer allows it. */
  const signIn = async (x: Lab, scopes = suite.scopes, approver?: string) => {
    const tokens = await x.signIn(
      `${scopes} ${BROWSER_SCOPE}`.trim(),
      { account, allow_browser: "yes", ...suite.consent },
      approver,
    );
    if ("refused" in tokens)
      throw new Error(`refused: ${await tokens.refused.text()}`);
    return tokens;
  };
  /** An agent's browser, joined with a token for `scopes`. */
  const joined = async (x: Lab, scopes?: string) => {
    const tokens = await signIn(x, scopes);
    const b = browser(x, {}, { origin, [suite.accountHeader]: account });
    expect((await join(x, b, { access: tokens.access_token })).status).toBe(
      303,
    );
    return b;
  };
  const stateOf = async (b: ReturnType<typeof browser>) => {
    const r = await b.get("/site/state");
    expect(r.status).toBe(200);
    return (await r.json()) as Record<string, unknown>;
  };

  describe(`an agent's browser at ${company.name}`, () => {
    it("lists the browser-session endpoint and the scope that signs a browser in", async () => {
      const x = await lab();
      const discovery = (await (
        await x.app.request("/.well-known/poppy.json")
      ).json()) as {
        web: Record<string, unknown>;
        auth: {
          scopes: Record<string, string>;
          scope_hints: Record<string, unknown>;
        };
      };
      // The website applies the scopes, so it isn't `unscoped`.
      expect(discovery.web).toEqual({
        browser_session_endpoint: `${origin}${PAGE}`,
      });
      expect(discovery.auth.scopes[BROWSER_SCOPE]).toBe(
        `Open ${suite.name}'s website in the agent's own browser, signed in to your account. The website shows what the read permissions you grant cover, and nothing can be changed there. Not needed for the API or for ${suite.name}'s own agent.`,
      );
      expect(discovery.auth.scope_hints[BROWSER_SCOPE]).toEqual({
        changes: "none",
        personal_data: true,
      });
      for (const document of [
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource",
      ]) {
        const metadata = (await (await x.app.request(document)).json()) as {
          scopes_supported: string[];
        };
        expect(metadata.scopes_supported).toContain(BROWSER_SCOPE);
        // Every scope it lists is described (the validator's check).
        for (const scope of metadata.scopes_supported)
          expect(discovery.auth.scopes[scope]).toBeTruthy();
      }
      const page = await x.app.request(PAGE);
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-store");
      const text = await page.text();
      expect(text).toContain(html(company.name));
      expect(text).toMatch(
        /<form method="post" action="\/poppy\/browser-session"><input type="hidden" name="code" value="bc_[\w.-]+"><button>Continue<\/button><\/form>/,
      );
    });

    it("gives the scope its own line on the consent page, ticked, and grants it only with that line", async () => {
      const x = await lab();
      const consent = async (scope: string) =>
        (
          await x.app.request(
            `/oauth/authorize?${new URLSearchParams({
              client_id: client,
              redirect_uri: redirect,
              response_type: "code",
              scope,
              state: "s".repeat(32),
              code_challenge: "c".repeat(43),
              code_challenge_method: "S256",
            })}`,
          )
        ).text();
      const line =
        '<h3>On this website</h3><label class="sheet-option"><input type="checkbox" name="allow_browser" value="yes" checked><span><strong>Browse signed in, read only</strong><span>The agent&#39;s own browser may open this website signed in to your account. It sees what the read permissions above cover, and can&#39;t change anything here.</span></span></label>';
      expect(await consent(`${suite.scopes} ${BROWSER_SCOPE}`)).toContain(line);
      expect(await consent(suite.scopes)).not.toContain("allow_browser");
      // Allowed with its line, and not without.
      const granted = async (fields: Record<string, string>) => {
        const tokens = await x.signIn(`${suite.scopes} ${BROWSER_SCOPE}`, {
          account,
          ...suite.consent,
          ...fields,
        });
        if ("refused" in tokens) throw new Error("refused");
        return (tokens.scope ?? "").split(" ");
      };
      expect(await granted({ allow_browser: "yes" })).toContain(BROWSER_SCOPE);
      expect(await granted({})).not.toContain(BROWSER_SCOPE);
    });

    it.each(modes)(
      "signs a joined browser in to the account, read only, with %s",
      async (_, deploy) => {
        const x = await lab(deploy);
        const b = await joined(x);
        const page = await b.get("/account");
        expect(page.status).toBe(200);
        const text = await page.text();
        // It is told whose browser it is and that nothing changes here.
        for (const sentence of [
          "This browser belongs to an agent's session. It is signed in through the agent and shows what you allowed the agent to read. Nothing can be changed here: changes are made through the agent and wait for your approval there.",
          "Connected agents and their activity are shown only in your own browser.",
        ])
          expect(text).toContain(html(sentence));
        expect(text).not.toContain("Not shown, because");
        // Every part its scopes cover, and none of the customer's own
        // controls: no log out, no switch of customer, no agents to
        // disconnect.
        for (const part of suite.parts)
          for (const id of part.ids) expect(text).toContain(`id="${id}"`);
        for (const id of suite.own) expect(text).not.toContain(`id="${id}"`);
        expect(text).not.toContain('href="/site/login"');
        expect(text).not.toContain("<form");
        const state = await stateOf(b);
        expect(state.account_id).toBe(account);
        expect(state.browser).toEqual({ read_only: true, not_shown: [] });
        for (const part of suite.parts)
          for (const [field, hidden] of Object.entries(part.state))
            expect([field, state[field]]).not.toEqual([field, hidden]);
        for (const field of suite.ownState) expect(state[field]).toEqual([]);
        // The list of connected agents is the customer's own, and the
        // login page has nothing for a browser that is signed in.
        expect((await b.get("/site/access")).status).toBe(403);
        const login = await b.get("/site/login");
        expect([login.status, login.headers.get("location")]).toEqual([
          302,
          "/account",
        ]);
      },
    );

    it("shows a joined browser only what the token's read scopes cover", async () => {
      for (const part of suite.parts) {
        const x = await lab();
        const others = suite.scopes
          .split(" ")
          .filter((scope) => scope !== part.scope)
          .join(" ");
        const b = await joined(x, others);
        const text = await (await b.get("/account")).text();
        for (const id of part.ids) expect(text).not.toContain(`id="${id}"`);
        // §6: it says what isn't shown, with the scope to ask for.
        expect(text).toContain(
          html(
            agentBrowserNotice(
              {
                account,
                readOnly: true,
                agent: { scopes: others.split(" ") },
              },
              suite.parts,
            )[1]!,
          ),
        );
        expect(text).toContain(html(`${part.name} (${part.scope})`));
        const state = await stateOf(b);
        for (const [field, hidden] of Object.entries(part.state))
          expect([field, state[field]]).toEqual([field, hidden]);
        expect((state.browser as { not_shown: string[] }).not_shown).toContain(
          part.scope,
        );
        // The parts it has a scope for are there.
        for (const other of suite.parts)
          if (other.scope !== part.scope)
            for (const id of other.ids) expect(text).toContain(`id="${id}"`);
      }
    });

    it("refuses a joined browser every change, at every route that writes", async () => {
      const x = await lab();
      const b = await joined(x);
      const before = await stateOf(b);
      const routes = writingRoutes(company);
      expect(
        routes
          .filter(([, path]) => websitePath(path))
          .map((route) => route.join(" "))
          .sort(),
      ).toEqual(suite.writes.map((route) => route.join(" ")).sort());
      const stored = JSON.stringify([
        x.store.value.tenants,
        x.store.value.grants,
      ]);
      const api = (path: string) =>
        path.startsWith("/api/") ||
        (company.accountPrefixes ?? []).some((prefix) =>
          path.startsWith(prefix),
        );
      // And one no Company has, as a route added later would be.
      for (const [method, path] of [
        ...routes,
        ["POST", "/site/added-later"],
      ] as Array<[string, string]>) {
        const r = await b.send(method, path);
        const body = await r.text();
        // The APIs take a Session header, and a cookie opens nothing there.
        if (api(path))
          expect([method, path, r.status, body]).toEqual([
            method,
            path,
            400,
            '{"error":"invalid_session"}',
          ]);
        else {
          expect([method, path, r.status]).toEqual([method, path, 403]);
          expect(JSON.parse(body)).toEqual({
            error: "read_only_browser",
            error_description: `This browser belongs to an agent's session, so it can't change anything at ${company.name}. Changes are made through the agent and wait for your approval there. Nothing has changed.`,
          });
        }
      }
      expect(
        JSON.stringify([x.store.value.tenants, x.store.value.grants]),
      ).toBe(stored);
      expect(await stateOf(b)).toEqual(before);
    });

    it("leaves a customer's own browser everything it could do", async () => {
      const x = await lab();
      const customer = browser(
        x,
        {},
        { origin, [suite.accountHeader]: account },
      );
      await websiteLogin(customer, account);
      // It approves the consent, so it follows the agent user's copy.
      const tokens = await signIn(
        x,
        suite.scopes,
        `__Host-pap_browser=${customer.jar.get("__Host-pap_browser")}`,
      );
      const b = browser(x, {}, { origin, [suite.accountHeader]: account });
      await join(x, b, { access: tokens.access_token });

      const page = await customer.get("/account");
      expect(page.status).toBe(200);
      const text = await page.text();
      for (const id of [...suite.own, ...suite.parts.flatMap((p) => p.ids)])
        expect(text).toContain(`id="${id}"`);
      expect(text).toContain('href="/site/login"');
      expect(text).not.toContain(html("belongs to an agent's session"));
      const state = await stateOf(customer);
      expect(state).not.toHaveProperty("browser");
      // The agent it allowed is in its list, to disconnect.
      expect(state.agents).toHaveLength(1);
      expect((await customer.get("/site/access")).status).toBe(200);
      // Its changes reach the website's own routes, which answer them.
      for (const [method, path] of suite.writes) {
        if (path === "/site/logout" || path === "/site/login") continue;
        const r = await customer.send(method, path);
        expect(await r.text()).not.toContain("read_only_browser");
      }
      const out = await customer.send("POST", "/site/logout");
      expect(out.status).toBe(200);
      expect((await customer.get("/site/state")).status).toBe(401);
      // The agent's browser is as it was.
      expect((await stateOf(b)).account_id).toBe(account);
    });

    it("shows a joined browser that isn't signed in no account and no login form", async () => {
      const x = await lab();
      const b = browser(x, {}, { origin, [suite.accountHeader]: account });
      expect((await join(x, b)).status).toBe(303);
      const page = await b.get("/account");
      expect([page.status, page.headers.get("location")]).toEqual([
        302,
        "/site/login",
      ]);
      const login = await b.get("/site/login");
      expect(login.status).toBe(200);
      expect(login.headers.getSetCookie()).toEqual([]);
      const text = await login.text();
      expect(text).toContain(html(AGENT_BROWSER_LOGIN));
      expect(text).not.toContain("<form");
      expect((await b.get("/site/state")).status).toBe(401);
      // The demo's login takes no password; an agent's browser can't use it.
      const posted = await b.post("/site/login", { account });
      expect(posted.status).toBe(403);
      expect((await b.get("/site/state")).status).toBe(401);
    });
  });
}

/**
 * Device Sign-In (§4.3, RFC 8628): the code, the page where a person enters
 * it, the same consent page as Direct Sign-In with what it adds, and each
 * state a poll can find the request in.
 */
import { afterEach, expect, it, vi } from "vitest";
import { createIdentity, proof } from "@poppy-lab/pap-client/core";
import { client, origin, setup } from "./test-company.ts";
import { DEVICE_GRANT } from "./types.ts";

type Started = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};
const error = async (r: Response) =>
  ((await r.json()) as { error?: string }).error;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
/** Behind Cloudflare, which sets `CF-Connecting-IP` itself. */
const onWorkers = () =>
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });

/** A Company with one Device Sign-In started, and a browser's steps. */
async function started(
  scope = "things:read",
  ...args: Parameters<typeof setup>
) {
  const x = await setup(...args);
  const start = async (body: Record<string, string> = {}) =>
    x.form("/oauth/device", { scope, ...(await x.credentials()), ...body });
  const response = await start();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const device = (await response.json()) as Started;
  /** One poll, with the agent's DPoP key or `key`. */
  const poll = async (key = x.dpop.privateKey, code = device.device_code) =>
    x.form(
      "/oauth/token",
      {
        grant_type: DEVICE_GRANT,
        device_code: code,
        ...(await x.credentials()),
      },
      { DPoP: await proof(key, `${origin}/oauth/token`, "POST") },
    );
  /** The code entered on the page, as a browser with `headers`. */
  const enter = (
    code = device.user_code,
    headers: Record<string, string> = {},
  ) => x.form("/device", { user_code: code }, { origin, ...headers });
  /** The consent page's cookie, from the page a code entry answered. */
  const consentCookie = (page: Response) =>
    page.headers
      .getSetCookie()
      .find((c) => c.includes("pap_consent_"))!
      .split(";")[0]!;
  /** The consent page's answer; `browser` is the browser's own cookie. */
  const answer = (
    cookie: string,
    decision: "approve" | "decline",
    browser?: string,
  ) =>
    x.form(
      "/oauth/authorize",
      { nonce: cookie.split("=")[1]!, decision, account: "elena" },
      { cookie: browser ? `${cookie}; ${browser}` : cookie, origin },
    );
  return { ...x, start, device, poll, enter, consentCookie, answer };
}

it("advertises Device Sign-In in the issuer's metadata", async () => {
  const x = await setup();
  const metadata = (await (
    await x.app.request("/.well-known/oauth-authorization-server")
  ).json()) as Record<string, unknown>;
  expect(metadata.device_authorization_endpoint).toBe(`${origin}/oauth/device`);
  expect(metadata.grant_types_supported).toEqual([
    "authorization_code",
    DEVICE_GRANT,
    "refresh_token",
  ]);
});

it("offers none of it at a Company that offers only Direct Sign-In", async () => {
  const x = await setup({}, { deviceSignIn: false });
  const metadata = (await (
    await x.app.request("/.well-known/oauth-authorization-server")
  ).json()) as Record<string, unknown>;
  expect(metadata).not.toHaveProperty("device_authorization_endpoint");
  expect(metadata.grant_types_supported).toEqual([
    "authorization_code",
    "refresh_token",
  ]);
  const start = await x.form("/oauth/device", {
    scope: "things:read",
    ...(await x.credentials()),
  });
  expect(start.status).toBe(404);
  expect((await x.app.request("/device")).status).toBe(404);
  const poll = await x.form("/oauth/token", {
    grant_type: DEVICE_GRANT,
    device_code: "anything",
    ...(await x.credentials()),
  });
  expect(poll.status).toBe(400);
  expect(await error(poll)).toBe("unsupported_grant_type");
});

it("signs in on another device: code, page, consent, then tokens", async () => {
  const x = await started();
  const { device } = x;
  expect(device.user_code).toMatch(
    /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
  );
  expect(device.verification_uri).toBe(`${origin}/device`);
  expect(device.verification_uri_complete).toBe(
    `${origin}/device?user_code=${device.user_code}`,
  );
  expect(device.expires_in).toBe(600);
  expect(device.interval).toBe(5);
  // Only the hash of the device_code is kept.
  expect(JSON.stringify(x.store.value)).not.toContain(device.device_code);

  vi.useFakeTimers({ toFake: ["Date"] });
  expect(await error(await x.poll())).toBe("authorization_pending");

  // Opening the link changes nothing and approves nothing.
  const saves = x.store.saves;
  const opened = await x.app.request(
    `/device?user_code=${device.user_code.toLowerCase()}`,
  );
  expect(opened.status).toBe(200);
  const openedHtml = await opened.text();
  expect(openedHtml).toContain(`value="${device.user_code}"`);
  expect(openedHtml).toContain(
    "Check that this code is the one your agent shows",
  );
  expect(openedHtml).not.toContain(device.device_code);
  expect(opened.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(x.store.saves).toBe(saves);
  expect(x.store.value.consents ?? {}).toEqual({});

  // The code typed with a space instead of the dash, in small letters.
  const page = await x.enter(device.user_code.replace("-", " ").toLowerCase());
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("You are signing in to <strong>Test Company</strong>");
  expect(html).toContain("at <strong>company.test</strong>");
  expect(html).toContain(
    `<strong class="sheet-code">${device.user_code}</strong>`,
  );
  expect(html).toContain(
    "Allow only if you asked Agent to sign in yourself and it shows this same code.",
  );
  expect(html).toContain(
    "If someone sent you this code or its link, choose Don&#39;t allow.",
  );
  expect(page.headers.get("content-security-policy")).toContain(
    "form-action 'self';",
  );

  vi.setSystemTime(Date.now() + 5000);
  expect(await error(await x.poll())).toBe("authorization_pending");

  const done = await x.answer(x.consentCookie(page), "approve");
  expect(done.status).toBe(200);
  expect(await done.text()).toContain(
    "Agent finishes signing in to your Test Company account on the device where you started",
  );

  vi.setSystemTime(Date.now() + 5000);
  const tokens = await x.poll();
  expect(tokens.status).toBe(200);
  const body = (await tokens.json()) as Record<string, unknown>;
  expect(body.token_type).toBe("DPoP");
  expect(typeof body.access_token).toBe("string");
  expect(typeof body.refresh_token).toBe("string");
  expect(body.scope).toBe("things:read");

  // Issued once; the code works once too.
  expect(await error(await x.poll())).toBe("invalid_grant");
  expect((await x.enter()).status).toBe(400);

  // Refreshed as after Direct Sign-In, with the same DPoP key.
  const refreshed = await x.token({
    grant_type: "refresh_token",
    refresh_token: String(body.refresh_token),
  });
  expect(refreshed.access_token).toBeTruthy();
});

it("says slow_down to a poll that comes early, and adds five seconds", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await started();
  expect(await error(await x.poll())).toBe("authorization_pending");
  vi.setSystemTime(Date.now() + 2000);
  expect(await error(await x.poll())).toBe("slow_down");
  // Now ten seconds: six is still early.
  vi.setSystemTime(Date.now() + 6000);
  expect(await error(await x.poll())).toBe("slow_down");
  vi.setSystemTime(Date.now() + 15000);
  expect(await error(await x.poll())).toBe("authorization_pending");
  // A second of grace for polls bunched up on the way.
  vi.setSystemTime(Date.now() + 14500);
  expect(await error(await x.poll())).toBe("authorization_pending");
});

it("ends after ten minutes: polls get expired_token, and the code is refused", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await started();
  vi.setSystemTime(Date.now() + 601000);
  expect(await error(await x.poll())).toBe("expired_token");
  const late = await x.enter();
  expect(late.status).toBe(400);
  expect(await late.text()).toContain(
    "Test Company isn&#39;t waiting for that code.",
  );
});

it("ends at the consent page's five minutes too, if the code was entered late", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await started();
  vi.setSystemTime(Date.now() + 500000);
  const page = await x.enter();
  expect(page.status).toBe(200);
  vi.setSystemTime(Date.now() + 101000);
  const late = await x.answer(x.consentCookie(page), "approve");
  expect(late.status).toBe(400);
  expect(await error(await x.poll())).toBe("expired_token");
});

it("tells the poll the customer declined", async () => {
  const x = await started();
  const page = await x.enter();
  const declined = await x.answer(x.consentCookie(page), "decline");
  expect(declined.status).toBe(200);
  const html = await declined.text();
  expect(html).toContain("Nothing was allowed");
  expect(html).toContain("Agent is told that you declined");
  expect(await error(await x.poll())).toBe("access_denied");
  // The page can't be answered again.
  expect((await x.answer(x.consentCookie(page), "approve")).status).toBe(400);
  expect(await error(await x.poll())).toBe("access_denied");
});

it("refuses a wrong code, and stops checking after ten from one place", async () => {
  onWorkers();
  const x = await started();
  const wrong = await x.enter("BBBB-BBBB", { "cf-connecting-ip": "192.0.2.1" });
  expect(wrong.status).toBe(400);
  const html = await wrong.text();
  expect(html).toContain("Test Company isn&#39;t waiting for that code.");
  expect(html).toContain('role="alert"');
  // Kept in the field, to be corrected.
  expect(html).toContain('value="BBBB-BBBB"');
  // Not even shaped like a code.
  expect(
    (await x.enter("hello", { "cf-connecting-ip": "192.0.2.1" })).status,
  ).toBe(400);
  for (let i = 0; i < 8; i++)
    await x.enter("CCCC-CCCC", { "cf-connecting-ip": "192.0.2.1" });
  // Ten wrong: even the right code isn't checked from there for a while.
  const blocked = await x.enter(undefined, { "cf-connecting-ip": "192.0.2.1" });
  expect(blocked.status).toBe(429);
  expect(await blocked.text()).toContain(
    "Too many codes that didn&#39;t match were entered here",
  );
  // Elsewhere it is.
  expect(
    (await x.enter(undefined, { "cf-connecting-ip": "192.0.2.2" })).status,
  ).toBe(200);
});

it("keeps checking codes from elsewhere while many places enter wrong ones", async () => {
  onWorkers();
  const x = await started();
  for (let place = 1; place <= 25; place++)
    for (let i = 0; i < 10; i++)
      await x.enter("CCCC-CCCC", { "cf-connecting-ip": `192.0.2.${place}` });
  expect(
    (await x.enter(undefined, { "cf-connecting-ip": "198.51.100.1" })).status,
  ).toBe(200);
});

it("takes CF-Connecting-IP only on Workers, where Cloudflare sets it", async () => {
  // On Node anyone can send it, so it can't make ten wrong codes look like
  // ten places: without a verified source address they share one bucket.
  const x = await started();
  for (let i = 1; i <= 10; i++)
    await x.enter("CCCC-CCCC", { "cf-connecting-ip": `192.0.2.${i}` });
  expect(
    (await x.enter(undefined, { "cf-connecting-ip": "192.0.2.11" })).status,
  ).toBe(429);
});

it("resolves source addresses from deploy.sourceAddress, Node socket, or POPPY_TRUSTED_PROXY_HEADER, and ignores forged pap_browser cookies", async () => {
  // 1) deploy.sourceAddress (normalized with addressKey)
  const custom = await started("things:read", {
    sourceAddress: (c) => c.req.header("x-custom-source"),
  });
  for (let i = 0; i < 10; i++)
    await custom.enter("CCCC-CCCC", {
      "x-custom-source": `2001:db8:1:2::${i + 1}`,
    });
  expect(
    (
      await custom.enter(undefined, {
        "x-custom-source": "2001:db8:1:2:ffff::9",
      })
    ).status,
  ).toBe(429);
  expect(
    (
      await custom.enter(undefined, {
        "x-custom-source": "2001:db8:1:3::1",
      })
    ).status,
  ).toBe(200);

  // 2) Node socket remoteAddress via Hono c.env.incoming.socket.remoteAddress
  const socketApp = await started();
  const enterWithSocket = (code: string, remoteAddress: string) =>
    socketApp.app.request(
      "/device",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin,
        },
        body: new URLSearchParams({ user_code: code }).toString(),
      },
      { incoming: { socket: { remoteAddress } } },
    );
  for (let i = 0; i < 10; i++)
    expect(
      (await enterWithSocket("CCCC-CCCC", "::ffff:192.0.2.10")).status,
    ).toBe(400);
  expect(
    (await enterWithSocket(socketApp.device.user_code, "192.0.2.10")).status,
  ).toBe(429);
  expect(
    (await enterWithSocket(socketApp.device.user_code, "192.0.2.11")).status,
  ).toBe(200);

  // 3) Explicitly configured POPPY_TRUSTED_PROXY_HEADER on Node (takes precedence over proxy socket)
  vi.stubEnv("POPPY_TRUSTED_PROXY_HEADER", "X-Forwarded-For");
  const proxied = await started();
  const enterProxied = (code: string, forwarded: string) =>
    proxied.app.request(
      "/device",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin,
          "x-forwarded-for": forwarded,
        },
        body: new URLSearchParams({ user_code: code }).toString(),
      },
      { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
    );
  for (let i = 0; i < 10; i++)
    await enterProxied("CCCC-CCCC", "198.51.100.5, 10.0.0.1");
  expect(
    (await enterProxied(proxied.device.user_code, "198.51.100.5, 10.0.0.2"))
      .status,
  ).toBe(429);
  expect(
    (await enterProxied(proxied.device.user_code, "198.51.100.6, 10.0.0.1"))
      .status,
  ).toBe(200);

  // Invalid proxy header name is ignored
  vi.stubEnv("POPPY_TRUSTED_PROXY_HEADER", "x-forwarded-for bad!");
  const invalidHeader = await started();
  for (let i = 1; i <= 10; i++)
    await invalidHeader.enter("CCCC-CCCC", {
      "x-forwarded-for": `198.51.100.${i}`,
    });
  expect(
    (
      await invalidHeader.enter(undefined, {
        "x-forwarded-for": "198.51.100.99",
      })
    ).status,
  ).toBe(429);
  vi.unstubAllEnvs();

  // 4) Forged pap_browser cookies do not split the source bucket on Node
  const forged = await started();
  for (let i = 1; i <= 10; i++) {
    const cookie = `__Host-pap_browser=${"a".repeat(24)}${String(i).padStart(2, "0")}`;
    expect((await forged.enter("CCCC-CCCC", { cookie })).status).toBe(400);
  }
  expect(
    (
      await forged.enter(undefined, {
        cookie: `__Host-pap_browser=${"b".repeat(26)}`,
      })
    ).status,
  ).toBe(429);
});

it("takes a code only from its own page's form", async () => {
  const x = await started();
  const r = await x.form("/device", { user_code: x.device.user_code });
  expect(r.status).toBe(400);
  const elsewhere = await x.form(
    "/device",
    { user_code: x.device.user_code },
    { origin: "https://elsewhere.test" },
  );
  expect(elsewhere.status).toBe(400);
  expect(x.store.value.consents ?? {}).toEqual({});
});

it("gives the newest browser the consent page, and the earlier page no answer", async () => {
  const x = await started();
  const first = await x.enter();
  const second = await x.enter();
  expect(Object.keys(x.store.value.consents!)).toHaveLength(1);
  expect((await x.answer(x.consentCookie(first), "approve")).status).toBe(400);
  expect(await error(await x.poll())).toBe("authorization_pending");
  expect((await x.answer(x.consentCookie(second), "approve")).status).toBe(200);
});

it("gives the tokens only to the agent that asked, with the key it polled with", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await started();
  // The first poll binds the request to its DPoP key.
  expect(await error(await x.poll())).toBe("authorization_pending");
  const page = await x.enter();
  await x.answer(x.consentCookie(page), "approve");
  vi.setSystemTime(Date.now() + 5000);
  const other = await createIdentity();
  expect(await error(await x.poll(other.privateKey))).toBe("invalid_grant");
  expect(await error(await x.poll(undefined, "not-a-device-code"))).toBe(
    "invalid_grant",
  );
  // Without a DPoP proof nothing is issued, as after Direct Sign-In.
  const bare = await x.form("/oauth/token", {
    grant_type: DEVICE_GRANT,
    device_code: x.device.device_code,
    ...(await x.credentials()),
  });
  expect(await error(bare)).toBe("invalid_dpop_proof");
  expect((await x.poll()).status).toBe(200);
});

it("binds the tokens to the key of a proof sent with the request", async () => {
  const x = await setup();
  const response = await x.form(
    "/oauth/device",
    { scope: "things:read", ...(await x.credentials()) },
    {
      DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/device`, "POST"),
    },
  );
  const { device_code } = (await response.json()) as Started;
  const other = await createIdentity();
  const poll = await x.form(
    "/oauth/token",
    { grant_type: DEVICE_GRANT, device_code, ...(await x.credentials()) },
    { DPoP: await proof(other.privateKey, `${origin}/oauth/token`, "POST") },
  );
  expect(await error(poll)).toBe("invalid_grant");
});

it("checks the request: the client's assertion, the scopes and the resource", async () => {
  const x = await setup();
  const ask = async (body: Record<string, string>) =>
    x.form("/oauth/device", { ...(await x.credentials()), ...body });
  expect(await error(await ask({ scope: "" }))).toBe("invalid_scope");
  expect(await error(await ask({ scope: "things:read things:read" }))).toBe(
    "invalid_scope",
  );
  expect(await error(await ask({ scope: "other" }))).toBe("invalid_scope");
  expect(
    await error(
      await ask({ scope: "things:read", resource: "https://other.test" }),
    ),
  ).toBe("invalid_target");
  const forged = await x.form("/oauth/device", {
    scope: "things:read",
    client_id: client,
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: "e30.e30.e30",
  });
  expect(forged.status).toBe(401);
  expect(await error(forged)).toBe("invalid_client");
  // Polls carry the assertion too (§4.3).
  const started = (await (
    await ask({ scope: "things:read" })
  ).json()) as Started;
  const bare = await x.form(
    "/oauth/token",
    {
      grant_type: DEVICE_GRANT,
      device_code: started.device_code,
      client_id: client,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    },
    { DPoP: await proof(x.dpop.privateKey, `${origin}/oauth/token`, "POST") },
  );
  expect(bare.status).toBe(401);
  expect(await error(bare)).toBe("invalid_client");
});

it("keeps the approving browser with the grant, as Direct Sign-In does", async () => {
  const x = await started("things:read", { isolation: "visitor" });
  const page = await x.enter();
  const browser = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_browser="))!
    .split(";")[0]!;
  await x.answer(x.consentCookie(page), "approve", browser);
  expect((await x.poll()).status).toBe(200);
  const [grant] = Object.values(x.store.value.grants);
  expect(grant!.browser).toBeTruthy();
  expect(grant!.account).toBe("elena");
});

it("shows its pages in the Company's own frame", async () => {
  const frame = (title: string, main: string) =>
    `<!doctype html><html><head><title>${title} · Test Company</title></head><body><header>Test Company header</header>${main}</body></html>`;
  const x = await started(
    "things:read",
    {},
    {
      consentExpired: () =>
        frame(
          "This page has expired",
          '<main class="sheet"><p>Expired</p></main>',
        ),
      consent: ({ nonce }) =>
        frame(
          "Allow",
          `<main class="sheet"><h1>Consent</h1><form method="post" action="/oauth/authorize"><input name="nonce" value="${nonce}"></form></main>`,
        ),
    },
  );
  const entry = await (await x.app.request("/device")).text();
  expect(entry).toContain("<title>Enter your code · Test Company</title>");
  expect(entry).toContain("<header>Test Company header</header>");
  expect(entry).toContain("Connect an agent to your Test Company account");
  expect(entry).not.toContain("Expired");
  // The notice goes above the consent form.
  const consent = await (await x.enter()).text();
  expect(consent).toMatch(
    /<h1>Consent<\/h1><section class="sheet-device"[^>]*>.*<\/section><form method="post"/,
  );
});

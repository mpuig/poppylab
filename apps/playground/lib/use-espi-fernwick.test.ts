/**
 * End to end, in process: Iris's routes and runtime against the real
 * Fernwick app, with Use ESPI on (`poppylab.dev/espi` v1). Only the network
 * is replaced: DNS answers loopback and the pinned fetch hands each request
 * to the Fernwick app, so the transport's own checks (no redirects, error
 * parsing, DPoP nonces, sizes) still run. No model: tools are called
 * directly, and demo-mode chat turns read usage and bills. The
 * authorization is revoked from the account row's route.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    app: undefined as
      | {
          request: (
            url: string,
            init?: RequestInit,
          ) => Response | Promise<Response>;
        }
      | undefined,
    cookies: new Map<string, string>(),
    /** Every request Iris sent: method, URL and headers. */
    seen: [] as Array<{
      method: string;
      url: string;
      headers: Record<string, string>;
    }>,
  };
});
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "127.0.0.1", family: 4 }],
}));
// The undici that pap-client's pinned fetch imports (it isn't the
// playground's own dependency).
const undici = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  return createRequire(
    fileURLToPath(new URL("../../../packages/pap-client/", import.meta.url)),
  ).resolve("undici");
});
vi.mock(undici, () => ({
  Agent: class {
    destroy() {}
  },
  fetch: async (
    url: URL | string,
    init: RequestInit & { dispatcher?: unknown },
  ) => {
    const { dispatcher, ...rest } = init;
    void dispatcher;
    net.seen.push({
      method: rest.method ?? "GET",
      url: String(url),
      headers: Object.fromEntries(new Headers(rest.headers).entries()),
    });
    return net.app!.request(String(url), rest);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      net.cookies.has(name) ? { value: net.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => {
      if (value) net.cookies.set(name, value);
      else net.cookies.delete(name);
    },
    delete: (name: string) => net.cookies.delete(name),
  }),
}));
import { createIdentity, ProtocolError } from "@poppy-lab/pap-client";
import {
  lab,
  origin,
  client,
  redirect,
  setup,
} from "../../fernwick/src/test-harness";
import { POST as discover } from "../app/api/discover/route";
import { GET as account, POST as act } from "../app/api/account/route";
import { GET as callback } from "../app/api/account/callback/route";
import { POST as chat } from "../app/api/chat/route";
import { acquireRun, releaseRun, visitorOf, type Held } from "./runs";
import { onlyConnection } from "./connections";
import {
  connect,
  ESPI_GUIDANCE,
  papRequest,
  renewAccount,
  type Connection,
} from "./runtime";

const base = `${origin}/espi/1_1/resource`;
const agent = "http://localhost:3000";
const raw = "e".repeat(43);
let visitor: string;
let conversation: string;

const post = (
  handler: (r: Request) => Promise<Response>,
  path: string,
  body: unknown,
) =>
  handler(
    new Request(`${agent}${path}`, {
      method: "POST",
      headers: {
        origin: agent,
        "Content-Type": "application/json",
        ...(conversation ? { "X-Poppy-Conversation": conversation } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const restored = async () =>
  (
    await account(
      new Request(`${agent}/api/account?conversation=${conversation}`),
    )
  ).json();
/**
 * Holds the conversation's run for direct runtime calls at its Company,
 * then saves it.
 */
async function withRun<T>(work: (run: Connection) => Promise<T>) {
  const held = (await acquireRun(visitor, conversation)) as Held;
  try {
    return await work(onlyConnection(held.run));
  } finally {
    await releaseRun(visitor, held);
  }
}
async function tools(trace: string[] = []) {
  return withRun((run) => connect(run, trace));
}
/** Elena on Fernwick's consent page, sharing the EV charger's meter. */
async function consent(url: string) {
  const page = await net.app!.request(url);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("espi_meter_UP-E1");
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const form = new URLSearchParams({
    nonce: cookie.split("=")[1]!,
    decision: "approve",
    account: "elena",
    "espi_meter_UP-E2": "yes",
    allow_offline: "yes",
  });
  const approved = await net.app!.request(`${origin}/oauth/authorize`, {
    method: "POST",
    headers: {
      cookie,
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  expect(approved.status).toBe(302);
  return approved.headers.get("location")!;
}
async function signIn() {
  const signin = await post(act, "/api/account", { action: "signin" });
  expect(signin.status).toBe(200);
  const back = await consent((await signin.json()).url);
  expect(back.startsWith(redirect)).toBe(true);
  expect((await callback(new Request(back))).status).toBe(303);
}

describe("Use ESPI against Fernwick, end to end", () => {
  beforeAll(async () => {
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    await setup({
      fetchJson: async (url: string) =>
        url.endsWith("client.json")
          ? {
              client_id: client,
              client_name: "Iris",
              jwks_uri: `${agent}/agent/jwks.json`,
              redirect_uris: [redirect],
            }
          : { keys: [keys.publicKey] },
    });
    net.app = lab.app;
    net.cookies.set("poppy_visitor", raw);
    visitor = visitorOf({ get: () => ({ value: raw }), set: () => {} })!;
  });
  afterAll(() => vi.unstubAllEnvs());

  it("discovers Fernwick, turns Use ESPI on in a new Session and signs in sharing one of two meters", async () => {
    const found = await post(discover, "/api/discover", { url: origin });
    expect(found.status).toBe(200);
    conversation = found.headers.get("X-Poppy-Conversation")!;
    expect((await found.json()).profile.extensions).toHaveProperty(
      "poppylab.dev/espi",
    );
    expect(await restored()).toMatchObject({ espi: false, fdx: false });
    const before = await withRun(async (run) => run.sessionId);
    const on = await post(act, "/api/account", {
      action: "espi",
      enabled: true,
    });
    const turned = await on.json();
    expect(turned).toMatchObject({ espi: true });
    expect(turned.sessionId).not.toBe(before);
    expect((await restored()).espi).toBe(true);

    const signin = await post(act, "/api/account", { action: "signin" });
    const asked = await withRun(async (run) => run.auth!.scopes.split(" "));
    // The scopes the ESPI-shaped tools use, never the customer's name and
    // address, and no change.
    expect(asked).toEqual(
      expect.arrayContaining(["account:read", "espi:usage", "espi:summary"]),
    );
    expect(asked).not.toContain("espi:customer");
    expect(asked).not.toContain("plan:write");
    const back = await consent((await signin.json()).url);
    expect((await callback(new Request(back))).status).toBe(303);
    await withRun(async (run) => {
      expect(run.espiResourceUri).toMatch(
        new RegExp(`^${base}/Batch/Subscription/[\\w-]+$`),
      );
      expect(run.espiAuthorizationUri).toBe(
        run.espiResourceUri!.replace("/Batch/Subscription/", "/Authorization/"),
      );
    });
    expect((await restored()).espiAuthorization).toMatch(/^[\w-]+$/);
  });

  it("offers four ESPI-shaped tools, steered to, that read the shared meter only, as Atom with the extension declared", async () => {
    const trace: string[] = [];
    const t = await tools(trace);
    expect(trace).toContain(
      "Extension poppylab.dev/espi v1 · native ESPI-shaped adapter · 4 read tools",
    );
    expect(trace[0]).toContain(
      'Poppy-Extensions "operations";v="3", "poppylab.dev/espi";v="1"',
    );
    expect(t.espi_meters!.description.startsWith(ESPI_GUIDANCE)).toBe(true);
    // Fernwick's own API stays offered, through the same grant.
    expect(t).toHaveProperty("bills");
    const from = net.seen.length;
    const meters = (await t.espi_meters!.execute({})) as {
      usagePoints: Array<{ usagePointId: string }>;
    };
    expect(meters.usagePoints.map((m) => m.usagePointId)).toEqual(["UP-E2"]);
    // Besides the API's resource metadata, read once (§4.5).
    const sent = net.seen
      .slice(from)
      .filter((r) => !r.url.includes("/.well-known/"));
    expect(sent.length).toBeGreaterThan(0);
    for (const request of sent) {
      expect(request.url.startsWith(`${base}/`)).toBe(true);
      expect(request.headers.accept).toBe("application/atom+xml");
      expect(request.headers["poppy-extensions"]).toContain(
        '"poppylab.dev/espi";v="1"',
      );
      expect(request.headers.authorization).toMatch(/^DPoP /);
      expect(request.headers.dpop).toEqual(expect.any(String));
      expect(request.headers["poppy-session"]).toEqual(expect.any(String));
    }
    // The meter not shared: Fernwick's bare 404 reaches the model.
    expect(
      await t.espi_usage!.execute({
        usagePointId: "UP-E1",
        from: "2026-11-01",
        to: "2026-11-02",
      }),
    ).toEqual({ error: "espi_error", status: 404 });
    // Fernwick's own API, through the same grant: the same one meter.
    const own = JSON.stringify(await t.account!.execute({}));
    expect(own).toContain("UP-E2");
    expect(own).not.toContain("UP-E1");
  });

  it("answers usage and bills through ESPI in demo mode", async () => {
    const reply = await post(chat, "/api/chat", {
      url: origin,
      message: "How much electricity did my EV use last week?",
      provider: "demo",
    });
    expect(reply.status).toBe(200);
    const body = (await reply.json()) as { text: string; data: string };
    expect(body.text).toContain("ESPI-shaped tools");
    expect(body.text).toContain("EV charger (UP-E2)");
    expect(body.text).toMatch(/\d kWh · \$\d/);
    expect(body.text).toMatch(
      /Total [\d,.]+ kWh · \$[\d,.]+ over 16[78] hours/,
    );
    expect(body.data).toContain("meterReadings");
    expect(body.data).not.toContain("UP-E1");
    const bills = await post(chat, "/api/chat", {
      url: origin,
      message: "¿Cuánto fue mi última factura?",
      provider: "demo",
    });
    const billed = (await bills.json()) as { text: string; data: string };
    expect(billed.text).toMatch(
      /\(UTC\) · [\d,.]+ kWh · \$[\d,.]+ · Time of use/,
    );
    expect(billed.data).toContain('"bills"');
  });

  it("refreshes keeping the subscription, and shows it in the account row", async () => {
    await withRun(async (run) => {
      const uri = run.espiAuthorizationUri;
      delete run.espiResourceUri;
      delete run.espiAuthorizationUri;
      await renewAccount(run);
      expect(run.espiAuthorizationUri).toBe(uri);
      expect(run.espiResourceUri).toBe(
        uri!.replace("/Authorization/", "/Batch/Subscription/"),
      );
    });
    const shown = await post(act, "/api/account", {
      action: "espi_authorization",
    });
    expect(shown.status).toBe(200);
    const { authorization } = await shown.json();
    expect(authorization).toMatchObject({
      id: (await restored()).espiAuthorization,
      status: "active",
      meters: [{ id: "UP-E2", title: "EV charger" }],
    });
    expect(Date.parse(authorization.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("with Use ESPI off, offers no ESPI tools and Fernwick answers extension_required", async () => {
    const off = await post(act, "/api/account", {
      action: "espi",
      enabled: false,
    });
    expect(await off.json()).toMatchObject({ espi: false });
    const t = await tools();
    expect(Object.keys(t).some((n) => n.startsWith("espi_"))).toBe(false);
    expect(t).toHaveProperty("bills");
    expect((await restored()).espiAuthorization).toBeUndefined();
    const error = await withRun((run) =>
      papRequest(run, `${base}/ReadingType`, "GET", undefined, {
        errorBody: true,
        binary: { accept: "application/atom+xml", maxBytes: 100000 },
      }).then(
        () => undefined,
        (e: unknown) => e,
      ),
    );
    expect(error).toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({ status: 403, code: "extension_required" });
    await post(act, "/api/account", { action: "espi", enabled: true });
  });

  it("revokes the authorization from the account row: one DELETE, the grant ends at Fernwick and the run is signed out", async () => {
    const before = await withRun(async (run) => ({
      authorization: run.espiAuthorizationUri!,
      token: run.token!,
      refresh: run.accountToken!,
      expires: run.tokenExpires!,
      scopes: run.scopes!,
      revoke: run.company!.metadata!.revocation_endpoint!,
    }));
    const id = before.authorization.split("/").at(-1)!;
    const from = net.seen.length;
    const revoked = await post(act, "/api/account", { action: "espi_revoke" });
    expect(revoked.status).toBe(200);
    const body = await revoked.json();
    expect(body).toEqual({
      signedIn: false,
      revoked: "revoked",
      authorization: id,
      trace: [
        `DELETE /espi/1_1/resource/Authorization/${id} · ESPI authorization revoked · 204`,
      ],
    });
    // Exactly one request, the DELETE; the dead refresh token isn't revoked.
    const sent = net.seen.slice(from);
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([
      `DELETE ${before.authorization}`,
    ]);
    expect(sent[0]!.headers.authorization).toBe(`DPoP ${before.token}`);
    expect(sent[0]!.headers["poppy-extensions"]).toContain(
      '"poppylab.dev/espi";v="1"',
    );

    // Signed out here, as after a sign-out, with Use ESPI still on.
    await withRun(async (run) => {
      expect(run.accountToken).toBeUndefined();
      expect(run.token).toBeUndefined();
      expect(run.espiResourceUri).toBeUndefined();
      expect(run.espiAuthorizationUri).toBeUndefined();
      expect(run.accountUnavailable).toBeUndefined();
      expect(run.espi).toBe(true);
    });
    expect(await restored()).toMatchObject({ signedIn: false, espi: true });
    const t = await tools();
    for (const name of ["espi_meters", "espi_authorization"])
      expect(await t[name]!.execute({})).toMatchObject({
        error: "sign_in_required",
      });
    // Nothing left to revoke.
    const again = await post(act, "/api/account", { action: "espi_revoke" });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({
      code: "no_espi_authorization",
    });

    // At Fernwick, the grant's tokens are gone: the old access token is
    // refused, and so is its refresh token.
    await withRun(async (run) => {
      Object.assign(run, {
        token: before.token,
        accountToken: before.refresh,
        tokenExpires: before.expires,
        scopes: before.scopes,
      });
      try {
        const read = await papRequest(
          run,
          `${base}/Authorization/${id}`,
          "GET",
          undefined,
          {
            errorBody: true,
            binary: { accept: "application/atom+xml", maxBytes: 100000 },
          },
        ).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(read).toMatchObject({ status: 401, code: "invalid_token" });
        delete run.accountUnavailable;
        const renewed = await renewAccount(run).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(renewed).toMatchObject({ status: 400, code: "invalid_grant" });
      } finally {
        delete run.token;
        delete run.accountToken;
        delete run.tokenExpires;
        delete run.scopes;
        delete run.accountUnavailable;
      }
    });

    // Signing in again shares meters over ESPI with a new authorization.
    await signIn();
    const fresh = await withRun(async (run) => run.espiAuthorizationUri);
    expect(fresh).toMatch(/\/Authorization\/[\w-]+$/);
    expect(fresh).not.toBe(before.authorization);
  });

  it("takes an authorization revoked by another request as already ended", async () => {
    // Disconnected elsewhere: the grant's own DELETE, sent directly.
    await withRun(async (run) => {
      await papRequest(run, run.espiAuthorizationUri!, "DELETE", undefined, {
        acceptEmpty: true,
      });
    });
    const t = await tools();
    const error = await t.espi_meters!.execute({}).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 401, code: "invalid_token" });
    await withRun(async (run) => {
      expect(run.accountUnavailable).toBe(true);
      // As the page would find it before the chat noticed.
      delete run.accountUnavailable;
    });
    const revoked = await post(act, "/api/account", { action: "espi_revoke" });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({
      signedIn: false,
      revoked: "already_ended",
    });
    await withRun(async (run) => {
      expect(run.accountToken).toBeUndefined();
      expect(run.espiAuthorizationUri).toBeUndefined();
    });
  });
});

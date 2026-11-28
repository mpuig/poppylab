/**
 * End to end, in process, at each of the lab's five Companies: whose a
 * later sign-in is, as the Session the earlier one used says it (§5.4).
 * The Companies are their real gateways; only the network is replaced.
 *
 * Signed in as Elena, a second consent as Elena is taken in the earlier
 * Session: the same account. A third as Robin is refused there with
 * `session_ended`: another account. The Inspector says which, and the
 * check sends nothing of the User's: a read that changes nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
type App = {
  request: (url: string, init?: RequestInit) => Response | Promise<Response>;
};
const net = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PAP_ALLOW_PRIVATE_NETWORK", "true");
  return {
    apps: {} as Record<string, App>,
    cookies: new Map<string, string>(),
    seen: [] as Array<{ url: string; method: string; body: string }>,
  };
});
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "127.0.0.1", family: 4 }],
}));
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
      url: String(url),
      method: rest.method ?? "GET",
      body: typeof rest.body === "string" ? rest.body : "",
    });
    return net.apps[new URL(String(url)).origin]!.request(String(url), rest);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      net.cookies.has(name) ? { value: net.cookies.get(name)! } : undefined,
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (value && options?.maxAge !== 0) net.cookies.set(name, value);
      else net.cookies.delete(name);
    },
    delete: (name: string) => net.cookies.delete(name),
  }),
}));
import { createIdentity } from "@poppy-lab/pap-client";
import * as fernwick from "../../fernwick/src/test-harness";
import * as harborline from "../../harborline/src/test-harness";
import * as lantern from "../../lantern/src/test-harness";
import * as northwind from "../../northwind/src/test-harness";
import { juniperApp } from "../../juniper/src/test-app";
import { POST as discover } from "../app/api/discover/route";
import { GET as account, POST as act } from "../app/api/account/route";
import { GET as callback } from "../app/api/account/callback/route";

const agent = "http://localhost:3000";
const juniper = "http://juniper.localhost:4100";
let conversation = "";

const post = async (path: string, body: unknown) => {
  const response = await (path === "/api/discover" ? discover : act)(
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
  return {
    conversation: response.headers.get("X-Poppy-Conversation"),
    data: await response.json(),
  };
};
const lines = async () =>
  (
    (await (
      await account(
        new Request(`${agent}/api/account?conversation=${conversation}`),
      )
    ).json()) as { log: Array<{ text: string }> }
  ).log.map((l) => l.text);

/** A sign-in at `company`, allowed on its own page as `who`. */
async function signIn(company: string, who: "elena" | "robin") {
  const started = await post("/api/account", {
    action: "signin",
    company,
    access: "read",
  });
  expect(started.data.url).toEqual(expect.any(String));
  const app = net.apps[company]!;
  const page = await app.request(started.data.url);
  expect(page.status).toBe(200);
  const cookie = page.headers
    .getSetCookie()
    .find((c) => c.includes("pap_consent_"))!
    .split(";")[0]!;
  const allowed = await app.request(`${company}/oauth/authorize`, {
    method: "POST",
    headers: {
      cookie,
      origin: company,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      nonce: cookie.split("=")[1]!,
      decision: "approve",
      account: who,
      // Fernwick's own choices: the meters shared, of either customer, and
      // the refresh token Iris needs.
      "espi_meter_UP-E1": "yes",
      "espi_meter_UP-R1": "yes",
      allow_offline: "yes",
    }).toString(),
  });
  expect(allowed.status).toBe(302);
  const back = await callback(new Request(allowed.headers.get("location")!));
  expect(back.headers.get("Location")).toBe("/playground/sign-in/done");
}

const SAME = "Same account · the earlier sign-in's Session took the new token";
const OTHER =
  "Another account · the earlier sign-in's Session refused the new token (session_ended)";

describe("whose a later sign-in is, at each of the lab's Companies (§5.4)", () => {
  beforeAll(async () => {
    const keys = await createIdentity();
    vi.stubEnv("POPPY_IDENTITY", JSON.stringify(keys));
    const fetchJson = async (url: string) =>
      url.endsWith("client.json")
        ? {
            client_id: lantern.client,
            client_name: "Iris",
            jwks_uri: `${agent}/agent/jwks.json`,
            redirect_uris: [lantern.redirect],
          }
        : { keys: [keys.publicKey] };
    for (const harness of [lantern, harborline, fernwick, northwind]) {
      await harness.setup({ fetchJson });
      net.apps[harness.origin] = harness.lab.app;
    }
    net.apps[juniper] = juniperApp({ origin: juniper, fetchJson }).app;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["Juniper Market", juniper],
    ["Lantern Noodle Bar", lantern.origin],
    ["Harborline Bank", harborline.origin],
    ["Northwind Air", northwind.origin],
    ["Fernwick Power & Light", fernwick.origin],
  ])(
    "%s takes the same customer's new token and refuses another's",
    async (_name, company) => {
      net.cookies.clear();
      net.cookies.set(
        "poppy_visitor",
        company.length.toString().repeat(43).slice(0, 43),
      );
      conversation = "";
      conversation = (await post("/api/discover", { url: company }))
        .conversation!;
      await signIn(company, "elena");
      expect(await lines()).not.toContain(SAME);
      const from = net.seen.length;
      await signIn(company, "elena");
      expect(await lines()).toContain(SAME);
      // The check: GETs only, at the Company's own API, with no body.
      const checks = net.seen
        .slice(from)
        .filter((r) => new URL(r.url).pathname.startsWith("/api/"));
      expect(checks.length).toBe(2);
      for (const r of checks) {
        expect(r.method).toBe("GET");
        expect(r.body).toBe("");
        expect(new URL(r.url).origin).toBe(company);
      }
      await signIn(company, "robin");
      expect(await lines()).toContain(OTHER);
    },
  );
});

/**
 * Sign-in at two Companies of one conversation, both under way at once.
 * Each sign-in has its own cookie, so the second doesn't undo the first,
 * and each callback is still completed only for the browser that holds
 * the cookie of that very sign-in. The real runtime and both routes; only
 * the network and the browser's cookies are replaced.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() =>
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
);
const discover = vi.hoisted(() => vi.fn());
/** The browser's cookies, and how each was last set. */
const jar = vi.hoisted(() => ({
  held: new Map<string, string>(),
  options: new Map<string, Record<string, unknown>>(),
}));
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: discover,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.held.has(name) ? { value: jar.held.get(name)! } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.options.set(name, options);
      if (value && options.maxAge !== 0) jar.held.set(name, value);
      else jar.held.delete(name);
    },
    delete: (name: string) => jar.held.delete(name),
  }),
}));
vi.mock("@poppy-lab/pap-agent/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-agent/deployment")>()),
  serving: () => true,
  publicMode: () => false,
  isAccountCompany: () => true,
  proposalsAllowed: () => true,
}));
import { connected, discovered } from "@/lib/company-fixture";
import { seedRun } from "@/lib/runs";
import type { Run } from "@/lib/runtime";
import { POST as act } from "../route";
import { GET as callback } from "./route";

const shop = "https://shop.example";
const food = "https://food.example";
const names: Record<string, string> = {
  [shop]: "Juniper Market",
  [food]: "Lantern Noodle Bar",
};
const DONE = "/playground/sign-in/done",
  FAILED = "/playground/sign-in/failed";

let count = 0;
let id = "";
async function conversation() {
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: [connected(shop, names[shop]!), connected(food, names[food]!)],
  };
  id = `run_two_signins_${String(++count).padStart(4, "0")}`;
  await seedRun("v".repeat(43), id, run);
  return run;
}
/** Sign in is pressed for a Company: the `state` of the sign-in it starts. */
async function signIn(company: string) {
  const response = await act(
    new Request("http://localhost:3000/api/account", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Poppy-Conversation": id,
      },
      body: JSON.stringify({ action: "signin", company }),
    }),
  );
  const answer = await response.json();
  expect(answer).not.toHaveProperty("error");
  const opened = new URL(answer.url);
  expect(opened.origin).toBe(company);
  return opened.searchParams.get("state")!;
}
/** The Company sends the browser back, and where the tab lands. */
const comeBack = async (company: string, state: string) =>
  (
    await callback(
      new Request(
        "http://localhost:3000/api/account/callback?" +
          new URLSearchParams({ code: `code-${state}`, state, iss: company }),
      ),
    )
  ).headers.get("Location");
/** The codes exchanged, each with the Company it was sent to. */
const exchanged = () =>
  transport.mock.calls
    .filter(([url]) => url.endsWith("/oauth/token"))
    .map(([url, init]) => {
      const form = new URLSearchParams(String(init!.body));
      return [new URL(url).origin, form.get("code")];
    });

beforeEach(() => {
  jar.held.clear();
  jar.options.clear();
  jar.held.set("poppy_visitor", "v".repeat(43));
  transport.mockReset().mockImplementation(async (url) => {
    const { origin, host } = new URL(url);
    if (url.endsWith("/poppy/openapi.json"))
      return {
        servers: [{ url: origin }],
        paths: { "/api/products": { get: { operationId: "list_products" } } },
      };
    if (url.endsWith("/oauth/token"))
      return {
        access_token: `access-${host}`,
        refresh_token: `refresh-${host}`,
        token_type: "DPoP",
        expires_in: 3600,
      };
    return { ok: true };
  });
  discover
    .mockReset()
    .mockImplementation(async (url: string) =>
      discovered(new URL(url).origin, names[new URL(url).origin]!),
    );
});

describe("two sign-ins under way in one conversation, at two Companies", () => {
  it("both complete, in either order, each with its own Company's tokens", async () => {
    const run = await conversation();
    const atShop = await signIn(shop);
    const atFood = await signIn(food);
    expect(atShop).not.toBe(atFood);
    // A cookie for each sign-in: for the callback only, and for five minutes.
    for (const state of [atShop, atFood]) {
      expect(jar.held.get(`pap_oauth_${state}`)).toBe(state);
      expect(jar.options.get(`pap_oauth_${state}`)).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/api/account/callback",
        maxAge: 300,
      });
    }
    // The second comes back first.
    expect(await comeBack(food, atFood)).toBe(DONE);
    expect(await comeBack(shop, atShop)).toBe(DONE);
    const [a, b] = run.connections;
    expect(a).toMatchObject({
      accountToken: "refresh-shop.example",
      token: "access-shop.example",
      consentVersion: 1,
    });
    expect(b).toMatchObject({
      accountToken: "refresh-food.example",
      token: "access-food.example",
      consentVersion: 1,
    });
    expect(a!.auth).toBeUndefined();
    expect(b!.auth).toBeUndefined();
    // Each code went to the Company it came from, and to no other.
    expect(exchanged()).toEqual([
      [food, `code-${atFood}`],
      [shop, `code-${atShop}`],
    ]);
    // Both cookies are spent.
    expect([...jar.held.keys()]).toEqual(["poppy_visitor"]);
  });

  it("completes each only for the browser that holds that sign-in's own cookie", async () => {
    const run = await conversation();
    const atShop = await signIn(shop);
    const atFood = await signIn(food);
    // A browser that holds the cookie of Lantern's sign-in, not Juniper's.
    jar.held.delete(`pap_oauth_${atShop}`);
    expect(await comeBack(shop, atShop)).toBe(FAILED);
    expect(exchanged()).toEqual([]);
    expect(run.connections[0]!.accountToken).toBeUndefined();
    // Juniper's sign-in still waits for the browser that started it.
    expect(run.connections[0]!.auth?.state).toBe(atShop);
    // One sign-in's cookie doesn't stand in for the other's state.
    jar.held.set(`pap_oauth_${atShop}`, atFood);
    expect(await comeBack(shop, atShop)).toBe(FAILED);
    // Nor one Company's state for the other Company.
    expect(await comeBack(shop, atFood)).toBe(FAILED);
    expect(run.connections.map((c) => c.accountToken)).toEqual([
      undefined,
      undefined,
    ]);
    // No cookie is read for a state that isn't one of Iris's.
    for (const state of ["", "a.b", "../x", "x".repeat(65)])
      expect(await comeBack(shop, state)).toBe(FAILED);
    expect(exchanged()).toEqual([]);
  });

  it("is single use, each on its own", async () => {
    const run = await conversation();
    const atShop = await signIn(shop);
    const atFood = await signIn(food);
    expect(await comeBack(food, atFood)).toBe(DONE);
    expect(await comeBack(food, atFood)).toBe(FAILED);
    // The other is untouched by either.
    expect(run.connections[0]!.auth?.state).toBe(atShop);
    expect(await comeBack(shop, atShop)).toBe(DONE);
    expect(exchanged()).toHaveLength(2);
  });

  it("replaces a sign-in under way at the same Company, and leaves the other Company's", async () => {
    const run = await conversation();
    const atFood = await signIn(food);
    const first = await signIn(shop);
    const second = await signIn(shop);
    // The first one's cookie went with it.
    expect(jar.held.has(`pap_oauth_${first}`)).toBe(false);
    expect(jar.options.get(`pap_oauth_${first}`)).toMatchObject({
      maxAge: 0,
      path: "/api/account/callback",
    });
    expect(jar.held.get(`pap_oauth_${atFood}`)).toBe(atFood);
    expect(await comeBack(shop, first)).toBe(FAILED);
    expect(await comeBack(shop, second)).toBe(DONE);
    expect(await comeBack(food, atFood)).toBe(DONE);
    expect(run.connections.map((c) => c.accountToken)).toEqual([
      "refresh-shop.example",
      "refresh-food.example",
    ]);
  });
});

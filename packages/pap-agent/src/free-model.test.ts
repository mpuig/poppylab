import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mode = vi.hoisted(() => ({ public: false }));
vi.mock("./deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deployment")>()),
  publicMode: () => mode.public,
}));
import {
  addNeurons,
  admitFreeTurn,
  configureFreeModel,
  dailyNeurons,
  FREE_LIMITS,
  FREE_NEURONS,
  freeModelStatus,
  neuronsToday,
} from "./free-model";
import { configureBackend, memoryBackend } from "./runs";

const binding = { run: vi.fn() };
let answer: Record<string, unknown> = {};
const siteverify = vi.fn(async (_url: string, _init?: RequestInit) =>
  Response.json(answer),
);
const caller = { ip: "203.0.113.7", origin: "https://poppylab.dev" };
const passes = { success: true, hostname: "poppylab.dev", action: "chat" };
/** Every bucket a count was kept in, and every key stored. */
const buckets: string[] = [];
let now = Date.UTC(2026, 10, 27, 12);

beforeEach(() => {
  const backend = memoryBackend();
  buckets.length = 0;
  configureBackend({
    ...backend,
    count: (bucket, key, windowMs) => {
      buckets.push(bucket);
      return backend.count(bucket, key, windowMs);
    },
    put: (bucket, key, value, expected) => {
      buckets.push(`${bucket} ${key}`);
      return backend.put(bucket, key, value, expected);
    },
  });
  configureFreeModel({ binding: () => binding });
  vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
  vi.stubGlobal("fetch", siteverify);
  answer = passes;
  mode.public = true;
  siteverify.mockClear();
  vi.useFakeTimers({ toFake: ["Date"], now: (now += 3 * 86400000) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const admit = (visitor = "visitor-a", token = "token", from = caller) =>
  admitFreeTurn(from, visitor, token, Date.now());
const notice = async (...args: Parameters<typeof admit>) => {
  const admitted = await admit(...args);
  return "notice" in admitted ? admitted.notice : undefined;
};

describe("what the free model needs", () => {
  it("is off without the binding, or until both Turnstile keys are set", () => {
    expect(freeModelStatus()).toEqual({ available: true, siteKey: "site-key" });
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(freeModelStatus()).toMatchObject({ available: false });
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    expect(freeModelStatus()).toMatchObject({ available: false });
    configureFreeModel({ binding: () => undefined });
    expect(freeModelStatus()).toMatchObject({
      reason: expect.stringMatching(
        /^The free model runs only on the deployed site/,
      ),
    });
  });

  it("verifies each token with the secret, for this host and the chat's action", async () => {
    expect(await notice()).toBeUndefined();
    const body = new URLSearchParams(
      String(siteverify.mock.calls[0]![1]!.body),
    );
    expect(body.get("secret")).toBe("secret-key");
    expect(body.get("response")).toBe("token");
    // Nothing of the visitor's address goes with it.
    expect([...body.keys()]).toEqual(["secret", "response"]);
    for (const refused of [
      { ...passes, hostname: "evil.example" },
      { ...passes, action: "login" },
      { success: false, "error-codes": ["timeout-or-duplicate"] },
    ]) {
      answer = refused;
      expect(await notice()).toMatch(/^Cloudflare's browser check didn't pass/);
    }
  });

  it("takes Cloudflare's always-pass test secret only outside public mode", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    answer = { success: true, hostname: "example.com" };
    expect(await notice()).toMatch(/didn't pass/);
    mode.public = false;
    expect(await notice()).toBeUndefined();
  });

  it("counts a turn only once its token passed", async () => {
    answer = { success: false };
    for (let i = 0; i < FREE_LIMITS.visitor.hour + 2; i++) await notice();
    answer = passes;
    expect(await notice()).toBeUndefined();
  });
});

describe("the limits", () => {
  it("lets a visitor take so many turns an hour and a day, then starts again", async () => {
    for (let i = 0; i < FREE_LIMITS.visitor.hour; i++)
      expect(await notice()).toBeUndefined();
    expect(await notice()).toMatch(/for this hour/);
    // Another visitor at another address is unaffected.
    expect(
      await notice("visitor-b", "token", { ...caller, ip: "198.51.100.9" }),
    ).toBeUndefined();
    let taken = FREE_LIMITS.visitor.hour;
    while (taken < FREE_LIMITS.visitor.day) {
      vi.setSystemTime(Date.now() + 3600001);
      for (
        let i = 0;
        i < FREE_LIMITS.visitor.hour && taken < FREE_LIMITS.visitor.day;
        i++, taken++
      )
        expect(
          await notice("visitor-a", "token", {
            ...caller,
            ip: `198.51.100.${taken}`,
          }),
        ).toBeUndefined();
    }
    vi.setSystemTime(Date.now() + 3600001);
    expect(
      await notice("visitor-a", "token", { ...caller, ip: "192.0.2.1" }),
    ).toMatch(/for today/);
    vi.setSystemTime(Date.now() + 86400001);
    expect(await notice()).toBeUndefined();
  });

  it("holds visitors at one network address together, keeping no address", async () => {
    for (let i = 0; i < FREE_LIMITS.network.hour; i++)
      expect(await notice(`visitor-${i}`)).toBeUndefined();
    expect(await notice("visitor-new")).toMatch(/^Visitors on your network/);
    // An IPv6 address counts by its /64.
    const six = { ...caller, ip: "2001:db8:1:2::1" };
    for (let i = 0; i < FREE_LIMITS.network.hour; i++)
      await notice(`six-${i}`, "token", six);
    expect(
      await notice("six-new", "token", {
        ...caller,
        ip: "2001:db8:1:2:ffff::9",
      }),
    ).toMatch(/^Visitors on your network/);
    const stored = JSON.stringify(buckets);
    expect(stored).not.toContain("203.0.113");
    expect(stored).not.toContain("2001:db8");
    expect(stored).toMatch(/free-ip:/);
  });

  it("stops every visitor at the day's cap, and starts again the next UTC day", async () => {
    const admitted = await admit();
    if ("notice" in admitted) throw new Error(admitted.notice);
    admitted.workersAi.onUsage(60);
    admitted.workersAi.onUsage(15.5);
    await admitted.settle();
    expect(await neuronsToday()).toBe(75.5);
    await addNeurons(dailyNeurons() - 75.5 - 199);
    expect(await notice("visitor-b")).toMatch(
      /^The free model has used today's allowance for everyone/,
    );
    const midnight = new Date(Date.now() + 86400000);
    midnight.setUTCHours(0, 0, 0, 1);
    vi.setSystemTime(midnight);
    expect(await neuronsToday()).toBe(0);
    expect(await notice("visitor-b")).toBeUndefined();
  });

  it("caps the day inside the free allocation unless a paid budget is set", () => {
    expect(dailyNeurons()).toBe(7000);
    vi.stubEnv("FREE_MODEL_DAILY_NEURONS", "50000");
    expect(dailyNeurons()).toBe(FREE_NEURONS);
    // $0.11 a day buys 10,000 Neurons more at $0.011 per 1,000.
    vi.stubEnv("FREE_MODEL_PAID_USD_PER_DAY", "0.11");
    expect(dailyNeurons()).toBe(20000);
    vi.stubEnv("FREE_MODEL_DAILY_NEURONS", "nonsense");
    expect(dailyNeurons()).toBe(7000);
  });
});

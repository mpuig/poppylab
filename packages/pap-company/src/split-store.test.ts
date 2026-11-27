/**
 * The split store, as a restarted Durable Object would load it: visitor
 * tenants (one that went idle and started again is still stored, whichever
 * request's save ends last, and an evicted one is deleted), and the
 * protocol state, whose rows each fit one value with every cap full.
 */
import { afterEach, expect, it, vi } from "vitest";
import { ReplayCache } from "@poppy-lab/pap-client/core";
import { MAX_CLIENT_ID } from "./gateway/context.ts";
import { setup } from "./gateway/test-company.ts";
import {
  emptyState,
  type CompanyDefinition,
  type Deployment,
  type GatewayState,
} from "./gateway/types.ts";
import {
  MAX_VALUE_BYTES,
  splitStore,
  valueBytes,
  type KeyValue,
} from "./split-store.ts";

type Held = { wait?: () => Promise<void> };
/** Holds the next caller of `target.wait`: `reached` once it waits, until `release`. */
function hold(target: Held) {
  let arrived!: () => void, release!: () => void;
  const reached = new Promise<void>((done) => (arrived = done));
  const held = new Promise<void>((done) => (release = done));
  target.wait = () => {
    delete target.wait;
    arrived();
    return held;
  };
  return { reached, release };
}

/** A Durable Object's storage, in memory. A test holds a `put` before it writes. */
function storage() {
  const data = new Map<string, unknown>();
  const kv: KeyValue & Held = {
    async get<T>(k: string) {
      return structuredClone(data.get(k)) as T | undefined;
    },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map(
        [...data]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k, structuredClone(v) as T]),
      );
    },
    async put(entries) {
      await kv.wait?.();
      // As Cloudflare does, a value over its bound fails the whole write.
      for (const v of Object.values(entries))
        if (valueBytes(v) > MAX_VALUE_BYTES) throw new Error("value too large");
      for (const [k, v] of Object.entries(entries))
        data.set(k, structuredClone(v));
    },
    async delete(keys) {
      for (const k of keys) data.delete(k);
      return keys.length;
    },
  };
  return Object.assign(kv, { data });
}

/**
 * A Company whose visitors each count their own POSTs, on the split store.
 * A test holds a POST in its route, after its tenant was entered.
 */
async function counting(deploy: Partial<Deployment>, kv = storage()) {
  const route: Held = {};
  const company: Partial<CompanyDefinition> = {
    mount: (app, ctx) => {
      app.post("/api/count", async (c) => {
        await route.wait?.();
        const count = (Number(ctx.state.count) || 0) + 1;
        ctx.state.count = count;
        return c.json({ count });
      });
    },
  };
  const x = await setup(
    { isolation: "visitor", store: await splitStore(kv), ...deploy },
    company,
  );
  const post = (user: string) => x.call("/api/count", { method: "POST", user });
  /** One more POST of this visitor: its count so far. */
  const count = async (user: string) => {
    const r = await post(user);
    expect(r.status).toBe(200);
    return ((await r.json()) as { count: number }).count;
  };
  /** The count of each tenant a restart would load. */
  const stored = async () =>
    Object.values((await splitStore(kv)).value.tenants)
      .map((tenant) => tenant.business.count)
      .sort();
  return { kv, route, post, count, stored };
}

/** Fails the next `put` once it is released, as a store that fails once. */
function failNext(kv: Held) {
  let arrived!: () => void, release!: () => void;
  const reached = new Promise<void>((done) => (arrived = done));
  const failing = new Promise<void>((_, fail) => {
    release = () => fail(new Error("storage failed"));
  });
  kv.wait = () => {
    delete kv.wait;
    arrived();
    return failing;
  };
  return { reached, release };
}

afterEach(() => vi.useRealTimers());

it("keeps a visitor's tenant that went idle and started again", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await counting({ tenantIdleMs: 1000 });
  await x.count("usr_a");
  expect(await x.count("usr_a")).toBe(2);
  expect(await x.stored()).toEqual([2]);
  vi.setSystemTime(Date.now() + 2000);
  // Idle too long, so it starts again: a restart knows the new tenant.
  expect(await x.count("usr_a")).toBe(1);
  expect(await x.stored()).toEqual([1]);
});

it("keeps it when another visitor's save began before its own and ends after", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await counting({ tenantIdleMs: 1000 });
  await x.count("usr_a");
  vi.setSystemTime(Date.now() + 2000);
  await x.count("usr_b");
  // usr_a starts again and waits in its route: the old tenant is dropped
  // and the new one is in memory only.
  const entered = hold(x.route);
  const again = x.count("usr_a");
  await entered.reached;
  // usr_b's request ends meanwhile. Its save takes the dropped tenant's key
  // and waits to write.
  const writing = hold(x.kv);
  const other = x.count("usr_b");
  await writing.reached;
  // usr_a's request ends and saves the new tenant, then usr_b's save goes on.
  entered.release();
  expect(await again).toBe(1);
  writing.release();
  expect(await other).toBe(2);
  expect(await x.stored()).toEqual([1, 2]);
});

it("deletes the tenant of a visitor evicted for a newer one", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await counting({ maxTenants: 2 });
  await x.count("usr_a");
  await x.count("usr_a");
  await x.count("usr_a");
  expect(await x.stored()).toEqual([3]);
  for (const user of ["usr_b", "usr_b", "usr_c"]) {
    vi.setSystemTime(Date.now() + 1000);
    await x.count(user);
  }
  // usr_a, the least recently used, is gone from storage as from memory.
  expect(await x.stored()).toEqual([1, 2]);
  // It starts again in place of usr_b, and both changes are stored.
  vi.setSystemTime(Date.now() + 1000);
  expect(await x.count("usr_a")).toBe(1);
  expect(await x.stored()).toEqual([1, 1]);
});

it("after a failed save, answers 503 and has the host start again from storage", async () => {
  const discard = vi.fn();
  const x = await counting({ discard });
  await x.count("usr_a");
  await x.count("usr_a");
  const put = failNext(x.kv);
  const failing = x.post("usr_a");
  await put.reached;
  put.release();
  expect((await failing).status).toBe(503);
  expect(discard).toHaveBeenCalledOnce();
  // This gateway holds a count storage never got, so it answers no more,
  // even with storage working again.
  expect((await x.post("usr_a")).status).toBe(503);
  expect(discard).toHaveBeenCalledOnce();
  // The one the host creates next loads what was stored, and goes on.
  const next = await counting({}, x.kv);
  expect(await next.count("usr_a")).toBe(3);
});

it("keeps an eviction for the next save when the save that had it fails", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const x = await counting({ maxTenants: 2 });
  await x.count("usr_a");
  vi.setSystemTime(Date.now() + 1000);
  await x.count("usr_b");
  vi.setSystemTime(Date.now() + 1000);
  // usr_c evicts usr_a, and its save fails; usr_b's, which overlaps it,
  // still deletes usr_a.
  const put = failNext(x.kv);
  const failing = x.post("usr_c");
  await put.reached;
  expect(await x.count("usr_b")).toBe(2);
  put.release();
  expect((await failing).status).toBe(503);
  expect(await x.stored()).toEqual([2]);
});

/**
 * The protocol state with every cap full, each record as large as a client
 * can make it: the longest client_id, User ID, Agent ID, `state` and
 * client name, and a replay cache filled by many clients.
 */
function worstCase(): GatewayState {
  const now = Date.now();
  const key = (i: number) => String(i).padStart(43, "k");
  const client = (i: number) =>
    `https://${"c".repeat(MAX_CLIENT_ID - 24)}/${String(i).padStart(10, "0")}.json`;
  const long = (n: number, i: number) => `${i}`.padEnd(n, "u");
  const name = "é".repeat(80);
  const scopes = "things:read things:write poppy:browser-sign-in";
  const resources = ["acct-checking-0001", "acct-savings-0002"];
  const many = <T>(n: number, record: (i: number) => T) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [key(i), record(i)]),
    );
  const replay = new ReplayCache();
  for (let i = 0; i < 10000; i++)
    replay.accept(
      `session:${client(i % 5)}:${key(i)}`,
      now / 1000 + 60,
      client(i % 5),
    );
  return {
    ...emptyState(),
    sessions: many(2000, (i) => ({
      client: client(i),
      user: long(256, i),
      agent: long(256, i),
      expires: now,
      account: "elena",
    })),
    tokens: many(2000, (i) => ({
      client: client(i),
      binding: key(i),
      expires: now,
      accountId: "elena",
      scopes,
      grant: key(i),
      resource: "https://company.test/mcp",
    })),
    grants: many(1000, (i) => ({
      account: "elena",
      holder: key(i),
      browser: key(i),
      id: key(i).slice(0, 32),
      client: client(i),
      name,
      scopes,
      expires: now,
      dpop: key(i),
      resources,
    })),
    replays: replay.snapshot(),
    consents: many(500, (i) => ({
      client: client(i),
      redirect: client(i),
      state: long(100, i),
      scopes,
      challenge: key(i),
      expires: now,
      dpop: key(i),
    })),
    codes: many(500, (i) => ({
      client: client(i),
      redirect: client(i),
      challenge: key(i),
      scopes,
      account: "elena",
      expires: now,
      browser: key(i),
      dpop: key(i),
      resources,
    })),
    pushed: many(500, (i) => ({
      client: client(i),
      params: {
        response_type: "code",
        client_id: client(i),
        redirect_uri: client(i),
        scope: scopes,
        state: long(100, i),
        code_challenge: key(i),
        code_challenge_method: "S256",
        resource: "https://company.test/mcp",
      },
      expires: now,
      dpop: key(i),
      consent: key(i),
    })),
    devices: many(500, (i) => ({
      client: client(i),
      name,
      scopes,
      userCode: "BCDFGHJK",
      expires: now,
      interval: 5,
      polled: now,
      dpop: key(i),
      consent: key(i),
      approved: { account: "elena", scopes, browser: key(i), resources },
    })),
    links: many(2000, (i) => ({ tenant: key(i), used: now })),
    joins: many(1000, (i) => ({
      expires: now,
      client: client(i),
      holder: key(i),
      session: key(i),
      account: "elena",
      scopes,
      grant: key(i),
    })),
    browsers: many(1000, (i) => ({
      client: client(i),
      holder: key(i),
      session: key(i),
      expires: now,
      account: "elena",
      scopes,
      grant: key(i),
    })),
    joinKey: key(0),
  };
}

it("saves the protocol state with every cap full, each row well within one value", async () => {
  const kv = storage();
  const store = await splitStore(kv);
  Object.assign(store.value, worstCase());
  // Several times what one value holds, all together.
  expect(valueBytes(store.value)).toBeGreaterThan(3 * MAX_VALUE_BYTES);
  await store.save({ tenants: [], removed: [] });
  for (const [key, value] of kv.data)
    expect(valueBytes(value), key).toBeLessThan(0.9 * MAX_VALUE_BYTES);
  const restarted = await splitStore(kv);
  expect(restarted.value).toEqual({ ...store.value, tenants: {} });
});

it("writes nothing when one value would be too large, and fails the save", async () => {
  const kv = storage();
  const store = await splitStore(kv);
  store.value.sessions.s1 = { client: "c", user: "u", expires: 1 };
  await store.save({ tenants: [], removed: [] });
  store.value.sessions.s2 = { client: "c", user: "u", expires: 2 };
  // A Company's own field in `state`, past what a value holds.
  (store.value as Record<string, unknown>).notes = "n".repeat(MAX_VALUE_BYTES);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(store.save({ tenants: [], removed: [] })).rejects.toThrow(
    "state is",
  );
  expect(error).toHaveBeenCalledWith(
    "state_value_too_large",
    "state",
    expect.any(Number),
  );
  error.mockRestore();
  expect(Object.keys((await splitStore(kv)).value.sessions)).toEqual(["s1"]);
});

it("reads a state saved in one row, and moves its collections to their own", async () => {
  const kv = storage();
  const old = {
    ...emptyState(),
    sessions: { s1: { client: "c", user: "u", expires: 1 } },
    replays: [["session:c:1", 1]],
    joinKey: "k",
  };
  await kv.put({ state: old });
  const store = await splitStore(kv);
  expect(store.value.sessions).toEqual(old.sessions);
  expect(store.value.joinKey).toBe("k");
  await store.save({ tenants: [], removed: [] });
  expect(kv.data.get("state")).not.toHaveProperty("sessions");
  expect(kv.data.get("state:sessions")).toEqual(old.sessions);
  expect((await splitStore(kv)).value.sessions).toEqual(old.sessions);
});

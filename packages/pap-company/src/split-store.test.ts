/**
 * Visitor tenants in the split store, as a restarted Durable Object would
 * load them: one that went idle and started again is still stored, whichever
 * request's save ends last, and an evicted one is deleted.
 */
import { afterEach, expect, it, vi } from "vitest";
import { setup } from "./gateway/test-company.ts";
import type { CompanyDefinition, Deployment } from "./gateway/types.ts";
import { splitStore, type KeyValue } from "./split-store.ts";

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
      for (const [k, v] of Object.entries(entries))
        data.set(k, structuredClone(v));
    },
    async delete(keys) {
      for (const k of keys) data.delete(k);
      return keys.length;
    },
  };
  return kv;
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

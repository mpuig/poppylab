import { afterEach, expect, it, vi } from "vitest";
import {
  acquireRun,
  allow,
  configureBackend,
  createRun,
  loadRun,
  memoryBackend,
  releaseRun,
  runForState,
  visitorOf,
} from "./runs";

function jar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (name: string) =>
      values.has(name) ? { value: values.get(name)! } : undefined,
    set: (name: string, value: string) => void values.set(name, value),
  };
}
afterEach(() => {
  vi.useRealTimers();
  configureBackend(memoryBackend());
});

it("gives each browser its own unguessable visitor, stored only as a hash", () => {
  const a = jar(),
    b = jar();
  const va = visitorOf(a, true),
    vb = visitorOf(b, true);
  expect(va).not.toBe(vb);
  const raw = [...a.values.values()][0]!;
  expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(va).not.toContain(raw);
  expect(visitorOf(a)).toBe(va);
  // A forged, malformed cookie is never accepted as a visitor.
  expect(visitorOf(jar({ poppy_visitor: "admin" }))).toBeUndefined();
});

it("never lets one visitor load, lock or finish another visitor's run", async () => {
  configureBackend(memoryBackend());
  const held = await createRun("visitor-a", "https://juniper.example");
  held.run.auth = {
    state: "s".repeat(32),
    verifier: "v",
    expires: Date.now() + 60000,
    issuer: "https://juniper.example",
    scopes: "read",
  };
  await releaseRun("visitor-a", held);
  expect(await loadRun("visitor-b", held.id)).toBeUndefined();
  expect(await acquireRun("visitor-b", held.id)).toBeUndefined();
  expect(await runForState("visitor-b", "s".repeat(32))).toBeUndefined();
  expect((await runForState("visitor-a", "s".repeat(32)))?.id).toBe(held.id);
});

it("locks a run for one request at a time and recovers a crashed lock", async () => {
  configureBackend(memoryBackend());
  const held = await createRun("v", "https://juniper.example");
  expect(await acquireRun("v", held.id)).toBe("busy");
  await releaseRun("v", held);
  const first = await acquireRun("v", held.id);
  expect(first).not.toBe("busy");
  expect(await acquireRun("v", held.id)).toBe("busy");
  // A request that never released: the lock lapses after two minutes.
  vi.useFakeTimers({ now: Date.now() + 121000 });
  expect(await acquireRun("v", held.id)).not.toBe("busy");
});

it("keeps at most five runs per visitor, dropping the oldest", async () => {
  configureBackend(memoryBackend());
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) {
    vi.useFakeTimers({ now: Date.now() + i * 1000 });
    const held = await createRun("v", "https://juniper.example");
    await releaseRun("v", held);
    ids.push(held.id);
  }
  const kept = await Promise.all(ids.map((id) => loadRun("v", id)));
  expect(kept.map(Boolean)).toEqual([
    false,
    false,
    true,
    true,
    true,
    true,
    true,
  ]);
});

it("counts budgets per visitor and globally", async () => {
  configureBackend(memoryBackend());
  const limits = {
    visitor: [{ name: "chat", limit: 2, windowMs: 60000 }],
    global: [{ name: "all", limit: 2, windowMs: 60000 }],
  };
  expect(await allow("a", limits)).toBe(true);
  expect(await allow("a", limits)).toBe(true);
  expect(await allow("a", limits)).toBe(false);
  expect(await allow("b", limits)).toBe(false); // global budget spent
  vi.useFakeTimers({ now: Date.now() + 61000 });
  expect(await allow("b", limits)).toBe(true);
});

it("merges this request's operations when the lock was lost, and reports it", async () => {
  configureBackend(memoryBackend());
  const first = await createRun("v", "https://juniper.example");
  // The lock lapses and a second request takes the run and saves.
  vi.useFakeTimers({ now: Date.now() + 121000 });
  const second = await acquireRun("v", first.id);
  expect(second).not.toBe("busy");
  (second as Exclude<typeof second, "busy" | undefined>).run.history.push({
    role: "user",
    content: "second",
  });
  await releaseRun("v", second as Exclude<typeof second, "busy" | undefined>);
  // The first request finishes late with an operation the Company holds.
  const late = {
    ...first,
    run: { ...first.run, operations: { op_1: { operation_id: "op_1" } } },
  };
  const ok = await releaseRun("v", late as never);
  expect(ok).toBe(false);
  const stored = (await loadRun("v", first.id))!.run;
  expect(stored.history.map((m) => m.content)).toEqual(["second"]);
  expect(stored.operations).toHaveProperty("op_1");
  expect(stored.busy).toBe(false);
});

it("never evicts a run another request currently holds", async () => {
  configureBackend(memoryBackend());
  const held = await createRun("v", "https://juniper.example"); // stays locked
  for (let i = 0; i < 6; i++) {
    vi.useFakeTimers({ now: Date.now() + 1000 });
    await releaseRun("v", await createRun("v", "https://juniper.example"));
  }
  expect(await loadRun("v", held.id)).toBeDefined();
});

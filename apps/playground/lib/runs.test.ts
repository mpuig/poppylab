import { afterEach, expect, it, vi } from "vitest";
import {
  acquireRun,
  allow,
  configureBackend,
  createRun,
  endedConversation,
  listConversations,
  loadRun,
  memoryBackend,
  readConversation,
  releaseRun,
  resetDemo,
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

it("keeps at most five runs running per visitor, ending the oldest", async () => {
  configureBackend(memoryBackend());
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) {
    vi.useFakeTimers({ now: Date.now() + i * 1000 });
    const held = await createRun("v", "https://juniper.example");
    held.run.title = `Request ${i}`;
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

it("ends an expired conversation: readable for a week, without tokens, never continued", async () => {
  configureBackend(memoryBackend());
  const start = Date.now();
  vi.useFakeTimers({ now: start });
  const held = await createRun("v", "https://juniper.example");
  Object.assign(held.run, {
    title: "Move my delivery",
    accountToken: "refresh-secret",
    token: "access-secret",
    dpop: { kty: "EC", d: "private" },
    sessionId: "sid",
    auth: {
      state: "s",
      verifier: "v",
      expires: start + 1000,
      issuer: "i",
      scopes: "",
    },
    transcript: [{ role: "user", content: "Move my delivery" }],
    log: [{ at: start, text: "GET /api/account/deliveries · Poppy Session" }],
    operations: {
      op_1: {
        operation_id: "op_1",
        revision: "r1",
        state: "completed",
        summary: "Moved",
        request: { url: "https://juniper.example/api", body: {} },
      },
    },
  });
  await releaseRun("v", held);
  // Still running: a request that names it goes on in it.
  expect(await endedConversation("v", held.id)).toBeUndefined();
  vi.setSystemTime(start + 31 * 60000);
  expect(await loadRun("v", held.id)).toBeUndefined();
  expect(await acquireRun("v", held.id)).toBeUndefined();
  // A page that still shows it is told it ended; one that names a
  // conversation unknown here, or another visitor's, is told nothing.
  expect(await endedConversation("v", held.id)).toEqual({
    keptUntil: start + 7 * 86400000,
  });
  expect(await endedConversation("v", "never_started_0001")).toBeUndefined();
  expect(await endedConversation("other", held.id)).toBeUndefined();
  expect(await endedConversation("v", undefined)).toBeUndefined();
  const read = await readConversation("v", held.id);
  expect(read).toMatchObject({
    archived: true,
    transcript: [{ role: "user", content: "Move my delivery" }],
    // The Inspector of an ended conversation lists its calls too.
    log: [{ at: start, text: "GET /api/account/deliveries · Poppy Session" }],
    keepUntil: start + 7 * 86400000,
  });
  expect(JSON.stringify(read)).not.toMatch(/secret|private|"sid"|verifier/);
  expect(read!.operations!.op_1).not.toHaveProperty("request");
  // Another visitor can't read it, whatever the address says.
  expect(await readConversation("other", held.id)).toBeUndefined();
  expect(await listConversations("v")).toEqual([
    expect.objectContaining({
      id: held.id,
      title: "Move my delivery",
      active: false,
      company: "juniper.example",
    }),
  ]);
  vi.setSystemTime(start + 7 * 86400000 + 1);
  expect(await readConversation("v", held.id)).toBeUndefined();
  expect(await listConversations("v")).toEqual([]);
});

it("keeps at most twenty conversations, dropping the oldest ended ones", async () => {
  configureBackend(memoryBackend());
  const ids: string[] = [];
  const start = Date.now();
  for (let i = 0; i < 23; i++) {
    vi.useFakeTimers({ now: start + i * 1000 });
    const held = await createRun("v", "https://juniper.example");
    held.run.title = `Request ${i}`;
    await releaseRun("v", held);
    ids.push(held.id);
  }
  const list = await listConversations("v");
  expect(list).toHaveLength(20);
  expect(list[0]!.id).toBe(ids[22]);
  expect(list.filter((c) => c.active)).toHaveLength(5);
  expect(list.map((c) => c.id)).not.toContain(ids[0]);
});

it("starts the demo over: running conversations end and new ones carry a new epoch", async () => {
  configureBackend(memoryBackend());
  const before = await createRun("v", "https://juniper.example");
  before.run.title = "Move my delivery";
  await releaseRun("v", before);
  expect(before.run.epoch).toBeUndefined();
  await resetDemo("v");
  expect(await loadRun("v", before.id)).toBeUndefined();
  expect((await readConversation("v", before.id))?.archived).toBe(true);
  const after = await createRun("v", "https://juniper.example");
  expect(after.run.epoch).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  const other = await createRun("w", "https://juniper.example");
  expect(other.run.epoch).toBeUndefined();
  await resetDemo("v");
  const again = await createRun("v", "https://juniper.example");
  expect(again.run.epoch).not.toBe(after.run.epoch);
});

it("leaves no trail of conversations nothing was said in", async () => {
  configureBackend(memoryBackend());
  const first = await createRun("v", "https://juniper.example");
  await releaseRun("v", first);
  const second = await createRun("v", "https://juniper.example");
  await releaseRun("v", second);
  expect((await listConversations("v")).map((c) => c.id)).toEqual([second.id]);
  // One with a sign-in under way is kept.
  const signing = await createRun("v", "https://juniper.example");
  signing.run.auth = {
    state: "s",
    verifier: "v",
    expires: Date.now() + 60000,
    issuer: "https://juniper.example",
    scopes: "",
  };
  await releaseRun("v", signing);
  const third = await createRun("v", "https://juniper.example");
  await releaseRun("v", third);
  expect((await listConversations("v")).map((c) => c.id).sort()).toEqual(
    [signing.id, third.id].sort(),
  );
});

it("doesn't list an ended conversation that has no words left to read", async () => {
  configureBackend(memoryBackend());
  const start = Date.now();
  vi.useFakeTimers({ now: start });
  // Signed in, and a sign-in or sign-out took back what was said in it.
  const held = await createRun("v", "https://juniper.example");
  held.run.accountToken = "refresh-secret";
  await releaseRun("v", held);
  // While it runs it is the conversation the page is on, with no messages.
  expect(await listConversations("v")).toEqual([
    expect.objectContaining({ id: held.id, active: true }),
  ]);
  vi.setSystemTime(start + 31 * 60000);
  // Ended, there is nothing in it to open.
  expect(await listConversations("v")).toEqual([]);
});

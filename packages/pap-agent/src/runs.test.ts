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
  moveConversations,
  readConversation,
  releaseRun,
  resetDemo,
  runForState,
  snapshotRows,
  visitorOf,
  type Backend,
} from "./runs";
import { bytesOf, RUN_LIMITS } from "./run-size";
import { addConnection, connectionAt, onlyConnection } from "./connections";
import { recordTurn, removeConnection } from "./transcript";

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
  onlyConnection(held.run).auth = {
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
    run: {
      ...first.run,
      connections: [
        {
          ...onlyConnection(first.run),
          operations: { op_1: { operation_id: "op_1" } },
        },
      ],
    },
  };
  const ok = await releaseRun("v", late as never);
  expect(ok).toBe(false);
  const stored = (await loadRun("v", first.id))!.run;
  expect(stored.history.map((m) => m.content)).toEqual(["second"]);
  expect(onlyConnection(stored).operations).toHaveProperty("op_1");
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
    transcript: [{ role: "user", content: "Move my delivery" }],
    log: [{ at: start, text: "GET /api/account/deliveries · Poppy Session" }],
  });
  Object.assign(onlyConnection(held.run), {
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
  expect(onlyConnection(read!).operations!.op_1).not.toHaveProperty("request");
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

it("starts a conversation at whatever address was typed: discovery says whether a Company is there", async () => {
  configureBackend(memoryBackend());
  const held = await createRun("v", "juniper.example");
  expect(held.run.connections).toEqual([
    { url: "juniper.example", user: "", visitor: "v" },
  ]);
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
  onlyConnection(signing.run).auth = {
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

it("lists the Companies removed from a conversation too, marked as removed", async () => {
  configureBackend(memoryBackend());
  const held = await createRun("v", "https://juniper.example");
  held.run.title = "What's on the menu?";
  addConnection(held.run, "https://lantern.example");
  addConnection(held.run, "https://harbor.example");
  removeConnection(
    held.run,
    connectionAt(held.run, "https://lantern.example")!,
  );
  // Removed and connected again: listed once, as connected.
  removeConnection(held.run, connectionAt(held.run, "https://harbor.example")!);
  addConnection(held.run, "https://harbor.example");
  await releaseRun("v", held);
  const [listed] = await listConversations("v");
  expect(listed!.companies).toEqual([
    {
      origin: "https://juniper.example",
      name: "juniper.example",
      url: "https://juniper.example",
    },
    {
      origin: "https://harbor.example",
      name: "harbor.example",
      url: "https://harbor.example",
    },
    {
      origin: "https://lantern.example",
      name: "lantern.example",
      url: "https://lantern.example",
      removed: true,
    },
  ]);
  // The line for a list that shows one name names the connected ones.
  expect(listed!.company).toBe("juniper.example, harbor.example");
});

it("doesn't list an ended conversation that has no words left to read", async () => {
  configureBackend(memoryBackend());
  const start = Date.now();
  vi.useFakeTimers({ now: start });
  // Signed in, and a sign-in or sign-out took back what was said in it.
  const held = await createRun("v", "https://juniper.example");
  onlyConnection(held.run).accountToken = "refresh-secret";
  await releaseRun("v", held);
  // While it runs it is the conversation the page is on, with no messages.
  expect(await listConversations("v")).toEqual([
    expect.objectContaining({ id: held.id, active: true }),
  ]);
  vi.setSystemTime(start + 31 * 60000);
  // Ended, there is nothing in it to open.
  expect(await listConversations("v")).toEqual([]);
});

it("holds a conversation's Companies in one run: one lock, one lifetime, and each Company's part where it belongs when it ends", async () => {
  configureBackend(memoryBackend());
  const start = Date.now();
  vi.useFakeTimers({ now: start });
  const held = await createRun("v", "https://juniper.example");
  const juniper = onlyConnection(held.run);
  const lantern = addConnection(held.run, "https://lantern.example");
  const harbor = addConnection(held.run, "https://harborline.example");
  // The User ID for each Company comes from the conversation's visitor.
  expect(held.run.connections.map((c) => c.visitor)).toEqual(["v", "v", "v"]);
  recordTurn(held.run, lantern, "What's on the menu?", "Ramen.");
  held.run.title = "What's on the menu?";
  Object.assign(juniper, {
    accountToken: "refresh-juniper",
    sessionId: "sid-juniper",
    operations: {
      waiting: {
        operation_id: "waiting",
        state: "proposed",
        request: { url: "https://juniper.example/api", body: {} },
      },
    },
  });
  // Harborline leaves the conversation with an approval out.
  harbor.operations = {
    sent: {
      operation_id: "sent",
      revision: "r1",
      state: "uncertain",
      expires_at: "2030-01-01T00:00:00Z",
      approval: { approved_at: 1, reference: "apr_1" },
      request: { url: "https://harborline.example/api/pay", body: {} },
    },
  };
  removeConnection(held.run, harbor);
  await releaseRun("v", held);

  // A sign-in under way at one of them finds the run it is in.
  const again = await acquireRun("v", held.id);
  if (!again || again === "busy") throw new Error("not held");
  connectionAt(again.run, "https://lantern.example")!.auth = {
    state: "s".repeat(32),
    verifier: "v",
    expires: start + 60000,
    issuer: "https://lantern.example",
    scopes: "",
  };
  await releaseRun("v", again);
  expect((await runForState("v", "s".repeat(32)))?.id).toBe(held.id);
  // Listed once: under its Companies' names and its first one's address,
  // for a list that shows one of each, and with each Company on its own.
  const listed = {
    id: held.id,
    company: "juniper.example, lantern.example",
    url: "https://juniper.example",
    companies: [
      {
        origin: "https://juniper.example",
        name: "juniper.example",
        url: "https://juniper.example",
      },
      {
        origin: "https://lantern.example",
        name: "lantern.example",
        url: "https://lantern.example",
      },
      // A Company that left the conversation is listed after them, as
      // removed, and is not in the line of names.
      {
        origin: "https://harborline.example",
        name: "harborline.example",
        url: "https://harborline.example",
        removed: true,
      },
    ],
  };
  expect(await listConversations("v")).toEqual([
    expect.objectContaining({ ...listed, active: true }),
  ]);

  vi.setSystemTime(start + 31 * 60000);
  const read = (await readConversation("v", held.id))!;
  expect(read.archived).toBe(true);
  expect(JSON.stringify(read)).not.toMatch(/refresh-juniper|sid-juniper/);
  // Each Company's proposals as they ended, none of them to send again.
  expect(read.connections).toEqual([
    {
      url: "https://juniper.example",
      user: "",
      operations: { waiting: { operation_id: "waiting", state: "proposed" } },
    },
    { url: "https://lantern.example", user: "", operations: {} },
  ]);
  expect(read.former).toEqual([
    {
      url: "https://harborline.example",
      name: "harborline.example",
      operations: {
        sent: {
          operation_id: "sent",
          revision: "r1",
          state: "uncertain",
          expires_at: "2030-01-01T00:00:00Z",
          approval: { approved_at: 1, reference: "apr_1" },
        },
      },
    },
  ]);
  expect(read.transcript!.map((entry) => entry.company)).toEqual([
    "https://lantern.example",
    "https://lantern.example",
  ]);
  // Ended, it is still listed with its Companies.
  expect(await listConversations("v")).toEqual([
    expect.objectContaining({ ...listed, active: false }),
  ]);
});

it("lists a conversation with no Company by its words, and says it has none where the name would be", async () => {
  configureBackend(memoryBackend());
  const held = await createRun("v");
  expect(held.run.connections).toEqual([]);
  held.run.title = "What's on the menu?";
  await releaseRun("v", held);
  expect(await listConversations("v")).toEqual([
    expect.objectContaining({
      id: held.id,
      title: "What's on the menu?",
      company: "No company yet",
      url: "",
      companies: [],
      active: true,
    }),
  ]);
  // One in which nothing was said doesn't outlive the next, as before.
  const empty = await createRun("v");
  await releaseRun("v", empty);
  const next = await createRun("v", "https://juniper.example");
  await releaseRun("v", next);
  expect((await listConversations("v")).map((c) => c.id).sort()).toEqual(
    [held.id, next.id].sort(),
  );
  // Once it has ended, no Company is to come.
  vi.useFakeTimers({ now: Date.now() + 31 * 60000 });
  expect(
    (await listConversations("v")).find((c) => c.id === held.id),
  ).toMatchObject({ company: "No company", url: "", active: false });
});

/**
 * A store that keeps copies, as the Workers' does: what a request holds
 * is its own until it is put.
 */
function copying(): Backend {
  const inner = memoryBackend();
  return {
    ...inner,
    get: async (visitor, key) => structuredClone(await inner.get(visitor, key)),
    put: async (visitor, key, value, expected) =>
      inner.put(visitor, key, structuredClone(value), expected),
    list: async (visitor, prefix) =>
      structuredClone(await inner.list(visitor, prefix)),
  };
}
type Taken = Exclude<
  Awaited<ReturnType<typeof acquireRun>>,
  "busy" | undefined
>;

it("says so when a conversation has grown too large to store, keeps what was stored and leaves it unlocked", async () => {
  configureBackend(copying());
  const first = await createRun("v", "https://juniper.example");
  first.run.title = "What do you sell?";
  await releaseRun("v", first);
  const turn = (await acquireRun("v", first.id)) as Taken;
  turn.run.history.push({ role: "assistant", content: "Oranges." });
  turn.run.transcript = [
    { role: "assistant", content: "x".repeat(RUN_LIMITS.bytes) },
  ];
  await expect(releaseRun("v", turn)).rejects.toMatchObject({
    name: "RunNotSaved",
    reason: "too_large",
  });
  // The next request isn't told to wait, and finds the conversation as
  // it was before the turn that couldn't be kept.
  const next = (await acquireRun("v", first.id)) as Taken;
  expect(next).toMatchObject({ run: { title: "What do you sell?" } });
  expect(next.run.history).toEqual([]);
  expect(next.run.transcript).toBeUndefined();
  await releaseRun("v", next);
});

it("says so when the store refuses the value, and leaves the conversation unlocked", async () => {
  const store = copying();
  configureBackend(store);
  const first = await createRun("v", "https://juniper.example");
  first.run.title = "What do you sell?";
  await releaseRun("v", first);
  const turn = (await acquireRun("v", first.id)) as Taken;
  turn.run.history.push({ role: "assistant", content: "Oranges." });
  // The store takes the lock's release once the turn's value was refused.
  const put = store.put;
  let refused = 0;
  store.put = async (visitor, key, value, expected) => {
    if (!refused++) throw new Error("storage unavailable");
    return put(visitor, key, value, expected);
  };
  await expect(releaseRun("v", turn)).rejects.toMatchObject({
    name: "RunNotSaved",
    reason: "failed",
  });
  const next = await acquireRun("v", first.id);
  expect(next).not.toBe("busy");
  expect((next as Taken).run.history).toEqual([]);
});

it("keeps a conversation of the usual size, three Companies and all", async () => {
  configureBackend(copying());
  const held = await createRun("v", "https://juniper.example");
  addConnection(held.run, "https://food.example");
  addConnection(held.run, "https://bank.example");
  for (let i = 0; i < 30; i++)
    recordTurn(
      held.run,
      held.run.connections[i % 3]!,
      "What do you offer?",
      "x".repeat(4000),
    );
  expect(bytesOf(held.run)).toBeLessThan(RUN_LIMITS.connect);
  expect(await releaseRun("v", held)).toBe(true);
});

it("moves a visitor's conversations to an account as they are, and leaves one another request holds", async () => {
  configureBackend(memoryBackend());
  const visitor = "visitor-a",
    account = "account-user";
  const one = await createRun(visitor, "https://shop.example");
  one.run.title = "Move my delivery";
  await releaseRun(visitor, one);
  const busy = await createRun(visitor);
  busy.run.title = "Still answering";
  // `busy` stays locked, as a turn under way holds it.
  expect(await moveConversations(visitor, account)).toEqual({
    moved: 1,
    skipped: 1,
  });
  const moved = await readConversation(account, one.id);
  expect(moved).toMatchObject({ title: "Move my delivery", busy: false });
  expect(moved!.connections[0]!.url).toBe("https://shop.example");
  // The User ID the Company knows comes from the visitor it began with.
  expect(moved!.connections[0]!.visitor).toBe(visitor);
  expect(await readConversation(visitor, one.id)).toBeUndefined();
  expect((await listConversations(visitor)).map((c) => c.id)).toEqual([
    busy.id,
  ]);
});

it("skips active runs when the destination is at MAX_RUNS, while still moving archived runs", async () => {
  configureBackend(memoryBackend());
  const visitor = "visitor-max-runs",
    account = "account-max-runs";
  const start = Date.now();
  vi.useFakeTimers({ now: start });

  // Visitor starts one conversation that will expire and become archived.
  const archived = await createRun(visitor, "https://shop.example");
  archived.run.title = "Ended visitor chat";
  await releaseRun(visitor, archived);

  vi.setSystemTime(start + 31 * 60000);

  // Account already holds MAX_RUNS (5) active runs.
  for (let i = 0; i < 5; i++) {
    const held = await createRun(account, "https://shop.example");
    held.run.title = `Account active ${i}`;
    await releaseRun(account, held);
  }

  // Visitor also holds 2 active runs.
  const activeIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const held = await createRun(visitor, "https://shop.example");
    held.run.title = `Visitor active ${i}`;
    await releaseRun(visitor, held);
    activeIds.push(held.id);
  }

  expect(await moveConversations(visitor, account)).toEqual({
    moved: 1,
    skipped: 2,
  });

  // Archived run moved into account; active runs stayed unlocked in visitor.
  const accountList = await listConversations(account);
  expect(accountList).toHaveLength(6);
  expect(accountList.filter((c) => c.active)).toHaveLength(5);
  expect(await readConversation(account, archived.id)).toMatchObject({
    archived: true,
    title: "Ended visitor chat",
    busy: false,
  });
  expect(await readConversation(visitor, archived.id)).toBeUndefined();

  expect((await listConversations(visitor)).map((c) => c.id).sort()).toEqual(
    activeIds.sort(),
  );
  for (const id of activeIds) {
    expect(await readConversation(account, id)).toBeUndefined();
    const kept = await acquireRun(visitor, id);
    expect(kept).not.toBe("busy");
    expect(kept).toBeDefined();
    await releaseRun(visitor, kept as Taken);
  }
});

it("skips all runs and leaves them intact when the destination is at MAX_CONVERSATIONS", async () => {
  configureBackend(memoryBackend());
  const visitor = "visitor-max-conv",
    account = "account-max-conv";
  const start = Date.now();
  vi.useFakeTimers({ now: start });

  // Visitor has an ended conversation; account fills all 20 slots.
  const visitorArchived = await createRun(visitor, "https://shop.example");
  visitorArchived.run.title = "Visitor ended";
  await releaseRun(visitor, visitorArchived);

  for (let i = 0; i < 20; i++) {
    vi.setSystemTime(start + i * 1000);
    const held = await createRun(account, "https://shop.example");
    held.run.title = `Account ${i}`;
    await releaseRun(account, held);
  }

  // Advance past RUN_MS so all 20 account conversations are archived (0 active),
  // verifying MAX_CONVERSATIONS blocks both active and archived moves even when
  // active < MAX_RUNS.
  vi.setSystemTime(start + 31 * 60000);
  const visitorActive = await createRun(visitor, "https://shop.example");
  visitorActive.run.title = "Visitor active";
  await releaseRun(visitor, visitorActive);

  expect(await moveConversations(visitor, account)).toEqual({
    moved: 0,
    skipped: 2,
  });

  const accountList = await listConversations(account);
  expect(accountList).toHaveLength(20);
  expect(accountList.map((c) => c.id)).not.toContain(visitorArchived.id);
  expect(accountList.map((c) => c.id)).not.toContain(visitorActive.id);

  expect((await listConversations(visitor)).map((c) => c.id).sort()).toEqual(
    [visitorArchived.id, visitorActive.id].sort(),
  );
  expect(await readConversation(visitor, visitorArchived.id)).toMatchObject({
    archived: true,
    busy: false,
  });
  const kept = await acquireRun(visitor, visitorActive.id);
  expect(kept).not.toBe("busy");
  expect(kept).toBeDefined();
  await releaseRun(visitor, kept as Taken);
});

it("partially claims conversations up to the destination's remaining active and total capacity", async () => {
  configureBackend(memoryBackend());
  const start = Date.now();
  vi.useFakeTimers({ now: start });

  // Part 1: room for 2 of 4 active runs (3 existing active -> MAX_RUNS = 5).
  const visitorA = "visitor-partial-active",
    accountA = "account-partial-active";
  for (let i = 0; i < 3; i++) {
    const held = await createRun(accountA, "https://shop.example");
    held.run.title = `Existing ${i}`;
    await releaseRun(accountA, held);
  }
  for (let i = 0; i < 4; i++) {
    const held = await createRun(visitorA, "https://shop.example");
    held.run.title = `Incoming ${i}`;
    await releaseRun(visitorA, held);
  }
  expect(await moveConversations(visitorA, accountA)).toEqual({
    moved: 2,
    skipped: 2,
  });
  expect(await listConversations(accountA)).toHaveLength(5);
  const remainingA = await listConversations(visitorA);
  expect(remainingA).toHaveLength(2);
  for (const { id } of remainingA) {
    const kept = await acquireRun(visitorA, id);
    expect(kept).not.toBe("busy");
    expect(kept).toBeDefined();
    await releaseRun(visitorA, kept as Taken);
  }

  // Part 2: room for 2 of 3 total conversations (18 existing archived -> MAX_CONVERSATIONS = 20).
  const visitorB = "visitor-partial-total",
    accountB = "account-partial-total";
  for (let i = 0; i < 18; i++) {
    vi.setSystemTime(start + i * 1000);
    const held = await createRun(accountB, "https://shop.example");
    held.run.title = `Archived ${i}`;
    await releaseRun(accountB, held);
  }
  vi.setSystemTime(start + 31 * 60000);
  for (let i = 0; i < 3; i++) {
    const held = await createRun(visitorB, "https://shop.example");
    held.run.title = `Visitor ${i}`;
    await releaseRun(visitorB, held);
  }
  expect(await moveConversations(visitorB, accountB)).toEqual({
    moved: 2,
    skipped: 1,
  });
  expect(await listConversations(accountB)).toHaveLength(20);
  const remainingB = await listConversations(visitorB);
  expect(remainingB).toHaveLength(1);
  const keptB = await acquireRun(visitorB, remainingB[0]!.id);
  expect(keptB).not.toBe("busy");
  expect(keptB).toBeDefined();
  await releaseRun(visitorB, keptB as Taken);
});

it("honors expires in memoryBackend get, list, and CAS put, and deletes empty buckets", async () => {
  const start = 1_000_000;
  vi.useFakeTimers({ now: start });
  const store = memoryBackend();

  expect(await store.put("b1", "ephemeral", "v1", null, start + 5000)).toBe(
    true,
  );
  expect(await store.put("b1", "permanent", "keep", null)).toBe(true);
  expect(await store.put("b2", "only", "gone", null, start + 5000)).toBe(true);

  expect(await store.get("b1", "ephemeral")).toEqual({
    value: "v1",
    version: 1,
  });
  expect(await store.list("b1", "")).toEqual([
    ["ephemeral", { value: "v1", version: 1 }],
    ["permanent", { value: "keep", version: 1 }],
  ]);

  // At expiry, get/list treat expired entries as absent and purge empty buckets.
  vi.setSystemTime(start + 5000);
  expect(await store.get("b2", "only")).toBeUndefined();
  expect(store.data.has("b2")).toBe(false);
  expect(await store.list("b1", "")).toEqual([
    ["permanent", { value: "keep", version: 1 }],
  ]);
  expect(store.data.get("b1")?.has("ephemeral")).toBe(false);

  // CAS sees an expired entry as absent (expected version 1 fails; expected null succeeds).
  expect(await store.put("b3", "cas", "first", null, start + 8000)).toBe(true);
  vi.setSystemTime(start + 8000);
  expect(await store.put("b3", "cas", "stale", 1)).toBe(false);
  expect(store.data.has("b3")).toBe(false);
  expect(await store.put("b3", "cas", "fresh", null, start + 20_000)).toBe(
    true,
  );
  expect(await store.get("b3", "cas")).toEqual({ value: "fresh", version: 1 });

  // Writing an already-expired entry drops it and cleans up the empty bucket.
  expect(await store.put("b3", "cas", "done", 1, start + 8000)).toBe(true);
  expect(await store.get("b3", "cas")).toBeUndefined();
  expect(store.data.has("b3")).toBe(false);
});

it("deletes empty buckets from memoryBackend on remove and failed absent CAS", async () => {
  const store = memoryBackend();

  expect(await store.put("absent", "k", "v", 1)).toBe(false);
  expect(store.data.has("absent")).toBe(false);

  expect(await store.put("b", "k1", 1, null)).toBe(true);
  expect(await store.put("b", "k2", 2, null)).toBe(true);
  await store.remove("b", "k1");
  expect(store.data.has("b")).toBe(true);
  await store.remove("b", "k2");
  expect(store.data.has("b")).toBe(false);
});

it("sweeps expired entries in untouched buckets and excludes expired entries from snapshotRows", async () => {
  const start = 1_000_000;
  vi.useFakeTimers({ now: start });
  const store = memoryBackend();

  expect(
    await store.put("ceremony:1", "ceremony", { c: 1 }, null, start + 5000),
  ).toBe(true);
  expect(
    await store.put("ceremony:2", "ceremony", { c: 2 }, null, start + 5000),
  ).toBe(true);
  expect(
    await store.put("channel:telegram", "user:u1", { user: "acct" }, null),
  ).toBe(true);
  expect(
    await store.put(
      "channel:temp",
      "user:u2",
      { user: "exp" },
      null,
      start + 5000,
    ),
  ).toBe(true);

  // snapshotRows ignores entries already expired at `now` even before a sweep runs.
  expect(snapshotRows(store.data, start + 5000)).toEqual([
    ["channel:telegram", "user:u1", { user: "acct" }],
  ]);

  // Later unrelated backend activity sweeps untouched expired buckets without removing live ones.
  vi.setSystemTime(start + 5000);
  expect(await store.put("other", "k", "v", null)).toBe(true);
  expect(store.data.has("ceremony:1")).toBe(false);
  expect(store.data.has("ceremony:2")).toBe(false);
  expect(store.data.has("channel:temp")).toBe(false);
  expect(store.data.has("channel:telegram")).toBe(true);

  // Counters also expire and reset cleanly after their window passes.
  expect(await store.count("ip:a", "k", 1000)).toBe(1);
  expect(await store.count("ip:a", "k", 1000)).toBe(2);
  vi.setSystemTime(start + 6000);
  expect(await store.count("ip:b", "k", 1000)).toBe(1);
  expect(await store.count("ip:a", "k", 1000)).toBe(1);
});

it("throttles memoryBackend full sweeps to once a minute while expiring lazily", async () => {
  const start = 1_000_000;
  vi.useFakeTimers({ now: start });
  const store = memoryBackend();

  // First sweep runs at start + 5000.
  expect(await store.put("first", "k", "v", null, start + 5000)).toBe(true);
  expect(await store.put("untouched", "k", "v", null, start + 10_000)).toBe(
    true,
  );
  expect(await store.put("lazy-get", "k", "v", null, start + 10_000)).toBe(
    true,
  );
  expect(await store.put("lazy-list", "k", "v", null, start + 10_000)).toBe(
    true,
  );
  expect(await store.put("lazy-put", "k", "v", null, start + 10_000)).toBe(
    true,
  );

  vi.setSystemTime(start + 5000);
  expect(await store.put("trigger", "k", "v", null)).toBe(true);
  expect(store.data.has("first")).toBe(false);

  // Within a minute of the last sweep, unrelated activity does not re-scan untouched buckets,
  // while get/list/put still expire entries lazily on access.
  vi.setSystemTime(start + 10_000);
  expect(await store.put("trigger2", "k", "v", null)).toBe(true);
  expect(store.data.has("untouched")).toBe(true);

  expect(await store.get("lazy-get", "k")).toBeUndefined();
  expect(store.data.has("lazy-get")).toBe(false);
  expect(await store.list("lazy-list", "")).toEqual([]);
  expect(store.data.has("lazy-list")).toBe(false);
  expect(await store.put("lazy-put", "k", "stale", 1)).toBe(false);
  expect(store.data.has("lazy-put")).toBe(false);

  // Still throttled before the full minute elapses.
  vi.setSystemTime(start + 64_999);
  expect(await store.get("trigger", "k")).toEqual({ value: "v", version: 1 });
  expect(store.data.has("untouched")).toBe(true);

  // Once a minute has passed since the previous sweep, the next operation sweeps untouched buckets.
  vi.setSystemTime(start + 65_000);
  expect(await store.get("trigger", "k")).toEqual({ value: "v", version: 1 });
  expect(store.data.has("untouched")).toBe(false);
});

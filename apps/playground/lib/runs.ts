/**
 * Per-visitor state. Every browser gets an unguessable visitor cookie; the
 * server keys all its runs (tokens, keys, conversation) by the cookie's
 * SHA-256, so one visitor can never name another visitor's run.
 *
 * Backends: in Node, an in-process map snapshotted to the encrypted vault
 * (local development or a single VPS process); in Cloudflare Workers, one
 * Durable Object per visitor (see `worker/visitor.ts`). Run locking is a
 * compare-and-set on a version, so it holds across Worker isolates.
 */
import { createHash, randomBytes } from "node:crypto";
import { onWorkers, randomId, vault } from "@poppy-lab/pap-client";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Connection, Run } from "./runtime";
import {
  companyName,
  connectionForState,
  from,
  newConnection,
  originOf,
} from "./connections";
import { importStateKey, sealedBackend } from "./sealed";

export type Versioned<T = unknown> = { value: T; version: number };
export interface Backend {
  get(visitor: string, key: string): Promise<Versioned | undefined>;
  /** Writes only if the stored version is `expected` (null: absent). */
  put(
    visitor: string,
    key: string,
    value: unknown,
    expected: number | null,
  ): Promise<boolean>;
  remove(visitor: string, key: string): Promise<void>;
  list(visitor: string, prefix: string): Promise<Array<[string, Versioned]>>;
  /** Fixed-window counter: returns the count including this hit. */
  count(visitor: string, key: string, windowMs: number): Promise<number>;
}

type Entry = { value: unknown; version: number };
/** In-process backend. Values are kept by reference (single process). */
export function memoryBackend(persist?: () => void) {
  const data = new Map<string, Map<string, Entry>>();
  const counters = new Map<string, { n: number; until: number }>();
  const bucket = (visitor: string) => {
    let b = data.get(visitor);
    if (!b) data.set(visitor, (b = new Map()));
    return b;
  };
  const backend: Backend & { data: typeof data } = {
    data,
    async get(visitor, key) {
      return data.get(visitor)?.get(key);
    },
    async put(visitor, key, value, expected) {
      const b = bucket(visitor);
      const current = b.get(key);
      if ((current?.version ?? null) !== expected) return false;
      b.set(key, { value, version: (current?.version ?? 0) + 1 });
      persist?.();
      return true;
    },
    async remove(visitor, key) {
      data.get(visitor)?.delete(key);
      persist?.();
    },
    async list(visitor, prefix) {
      return [...(data.get(visitor) ?? [])].filter(([k]) =>
        k.startsWith(prefix),
      );
    },
    async count(visitor, key, windowMs) {
      const id = `${visitor}\n${key}`,
        now = Date.now();
      let c = counters.get(id);
      if (!c || c.until <= now) {
        if (counters.size > 50000)
          for (const [k, v] of counters) if (v.until <= now) counters.delete(k);
        counters.set(id, (c = { n: 0, until: now + windowMs }));
      }
      return ++c.n;
    },
  };
  return backend;
}

/**
 * The members a run kept for its one Company when a run was one object,
 * before a conversation held a connection for each Company.
 */
const ONE_COMPANY = [
  "url",
  "user",
  "sessionId",
  "sessionKey",
  "agentApprovals",
  "tasks",
  "reported",
  "services",
  "resourceTokens",
  "apiBase",
  "dpop",
  "token",
  "tokenType",
  "tokenExpires",
  "accountToken",
  "consentVersion",
  "accountUnavailable",
  "scopes",
  "fdx",
  "fdxConsent",
  "espi",
  "espiResourceUri",
  "espiAuthorizationUri",
  "company",
  "auth",
  "operations",
  "conversation",
  "publicHistory",
] as const satisfies ReadonlyArray<keyof Connection>;

/**
 * A stored conversation as this code works with it. One stored before a
 * conversation held connections is a single object with its one Company's
 * Session, sign-in and proposals among its own members: it is read as a
 * conversation with one connection, and saved that way the next time it
 * is written. An ended one is never written again, and is read like this
 * for as long as it is kept.
 */
export function readRun(stored: unknown): Run | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  if (Array.isArray((stored as Run).connections)) return stored as Run;
  const flat = stored as Record<string, unknown>;
  if (typeof flat.url !== "string") return undefined;
  const conversation: Record<string, unknown> = {};
  const connection: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat))
    ((ONE_COMPANY as readonly string[]).includes(key)
      ? connection
      : conversation)[key] = value;
  // The User ID for the Company comes from these two (`userFor`).
  for (const key of ["visitor", "epoch"])
    if (flat[key] !== undefined) connection[key] = flat[key];
  // Everything it kept came from its one Company, and says so from now on.
  const tag = from({ url: flat.url });
  const tagged = (list: unknown) =>
    Array.isArray(list)
      ? list.map((entry: object) => ({ ...entry, ...tag }))
      : undefined;
  for (const [holder, key] of [
    [conversation, "history"],
    [conversation, "transcript"],
    [conversation, "log"],
    [connection, "publicHistory"],
  ] as const) {
    const list = tagged(holder[key]);
    if (list) holder[key] = list;
  }
  return { ...conversation, connections: [connection] } as Run;
}

/** A conversation still worth keeping: running, or ended and readable. */
const kept = (run: Run, now = Date.now()) =>
  run.archived ? (run.keepUntil ?? 0) > now : run.expires > now;
/**
 * Node: memory plus an encrypted snapshot of the conversations still kept
 * and of each visitor's demo epoch.
 */
function nodeBackend() {
  const storage = vault<Array<[string, string, unknown]>>(
    "visitor-runs",
    () => [],
  );
  const persist = () => {
    const rows: Array<[string, string, unknown]> = [];
    for (const [visitor, entries] of backend.data)
      for (const [key, entry] of entries) {
        if (key === DEMO) rows.push([visitor, key, entry.value]);
        const run = key.startsWith("run:") ? readRun(entry.value) : undefined;
        // A sign-in under way doesn't outlive the process.
        if (run && kept(run))
          rows.push([
            visitor,
            key,
            {
              ...run,
              busy: false,
              connections: run.connections.map((c) => ({
                ...c,
                auth: undefined,
              })),
            },
          ]);
      }
    storage.value.splice(0, storage.value.length, ...rows);
    storage.save();
  };
  const backend = memoryBackend(persist);
  // Runs from 0.2 used Session Tokens: never restore them.
  for (const [visitor, key, value] of storage.value) {
    const run = key === DEMO ? undefined : readRun(value);
    const restore =
      key === DEMO
        ? value
        : run?.protocol === "1.0" && kept(run)
          ? { ...run, busy: false }
          : undefined;
    if (!restore) continue;
    if (!backend.data.has(visitor)) backend.data.set(visitor, new Map());
    backend.data.get(visitor)!.set(key, { value: restore, version: 1 });
  }
  return backend;
}

/** The visitor Durable Object's RPC surface (`worker/visitor.ts`). */
type VisitorObject = {
  getEntry(key: string): Promise<Versioned | undefined>;
  putEntry(
    key: string,
    value: unknown,
    expected: number | null,
  ): Promise<boolean>;
  removeEntry(key: string): Promise<void>;
  listEntries(prefix: string): Promise<Array<[string, Versioned]>>;
  count(key: string, windowMs: number): Promise<number>;
};
type Namespace = {
  idFromName(name: string): unknown;
  get(id: unknown): VisitorObject;
};
/**
 * Workers: one Durable Object per visitor (and per budget bucket), every
 * value sealed with the POPPY_STATE_KEY secret before it leaves the isolate.
 */
function durableBackend(): Backend {
  const env = () => getCloudflareContext().env as Record<string, unknown>;
  const stub = (visitor: string) => {
    const ns = env().POPPY_VISITORS as Namespace;
    return ns.get(ns.idFromName(visitor));
  };
  const key = importStateKey(
    typeof env().POPPY_STATE_KEY === "string"
      ? (env().POPPY_STATE_KEY as string)
      : undefined,
  );
  key.catch(() => {});
  return sealedBackend(plainDurableBackend(stub), key);
}
function plainDurableBackend(
  stub: (visitor: string) => VisitorObject,
): Backend {
  return {
    get: (visitor, key) => stub(visitor).getEntry(key),
    put: (visitor, key, value, expected) =>
      stub(visitor).putEntry(key, value, expected),
    remove: (visitor, key) => stub(visitor).removeEntry(key),
    list: (visitor, prefix) => stub(visitor).listEntries(prefix),
    count: (visitor, key, windowMs) => stub(visitor).count(key, windowMs),
  };
}

const global = globalThis as typeof globalThis & { poppyBackend?: Backend };
/** Replace the backend (Workers entry, tests). */
export function configureBackend(backend: Backend) {
  global.poppyBackend = backend;
}
function backend(): Backend {
  return (global.poppyBackend ??=
    // Tests never touch the developer's vault, whatever NODE_ENV they stub.
    process.env.NODE_ENV === "test" || process.env.VITEST
      ? memoryBackend()
      : onWorkers()
        ? durableBackend()
        : nodeBackend());
}

// ---- Visitor cookie --------------------------------------------------------
export const secureCookies = () =>
  (process.env.AGENT_PUBLIC_ORIGIN ?? "").startsWith("https://") &&
  process.env.NODE_ENV === "production";
export const visitorCookie = () =>
  secureCookies() ? "__Host-poppy_visitor" : "poppy_visitor";
type CookieStore = {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options: Record<string, string | number | boolean>,
  ): unknown;
};
/**
 * The visitor's storage key. The raw cookie never leaves the browser and
 * this process; storage only sees its hash. SameSite=Lax so the Company's
 * redirect back to the OAuth callback still identifies the visitor.
 */
export function visitorOf(store: CookieStore, create: true): string;
export function visitorOf(
  store: CookieStore,
  create?: boolean,
): string | undefined;
export function visitorOf(store: CookieStore, create = false) {
  let raw = store.get(visitorCookie())?.value;
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) {
    if (!create) return undefined;
    raw = randomBytes(32).toString("base64url");
    store.set(visitorCookie(), raw, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 86400,
    });
  }
  return createHash("sha256").update(raw).digest("base64url");
}

// ---- Runs ------------------------------------------------------------------
// A run is one conversation, with a connection for each Company it works
// with. Its ID is in the page's URL (`/playground/<id>`); only the visitor
// who started it can name it.
const RUN_MS = 1800000,
  MAX_RUNS = 5,
  BUSY_MS = 120000,
  /** An ended conversation stays readable this long, counted from its start. */
  KEEP_MS = 7 * 86400000,
  MAX_CONVERSATIONS = 20,
  /** The visitor's demo epoch (`resetDemo`). */
  DEMO = "demo";
export type Held = { id: string; run: Run; version: number };
export const isConversationId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id);
const locked = (run: Run, now = Date.now()) =>
  run.busy && (run.busyUntil ?? 0) > now;
const startOf = (run: Run) => run.created ?? run.expires - RUN_MS;
/**
 * Nothing said, or nothing of it left: a sign-in or a sign-out can take
 * back everything the conversation showed.
 */
const wordless = (run: Run) =>
  !run.title && !run.history.length && !run.transcript?.length;
/** Nothing said, no account, no sign-in under way at any Company. */
const untouched = (run: Run) =>
  wordless(run) && !run.connections.some((c) => c.accountToken || c.auth);

export async function loadRun(visitor: string, id: string | undefined) {
  if (!isConversationId(id)) return undefined;
  const entry = await backend().get(visitor, `run:${id}`);
  const run = readRun(entry?.value);
  return run &&
    !run.archived &&
    run.expires > Date.now() &&
    run.protocol === "1.0"
    ? { id, run, version: entry!.version }
    : undefined;
}

/** What stays of a conversation once it ends: its words, never its keys. */
function ended(run: Run, now = Date.now()): Run {
  return {
    protocol: "1.0",
    ...(run.visitor ? { visitor: run.visitor } : {}),
    expires: Math.min(run.expires, now),
    calls: run.calls,
    busy: false,
    // Each Company and how its proposals ended; no Session, key or token.
    connections: run.connections.map((connection) => ({
      url: connection.url,
      user: "",
      ...(connection.company ? { company: connection.company } : {}),
      operations: Object.fromEntries(
        Object.entries(connection.operations ?? {}).map(([id, op]) => {
          // The stored request could be sent again; an ended one never is.
          const rest = { ...op };
          delete rest.request;
          return [id, rest];
        }),
      ),
    })),
    // The Companies that had left it, and what they left unanswered.
    ...(run.former ? { former: run.former } : {}),
    history: [],
    transcript: run.transcript ?? run.history,
    ...(run.log ? { log: run.log } : {}),
    ...(run.title ? { title: run.title } : {}),
    created: startOf(run),
    archived: true,
    keepUntil: startOf(run) + KEEP_MS,
  };
}

/**
 * The visitor's conversations, after ending the expired ones and dropping
 * those past their keep time. `room` leaves space for that many new ones.
 */
async function sweep(visitor: string, room = 0) {
  const b = backend(),
    now = Date.now();
  const all: Held[] = [];
  for (const [key, entry] of await b.list(visitor, "run:")) {
    let run = readRun(entry.value),
      version = entry.version;
    if (
      !run ||
      run.protocol !== "1.0" ||
      (run.archived && (!kept(run, now) || untouched(run))) ||
      // Nothing to read in one that ended without words. Its sign-in, if
      // it had one, ends with it either way.
      (!run.archived &&
        run.expires <= now &&
        wordless(run) &&
        !locked(run, now))
    ) {
      await b.remove(visitor, key);
      continue;
    }
    if (!run.archived && run.expires <= now && !locked(run, now)) {
      const next = ended(run, now);
      if (await b.put(visitor, key, next, version)) {
        run = next;
        version++;
      }
    }
    all.push({ id: key.slice(4), run, version });
  }
  // Over the cap, the oldest ended conversations go first.
  const oldest = all
    .filter((held) => held.run.archived)
    .sort((a, c) => startOf(a.run) - startOf(c.run));
  for (const held of oldest) {
    if (all.length + room <= MAX_CONVERSATIONS) break;
    await b.remove(visitor, `run:${held.id}`);
    all.splice(all.indexOf(held), 1);
  }
  return all;
}

export type ConversationSummary = {
  id: string;
  /** Its Companies' names in one line, and the address of the first. */
  company: string;
  url: string;
  /** Each of its Companies, in the order they were connected. */
  companies: Array<{ origin: string; name: string; url: string }>;
  title?: string;
  created: number;
  /** Still running; otherwise read-only. */
  active: boolean;
  /** When a running one ends, or when an ended one is deleted. */
  until: number;
};
/** The visitor's conversations, newest first. Names and times only. */
export async function listConversations(
  visitor: string,
): Promise<ConversationSummary[]> {
  return (await sweep(visitor))
    .map(({ id, run }) => ({
      id,
      // For a list that shows one name and one address: with several
      // Companies it names each and links to the first. With none, as
      // before any is connected or after the last one left, both are "".
      company: run.connections.map(companyName).join(", "),
      url: run.connections[0]?.url ?? "",
      companies: run.connections.map((connection) => ({
        origin: originOf(connection),
        name: companyName(connection),
        url: connection.url,
      })),
      ...(run.title ? { title: run.title } : {}),
      created: startOf(run),
      active: !run.archived,
      until: run.archived ? (run.keepUntil ?? 0) : run.expires,
    }))
    .sort((a, c) => c.created - a.created);
}

/** A conversation to show: running, or ended and read-only. */
export async function readConversation(visitor: string, id: unknown) {
  if (!isConversationId(id)) return undefined;
  const b = backend(),
    now = Date.now();
  const entry = await b.get(visitor, `run:${id}`);
  let run = readRun(entry?.value);
  if (!run || run.protocol !== "1.0") return undefined;
  if (run.archived) return kept(run, now) ? run : undefined;
  if (run.expires <= now && !locked(run, now)) {
    const next = ended(run, now);
    if (await b.put(visitor, `run:${id}`, next, entry!.version)) run = next;
  }
  return run;
}

/**
 * Whether a request names a conversation of this visitor that has ended
 * and is still kept, with the day it goes. A tab left open past the end
 * still shows it, so such a request is refused and the page told, where
 * one that names a conversation unknown here goes on in a new one.
 */
export async function endedConversation(
  visitor: string,
  id: string | undefined,
) {
  const run = await readConversation(visitor, id);
  return run?.archived ? { keptUntil: run.keepUntil } : undefined;
}

/**
 * Starts the demo over: every Company meets this visitor as a new person
 * (a new User ID, so a fresh copy of its test customers), and the running
 * conversations end, since their Sessions belong to the person before.
 * The Companies' old copies lapse on their own idle clocks.
 */
export async function resetDemo(visitor: string) {
  const b = backend();
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await b.get(visitor, DEMO);
    if (
      await b.put(
        visitor,
        DEMO,
        { epoch: randomId() },
        current?.version ?? null,
      )
    )
      break;
  }
  for (const { id, run, version } of await sweep(visitor)) {
    if (run.archived) continue;
    if (untouched(run)) await b.remove(visitor, `run:${id}`);
    else await b.put(visitor, `run:${id}`, ended(run), version);
  }
}

/** Locks a run for one request; `busy` when another request holds it. */
export async function acquireRun(
  visitor: string,
  id: string | undefined,
): Promise<Held | "busy" | undefined> {
  const held = await loadRun(visitor, id);
  if (!held) return undefined;
  if (held.run.busy && (held.run.busyUntil ?? 0) > Date.now()) return "busy";
  // In place: the memory backend holds this object; Workers return a copy.
  const run = Object.assign(held.run, {
    busy: true,
    busyUntil: Date.now() + BUSY_MS,
  });
  if (!(await backend().put(visitor, `run:${held.id}`, run, held.version)))
    return "busy";
  return { id: held.id, run, version: held.version + 1 };
}

/**
 * Saves and unlocks. If the lock was lost (the request outlived BUSY_MS and
 * another request took the run), the newer copy wins, but this request's
 * operations are merged into it, each into its own Company's connection,
 * so a proposal the Company holds still gets its approval card. Returns
 * false when the lock was lost.
 */
export async function releaseRun(visitor: string, held: Held) {
  const run = held.run;
  run.busy = false;
  delete run.busyUntil;
  const b = backend();
  if (await b.put(visitor, `run:${held.id}`, run, held.version)) return true;
  console.error("run_lock_lost", held.id.slice(0, 6));
  const current = await b.get(visitor, `run:${held.id}`);
  if (!current) return false;
  const latest = readRun(current.value);
  if (!latest) return false;
  for (const theirs of latest.connections) {
    const mine = run.connections.find((c) => originOf(c) === originOf(theirs));
    theirs.operations = { ...mine?.operations, ...theirs.operations };
    // And whose accounts could be in each, for the ones merged in.
    const accounts = {
      ...mine?.operationAccounts,
      ...theirs.operationAccounts,
    };
    if (Object.keys(accounts).length) theirs.operationAccounts = accounts;
  }
  latest.calls = Math.max(latest.calls, run.calls);
  await b.put(visitor, `run:${held.id}`, latest, current.version);
  return false;
}

/**
 * A new, locked run, connected to one Company, or to none yet when no
 * address is given. The visitor keeps at most five running; the oldest
 * idle ones end (and stay readable) to make room.
 */
export async function createRun(visitor: string, url?: string): Promise<Held> {
  const b = backend();
  const running: Held[] = [];
  for (const held of await sweep(visitor, 1)) {
    if (held.run.archived) continue;
    // Connecting again and again leaves no trail: a conversation nothing
    // was said or signed in doesn't outlive the next one.
    if (untouched(held.run) && !locked(held.run))
      await b.remove(visitor, `run:${held.id}`);
    else running.push(held);
  }
  running.sort((a, c) => a.run.expires - c.run.expires);
  // A run another request holds right now is never ended under it.
  let over = running.length - (MAX_RUNS - 1);
  for (const held of running) {
    if (over <= 0) break;
    if (locked(held.run)) continue;
    if (await b.put(visitor, `run:${held.id}`, ended(held.run), held.version))
      over--;
  }
  const id = randomId();
  const epoch = (
    (await b.get(visitor, DEMO))?.value as { epoch?: string } | undefined
  )?.epoch;
  const run: Run = {
    protocol: "1.0",
    expires: Date.now() + RUN_MS,
    calls: 0,
    busy: true,
    busyUntil: Date.now() + BUSY_MS,
    connections:
      url === undefined
        ? []
        : [newConnection({ visitor, ...(epoch ? { epoch } : {}) }, url)],
    history: [],
    visitor,
    created: Date.now(),
    ...(epoch ? { epoch } : {}),
  };
  if (!(await b.put(visitor, `run:${id}`, run, null)))
    throw new Error("Run conflict");
  return { id, run, version: 1 };
}

/**
 * The visitor's run in which a sign-in waits for this OAuth state
 * (callback). `connectionForState` says at which of its Companies.
 */
export async function runForState(visitor: string, state: string) {
  for (const [key, entry] of await backend().list(visitor, "run:")) {
    const run = readRun(entry.value);
    const auth = run && connectionForState(run, state)?.auth;
    if (run && auth && auth.expires > Date.now() && run.expires > Date.now())
      return { id: key.slice(4), run, version: entry.version };
  }
  return undefined;
}

/**
 * The OAuth states of the sign-ins the visitor has under way, in any of
 * their conversations: each has a cookie of its own (`sign-in-cookie.ts`).
 */
export async function pendingSignIns(visitor: string) {
  const states: string[] = [];
  for (const [, entry] of await backend().list(visitor, "run:"))
    for (const connection of readRun(entry.value)?.connections ?? [])
      if (connection.auth && connection.auth.expires > Date.now())
        states.push(connection.auth.state);
  return states;
}

// ---- Rate limits -----------------------------------------------------------
export type Limit = { name: string; limit: number; windowMs: number };
/** True when within every limit (per visitor, and the global budget). */
export async function allow(
  visitor: string,
  limits: { visitor: Limit[]; global?: Limit[] },
) {
  for (const l of limits.visitor)
    if ((await backend().count(visitor, l.name, l.windowMs)) > l.limit)
      return false;
  for (const l of limits.global ?? [])
    if ((await backend().count("global", l.name, l.windowMs)) > l.limit)
      return false;
  return true;
}

/**
 * TEST ONLY: put a run for a raw visitor cookie value, as it is given. One
 * in the shape stored before connections has no list of them.
 */
export async function seedRun(rawCookie: string, id: string, run: Run) {
  const visitor = createHash("sha256").update(rawCookie).digest("base64url");
  run.visitor = visitor;
  const connections: Connection[] | undefined = run.connections;
  for (const connection of connections ?? []) connection.visitor = visitor;
  await backend().put(visitor, `run:${id}`, run, null);
  return visitor;
}

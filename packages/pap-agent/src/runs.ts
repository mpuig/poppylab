/**
 * Per-visitor state. Every browser gets an unguessable visitor cookie; the
 * server keys all its runs (tokens, keys, conversation) by the cookie's
 * SHA-256, so one visitor can never name another visitor's run.
 *
 * Backends (`Backend`): in Node, an in-process map snapshotted to the
 * encrypted vault (local development or a single VPS process); elsewhere
 * the one a channel configures (`configureStorage`), such as the
 * playground's Durable Object per visitor on Workers. Run locking is a
 * compare-and-set on a version, so it holds across Worker isolates.
 */
import { createHash, randomBytes } from "node:crypto";
import { onWorkers, randomId, vault } from "@poppy-lab/pap-client";
import type { Connection, Run } from "./runtime";
import {
  companyName,
  connectionAt,
  connectionForState,
  from,
  newConnection,
  originOf,
} from "./connections";
import { bytesOf, RUN_LIMITS, RunNotSaved } from "./run-size";

export type Versioned<T = unknown> = { value: T; version: number };
export interface Backend {
  get(visitor: string, key: string): Promise<Versioned | undefined>;
  /**
   * Writes only if the stored version is `expected` (null: absent).
   * `expires` says the value is worth nothing after then (a ceremony's
   * challenge, a link code), so a store may drop it from that time
   * instead of keeping it as long as its bucket.
   */
  put(
    visitor: string,
    key: string,
    value: unknown,
    expected: number | null,
    expires?: number,
  ): Promise<boolean>;
  remove(visitor: string, key: string): Promise<void>;
  list(visitor: string, prefix: string): Promise<Array<[string, Versioned]>>;
  /** Fixed-window counter: returns the count including this hit. */
  count(visitor: string, key: string, windowMs: number): Promise<number>;
}

type Entry = { value: unknown; version: number; expires?: number };
const MEMORY_SWEEP_MS = 60_000;
/** In-process backend. Values are kept by reference (single process). */
export function memoryBackend(persist?: () => void) {
  const data = new Map<string, Map<string, Entry>>();
  const counters = new Map<string, { n: number; until: number }>();
  const expiringBuckets = new Set<string>();
  let nextExpiry = Infinity,
    lastEntrySweep = -Infinity,
    nextCounterExpiry = Infinity,
    lastCounterSweep = -Infinity;
  const bucket = (visitor: string) => {
    let b = data.get(visitor);
    if (!b) data.set(visitor, (b = new Map()));
    return b;
  };
  const drop = (visitor: string, b: Map<string, Entry>, key: string) => {
    b.delete(key);
    if (!b.size) {
      data.delete(visitor);
      expiringBuckets.delete(visitor);
    }
  };
  const live = (visitor: string, key: string, now: number) => {
    const b = data.get(visitor);
    const entry = b?.get(key);
    if (!entry) return undefined;
    if (entry.expires !== undefined && entry.expires <= now) {
      drop(visitor, b!, key);
      return undefined;
    }
    return entry;
  };
  const sweepEntries = (now: number) => {
    if (now < nextExpiry) return;
    if (now >= lastEntrySweep && now - lastEntrySweep < MEMORY_SWEEP_MS) return;
    let earliest = Infinity;
    for (const visitor of expiringBuckets) {
      const b = data.get(visitor);
      if (!b) {
        expiringBuckets.delete(visitor);
        continue;
      }
      let hasExpiring = false;
      for (const [k, entry] of b) {
        if (entry.expires === undefined) continue;
        if (entry.expires <= now) b.delete(k);
        else {
          hasExpiring = true;
          if (entry.expires < earliest) earliest = entry.expires;
        }
      }
      if (!b.size) data.delete(visitor);
      if (!b.size || !hasExpiring) expiringBuckets.delete(visitor);
    }
    nextExpiry = earliest;
    lastEntrySweep = now;
  };
  const sweepCounters = (now: number) => {
    if (now < nextCounterExpiry) return;
    if (now >= lastCounterSweep && now - lastCounterSweep < MEMORY_SWEEP_MS)
      return;
    let earliest = Infinity;
    for (const [k, v] of counters) {
      if (v.until <= now) counters.delete(k);
      else if (v.until < earliest) earliest = v.until;
    }
    nextCounterExpiry = earliest;
    lastCounterSweep = now;
  };
  const sweepAll = (now: number) => {
    sweepEntries(now);
    sweepCounters(now);
  };
  const backend: Backend & { data: typeof data } = {
    data,
    async get(visitor, key) {
      const now = Date.now();
      sweepAll(now);
      const entry = live(visitor, key, now);
      return entry ? { value: entry.value, version: entry.version } : undefined;
    },
    async put(visitor, key, value, expected, expires) {
      const now = Date.now();
      sweepAll(now);
      const current = live(visitor, key, now);
      if ((current?.version ?? null) !== expected) return false;
      if (expires !== undefined && expires <= now) {
        const b = data.get(visitor);
        if (b) drop(visitor, b, key);
        persist?.();
        return true;
      }
      const b = bucket(visitor);
      b.set(key, {
        value,
        version: (current?.version ?? 0) + 1,
        ...(expires !== undefined ? { expires } : {}),
      });
      if (expires !== undefined) {
        expiringBuckets.add(visitor);
        if (expires < nextExpiry) nextExpiry = expires;
      }
      persist?.();
      return true;
    },
    async remove(visitor, key) {
      sweepAll(Date.now());
      const b = data.get(visitor);
      if (b) drop(visitor, b, key);
      persist?.();
    },
    async list(visitor, prefix) {
      const now = Date.now();
      sweepAll(now);
      const b = data.get(visitor);
      if (!b) return [];
      const out: Array<[string, Versioned]> = [];
      for (const [k, entry] of b) {
        if (entry.expires !== undefined && entry.expires <= now) {
          b.delete(k);
          continue;
        }
        if (k.startsWith(prefix))
          out.push([k, { value: entry.value, version: entry.version }]);
      }
      if (!b.size) {
        data.delete(visitor);
        expiringBuckets.delete(visitor);
      }
      return out;
    },
    async count(visitor, key, windowMs) {
      const id = `${visitor}\n${key}`,
        now = Date.now();
      sweepAll(now);
      let c = counters.get(id);
      if (!c || c.until <= now) {
        const until = now + windowMs;
        counters.set(id, (c = { n: 0, until }));
        if (until < nextCounterExpiry) nextCounterExpiry = until;
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
type Row = [bucket: string, key: string, value: unknown];
/**
 * What of an account's bucket outlives a Node process: the account with
 * its passkeys, and the sessions that haven't ended. A ceremony or a link
 * code under way doesn't, nor does a count of open streams.
 */
function lastingOfAccount(key: string, value: unknown, now: number) {
  if (key === "account") return value;
  if (!key.startsWith("session:")) return undefined;
  const session = value as { expires: number; until: number };
  return session.expires > now && session.until > now ? value : undefined;
}
/**
 * The rows a Node process keeps in its encrypted snapshot: the agent
 * accounts and their devices' sessions, the channels' users and links,
 * each visitor's demo epoch and the conversations still kept, without a
 * sign-in under way.
 */
export function snapshotRows(
  data: Map<string, Map<string, Entry>>,
  now = Date.now(),
) {
  const rows: Row[] = [];
  for (const [bucket, entries] of data)
    for (const [key, entry] of entries) {
      if (entry.expires !== undefined && entry.expires <= now) continue;
      if (bucket.startsWith("account:")) {
        const value = lastingOfAccount(key, entry.value, now);
        if (value !== undefined) rows.push([bucket, key, value]);
        continue;
      }
      if (bucket.startsWith("channel:")) {
        if (key.startsWith("user:")) rows.push([bucket, key, entry.value]);
        continue;
      }
      if (key === DEMO) rows.push([bucket, key, entry.value]);
      const run = key.startsWith("run:") ? readRun(entry.value) : undefined;
      // A sign-in under way doesn't outlive the process.
      if (run && kept(run, now))
        rows.push([
          bucket,
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
  return rows;
}
/** The rows of a snapshot still worth restoring, as they are restored. */
export function restoredRows(rows: Row[], now = Date.now()) {
  const restored: Row[] = [];
  for (const [bucket, key, value] of rows) {
    if (bucket.startsWith("account:")) {
      const kept = lastingOfAccount(key, value, now);
      if (kept !== undefined) restored.push([bucket, key, kept]);
      continue;
    }
    if (bucket.startsWith("channel:")) {
      if (key.startsWith("user:")) restored.push([bucket, key, value]);
      continue;
    }
    // Runs from 0.2 used Session Tokens: never restore them.
    const run = key === DEMO ? undefined : readRun(value);
    const restore =
      key === DEMO
        ? value
        : run?.protocol === "1.0" && kept(run, now)
          ? { ...run, busy: false }
          : undefined;
    if (restore) restored.push([bucket, key, restore]);
  }
  return restored;
}
/**
 * Node: memory plus an encrypted snapshot (`snapshotRows`), so the
 * accounts, the channels' links and the conversations still kept outlive
 * a restart.
 */
function nodeBackend() {
  const storage = vault<Row[]>("visitor-runs", () => []);
  const persist = () => {
    storage.value.splice(
      0,
      storage.value.length,
      ...snapshotRows(backend.data),
    );
    storage.save();
  };
  const backend = memoryBackend(persist);
  for (const [bucket, key, value] of restoredRows(storage.value)) {
    if (!backend.data.has(bucket)) backend.data.set(bucket, new Map());
    backend.data.get(bucket)!.set(key, { value, version: 1 });
  }
  return backend;
}

const global = globalThis as typeof globalThis & {
  poppyBackend?: Backend;
  poppyStorage?: () => Backend;
};
/** Replace the backend (tests, a channel with a store of its own). */
export function configureBackend(backend: Backend) {
  global.poppyBackend = backend;
}
/**
 * Where conversations are kept, opened on the first request that needs
 * them: a Worker's bindings are only there while it serves one. The
 * playground keeps them in a Durable Object per visitor
 * (`apps/playground/lib/visitor-storage.ts`); a Node process that
 * configures nothing keeps them in memory and the encrypted vault.
 */
export function configureStorage(open: () => Backend) {
  global.poppyStorage = open;
}
function backend(): Backend {
  return (global.poppyBackend ??=
    // Tests never touch the developer's vault, whatever NODE_ENV they stub.
    process.env.NODE_ENV === "test" || process.env.VITEST
      ? memoryBackend()
      : global.poppyStorage
        ? global.poppyStorage()
        : onWorkers()
          ? unconfigured()
          : nodeBackend());
}
/** The store as configured: for what the core keeps beside conversations. */
export const storage = () => backend();
/** A Worker has no file system for the vault: its store has to be named. */
function unconfigured(): never {
  throw new Error(
    "No storage for conversations: call configureStorage before the first request.",
  );
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
  /**
   * Its Companies' names in one line, and the address of the first. A
   * conversation with no Company says so in `company` ("No company yet",
   * or "No company" once it has ended), and its `url` is "".
   */
  company: string;
  url: string;
  /**
   * Each of its Companies, in the order they were connected, then those
   * removed from it and not connected again (`removed`), in the order
   * they left.
   */
  companies: Array<{
    origin: string;
    name: string;
    url: string;
    removed?: true;
  }>;
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
      // before any is connected or after the last one left, the list
      // says so where the name would be, and there is no address.
      company:
        run.connections.map(companyName).join(", ") ||
        (run.archived ? "No company" : "No company yet"),
      url: run.connections[0]?.url ?? "",
      companies: [
        ...run.connections.map((connection) => ({
          origin: originOf(connection),
          name: companyName(connection),
          url: connection.url,
        })),
        ...(run.former ?? [])
          .filter((f) => !connectionAt(run, f.url))
          .map((f) => ({
            origin: originOf(f),
            name: f.name,
            url: f.url,
            removed: true as const,
          })),
      ],
      ...(run.title ? { title: run.title } : {}),
      created: startOf(run),
      active: !run.archived,
      until: run.archived ? (run.keepUntil ?? 0) : run.expires,
    }))
    .sort((a, c) => c.created - a.created);
}

/**
 * The visitor's conversations as stored, running and ended, for what waits
 * in them (`pending-runs.ts`). Read as the list reads them.
 */
export async function storedConversations(visitor: string) {
  return (await sweep(visitor)).map(({ id, run }) => ({ id, run }));
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
 * Unlocks the conversation as it was last stored, after a save that
 * didn't happen: the next request isn't told to wait for the two minutes
 * a crashed lock takes. The memory backend holds the run itself, which is
 * unlocked already.
 */
async function unlockStored(visitor: string, held: Held) {
  try {
    const b = backend();
    const current = await b.get(visitor, `run:${held.id}`);
    const stored = readRun(current?.value);
    if (!current || !stored?.busy || current.version !== held.version) return;
    const { busyUntil, ...rest } = stored;
    void busyUntil;
    await b.put(
      visitor,
      `run:${held.id}`,
      { ...rest, busy: false },
      current.version,
    );
  } catch {
    // The lock then lapses by itself (`BUSY_MS`).
  }
}

/**
 * Saves and unlocks. If the lock was lost (the request outlived BUSY_MS and
 * another request took the run), the newer copy wins, but this request's
 * operations are merged into it, each into its own Company's connection,
 * so a proposal the Company holds still gets its approval card. Returns
 * false when the lock was lost.
 *
 * A run too large to store (`RUN_LIMITS`), or one the store refuses, is
 * not saved: this throws `RunNotSaved`, so the request can say so, and the
 * conversation is left unlocked as it was last stored.
 */
export async function releaseRun(visitor: string, held: Held) {
  const run = held.run;
  run.busy = false;
  delete run.busyUntil;
  const b = backend();
  let stored: boolean;
  try {
    if (bytesOf(run) > RUN_LIMITS.bytes) throw new RunNotSaved("too_large");
    stored = await b.put(visitor, `run:${held.id}`, run, held.version);
  } catch (error) {
    console.error(
      "run_not_saved",
      held.id.slice(0, 6),
      error instanceof RunNotSaved ? error.reason : "failed",
    );
    await unlockStored(visitor, held);
    throw error instanceof RunNotSaved ? error : new RunNotSaved("failed");
  }
  if (stored) return true;
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

// ---- Moving conversations --------------------------------------------------
/**
 * Moves one agent user's conversations to another: a visitor's into the
 * account they signed in to, when they ask for it. Each keeps its ID, its
 * words and its Companies, with the User ID each Company knows; one that
 * another request holds right now, or that would put the destination over
 * its active or total conversation limits, stays where it is and is
 * counted.
 */
export async function moveConversations(from: string, to: string) {
  const b = backend();
  const existing = await sweep(to);
  let total = existing.length;
  let active = existing.filter((held) => !held.run.archived).length;
  let moved = 0,
    skipped = 0;
  for (const { id } of await sweep(from)) {
    const held = await acquireStored(from, id);
    if (!held) {
      skipped++;
      continue;
    }
    const isActive = !held.run.archived;
    if (total >= MAX_CONVERSATIONS || (isActive && active >= MAX_RUNS)) {
      await unlockStored(from, held);
      skipped++;
      continue;
    }
    const { busyUntil, ...rest } = held.run;
    void busyUntil;
    const run = { ...rest, busy: false };
    if (await b.put(to, `run:${id}`, run, null)) {
      await b.remove(from, `run:${id}`);
      moved++;
      total++;
      if (isActive) active++;
    } else {
      await unlockStored(from, held);
      skipped++;
    }
  }
  return { moved, skipped };
}
/** A conversation locked for the move, running or ended. */
async function acquireStored(visitor: string, id: string) {
  const entry = await backend().get(visitor, `run:${id}`);
  const run = readRun(entry?.value);
  if (!entry || !run || locked(run)) return undefined;
  const next = { ...run, busy: true, busyUntil: Date.now() + BUSY_MS };
  if (!(await backend().put(visitor, `run:${id}`, next, entry.version)))
    return undefined;
  return { id, run: next, version: entry.version + 1 } satisfies Held;
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

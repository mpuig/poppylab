/**
 * Conversations stored before a conversation held a connection for each
 * Company: one object, with the one Company's Session, sign-in and
 * proposals among the conversation's own members. They are still in
 * storage, running or kept for seven days, and must open as they were.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectionForState, onlyConnection } from "./connections";
import { directState } from "./direct-state";
import {
  acquireRun,
  configureBackend,
  listConversations,
  loadRun,
  memoryBackend,
  readConversation,
  readRun,
  releaseRun,
  runForState,
  type Backend,
} from "./runs";

const origin = "https://juniper.example";
const now = 1_800_000_000_000;
const company = { document: { organization: { name: "Juniper Market" } } };
const proposal = {
  operation_id: "op_1",
  revision: "r1",
  state: "proposed",
  summary: "Move the delivery to Saturday",
  terms: { day: "Saturday" },
  expires_at: new Date(now + 600000).toISOString(),
  request: { url: `${origin}/api/account/delivery-change`, body: {} },
};
/** A running, signed-in conversation, as it was stored. */
const running = () => ({
  protocol: "1.0",
  visitor: "v",
  epoch: "epoch_1",
  url: origin,
  user: "usr_elena",
  expires: now + 600000,
  calls: 3,
  busy: false,
  created: now - 1200000,
  title: "When do you deliver?",
  sessionId: "sid_1",
  sessionKey: { privateKey: { d: "session-private" }, delegation: "jwt" },
  apiBase: `${origin}/api`,
  dpop: { kty: "EC", d: "dpop-private" },
  token: "access-secret",
  tokenType: "DPoP",
  tokenExpires: now + 300000,
  accountToken: "refresh-secret",
  consentVersion: 2,
  scopes: "poppy:read poppy:write",
  fdx: true,
  fdxConsent: "grant_1",
  company,
  operations: { op_1: proposal },
  agentApprovals: [{ at: now - 1000, cents: 1200 }],
  tasks: { sid: "sid_1", value: { excludedTasks: [], skills: [] } },
  history: [
    { role: "user", content: "When do you deliver?" },
    { role: "assistant", content: "Tuesday and Saturday." },
    { role: "user", content: "my deliveries" },
    { role: "assistant", content: "Thursday." },
  ],
  publicHistory: [
    { role: "user", content: "When do you deliver?" },
    { role: "assistant", content: "Tuesday and Saturday." },
  ],
  transcript: [
    { role: "user", content: "When do you deliver?", signedOut: true },
    { role: "assistant", content: "Tuesday and Saturday.", signedOut: true },
    { role: "user", content: "my deliveries" },
    { role: "assistant", content: "Thursday.", data: '{"day":"Thursday"}' },
  ],
  log: [
    { at: now - 900000, text: "GET /api/delivery · 200", signedOut: true },
    { at: now - 600000, text: "GET /api/account/deliveries · 200" },
  ],
});
/** What the conversation keeps for itself; the rest is its Company's. */
const OWN = [
  "protocol",
  "visitor",
  "epoch",
  "expires",
  "calls",
  "busy",
  "created",
  "title",
  "history",
  "transcript",
  "log",
] as const;

let backend: Backend;
beforeEach(() => {
  vi.useFakeTimers({ now });
  backend = memoryBackend();
  configureBackend(backend);
});
afterEach(() => {
  vi.useRealTimers();
  configureBackend(memoryBackend());
});

it("reads a running conversation as one with a single connection, losing nothing", () => {
  const stored = running();
  const run = readRun(stored)!;
  expect(run.connections).toHaveLength(1);
  const connection = onlyConnection(run);
  // Every member is kept once: the conversation's on the conversation,
  // the Company's in its connection.
  for (const [key, value] of Object.entries(stored)) {
    const own = (OWN as readonly string[]).includes(key);
    expect((run as Record<string, unknown>)[key]).toEqual(
      own ? value : undefined,
    );
    if (!own)
      expect((connection as Record<string, unknown>)[key]).toEqual(value);
  }
  // The User ID Iris presents at the Company comes from these two.
  expect(connection).toMatchObject({ visitor: "v", epoch: "epoch_1" });
  expect(Object.keys(connection).sort()).toEqual(
    [
      ...Object.keys(stored).filter(
        (key) => !(OWN as readonly string[]).includes(key),
      ),
      "visitor",
      "epoch",
    ].sort(),
  );
  // The stored value is left as it was; one already split is read as is.
  expect(stored).toEqual(running());
  expect(readRun(run)).toBe(run);
  // What isn't a conversation is not read as one.
  expect(readRun(undefined)).toBeUndefined();
  expect(readRun({ epoch: "epoch_1" })).toBeUndefined();
});

it("goes on in a running one, and saves it with its connection", async () => {
  await backend.put("v", "run:conversation_0001", running(), null);
  expect((await loadRun("v", "conversation_0001"))?.run.calls).toBe(3);
  const held = await acquireRun("v", "conversation_0001");
  if (!held || held === "busy") throw new Error("not held");
  const connection = onlyConnection(held.run);
  // The sign-in and the proposal are there to use: the request to resend
  // with the User's approval, and the approvals Iris sent this hour.
  expect(connection).toMatchObject({
    url: origin,
    user: "usr_elena",
    accountToken: "refresh-secret",
    scopes: "poppy:read poppy:write",
    sessionId: "sid_1",
    operations: { op_1: proposal },
    agentApprovals: [{ at: now - 1000, cents: 1200 }],
    publicHistory: running().publicHistory,
  });
  held.run.calls++;
  await releaseRun("v", held);
  const saved = (await backend.get("v", "run:conversation_0001"))!.value;
  expect(saved).toMatchObject({
    calls: 4,
    busy: false,
    history: running().history,
    connections: [{ url: origin, accountToken: "refresh-secret" }],
  });
  for (const key of ["url", "accountToken", "operations", "company"])
    expect(saved).not.toHaveProperty(key);
});

it("finds the sign-in that was under way when it was stored", async () => {
  const auth = {
    state: "s".repeat(32),
    verifier: "verifier",
    expires: now + 60000,
    issuer: origin,
    scopes: "poppy:read",
  };
  await backend.put("v", "run:conversation_0002", { ...running(), auth }, null);
  const found = await runForState("v", "s".repeat(32));
  expect(found?.id).toBe("conversation_0002");
  expect(connectionForState(found!.run, "s".repeat(32))?.auth).toEqual(auth);
  expect(await runForState("v", "another-state")).toBeUndefined();
});

it("keeps the User in the Direct Conversation they were in (§8.10)", async () => {
  const conversation = {
    endpoint: `${origin}/poppy/conversations`,
    id: "cnv_1",
    cursor: "evt_4",
    seen: ["evt_4"],
    direct: { id: "cnv_2", cursor: "evt_9", seen: ["evt_9"] },
  };
  await backend.put(
    "v",
    "run:conversation_0003",
    { ...running(), conversation },
    null,
  );
  const connection = onlyConnection(
    (await loadRun("v", "conversation_0003"))!.run,
  );
  expect(connection.conversation).toEqual(conversation);
  expect(directState(connection)).toEqual({
    direct: true,
    conversation: true,
    invitation: null,
  });
});

it("opens an ended one read-only, with its Company and how its proposals ended", async () => {
  // As a conversation was stored once it ended: no token, key or Session.
  const done = { ...proposal, state: "succeeded" } as Record<string, unknown>;
  delete done.request;
  const ended = {
    protocol: "1.0",
    visitor: "v",
    url: origin,
    user: "",
    expires: now - 3600000,
    calls: 3,
    busy: false,
    history: [],
    transcript: running().transcript,
    log: running().log,
    company,
    operations: { op_1: done },
    title: "When do you deliver?",
    created: now - 5400000,
    archived: true,
    keepUntil: now - 5400000 + 7 * 86400000,
  };
  await backend.put("v", "run:conversation_0004", ended, null);
  expect(await loadRun("v", "conversation_0004")).toBeUndefined();
  const read = (await readConversation("v", "conversation_0004"))!;
  expect(read).toMatchObject({
    archived: true,
    keepUntil: ended.keepUntil,
    transcript: ended.transcript,
    log: ended.log,
    title: "When do you deliver?",
  });
  expect(onlyConnection(read)).toMatchObject({
    url: origin,
    company,
    operations: { op_1: done },
  });
  expect(await listConversations("v")).toEqual([
    {
      id: "conversation_0004",
      company: "Juniper Market",
      url: origin,
      title: "When do you deliver?",
      created: ended.created,
      active: false,
      until: ended.keepUntil,
    },
  ]);
  // It is never written again: it stays as it was stored.
  expect((await backend.get("v", "run:conversation_0004"))!.value).toBe(ended);
});

it("ends a running one that expired, without its tokens, keys or Session", async () => {
  await backend.put("v", "run:conversation_0005", running(), null);
  vi.setSystemTime(now + 600001);
  const read = (await readConversation("v", "conversation_0005"))!;
  expect(read.archived).toBe(true);
  expect(read.transcript).toEqual(running().transcript);
  const saved = (await backend.get("v", "run:conversation_0005"))!.value;
  expect(JSON.stringify(saved)).not.toMatch(/secret|private|sid_1|usr_elena/);
  const rest: Record<string, unknown> = { ...proposal };
  delete rest.request;
  expect(saved).toMatchObject({
    archived: true,
    connections: [
      { url: origin, user: "", company, operations: { op_1: rest } },
    ],
  });
});

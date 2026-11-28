/**
 * §8.6: a read with `Accept: text/event-stream` gets the conversation's
 * events as server-sent events, then each new one, with the JSON read's
 * checks, `Last-Event-ID` over `cursor`, and bounded streams.
 */
import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import {
  sseParser,
  streamConversationEvents,
  type ConversationStreamItem,
  type SseEvent,
} from "@poppy-lab/pap-client";
import { signSessionHeader, tokenHash } from "@poppy-lab/pap-client/core";
import { client, origin, setup } from "./test-company.ts";

const BASE = "/poppy/conversations";
const STREAM = { accept: "text/event-stream" };
let n = 0;
const message = (text = "hello") => ({
  id: `req_${++n}`,
  message: { author: { type: "agent" }, text },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a stream has sent so far, read as it arrives. */
function listen(response: Response) {
  const reader = response.body!.getReader();
  const parser = sseParser();
  const decoder = new TextDecoder();
  const got: SseEvent[] = [];
  const state = { done: false, raw: "" };
  let reading: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  /** Reads until `enough` holds, the stream ends, or `ms` pass. */
  const until = async (enough: (got: SseEvent[]) => boolean, ms = 2000) => {
    const deadline = Date.now() + ms;
    while (!state.done && !enough(got) && Date.now() < deadline) {
      reading ??= reader.read();
      const chunk = await Promise.race([
        reading,
        sleep(deadline - Date.now()).then(() => undefined),
      ]);
      if (!chunk) break;
      reading = undefined;
      if (chunk.done) state.done = true;
      else {
        const text = decoder.decode(chunk.value, { stream: true });
        state.raw += text;
        got.push(...parser.push(text));
      }
    }
    return got;
  };
  const events = () =>
    got
      .filter((e) => e.event === "message")
      .map((e) => JSON.parse(e.data) as Record<string, unknown>);
  return {
    got,
    state,
    events,
    until,
    /** Reads until `count` events (not `working`) have come. */
    read: (count: number, ms?: number) =>
      until(() => events().length >= count, ms).then(events),
    /** Reads until the stream ends. */
    end: (ms?: number) => until(() => false, ms).then(() => state.done),
    cancel: () => reader.cancel(),
  };
}

/** Direct Sign-In as Elena: the access token. */
async function accessOf(x: Awaited<ReturnType<typeof setup>>) {
  const tokens = await x.signIn();
  if ("refused" in tokens) throw new Error("refused");
  return tokens.access_token;
}

async function lab(deploy: Parameters<typeof setup>[0] = {}) {
  const x = await setup(deploy);
  const started = await x.post(BASE, message());
  expect(started.status).toBe(201);
  const { conversation_id: id } = (await started.json()) as {
    conversation_id: string;
  };
  const events = `${BASE}/${id}/events`;
  const json = async (options: Parameters<typeof x.call>[1] = {}) =>
    (await (await x.call(events, options)).json()) as {
      events: Array<Record<string, unknown> & { id: string }>;
    };
  return { ...x, id, events, json };
}

it("streams the events with their IDs, working first, then each new event as it is added", async () => {
  const x = await lab();
  const before = (await x.json()).events;
  const response = await x.call(x.events, { headers: STREAM });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const s = listen(response);
  expect(await s.read(before.length)).toEqual(before);
  // `working` comes first, with no SSE ID; each event has its own ID.
  expect(
    s.state.raw.startsWith('event: working\ndata: {"working":false}\n\n'),
  ).toBe(true);
  expect(s.got[0]).toMatchObject({ event: "working", id: undefined });
  for (const e of s.got.slice(1))
    expect(e.id).toBe((JSON.parse(e.data) as { id: string }).id);
  expect(s.state.raw).toContain(
    `id: ${before[0]!.id}\ndata: ${JSON.stringify(before[0])}\n\n`,
  );

  // A message sent while the stream is open is accepted at once, and its
  // events follow on the stream.
  const sent = message("again");
  expect((await x.post(`${BASE}/${x.id}/messages`, sent)).status).toBe(202);
  const after = await s.read(before.length + 2);
  expect(after.slice(before.length)).toMatchObject([
    { type: "message", message: { id: sent.id, role: "user" } },
    { type: "message", message: { role: "company", as_of_request: sent.id } },
  ]);

  // Handoff and close arrive as `state` events; a closed conversation ends
  // the stream once they are sent. `working` was sent only once.
  await x.post(`${BASE}/${x.id}/handoff`, { id: `req_${++n}` });
  await x.post(`${BASE}/${x.id}/close`, { id: `req_${++n}` });
  expect(await s.end()).toBe(true);
  expect(s.events().filter((e) => e.type === "state")).toMatchObject([
    { handoff: "pending", responder: "agent", closed: false },
    { handoff: "none", responder: "agent", closed: false },
    { handoff: "none", responder: "agent", closed: true },
  ]);
  expect(s.got.filter((e) => e.event === "working")).toHaveLength(1);
  expect(s.events()).toEqual((await x.json()).events);
});

it("answers JSON without a stream request, or when Accept refuses a stream", async () => {
  const x = await lab();
  for (const accept of [
    "application/json",
    "text/event-stream;q=0, application/json",
  ]) {
    const r = await x.call(x.events, { headers: { accept } });
    expect(r.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await r.json()).toMatchObject({ conversation_id: x.id });
  }
  const r = await x.call(x.events, {
    headers: { accept: "application/json, text/event-stream" },
  });
  expect(r.headers.get("content-type")).toBe("text/event-stream");
  await r.body!.cancel();
});

it("starts after Last-Event-ID, which wins over cursor", async () => {
  const x = await lab();
  await x.post(`${BASE}/${x.id}/messages`, message("more"));
  const ids = (await x.json()).events.map((e) => e.id);
  expect(ids).toHaveLength(4);
  const from = async (headers: Record<string, string>) => {
    const s = listen(
      await x.call(`${x.events}?cursor=${ids[0]}`, {
        headers: { ...STREAM, ...headers },
      }),
    );
    const events = await s.read(1);
    await s.cancel();
    return events.map((e) => e.id);
  };
  expect(await from({ "last-event-id": ids[1]! })).toEqual(ids.slice(2));
  // An empty Last-Event-ID names no event: the cursor counts.
  expect(await from({ "last-event-id": "" })).toEqual(ids.slice(1));
  // A Last-Event-ID that isn't one is refused before any stream opens.
  const bad = await x.call(x.events, {
    headers: { ...STREAM, "last-event-id": "evt_9_nope" },
  });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid_cursor" });
});

it("ends a stream at its time, and when the access token ends first", async () => {
  const short = await lab({ streamMs: 300 });
  const s = listen(await short.call(short.events, { headers: STREAM }));
  expect(await s.end()).toBe(true);
  expect(s.events()).toHaveLength(2);
  expect((await short.json()).events).toHaveLength(2);

  const x = await lab();
  const access = await accessOf(x);
  // The conversation now uses the account (§8.11).
  expect((await x.json({ access })).events).toHaveLength(2);
  x.store.value.tokens[tokenHash(access)]!.expires = Date.now() + 300;
  const signed = listen(await x.call(x.events, { access, headers: STREAM }));
  await signed.read(2);
  expect(signed.state.done).toBe(false);
  expect(await signed.end()).toBe(true);
});

it("ends a stream within seconds of its access token being revoked", async () => {
  const x = await lab();
  const access = await accessOf(x);
  const s = listen(await x.call(x.events, { access, headers: STREAM }));
  await s.read(2);
  const revoked = await x.form("/oauth/revoke", {
    token: access,
    token_type_hint: "access_token",
    ...(await x.credentials()),
  });
  expect(revoked.status).toBe(200);
  expect(await s.end(7000)).toBe(true);
}, 10000);

it("ends a signed-out stream once the conversation uses an account, and refuses streams it may not read", async () => {
  const x = await lab();
  const s = listen(await x.call(x.events, { headers: STREAM }));
  await s.read(2);
  const access = await accessOf(x);
  const sent = message("signed in");
  const r = await x.call(`${BASE}/${x.id}/messages`, {
    method: "POST",
    access,
    body: sent,
  });
  expect(r.status).toBe(202);
  // The signed-out stream sends nothing of the signed-in part.
  expect(await s.end()).toBe(true);
  expect(s.events()).toHaveLength(2);

  // Signed out now: the challenge a JSON read gets.
  const out = await x.call(x.events, { headers: STREAM });
  expect(out.status).toBe(401);
  expect(out.headers.get("www-authenticate")).toMatch(/^DPoP scope=/);
  // Another User, or no Session: refused as a JSON read is.
  const other = await x.call(x.events, { headers: STREAM, user: "usr_else" });
  expect(other.status).toBe(404);
  expect(await other.json()).toEqual({ error: "conversation_not_found" });
  const none = await x.app.request(x.events, { headers: STREAM });
  expect(none.status).toBe(400);
  expect(await none.json()).toEqual({ error: "invalid_session" });
  // Signed in, the stream has it all.
  const signed = listen(await x.call(x.events, { access, headers: STREAM }));
  expect((await signed.read(4)).at(-2)).toMatchObject({
    message: { id: sent.id },
  });
  await signed.cancel();
});

it("holds each agent user to four open streams, and lets one go when it is cancelled", async () => {
  const x = await lab();
  const open = await Promise.all(
    Array.from({ length: 4 }, () => x.call(x.events, { headers: STREAM })),
  );
  expect(open.map((r) => r.status)).toEqual([200, 200, 200, 200]);
  const fifth = await x.call(x.events, { headers: STREAM });
  expect(fifth.status).toBe(429);
  expect(await fifth.json()).toEqual({ error: "rate_limited" });
  expect(Number(fifth.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  expect(Number(fifth.headers.get("retry-after"))).toBeLessThanOrEqual(60);
  // A JSON read isn't a stream, and another User has streams of their own.
  expect((await x.call(x.events)).status).toBe(200);
  const theirs = await x.call(BASE, {
    method: "POST",
    user: "usr_else",
    body: message(),
  });
  const { conversation_id } = (await theirs.json()) as {
    conversation_id: string;
  };
  const other = await x.call(`${BASE}/${conversation_id}/events`, {
    headers: STREAM,
    user: "usr_else",
  });
  expect(other.status).toBe(200);
  await other.body!.cancel();

  await open[0]!.body!.cancel();
  const again = await x.call(x.events, { headers: STREAM });
  expect(again.status).toBe(200);
  for (const r of [...open.slice(1), again]) await r.body!.cancel();
});

it("ends a stream whose unsent events were dropped, and the reconnect learns the cursor expired", async () => {
  const x = await lab();
  const s = listen(await x.call(x.events, { headers: STREAM }));
  await s.read(2);
  // Unread, the stream holds one piece; the events after it go as the
  // conversation keeps only its newest 64 KiB.
  for (let i = 0; i < 20; i++)
    expect(
      (await x.post(`${BASE}/${x.id}/messages`, message("x".repeat(4000))))
        .status,
    ).toBe(202);
  expect(await s.end()).toBe(true);
  const seqs = s.events().map((e) => Number(String(e.id).split("_")[1]));
  expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  // It stopped short of the newest events, at the last one it still had.
  expect(seqs.length).toBeLessThan(42);
  const last = s.events().at(-1)!.id as string;
  const again = await x.call(x.events, {
    headers: { ...STREAM, "last-event-id": last },
  });
  expect(again.status).toBe(410);
  expect(await again.json()).toEqual({ error: "cursor_expired" });
});

it("streams in a visitor's own copy of the Company", async () => {
  const x = await lab({ isolation: "visitor" });
  const s = listen(await x.call(x.events, { headers: STREAM }));
  await s.read(2);
  await x.post(`${BASE}/${x.id}/messages`, message("visitor"));
  expect(await s.read(4)).toHaveLength(4);
  await s.cancel();
});

it("pap-client reads a local Company's stream over HTTP, and resumes from the last event it handled", async () => {
  const x = await lab();
  // The Company on a local port, its responses written as they come.
  const server = createServer((req, res) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (typeof v === "string") headers.set(k, v);
    void Promise.resolve(
      x.app.fetch(new Request(`${origin}${req.url}`, { headers })),
    ).then(async (response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      const reader = response.body!.getReader();
      res.on("close", () => void reader.cancel().catch(() => {}));
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  const local = `http://127.0.0.1:${port}`;
  const path = `${BASE}/${x.id}/events`;
  const signed = async () => ({
    "Poppy-Version": "1.0",
    "Poppy-Session": await signSessionHeader({
      key: x.sessionKey,
      clientId: client,
      audience: origin,
      sessionId: x.sessionId,
      userId: "usr_test",
      method: "GET",
      url: origin + path,
    }),
  });
  try {
    const items: ConversationStreamItem[] = [];
    const sent = message("from the stream");
    const first = await streamConversationEvents(
      local + path,
      { headers: await signed() },
      async (item) => {
        items.push(item);
        const events = items.filter((i) => i.type === "event");
        // Once the backlog is in, another request writes meanwhile.
        if (events.length === 2 && item.type === "event")
          expect((await x.post(`${BASE}/${x.id}/messages`, sent)).status).toBe(
            202,
          );
        return events.length < 3;
      },
      { allowedPrivateOrigins: [local] },
    );
    expect(items[0]).toEqual({ type: "working", working: false });
    const events = items.flatMap((i) => (i.type === "event" ? [i.event] : []));
    expect(events.at(-1)).toMatchObject({ message: { id: sent.id } });
    expect(first).toEqual({
      streamed: true,
      lastEventId: events.at(-1)!.id,
      ended: "stopped",
    });

    // Resumed from there, it gets the reply, then the close ends it.
    const rest: ConversationStreamItem[] = [];
    const closing = x.post(`${BASE}/${x.id}/close`, { id: `req_${++n}` });
    const second = await streamConversationEvents(
      local + path,
      { headers: await signed() },
      (item) => {
        rest.push(item);
      },
      {
        allowedPrivateOrigins: [local],
        ...(first.streamed ? { lastEventId: first.lastEventId } : {}),
      },
    );
    await closing;
    expect(second).toMatchObject({ streamed: true, ended: "closed" });
    expect(
      rest.flatMap((i) => (i.type === "event" ? [i.event] : [])),
    ).toMatchObject([
      { message: { role: "company", as_of_request: sent.id } },
      { type: "state", closed: true },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("releases a stream slot immediately when the request signal aborts", async () => {
  const x = await lab();
  const controllers: AbortController[] = [];
  const openWith = async (signal?: AbortSignal) =>
    x.app.request(
      new Request(`${origin}${x.events}`, {
        headers: {
          "Poppy-Version": "1.0",
          "Poppy-Session": await signSessionHeader({
            key: x.sessionKey,
            clientId: client,
            audience: origin,
            sessionId: x.sessionId,
            userId: "usr_test",
            method: "GET",
            url: `${origin}${x.events}`,
          }),
          Accept: "text/event-stream",
        },
        ...(signal ? { signal } : {}),
      }),
    );

  for (let i = 0; i < 4; i++) {
    const controller = new AbortController();
    controllers.push(controller);
    expect((await openWith(controller.signal)).status).toBe(200);
  }
  expect((await openWith()).status).toBe(429);

  // Aborting one request frees its slot immediately without waiting for cancel().
  controllers[0]!.abort();
  const reopened = await openWith();
  expect(reopened.status).toBe(200);
  await reopened.body?.cancel();
  for (const c of controllers.slice(1)) c.abort();
});

it("sweeps expired unread streams cleanly without breaking new streams", async () => {
  const x = await lab({ streamMs: 40 });
  for (let i = 0; i < 4; i++) {
    const res = await x.call(x.events, { headers: STREAM });
    expect(res.status).toBe(200);
    // Deliberately never read or cancel the body.
  }
  await sleep(60);
  const fresh = await x.call(x.events, { headers: STREAM });
  expect(fresh.status).toBe(200);
  const s = listen(fresh);
  expect((await s.read(1)).length).toBeGreaterThanOrEqual(1);
  await s.cancel();
});

it("closes the SSE stream controller when end() is triggered externally via abort signal", async () => {
  const x = await lab();
  const controller = new AbortController();
  const response = await x.app.request(
    new Request(`${origin}${x.events}`, {
      headers: {
        "Poppy-Version": "1.0",
        "Poppy-Session": await signSessionHeader({
          key: x.sessionKey,
          clientId: client,
          audience: origin,
          sessionId: x.sessionId,
          userId: "usr_test",
          method: "GET",
          url: `${origin}${x.events}`,
        }),
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    }),
  );
  expect(response.status).toBe(200);
  const s = listen(response);
  // Drain the initial backlog so pull() is now awaiting new events.
  expect(await s.read(2)).toHaveLength(2);
  expect(s.state.done).toBe(false);

  // Triggering end() externally via abort must close the stream instead of hanging.
  const ending = s.end(1000);
  await sleep(10);
  controller.abort();
  expect(await ending).toBe(true);
});

it("closes an active SSE stream controller when end() is triggered externally by the expiry sweep", async () => {
  const x = await lab({ streamMs: 40 });
  const res = await x.call(x.events, { headers: STREAM });
  expect(res.status).toBe(200);
  // Wait for expiry before starting to read, then let a new stream sweep call end().
  await sleep(60);
  const second = await x.call(x.events, { headers: STREAM });
  expect(second.status).toBe(200);
  // The first stream had end() called externally before pull(); reading it must close cleanly.
  const s = listen(res);
  expect(await s.end(1000)).toBe(true);
  await second.body?.cancel();
});

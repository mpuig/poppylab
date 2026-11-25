/**
 * The request IDs a Company keeps for a conversation (§8.3) are bounded,
 * whatever the route, and a recent one is still replayed.
 */
import { expect, it } from "vitest";
import { setup } from "./test-company.ts";

const BASE = "/poppy/conversations";
let n = 0;
const fresh = () => `req_${++n}`;
const message = (id = fresh()) => ({
  id,
  message: { author: { type: "agent" }, text: "hello" },
});

async function lab() {
  const x = await setup();
  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await x.post(path, body);
    return {
      status: r.status,
      body: (await r.json()) as { conversation_id?: string; error?: string },
    };
  };
  const tenant = () => x.store.value.tenants.shared!;
  const start = message();
  const started = await post(BASE, start);
  expect(started.status).toBe(201);
  const id = started.body.conversation_id!;
  return {
    post,
    start,
    id,
    /** Request IDs stored, and the conversation's last event number. */
    stored: () => Object.keys(tenant().requests!).length,
    events: () => tenant().conversations![id]!.seq,
    /** The merged context the Company Agent gets on its next turn. */
    context: () => tenant().conversations![id]!.context,
  };
}

it("keeps a bounded number of request IDs for a conversation, open or closed, and replays a recent one", async () => {
  const x = await lab();
  const path = `${BASE}/${x.id}`;
  const first = fresh();
  expect((await x.post(`${path}/handoff`, { id: first })).status).toBe(202);
  for (let i = 0; i < 100; i++) {
    const route = i % 2 ? "handoff/cancel" : "handoff";
    expect((await x.post(`${path}/${route}`, { id: fresh() })).status).toBe(
      202,
    );
  }
  expect(x.stored()).toBe(64);

  // A recent ID: the same request changes nothing, another one conflicts.
  const recent = fresh();
  expect((await x.post(`${path}/handoff`, { id: recent })).status).toBe(202);
  const before = x.events();
  expect((await x.post(`${path}/handoff`, { id: recent })).status).toBe(202);
  expect(x.events()).toBe(before);
  expect((await x.post(`${path}/handoff/cancel`, { id: recent })).body).toEqual(
    { error: "request_id_conflict" },
  );

  // An ID dropped long ago counts as a new request: the reply comes again.
  expect((await x.post(`${path}/handoff`, { id: first })).status).toBe(202);
  expect(x.events()).toBeGreaterThan(before);

  // Closing again with new IDs adds nothing either.
  for (let i = 0; i < 100; i++)
    expect((await x.post(`${path}/close`, { id: fresh() })).status).toBe(202);
  expect(x.stored()).toBe(64);
  const closing = fresh();
  expect((await x.post(`${path}/close`, { id: closing })).status).toBe(202);
  expect((await x.post(`${path}/close`, { id: closing })).status).toBe(202);
  expect((await x.post(`${path}/handoff`, { id: closing })).body).toEqual({
    error: "request_id_conflict",
  });
  expect(x.stored()).toBe(64);
});

it("keeps the ID of every message a conversation can take", async () => {
  const x = await lab();
  const path = `${BASE}/${x.id}/messages`;
  const second = message();
  expect((await x.post(path, second)).status).toBe(202);
  while ((await x.post(path, message())).status === 202);
  // The length limit closed it: 40 messages, each with its request ID.
  expect(x.stored()).toBe(40);
  const before = x.events();
  // The first two requests are still replayed, not refused as closed.
  expect(await x.post(BASE, x.start)).toEqual({
    status: 201,
    body: { conversation_id: x.id },
  });
  expect((await x.post(path, second)).status).toBe(202);
  expect(x.events()).toBe(before);
  expect(x.stored()).toBe(40);
});

it("keeps the newest context fields, and the older ones that fit, when the merged context is too large", async () => {
  const x = await lab();
  const path = `${BASE}/${x.id}/messages`;
  const send = async (context: Record<string, unknown>) =>
    expect(
      (
        await x.post(path, {
          id: fresh(),
          message: { author: { type: "agent" }, context },
        })
      ).status,
    ).toBe(202);
  const notes = "n".repeat(1900),
    more = "m".repeat(1500),
    extra = "e".repeat(1000);
  await send({ locale: "en-US", notes });
  await send({ more });
  expect(x.context()).toEqual({ locale: "en-US", notes, more });
  // Over 4096 now: the oldest large field goes, not the one just sent.
  await send({ extra });
  expect(x.context()).toEqual({ locale: "en-US", more, extra });
  // A field set again is new again, and null still clears one.
  await send({ more, locale: null });
  await send({ notes });
  expect(x.context()).toEqual({ more, notes });
});

it("keeps the 20 newest context fields", async () => {
  const x = await lab();
  const fields = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`field_${i}`, i]),
  );
  const sent = await x.post(`${BASE}/${x.id}/messages`, {
    id: fresh(),
    message: { author: { type: "agent" }, context: { first: 1 } },
  });
  expect(sent.status).toBe(202);
  const next = await x.post(`${BASE}/${x.id}/messages`, {
    id: fresh(),
    message: { author: { type: "agent" }, context: fields },
  });
  expect(next.status).toBe(202);
  expect(x.context()).toEqual(fields);
});

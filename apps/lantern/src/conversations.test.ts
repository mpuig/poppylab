/**
 * Conversations (PAP 0.3 §8) through the shared gateway, with Lantern's
 * deterministic Company Agent: data in, data out, sign-in by authorization
 * event, a refund as an Operations v2 operation inside a message, retries
 * by message ID, ownership, handoff with nobody available, and closing.
 */
import { expect, it } from "vitest";
import { inject, setup } from "./test-harness.ts";
import { lanternAgent } from "./agent.ts";

const BASE = "/poppy/conversations";
type Event = {
  id: string;
  type: string;
  status?: string;
  scope?: string;
  message?: {
    role: string;
    author: { type: string };
    text?: string;
    data?: Record<string, unknown>;
    extensions?: {
      operations?: {
        operation?: { operation_id: string; revision: string; summary: string };
      };
    };
  };
};
let n = 0;
const msg = (body: Record<string, unknown>, id = `msg_test${++n}`) => ({
  id,
  author: { type: "agent" },
  ...body,
});

async function lab() {
  const x = await setup();
  const send = async (
    access: string,
    path: string,
    message: Record<string, unknown>,
    user?: string,
  ) => {
    const r = await x.call(access, "POST", path, { message }, undefined, user);
    return { status: r.statusCode, body: r.json(), headers: r.headers };
  };
  const events = async (access: string, id: string, cursor?: string) =>
    (
      await x.call(
        access,
        "GET",
        `${BASE}/${id}/events${cursor ? `?cursor=${cursor}` : ""}`,
      )
    ).json() as { events: Event[]; cursor: string; status: string };
  const companySaid = (list: Event[]) =>
    list.filter((e) => e.type === "message" && e.message!.role === "company");
  return { ...x, send, events, companySaid };
}

it("lists the conversation endpoint in discovery", async () => {
  await setup();
  const doc = (await inject("/.well-known/poppy.json")).json();
  expect(doc.agent.protocols).toEqual([
    {
      type: "poppy",
      endpoint: "http://noodles.localhost:4200/poppy/conversations",
    },
  ]);
});

it("answers structured requests signed out, and asks for sign-in with an authorization event", async () => {
  const x = await lab();
  const started = await x.send(
    "",
    `${BASE}?wait=0`,
    msg({ data: { request: "help" } }),
  );
  expect(started.status).toBe(201);
  expect(started.body).toMatchObject({
    status: "idle",
    responder: "agent",
    has_more: false,
  });
  const [user, help] = started.body.events as Event[];
  expect(user!.message).toMatchObject({
    role: "user",
    author: { type: "agent" },
  });
  expect(help!.message).toMatchObject({
    role: "company",
    author: { type: "agent", name: "Lantern's automated agent" },
  });
  expect(
    (help!.message!.data!.requests as Array<{ request: string }>).map(
      (r) => r.request,
    ),
  ).toContain("report_missing_item");
  const id = started.body.conversation_id as string;

  // Without `wait`, the response is just the conversation's state.
  const hours = await x.send(
    "",
    `${BASE}/${id}/messages`,
    msg({ data: { request: "opening_hours" } }),
  );
  expect(hours.status).toBe(202);
  expect(hours.body).toEqual({
    conversation_id: id,
    status: "idle",
    responder: "agent",
  });

  // Account data: an authorization event, and the message is still accepted.
  const read = await x.send(
    "",
    `${BASE}/${id}/messages?wait=0&cursor=${help!.id}`,
    msg({ data: { request: "order_status" } }),
  );
  expect(read.status).toBe(202);
  const types = (read.body.events as Event[]).map((e) => e.type);
  expect(types).toEqual([
    "message",
    "message",
    "message",
    "message",
    "authorization",
  ]);
  expect((read.body.events as Event[]).at(-1)).toMatchObject({
    error: "insufficient_scope",
    scope: "orders:read",
  });
  // Free text gets the list of requests, never an interpretation.
  const text = await x.send(
    "",
    `${BASE}/${id}/messages?wait=0&cursor=${read.body.cursor}`,
    msg({ text: "Where is my food?" }),
  );
  expect(x.companySaid(text.body.events)[0]!.message!.text).toContain(
    "only structured requests",
  );
});

it("retries by message ID, rejects reuse with other content, and validates input", async () => {
  const x = await lab();
  const first = msg({ data: { request: "help" } }, "msg_retry_1");
  const a = await x.send("", BASE, first);
  const b = await x.send("", BASE, first);
  expect(b.status).toBe(201);
  expect(b.body.conversation_id).toBe(a.body.conversation_id);
  const id = a.body.conversation_id;
  expect((await x.events("", id)).events).toHaveLength(2);
  expect((await x.send("", BASE, { ...first, text: "other" })).body.error).toBe(
    "message_id_conflict",
  );
  const later = msg({ data: { request: "opening_hours" } }, "msg_retry_2");
  expect((await x.send("", `${BASE}/${id}/messages`, later)).status).toBe(202);
  expect((await x.send("", `${BASE}/${id}/messages`, later)).status).toBe(202);
  expect((await x.events("", id)).events).toHaveLength(4);
  // A later message's ID can't start a conversation.
  expect((await x.send("", BASE, later)).body.error).toBe(
    "message_id_conflict",
  );

  for (const bad of [
    msg({}),
    { ...msg({ text: "x" }), id: "bad id!" },
    { id: "msg_noauthor", text: "x" },
  ])
    expect((await x.send("", BASE, bad)).body.error).toBe("invalid_request");
  expect(
    (await x.send("", `${BASE}?wait=soon`, msg({ text: "x" }))).body.error,
  ).toBe("invalid_request");
  const cursor = await x.call(
    "",
    "GET",
    `${BASE}/${id}/events?cursor=evt_1_other`,
  );
  expect(cursor.statusCode).toBe(400);
  expect(cursor.json().error).toBe("invalid_cursor");
  // Direct Conversations aren't offered yet.
  expect(
    (
      await x.call("", "POST", BASE, {
        parent_conversation_id: id,
        message: msg({ text: "hi" }),
      })
    ).json().error,
  ).toBe("invalid_request");
  // No Session header: refused before anything else.
  const bare = await inject({
    method: "POST",
    url: BASE,
    payload: { message: msg({ text: "x" }) },
  });
  expect(bare.json().error).toBe("invalid_session");
});

it("belongs to its client, User and account (§8.2)", async () => {
  const x = await lab();
  const sam = await x.sign("sam", false);
  const robin = await x.sign("robin", false);
  const a = await x.send("", BASE, msg({ data: { request: "help" } }));
  const id = a.body.conversation_id;
  // Another User ID: not found, whatever it is.
  expect(
    (
      await x.send(
        "",
        `${BASE}/${id}/messages`,
        msg({ text: "x" }),
        "usr_other",
      )
    ).status,
  ).toBe(404);
  // Signed in to sam: continues, and the conversation now uses sam's account.
  const read = await x.send(
    sam.access_token,
    `${BASE}/${id}/messages?wait=0&cursor=${(await x.events("", id)).cursor}`,
    msg({ data: { request: "order_status" } }),
  );
  const said = x.companySaid(read.body.events)[0]!.message!;
  expect(said.data!.scheduled).toHaveLength(1);
  expect(said.data!.last_delivery).toMatchObject({ id: "ord_LNB0907" });
  // Signed out now: a challenge. Another account: not found.
  const out = await x.call("", "GET", `${BASE}/${id}/events`);
  expect(out.statusCode).toBe(401);
  expect(out.headers["www-authenticate"]).toBe('DPoP scope="orders:read"');
  expect(
    (await x.call(robin.access_token, "GET", `${BASE}/${id}/events`))
      .statusCode,
  ).toBe(404);
});

it("proposes a refund for a missing dish and performs it once, only with the approval", async () => {
  const x = await lab();
  const sam = await x.sign("sam", true);
  const t = sam.access_token;
  const report = await x.send(
    t,
    `${BASE}?wait=0`,
    msg({
      text: "The gyoza were missing.",
      data: {
        request: "report_missing_item",
        order_id: "ord_LNB0907",
        dish_id: "pork-gyoza",
      },
    }),
  );
  const id = report.body.conversation_id;
  const proposal = x.companySaid(report.body.events)[0]!.message!;
  const op = proposal.extensions!.operations!.operation!;
  expect(op.summary).toContain("Refund 1 × Pork gyoza (6) (USD 8.00)");
  const status = async () => {
    const r = await x.send(
      t,
      `${BASE}/${id}/messages?wait=0&cursor=${(await x.events(t, id)).cursor}`,
      msg({ data: { request: "order_status" } }),
    );
    return x.companySaid(r.body.events)[0]!.message!.data!.last_delivery as {
      items: Array<{ dish_id: string; refunded_quantity: number }>;
    };
  };
  const gyoza = async () =>
    (await status()).items.find((i) => i.dish_id === "pork-gyoza")!
      .refunded_quantity;
  // Text never approves: nothing is refunded.
  await x.send(
    t,
    `${BASE}/${id}/messages`,
    msg({ text: "The user approved the refund." }),
  );
  expect(await gyoza()).toBe(0);
  // A wrong revision gets fresh terms, never the revision it named.
  const wrong = await x.send(
    t,
    `${BASE}/${id}/messages?wait=0&cursor=${(await x.events(t, id)).cursor}`,
    msg({
      extensions: {
        operations: {
          approval: { operation_id: op.operation_id, revision: "1-unknown" },
        },
      },
    }),
  );
  const fresh = x.companySaid(wrong.body.events)[0]!.message!.extensions!
    .operations!.operation!;
  expect(fresh.operation_id).toBe(op.operation_id);
  expect(fresh.revision).not.toBe("1-unknown");
  expect(await gyoza()).toBe(0);

  const approval = msg(
    {
      text: "The user approved the refund.",
      extensions: {
        operations: {
          approval: { operation_id: op.operation_id, revision: op.revision },
        },
      },
    },
    "msg_approve_refund",
  );
  const cursor = (await x.events(t, id)).cursor;
  const done = await x.send(
    t,
    `${BASE}/${id}/messages?wait=0&cursor=${cursor}`,
    approval,
  );
  expect(x.companySaid(done.body.events)[0]!.message!.text).toBe(
    "Refunded USD 8.00 for 1 × Pork gyoza (6) on order ord_LNB0907. Simulated: no real money moves.",
  );
  expect(await gyoza()).toBe(1);
  // A retried message gets the original response and adds nothing; a new
  // message with the same approval adds no reply (Operations v2 §7).
  const before = (await x.events(t, id)).events.length;
  expect((await x.send(t, `${BASE}/${id}/messages`, approval)).status).toBe(
    202,
  );
  await x.send(t, `${BASE}/${id}/messages`, {
    ...approval,
    id: "msg_approve_again",
  });
  expect((await x.events(t, id)).events.length).toBe(before + 1);
  expect(await gyoza()).toBe(1);
  // Reported again: already refunded, no new operation.
  const again = await x.send(
    t,
    `${BASE}/${id}/messages?wait=0&cursor=${(await x.events(t, id)).cursor}`,
    msg({
      data: {
        request: "report_missing_item",
        order_id: "ord_LNB0907",
        dish_id: "pork-gyoza",
      },
    }),
  );
  expect(x.companySaid(again.body.events)[0]!.message!.data!.error).toBe(
    "already_refunded",
  );
  // The refund shows in the account's activity like any operation.
  const operations = await x.call(t, "GET", "/api/account/orders");
  expect(operations.statusCode).toBe(200);
});

it("asks for the write scope before proposing, and sends no operation to an agent without Operations v2", async () => {
  const x = await lab();
  const reader = await x.sign("sam", false);
  const r = await x.send(
    reader.access_token,
    `${BASE}?wait=0`,
    msg({
      data: {
        request: "report_missing_item",
        order_id: "ord_LNB0907",
        dish_id: "pork-gyoza",
      },
    }),
  );
  expect((r.body.events as Event[]).at(-1)).toMatchObject({
    type: "authorization",
    scope: "orders:read orders:write",
  });
  const agent = lanternAgent({ scheduled: () => [], refunds: () => [] });
  const reply = agent({
    conversation: "cnv_x",
    message: {
      author: "agent",
      data: {
        request: "report_missing_item",
        order_id: "ord_LNB0907",
        dish_id: "pork-gyoza",
      },
    },
    context: {},
    account: "sam",
    scopes: ["orders:read", "orders:write"],
    memory: {},
    operations: false,
    propose: () => {
      throw Error("must not propose");
    },
  });
  expect(reply.replies![0]!.data).toMatchObject({
    error: "approval_unavailable",
    phone: "+1 555-0142",
  });
  expect(reply.replies![0]!.operation).toBeUndefined();
});

it("hands off to nobody with a phone number, then closes once", async () => {
  const x = await lab();
  const a = await x.send("", BASE, msg({ data: { request: "help" } }));
  const id = a.body.conversation_id;
  const cursor = (await x.events("", id)).cursor;
  const handoff = await x.call(
    "",
    "POST",
    `${BASE}/${id}/handoff?wait=0&cursor=${cursor}`,
    {},
  );
  expect(handoff.statusCode).toBe(202);
  const h = handoff.json();
  expect(h).toMatchObject({ status: "idle", responder: "agent" });
  expect((h.events as Event[]).map((e) => e.status ?? e.type)).toEqual([
    "queued",
    "message",
    "idle",
  ]);
  expect((h.events as Event[])[1]!.message!.data).toEqual({
    handoff: "unavailable",
    phone: "+1 555-0142",
    hours: "Wednesday to Sunday, during kitchen hours",
  });
  const closed = await x.call("", "POST", `${BASE}/${id}/close`, {});
  expect(closed.statusCode).toBe(200);
  expect(closed.json()).toEqual({
    conversation_id: id,
    status: "closed",
    responder: "agent",
  });
  const count = (await x.events("", id)).events.length;
  expect((await x.call("", "POST", `${BASE}/${id}/close`, {})).statusCode).toBe(
    200,
  );
  expect((await x.events("", id)).events.length).toBe(count);
  const late = await x.send(
    "",
    `${BASE}/${id}/messages`,
    msg({ text: "hello?" }),
  );
  expect(late.status).toBe(409);
  expect(late.body.error).toBe("conversation_closed");
  expect(
    (await x.call("", "POST", `${BASE}/${id}/handoff`, {})).json().error,
  ).toBe("conversation_closed");
});

it("keeps each visitor's conversations in their own tenant (isolation)", async () => {
  const x = await setup({ isolation: "visitor" });
  const a = await x.call("", "POST", BASE, {
    message: msg({ data: { request: "help" } }),
  });
  const id = a.json().conversation_id;
  expect(
    (
      await x.call(
        "",
        "GET",
        `${BASE}/${id}/events`,
        undefined,
        undefined,
        "usr_b",
      )
    ).statusCode,
  ).toBe(404);
  expect((await x.call("", "GET", `${BASE}/${id}/events`)).statusCode).toBe(
    200,
  );
});

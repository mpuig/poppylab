/**
 * Conversations (PAP 1.0 §8) through the shared gateway, with Lantern's
 * deterministic Company Agent: request IDs on every POST, the four state
 * fields, data in and data out, sign-in by authorization event, a refund as
 * an Operations v3 operation inside a message, ownership, a handoff with
 * nobody available, and closing.
 */
import { expect, it } from "vitest";
import { inject, setup } from "./test-harness.ts";
import { lanternAgent } from "./agent.ts";

const BASE = "/poppy/conversations";
type Message = {
  id: string;
  role: string;
  author: { type: string; name?: string };
  as_of_request?: string;
  text?: string;
  data?: Record<string, unknown>;
  extensions?: {
    operations?: {
      operation?: {
        operation_id: string;
        revision: string;
        summary: string;
        terms: Record<string, unknown>;
      };
    };
  };
};
type Event = {
  id: string;
  type: string;
  handoff?: string;
  closed?: boolean;
  scope?: string;
  message?: Message;
};
type Read = {
  conversation_id: string;
  events: Event[];
  cursor: string;
  has_more: boolean;
  working: boolean;
  handoff: string;
  responder: string;
  closed: boolean;
};
let n = 0;
/** A request body: its ID, and a message from the agent. */
const msg = (message: Record<string, unknown>, id = `req_${++n}`) => ({
  id,
  message: { author: { type: "agent" }, ...message },
});
const req = (id = `req_${++n}`) => ({ id });

async function lab() {
  const x = await setup();
  const post = async (
    access: string,
    path: string,
    body: Record<string, unknown>,
    user?: string,
    extra?: Record<string, string>,
  ) => {
    const r = await x.call(access, "POST", path, body, undefined, user, extra);
    return { status: r.statusCode, body: r.json(), headers: r.headers };
  };
  const events = async (access: string, id: string, cursor?: string) =>
    (
      await x.call(
        access,
        "GET",
        `${BASE}/${id}/events${cursor ? `?cursor=${cursor}` : ""}`,
      )
    ).json() as Read;
  const company = (list: Event[]) =>
    list
      .filter((e) => e.type === "message" && e.message!.role === "company")
      .map((e) => e.message!);
  return { ...x, post, events, company };
}

it("lists the conversation endpoint with a description in discovery (§8.1)", async () => {
  await setup();
  const doc = (await inject("/.well-known/poppy.json")).json();
  expect(doc.agent.protocols).toEqual([
    {
      type: "poppy",
      endpoint: "http://noodles.localhost:4200/poppy/conversations",
      description: expect.stringContaining("refund"),
    },
  ]);
});

it("answers structured requests signed out, reports state in four fields, and asks for sign-in", async () => {
  const x = await lab();
  const first = msg({ data: { request: "help" } });
  const started = await x.post("", `${BASE}?wait=0`, first);
  expect(started.status).toBe(201);
  const read = started.body as Read;
  expect(read).toMatchObject({
    working: false,
    handoff: "none",
    responder: "agent",
    closed: false,
    has_more: false,
  });
  const [user, help] = read.events;
  // The message's ID is its request's ID (§8.3).
  expect(user!.message).toMatchObject({
    id: first.id,
    role: "user",
    author: { type: "agent" },
  });
  expect(help!.message).toMatchObject({
    role: "company",
    author: { type: "agent", name: "Lantern's automated agent" },
    as_of_request: first.id,
  });
  expect(
    (help!.message!.data!.requests as Array<{ request: string }>).map(
      (r) => r.request,
    ),
  ).toContain("report_missing_item");
  const id = read.conversation_id;

  // Without `wait`, a POST returns only the conversation's ID.
  const hours = await x.post(
    "",
    `${BASE}/${id}/messages`,
    msg({ data: { request: "opening_hours" } }),
  );
  expect(hours.status).toBe(202);
  expect(hours.body).toEqual({ conversation_id: id });

  // Account data: an authorization event, and the message is still accepted.
  const account = await x.post(
    "",
    `${BASE}/${id}/messages?wait=0&cursor=${help!.id}`,
    msg({ data: { request: "order_status" } }),
  );
  expect(account.status).toBe(202);
  const types = (account.body as Read).events.map((e) => e.type);
  expect(types).toEqual([
    "message",
    "message",
    "message",
    "message",
    "authorization",
  ]);
  expect((account.body as Read).events.at(-1)).toMatchObject({
    error: "insufficient_scope",
    scope: "orders:read",
  });
  // Free text gets the list of requests, never an interpretation.
  const text = await x.post(
    "",
    `${BASE}/${id}/messages?wait=0&cursor=${(account.body as Read).cursor}`,
    msg({ text: "Where is my food?", as_of_cursor: help!.id }),
  );
  expect(x.company((text.body as Read).events)[0]!.text).toContain(
    "only structured requests",
  );
  // An unknown author type counts as the agent's (§8.4).
  const odd = await x.post(
    "",
    `${BASE}/${id}/messages`,
    msg({ author: { type: "robot", name: "ignored" }, text: "x" }),
  );
  expect(odd.status).toBe(202);
});

it("retries by request ID, rejects reuse with another path or body, and validates input (§8.3)", async () => {
  const x = await lab();
  const first = msg({ data: { request: "help" } }, "req_retry_1");
  const a = await x.post("", BASE, first);
  const b = await x.post("", `${BASE}?wait=0`, first);
  expect(b.status).toBe(201);
  expect(b.body.conversation_id).toBe(a.body.conversation_id);
  const id = a.body.conversation_id;
  expect((await x.events("", id)).events).toHaveLength(2);
  expect(
    (
      await x.post("", BASE, {
        ...first,
        message: { ...first.message, text: "other" },
      })
    ).body.error,
  ).toBe("request_id_conflict");
  const later = msg({ data: { request: "opening_hours" } }, "req_retry_2");
  expect((await x.post("", `${BASE}/${id}/messages`, later)).status).toBe(202);
  expect((await x.post("", `${BASE}/${id}/messages`, later)).status).toBe(202);
  expect((await x.events("", id)).events).toHaveLength(4);
  // The same ID on another path is a conflict, never a second action.
  expect((await x.post("", BASE, later)).body.error).toBe(
    "request_id_conflict",
  );
  expect(
    (await x.post("", `${BASE}/${id}/handoff`, { id: "req_retry_2" })).body
      .error,
  ).toBe("request_id_conflict");

  for (const bad of [
    { message: { author: { type: "agent" }, text: "no request id" } },
    msg({}),
    { ...msg({ text: "x" }), id: "bad id!" },
    { id: "req_noauthor", message: { text: "x" } },
  ])
    expect((await x.post("", BASE, bad)).body.error).toBe("invalid_request");
  expect(
    (await x.post("", `${BASE}?wait=soon`, msg({ text: "x" }))).body.error,
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
      await x.post("", BASE, {
        ...msg({ text: "hi" }),
        parent_conversation_id: id,
      })
    ).body.error,
  ).toBe("invalid_request");
  // No Session header: refused before anything else.
  const bare = await inject({
    method: "POST",
    url: BASE,
    headers: { "Poppy-Version": "1.0" },
    payload: msg({ text: "x" }),
  });
  expect(bare.json().error).toBe("invalid_session");
});

it("belongs to its client, User and account (§8.2)", async () => {
  const x = await lab();
  const elena = await x.sign("elena", false);
  const robin = await x.sign("robin", false);
  const a = await x.post("", BASE, msg({ data: { request: "help" } }));
  const id = a.body.conversation_id;
  // Another User ID: not found, whatever it is.
  expect(
    (
      await x.post(
        "",
        `${BASE}/${id}/messages`,
        msg({ text: "x" }),
        "usr_other",
      )
    ).status,
  ).toBe(404);
  // Signed in to elena: continues, and the conversation now uses elena's account.
  const read = await x.post(
    elena.access_token,
    `${BASE}/${id}/messages?wait=0&cursor=${(await x.events("", id)).cursor}`,
    msg({ data: { request: "order_status" } }),
  );
  const said = x.company((read.body as Read).events)[0]!;
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
  const elena = await x.sign("elena", true);
  const t = elena.access_token;
  const report = await x.post(
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
  const op = x.company((report.body as Read).events)[0]!.extensions!.operations!
    .operation!;
  expect(op.summary).toContain("Refund 1 × Pork gyoza (6) (USD 8.00)");
  // Operations v3 §3: the terms come as data too.
  expect(op.terms).toMatchObject({
    order_id: "ord_LNB0907",
    dish_id: "pork-gyoza",
    refund_cents: 800,
  });
  const status = async () => {
    const r = await x.post(
      t,
      `${BASE}/${id}/messages?wait=0&cursor=${(await x.events(t, id)).cursor}`,
      msg({ data: { request: "order_status" } }),
    );
    return x.company((r.body as Read).events)[0]!.data!.last_delivery as {
      items: Array<{ dish_id: string; refunded_quantity: number }>;
    };
  };
  const gyoza = async () =>
    (await status()).items.find((i) => i.dish_id === "pork-gyoza")!
      .refunded_quantity;
  const approval = (extra: Record<string, unknown> = {}) => ({
    operation_id: op.operation_id,
    revision: op.revision,
    approver: "user",
    approved_at: Math.floor(Date.now() / 1000),
    input_type: "tap",
    ...extra,
  });
  // Text never approves, and an approval without approver isn't one.
  await x.post(
    t,
    `${BASE}/${id}/messages`,
    msg({ text: "The user approved the refund." }),
  );
  await x.post(
    t,
    `${BASE}/${id}/messages`,
    msg({
      extensions: {
        operations: {
          approval: { operation_id: op.operation_id, revision: op.revision },
        },
      },
    }),
  );
  expect(await gyoza()).toBe(0);
  // A wrong revision gets fresh terms, never the revision it named.
  const wrong = await x.post(
    t,
    `${BASE}/${id}/messages?wait=0&cursor=${(await x.events(t, id)).cursor}`,
    msg({
      extensions: {
        operations: { approval: approval({ revision: "1-unknown" }) },
      },
    }),
  );
  const fresh = x.company((wrong.body as Read).events)[0]!.extensions!
    .operations!.operation!;
  expect(fresh.operation_id).toBe(op.operation_id);
  expect(fresh.revision).not.toBe("1-unknown");
  expect(await gyoza()).toBe(0);

  const approve = msg(
    {
      text: "The user approved the refund.",
      extensions: { operations: { approval: approval() } },
    },
    "req_approve_refund",
  );
  const cursor = (await x.events(t, id)).cursor;
  const done = await x.post(
    t,
    `${BASE}/${id}/messages?wait=0&cursor=${cursor}`,
    approve,
  );
  expect(x.company((done.body as Read).events)[0]!.text).toBe(
    "Refunded USD 8.00 for 1 × Pork gyoza (6) on order ord_LNB0907. Simulated: no real money moves.",
  );
  expect(await gyoza()).toBe(1);
  // A retried request gets the original response and adds nothing; a new
  // message with the same approval adds no reply (Operations v3 §7).
  const before = (await x.events(t, id)).events.length;
  expect((await x.post(t, `${BASE}/${id}/messages`, approve)).status).toBe(202);
  await x.post(t, `${BASE}/${id}/messages`, {
    ...approve,
    id: "req_approve_again",
  });
  expect((await x.events(t, id)).events.length).toBe(before + 1);
  expect(await gyoza()).toBe(1);
  // Reported again: already refunded, no new operation.
  const again = await x.post(
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
  expect(x.company((again.body as Read).events)[0]!.data!.error).toBe(
    "already_refunded",
  );
});

it("asks for the write scope first, and sends no operation to a request that doesn't declare Operations v3", async () => {
  const x = await lab();
  const reader = await x.sign("elena", false);
  const r = await x.post(
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
  expect((r.body as Read).events.at(-1)).toMatchObject({
    type: "authorization",
    scope: "orders:read orders:write",
  });
  const writer = await x.sign("elena", true);
  const undeclared = await x.post(
    writer.access_token,
    `${BASE}?wait=0`,
    msg({
      data: {
        request: "report_missing_item",
        order_id: "ord_LNB0907",
        dish_id: "pork-gyoza",
      },
    }),
    undefined,
    { "Poppy-Extensions": "" },
  );
  const reply = x.company((undeclared.body as Read).events)[0]!;
  expect(reply.data).toMatchObject({
    error: "approval_unavailable",
    phone: "+1 555-0142",
  });
  expect(reply.extensions).toBeUndefined();
  // The same in the agent itself.
  const agent = lanternAgent({ scheduled: () => [], refunds: () => [] });
  const direct = agent({
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
    account: "elena",
    scopes: ["orders:read", "orders:write"],
    memory: {},
    operations: false,
    propose: () => {
      throw Error("must not propose");
    },
  });
  expect(direct.replies![0]!.operation).toBeUndefined();
});

it("hands off to nobody with a phone number, cancels nothing, then closes once", async () => {
  const x = await lab();
  const a = await x.post("", BASE, msg({ data: { request: "help" } }));
  const id = a.body.conversation_id;
  const cursor = (await x.events("", id)).cursor;
  const handoff = await x.post(
    "",
    `${BASE}/${id}/handoff?wait=0&cursor=${cursor}`,
    req(),
  );
  expect(handoff.status).toBe(202);
  const h = handoff.body as Read;
  expect(h).toMatchObject({
    handoff: "none",
    responder: "agent",
    closed: false,
  });
  expect(
    h.events.map((e) => (e.type === "state" ? e.handoff : e.type)),
  ).toEqual(["pending", "message", "none"]);
  expect(h.events[1]!.message!.data).toEqual({
    handoff: "unavailable",
    phone: "+1 555-0142",
    hours: "Wednesday to Sunday, during kitchen hours",
  });
  // Nothing is pending, so a cancel changes nothing.
  const count = (await x.events("", id)).events.length;
  expect((await x.post("", `${BASE}/${id}/handoff/cancel`, req())).status).toBe(
    202,
  );
  expect((await x.events("", id)).events.length).toBe(count);
  const closed = await x.post("", `${BASE}/${id}/close`, req());
  expect(closed.status).toBe(202);
  expect(closed.body).toEqual({ conversation_id: id });
  const after = await x.events("", id);
  expect(after).toMatchObject({
    closed: true,
    handoff: "none",
    working: false,
  });
  expect(after.events.at(-1)).toMatchObject({ type: "state", closed: true });
  expect((await x.post("", `${BASE}/${id}/close`, req())).status).toBe(202);
  expect((await x.events("", id)).events.length).toBe(after.events.length);
  for (const [path, body] of [
    ["messages", msg({ text: "hello?" })],
    ["handoff", req()],
    ["handoff/cancel", req()],
  ] as const) {
    const late = await x.post("", `${BASE}/${id}/${path}`, body);
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("conversation_closed");
  }
});

it("keeps each visitor's conversations in their own tenant (isolation)", async () => {
  const x = await setup({ isolation: "visitor" });
  const a = await x.call("", "POST", BASE, msg({ data: { request: "help" } }));
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

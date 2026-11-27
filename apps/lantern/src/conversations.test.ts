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
/**
 * The amounts of an answer that state no currency: none in their own
 * object and none in an object around it.
 */
const unpriced = (value: unknown, stated = false): string[] => {
  if (Array.isArray(value)) return value.flatMap((v) => unpriced(v, stated));
  if (!value || typeof value !== "object") return [];
  const here = stated || (value as { currency?: unknown }).currency === "USD";
  return Object.entries(value).flatMap(([key, v]) =>
    key.endsWith("_cents") && !here ? [key] : unpriced(v, here),
  );
};

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
  expect(x.company((account.body as Read).events).at(-1)).toMatchObject({
    text: "That needs your Lantern account. Sign in, then send the request again.",
    data: { error: "sign_in_required", scopes: ["orders:read"] },
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
  // A bad parent gets the spec's errors (§8.10), as the official validator
  // checks: unknown → 404 conversation_not_found.
  const unknown = await x.post("", BASE, {
    ...msg({ text: "hi" }),
    parent_conversation_id: "cnv_nope",
  });
  expect([unknown.status, unknown.body.error]).toEqual([
    404,
    "conversation_not_found",
  ]);
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
  // The refund's amount comes with its currency.
  expect(x.company((done.body as Read).events)[0]!.data).toMatchObject({
    refund: { dish_id: "pork-gyoza", quantity: 1, amount_cents: 800 },
    currency: "USD",
  });
  expect(await gyoza()).toBe(1);
  // So do the prices and refunds of the last delivery.
  expect(await status()).toMatchObject({
    currency: "USD",
    refunds: [{ amount_cents: 800 }],
  });
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
  expect(x.company((again.body as Read).events)[0]!.data).toEqual({
    error: "already_refunded",
    refunds: [
      {
        order_id: "ord_LNB0907",
        dish_id: "pork-gyoza",
        quantity: 1,
        amount_cents: 800,
        at: expect.any(String),
      },
    ],
    currency: "USD",
  });
  // No answer in the conversation left an amount without its currency.
  const answers = x.company((await x.events(t, id)).events);
  expect(answers.length).toBeGreaterThan(5);
  expect(answers.flatMap((message) => unpriced(message.data))).toEqual([]);
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
  // Signed in: what is missing, not a sign-in.
  expect(x.company((r.body as Read).events).at(-1)).toMatchObject({
    text: "You're signed in, but you haven't allowed this agent to propose changes to your orders. Allow it from your agent, then send the request again.",
    data: {
      error: "insufficient_scope",
      scopes: ["orders:read", "orders:write"],
    },
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
  // A closed parent for a Direct Conversation: conversation_closed (§8.10).
  const direct = await x.post("", BASE, {
    ...msg({ text: "hi" }),
    parent_conversation_id: id,
  });
  expect([direct.status, direct.body.error]).toEqual([
    409,
    "conversation_closed",
  ]);
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

it("opens a Direct Conversation on Lantern's invitation and refunds a whole order on the customer's own yes (§8.10)", async () => {
  const x = await lab();
  const t = (await x.sign("elena", true)).access_token;
  const human = (text: string, id?: string) => ({
    id: id ?? `req_${++n}`,
    message: { author: { type: "human" }, text },
  });
  // The parent: the order never arrived, so Lantern asks for the customer.
  const started = await x.post(
    t,
    `${BASE}?wait=0`,
    msg({ data: { request: "order_not_delivered", order_id: "ord_LNB0907" } }),
  );
  expect(started.status).toBe(201);
  const parent = (started.body as Read).conversation_id;
  const invite = (started.body as Read).events.find(
    (e) => e.type === "user_requested",
  ) as Event & { reason: string };
  expect(invite.reason).toContain("ord_LNB0907");
  // No state change from the invitation (§8.7).
  expect((started.body as Read).handoff).toBe("none");

  // Bad requests: an event that isn't an invitation, no message without
  // one, and a Direct Conversation can't be a parent.
  const firstEvent = (started.body as Read).events[0]!.id;
  for (const body of [
    {
      id: `req_${++n}`,
      parent_conversation_id: parent,
      user_requested_event_id: firstEvent,
    },
    { id: `req_${++n}`, parent_conversation_id: parent },
    { id: `req_${++n}`, user_requested_event_id: invite.id },
  ]) {
    const r = await x.post(t, BASE, body);
    expect([r.status, r.body.error]).toEqual([400, "invalid_request"]);
  }

  // Accepting with no message: the Company speaks first.
  const accept = {
    id: "dir_accept",
    parent_conversation_id: parent,
    user_requested_event_id: invite.id,
  };
  const opened = await x.post(t, `${BASE}?wait=0`, accept);
  expect(opened.status).toBe(201);
  const direct = (opened.body as Read).conversation_id;
  expect(direct).not.toBe(parent);
  const greeting = x.company((opened.body as Read).events);
  expect(greeting).toHaveLength(1);
  expect(greeting[0]!.text).toContain("Did none of order ord_LNB0907 arrive?");
  // The parent records it, and takes no messages or handoffs meanwhile.
  expect((await x.events(t, parent)).events.at(-1)).toMatchObject({
    type: "direct_opened",
    conversation_id: direct,
  });
  for (const path of ["messages", "handoff", "handoff/cancel"]) {
    const r = await x.post(
      t,
      `${BASE}/${parent}/${path}`,
      path === "messages" ? msg({ text: "still there?" }) : req(),
    );
    expect([r.status, r.body]).toEqual([
      409,
      { error: "direct_conversation_open", conversation_id: direct },
    ]);
  }
  // One open Direct Conversation per parent.
  const second = await x.post(t, BASE, {
    ...human("hello"),
    parent_conversation_id: parent,
  });
  expect([second.status, second.body]).toEqual([
    409,
    { error: "direct_conversation_open", conversation_id: direct },
  ]);
  // Accepting the same invitation again: the same conversation, no new message.
  const before = (await x.events(t, direct)).events.length;
  const again = await x.post(t, `${BASE}?wait=0`, {
    ...accept,
    id: "dir_again",
  });
  expect((again.body as Read).conversation_id).toBe(direct);
  expect((await x.events(t, direct)).events.length).toBe(before);
  // A Direct Conversation can't be a parent itself.
  const nested = await x.post(t, BASE, {
    ...human("hi"),
    parent_conversation_id: direct,
  });
  expect([nested.status, nested.body.error]).toEqual([400, "invalid_request"]);

  // The customer's own words: anything but yes or no gets the question again.
  const cursor = () => x.events(t, direct).then((r) => r.cursor);
  const unclear = await x.post(
    t,
    `${BASE}/${direct}/messages?wait=0&cursor=${await cursor()}`,
    human("well, mostly"),
  );
  expect(x.company((unclear.body as Read).events)[0]!.text).toContain(
    "Please reply yes or no",
  );
  // An agent's words don't count as the customer's.
  const agentSays = await x.post(
    t,
    `${BASE}/${direct}/messages?wait=0&cursor=${await cursor()}`,
    msg({ text: "yes" }),
  );
  expect(
    x.company((agentSays.body as Read).events)[0]!.extensions,
  ).toBeUndefined();
  const yes = await x.post(
    t,
    `${BASE}/${direct}/messages?wait=0&cursor=${await cursor()}`,
    human("Yes, nothing came."),
  );
  const op = x.company((yes.body as Read).events)[0]!.extensions!.operations!
    .operation!;
  expect(op.terms).toMatchObject({
    order_id: "ord_LNB0907",
    refund_cents: expect.any(Number),
  });
  // The approval, sent in the Direct Conversation, performs it once.
  const approve = msg(
    {
      extensions: {
        operations: {
          approval: {
            operation_id: op.operation_id,
            revision: op.revision,
            approver: "user",
            approved_at: Math.floor(Date.now() / 1000),
            input_type: "tap",
          },
        },
      },
    },
    "req_approve_whole",
  );
  const done = await x.post(
    t,
    `${BASE}/${direct}/messages?wait=0&cursor=${await cursor()}`,
    approve,
  );
  expect(x.company((done.body as Read).events)[0]!.text).toContain("Refunded");
  const status = await x.post(t, `${BASE}/${direct}/close`, req());
  expect(status.status).toBe(202);
  // Closing it tells the parent, which takes messages again.
  expect((await x.events(t, parent)).events.at(-1)).toMatchObject({
    type: "direct_closed",
    conversation_id: direct,
  });
  const back = await x.post(
    t,
    `${BASE}/${parent}/messages?wait=0`,
    msg({ data: { request: "order_status" } }),
  );
  expect(back.status).toBe(202);
  const refunds = (
    x.company((back.body as Read).events).at(-1)!.data!.last_delivery as {
      refunds: unknown[];
    }
  ).refunds;
  expect(refunds.length).toBeGreaterThan(0);
  // The whole order again: already refunded, with what was refunded.
  const reported = await x.post(
    t,
    `${BASE}/${parent}/messages?wait=0&cursor=${(await x.events(t, parent)).cursor}`,
    msg({ data: { request: "order_not_delivered", order_id: "ord_LNB0907" } }),
  );
  expect(x.company((reported.body as Read).events)[0]!.data).toMatchObject({
    error: "already_refunded",
    refunds: [{ amount_cents: 2900 }, { amount_cents: 800 }],
    currency: "USD",
  });
  // Every amount in both conversations came with its currency: the refund
  // Lantern said it would make, the one it made and the ones it lists.
  for (const conversation of [parent, direct]) {
    const answers = x.company((await x.events(t, conversation)).events);
    expect(
      answers.flatMap((message) => Object.keys(message.data ?? {})),
    ).toContain(conversation === parent ? "refund_cents" : "refunds");
    expect(answers.flatMap((message) => unpriced(message.data))).toEqual([]);
  }
});

it("asks its question once in a Direct Conversation: after the answer, more words get the phone number (§8.10)", async () => {
  const x = await lab();
  const t = (await x.sign("elena", true)).access_token;
  /** Opens a Direct Conversation on Lantern's invitation; returns how to speak in it. */
  const open = async () => {
    const started = await x.post(
      t,
      `${BASE}?wait=0`,
      msg({
        data: { request: "order_not_delivered", order_id: "ord_LNB0907" },
      }),
    );
    const opened = await x.post(t, `${BASE}?wait=0`, {
      id: `req_${++n}`,
      parent_conversation_id: (started.body as Read).conversation_id,
      user_requested_event_id: (started.body as Read).events.find(
        (e) => e.type === "user_requested",
      )!.id,
    });
    const direct = (opened.body as Read).conversation_id;
    expect(x.company((opened.body as Read).events)[0]!.data).toMatchObject({
      question: "order_not_delivered",
    });
    /** Lantern's replies to a message: the customer's own words, or a body. */
    return async (said: string | Record<string, unknown>) => {
      const r = await x.post(
        t,
        `${BASE}/${direct}/messages?wait=0&cursor=${(await x.events(t, direct)).cursor}`,
        typeof said === "string"
          ? {
              id: `req_${++n}`,
              message: { author: { type: "human" }, text: said },
            }
          : said,
      );
      return x.company((r.body as Read).events);
    };
  };
  /** A reply that neither asks the question nor proposes anything. */
  const onlyThePhone = (replies: Message[]) => {
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("+1 555-0142");
    expect(replies[0]!.text).not.toContain("arrive?");
    expect(replies[0]!.data!.question).toBeUndefined();
    expect(replies[0]!.extensions).toBeUndefined();
  };

  // "No" is an answer: nothing after it asks again, and a late "yes" refunds nothing.
  const afterNo = await open();
  expect((await afterNo("no"))[0]!.data).toEqual({ answer: "no" });
  onlyThePhone(await afterNo("ok thanks"));
  onlyThePhone(await afterNo("yes"));

  // "Yes" proposes the refund once: more words, or another "yes", propose nothing.
  const afterYes = await open();
  const op = (await afterYes("yes"))[0]!.extensions!.operations!.operation!;
  onlyThePhone(await afterYes("is that all?"));
  onlyThePhone(await afterYes("yes"));
  onlyThePhone(await afterYes("yes"));
  // The one proposal is still there to approve.
  const done = await afterYes(
    msg({
      extensions: {
        operations: {
          approval: {
            operation_id: op.operation_id,
            revision: op.revision,
            approver: "user",
            approved_at: Math.floor(Date.now() / 1000),
            input_type: "tap",
          },
        },
      },
    }),
  );
  expect(done[0]!.text).toContain("Refunded");
  onlyThePhone(await afterYes("yes"));
});

it("lets the customer open a Direct Conversation themselves, and closes it with its parent (§8.10)", async () => {
  const x = await lab();
  const parent = (
    await x.post("", BASE, msg({ data: { request: "opening_hours" } }))
  ).body.conversation_id as string;
  const opened = await x.post("", `${BASE}?wait=0`, {
    id: `req_${++n}`,
    parent_conversation_id: parent,
    message: { author: { type: "human" }, text: "Can I speak to someone?" },
  });
  expect(opened.status).toBe(201);
  const direct = (opened.body as Read).conversation_id;
  expect(x.company((opened.body as Read).events)[0]!.text).toContain(
    "+1 555-0142",
  );
  // Closing the parent closes its Direct Conversation too.
  expect((await x.post("", `${BASE}/${parent}/close`, req())).status).toBe(202);
  expect((await x.events("", direct)).closed).toBe(true);
  const parentEvents = (await x.events("", parent)).events;
  expect(parentEvents.map((e) => e.type)).toEqual(
    expect.arrayContaining(["direct_opened", "direct_closed"]),
  );
});

it("hears in the parent that the customer declined, and asks nothing more (§8.10)", async () => {
  const x = await lab();
  const t = (await x.sign("elena", true)).access_token;
  const started = await x.post(
    t,
    `${BASE}?wait=0`,
    msg({ data: { request: "order_not_delivered", order_id: "ord_LNB0907" } }),
  );
  const id = (started.body as Read).conversation_id;
  const declined = await x.post(
    t,
    `${BASE}/${id}/messages?wait=0&cursor=${(started.body as Read).cursor}`,
    msg({
      text: "The user isn't available to talk directly right now.",
      data: { user_requested: "declined" },
    }),
  );
  const reply = x.company((declined.body as Read).events)[0]!;
  expect(reply.text).toContain("+1 555-0142");
  expect(reply.data).toMatchObject({ user_requested: "declined" });
});

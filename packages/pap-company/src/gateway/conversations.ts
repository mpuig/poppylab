/**
 * Conversations (PAP 1.0 §8) with a deterministic Company Agent: the
 * Personal Agent sends messages (structured `data` or `text`), and the
 * Company answers with data, an `authorization` event when it needs the
 * account (§8.11), or an Operations v3 operation in `extensions.operations`
 * that the User approves in a later message.
 *
 * Every `POST` carries a request `id`; a retry with the same path and body
 * gets the original response, anything else `request_id_conflict` (§8.3). A
 * successful `POST` returns only `conversation_id`, or a read of the events
 * with `wait`. Replies are computed when a request is accepted, so `working`
 * is always `false` and `wait` is capped at zero (§8.5, §8.7).
 *
 * Ownership (§8.2) is the client, the User ID and, once a request carries an
 * access token, that account. A handoff (§8.9) finds nobody in this lab:
 * `handoff` goes `pending` then back to `none`, and the Company Agent says
 * how to call. Direct Conversations (§8.10) and streaming (§8.6) are not
 * offered: a `parent_conversation_id` gets `conversation_not_found` or
 * `conversation_closed` for a bad parent and `invalid_request` otherwise,
 * and a stream request gets JSON.
 */
import type { Context, Hono } from "hono";
import { approvalFrom, randomId } from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import type { Tenancy } from "./tenancy.ts";
import {
  hash,
  type CompanyReply,
  type Conversation,
  type ConversationEvent,
  type ConversationMessage,
  type TurnResult,
} from "./types.ts";

const BASE = "/poppy/conversations";
const ID = /^[A-Za-z0-9_-]{1,256}$/;
const CURSOR = /^evt_(\d{1,9})_([A-Za-z0-9_-]{1,32})$/;
/** Bounds: conversations per User and per tenant, and per conversation. */
const PER_USER = 8,
  PER_TENANT = 200,
  MESSAGES = 40,
  EVENTS = 120,
  BYTES = 64 * 1024,
  PAGE = 50;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Canonical JSON (sorted keys), to compare a retried request's body. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : object(v)
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
const size = (v: unknown) => JSON.stringify(v).length;
const idOf = (c: Context) => c.req.param("id") ?? "";

class Refusal extends Error {
  constructor(
    public status: 400 | 401 | 404 | 409 | 410,
    public code: string,
    public headers: Record<string, string> = {},
  ) {
    super(code);
  }
}
type UserMessage = Omit<ConversationMessage, "id" | "role">;

/** §8.4: a User-side message, or a Refusal for `invalid_request`. */
function parseMessage(raw: unknown): UserMessage {
  const bad = () => new Refusal(400, "invalid_request");
  if (!object(raw)) throw bad();
  const { author, text, data, context, extensions, as_of_cursor } = raw;
  if (!object(author) || typeof author.type !== "string" || !author.type)
    throw bad();
  if (text !== undefined && (typeof text !== "string" || text.length > 4000))
    throw bad();
  for (const [part, max] of [
    [data, 8192],
    [context, 2048],
    [extensions, 2048],
  ] as const)
    if (part !== undefined && (!object(part) || size(part) > max)) throw bad();
  if ([text, data, context, extensions].every((p) => p === undefined))
    throw bad();
  return {
    // A Company ignores author id, name and image from the Personal Agent.
    author: { type: author.type.slice(0, 32) },
    ...(typeof as_of_cursor === "string" && ID.test(as_of_cursor)
      ? { as_of_cursor }
      : {}),
    ...(text !== undefined ? { text: text as string } : {}),
    ...(data !== undefined ? { data: data as Record<string, unknown> } : {}),
    ...(context !== undefined
      ? { context: context as Record<string, unknown> }
      : {}),
    ...(extensions !== undefined
      ? { extensions: extensions as Record<string, unknown> }
      : {}),
  };
}

/** `extensions.operations.approval` (Operations v3 §6), when well formed. */
function approvalOf(message: UserMessage) {
  const ops = message.extensions?.operations;
  return object(ops) ? approvalFrom(ops.approval) : undefined;
}

export function mountConversations(app: Hono, ctx: Ctx, tenancy: Tenancy) {
  const { def } = ctx;
  const agent = def.agent;
  if (!agent) return;

  /** The caller: owner fields and, with an access token, its account. */
  const caller = (c: Context) => {
    const s = ctx.sessionFor(c);
    return {
      client: s.client,
      user: s.user,
      account: s.grant ? s.account : undefined,
      scopes: s.grant ? (s.scopes ?? "").split(" ").filter(Boolean) : [],
      operations: !!s.operations,
    };
  };
  const tenantOf = (c: Context) => {
    const entry = tenancy.enter(c.req.raw);
    entry.tenant.conversations ??= {};
    entry.tenant.requests ??= {};
    return {
      entry,
      conversations: entry.tenant.conversations,
      requests: entry.tenant.requests,
    };
  };
  const requestKey = (who: { client: string; user: string }, id: string) =>
    hash(`${who.client}\n${who.user}\n${id}`);

  /** §8.2: the conversation, checked against the caller (and bound to an account). */
  function owned(c: Context, id: string) {
    const who = caller(c);
    const conv = tenantOf(c).conversations[id];
    if (!conv || conv.client !== who.client || conv.user !== who.user)
      throw new Refusal(404, "conversation_not_found");
    if (conv.account) {
      if (!who.account)
        // Signed out on a conversation that used the account: a challenge.
        throw new Refusal(401, "", {
          "WWW-Authenticate": `DPoP scope="${def.readScope}"`,
        });
      if (who.account !== conv.account)
        throw new Refusal(404, "conversation_not_found");
    } else if (who.account) {
      conv.account = who.account;
    }
    return conv;
  }

  function add(conv: Conversation, event: Omit<ConversationEvent, "id">) {
    conv.seq++;
    conv.events.push({ id: `evt_${conv.seq}_${conv.tag}`, ...event });
    // Bounded: drop the oldest events (their cursors then expire, §8.5).
    while (
      conv.events.length > EVENTS ||
      (conv.events.length > 1 && size(conv.events) > BYTES)
    )
      conv.events.shift();
    conv.updated = Date.now();
  }
  const now = () => new Date().toISOString();
  /** §8.7: every change to handoff, responder or closed adds a state event. */
  const state = (conv: Conversation) =>
    add(conv, {
      type: "state",
      created_at: now(),
      handoff: conv.handoff,
      responder: "agent",
      closed: conv.closed,
    });
  const say = (conv: Conversation, reply: CompanyReply, asOf: string) =>
    add(conv, {
      type: "message",
      created_at: now(),
      message: {
        id: `msg_${randomId().slice(0, 16)}`,
        role: "company",
        author: { type: "agent", id: "aut_company_agent", name: agent.name },
        as_of_request: asOf,
        ...(reply.text ? { text: reply.text.slice(0, 4000) } : {}),
        ...(reply.data ? { data: reply.data } : {}),
        ...(reply.operation
          ? { extensions: { operations: { operation: reply.operation } } }
          : {}),
      },
    });

  /** Query: `wait` (whole seconds, capped at 0) and `cursor`. */
  function query(c: Context) {
    const wait = c.req.query("wait");
    if (wait !== undefined && !/^\d{1,6}$/.test(wait))
      throw new Refusal(400, "invalid_request");
    const cursor = c.req.header("last-event-id") ?? c.req.query("cursor");
    return { waiting: wait !== undefined, cursor };
  }
  /** §8.5: events after the cursor, a page at a time, with the state. */
  function read(conv: Conversation, cursor: string | undefined) {
    let after = 0;
    if (cursor !== undefined) {
      const m = CURSOR.exec(cursor);
      if (!m || m[2] !== conv.tag || Number(m[1]) > conv.seq)
        throw new Refusal(400, "invalid_cursor");
      after = Number(m[1]);
      const first = Number(CURSOR.exec(conv.events[0]?.id ?? "")?.[1] ?? 1);
      if (after < first - 1) throw new Refusal(410, "cursor_expired");
    }
    const pending = conv.events.filter(
      (e) => Number(CURSOR.exec(e.id)![1]) > after,
    );
    const events = pending.slice(0, PAGE);
    return {
      conversation_id: conv.id,
      events,
      cursor: events.at(-1)?.id ?? cursor ?? conv.events.at(-1)?.id ?? null,
      has_more: pending.length > events.length,
      working: false,
      handoff: conv.handoff,
      responder: "agent" as const,
      closed: conv.closed,
    };
  }
  const answer = (
    c: Context,
    conv: Conversation,
    status: 201 | 202,
    q: ReturnType<typeof query>,
  ) =>
    c.json(
      q.waiting ? read(conv, q.cursor) : { conversation_id: conv.id },
      status,
    );

  /** Accepts one User-side message and runs the Company Agent on it. */
  function accept(
    c: Context,
    conv: Conversation,
    requestId: string,
    message: UserMessage,
  ) {
    const who = caller(c);
    const { entry } = tenantOf(c);
    conv.messages++;
    add(conv, {
      type: "message",
      created_at: now(),
      message: { id: requestId, role: "user", ...message },
    });
    if (message.context) {
      // Fields left out keep their values; null clears one (§8.4).
      const merged = { ...conv.context };
      for (const [k, v] of Object.entries(message.context))
        if (v === null) delete merged[k];
        else merged[k] = v;
      const bounded = Object.fromEntries(Object.entries(merged).slice(0, 20));
      conv.context = size(bounded) <= 4096 ? bounded : {};
    }
    // Operations v3 §2: extension content only when the request declares it.
    const approval = who.operations ? approvalOf(message) : undefined;
    const handler = entry.converse;
    const unavailable: TurnResult = {
      replies: [
        {
          text: "The Company Agent couldn't handle that. Try again later.",
          data: { error: "agent_unavailable" },
        },
      ],
    };
    let result: TurnResult = unavailable;
    if (handler)
      try {
        result = handler({
          conversation: conv.id,
          message: {
            author: message.author.type === "human" ? "human" : "agent",
            ...(message.text !== undefined ? { text: message.text } : {}),
            ...(message.data ? { data: message.data } : {}),
          },
          context: conv.context,
          ...(who.account ? { account: who.account } : {}),
          scopes: who.scopes,
          memory: conv.memory,
          ...(approval ? { approval } : {}),
          operations: who.operations,
          propose: (action) => {
            if (!who.account) throw Error("propose needs the account");
            // "In a conversation, the operation is the conversation's."
            return entry.engine.gate(
              { client: who.client, user: who.user, account: who.account },
              approval,
              { ...action, key: `conversation:${conv.id}:${action.key}` },
            );
          },
        });
      } catch {
        // The message stays accepted; the reply says the agent failed.
        console.error("company_agent_failed", def.name);
      }
    if (size(conv.memory) > 4096) conv.memory = {};
    for (const reply of result.replies ?? []) say(conv, reply, requestId);
    if (result.authorization)
      add(conv, {
        type: "authorization",
        created_at: now(),
        error: "insufficient_scope",
        scope: result.authorization,
      });
  }

  /** Drops a conversation and the request IDs kept for it. */
  function forget(c: Context, id: string) {
    const { conversations, requests } = tenantOf(c);
    delete conversations[id];
    for (const [k, r] of Object.entries(requests))
      if (r.conversation === id) delete requests[k];
  }

  /**
   * Every POST: the body with its request `id`; a retry with the same path
   * and body gets the original response, another use of the ID a conflict.
   */
  async function post(c: Context, path: string) {
    let body: Record<string, unknown>;
    try {
      const b: unknown = await c.req.json();
      if (!object(b)) throw Error();
      body = b;
    } catch {
      throw new Refusal(400, "invalid_request");
    }
    if (typeof body.id !== "string" || !ID.test(body.id))
      throw new Refusal(400, "invalid_request");
    const who = caller(c);
    const key = requestKey(who, body.id);
    const digest = hash(canonical(body));
    const seen = tenantOf(c).requests[key];
    if (seen && (seen.path !== path || seen.digest !== digest))
      throw new Refusal(409, "request_id_conflict");
    const remember = (conv: Conversation, status: 201 | 202) => {
      tenantOf(c).requests[key] = {
        conversation: conv.id,
        path,
        digest,
        status,
      };
    };
    return { body, id: body.id, seen, remember };
  }

  const guard =
    (handler: (c: Context) => Response | Promise<Response>) =>
    async (c: Context) => {
      try {
        return await handler(c);
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        // A sign-in challenge has no body, as at the account APIs (§7).
        if (!e.code) return c.body(null, e.status, e.headers);
        return c.json({ error: e.code }, e.status, e.headers);
      }
    };

  // POST {endpoint}: start a conversation with its first message (§8.3).
  app.post(
    BASE,
    guard(async (c) => {
      const q = query(c);
      const { body, id, seen, remember } = await post(c, BASE);
      if (seen) return answer(c, owned(c, seen.conversation), seen.status, q);
      // Direct Conversations (§8.10) aren't offered by this lab yet, but the
      // parent is checked first, so its errors are the spec's: an unknown or
      // another owner's parent is not found, a closed one is closed.
      if (body.parent_conversation_id !== undefined) {
        const parent = String(body.parent_conversation_id);
        if (owned(c, parent).closed)
          throw new Refusal(409, "conversation_closed");
        throw new Refusal(400, "invalid_request");
      }
      if (body.user_requested_event_id !== undefined)
        throw new Refusal(400, "invalid_request");
      const message = parseMessage(body.message);
      const who = caller(c);
      const { conversations } = tenantOf(c);
      // Bounded per User and per tenant: closed, then least recently used.
      const evict = (list: Conversation[], max: number) =>
        [...list]
          .sort(
            (a, b) =>
              Number(b.closed) - Number(a.closed) || a.updated - b.updated,
          )
          .slice(0, Math.max(0, list.length - max + 1))
          .forEach((v) => forget(c, v.id));
      evict(
        Object.values(conversations).filter(
          (v) => v.client === who.client && v.user === who.user,
        ),
        PER_USER,
      );
      evict(Object.values(conversations), PER_TENANT);
      const conv: Conversation = {
        id: `cnv_${randomId().slice(0, 20)}`,
        tag: randomId().slice(0, 8),
        client: who.client,
        user: who.user,
        ...(who.account ? { account: who.account } : {}),
        handoff: "none",
        closed: false,
        seq: 0,
        events: [],
        context: {},
        memory: {},
        messages: 0,
        updated: Date.now(),
      };
      conversations[conv.id] = conv;
      accept(c, conv, id, message);
      remember(conv, 201);
      return answer(c, conv, 201, q);
    }),
  );

  // POST {endpoint}/{id}/messages (§8.3).
  app.post(
    `${BASE}/:id/messages`,
    guard(async (c) => {
      const q = query(c);
      const path = `${BASE}/${idOf(c)}/messages`;
      const conv = owned(c, idOf(c));
      const { body, id, seen, remember } = await post(c, path);
      if (seen) return answer(c, conv, 202, q);
      const message = parseMessage(body.message);
      if (conv.closed) throw new Refusal(409, "conversation_closed");
      if (conv.messages >= MESSAGES) {
        say(
          conv,
          {
            text: "This conversation reached its length limit and is now closed. Start a new one to continue.",
          },
          id,
        );
        conv.closed = true;
        conv.handoff = "none";
        state(conv);
        throw new Refusal(409, "conversation_closed");
      }
      accept(c, conv, id, message);
      remember(conv, 202);
      return answer(c, conv, 202, q);
    }),
  );

  // GET {endpoint}/{id}/events (§8.5). No streaming: JSON for every Accept.
  app.get(
    `${BASE}/:id/events`,
    guard((c) => {
      const q = query(c);
      return c.json(read(owned(c, idOf(c)), q.cursor), 200);
    }),
  );

  // POST {endpoint}/{id}/handoff (§8.9): nobody is available in this lab.
  app.post(
    `${BASE}/:id/handoff`,
    guard(async (c) => {
      const q = query(c);
      const conv = owned(c, idOf(c));
      const { id, seen, remember } = await post(
        c,
        `${BASE}/${conv.id}/handoff`,
      );
      if (seen) return answer(c, conv, 202, q);
      if (conv.closed) throw new Refusal(409, "conversation_closed");
      if (conv.handoff === "none") {
        conv.handoff = "pending";
        state(conv);
        say(conv, agent.handoff, id);
        conv.handoff = "none";
        state(conv);
      }
      remember(conv, 202);
      return answer(c, conv, 202, q);
    }),
  );

  // POST {endpoint}/{id}/handoff/cancel (§8.9): nothing is ever pending here.
  app.post(
    `${BASE}/:id/handoff/cancel`,
    guard(async (c) => {
      const q = query(c);
      const conv = owned(c, idOf(c));
      const { seen, remember } = await post(
        c,
        `${BASE}/${conv.id}/handoff/cancel`,
      );
      if (seen) return answer(c, conv, 202, q);
      if (conv.closed) throw new Refusal(409, "conversation_closed");
      if (conv.handoff === "pending") {
        conv.handoff = "none";
        state(conv);
      }
      remember(conv, 202);
      return answer(c, conv, 202, q);
    }),
  );

  // POST {endpoint}/{id}/close (§8.12): 202; closing again changes nothing.
  app.post(
    `${BASE}/:id/close`,
    guard(async (c) => {
      const q = query(c);
      const conv = owned(c, idOf(c));
      const { seen, remember } = await post(c, `${BASE}/${conv.id}/close`);
      if (!seen && !conv.closed) {
        conv.closed = true;
        conv.handoff = "none";
        state(conv);
      }
      if (!seen) remember(conv, 202);
      return answer(c, conv, 202, q);
    }),
  );
}

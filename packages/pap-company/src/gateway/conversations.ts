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
 * how to call. Direct Conversations (§8.10): the Personal Agent opens one
 * with `parent_conversation_id`, on its own or accepting the Company's
 * `user_requested` event; the parent gets `direct_opened` and
 * `direct_closed` and takes no messages while it's open. A Company Agent
 * that sets `agent.direct` answers the User there; otherwise the gateway
 * answers with the handoff reply.
 *
 * Streaming (§8.6): a read that asks for `text/event-stream` gets the events
 * as server-sent events, then each new one as it is added, until the stream
 * reaches its time, the access token or Session ends, or the conversation
 * closes or goes. A stream only reads what other requests write, so it
 * never holds the Durable Object's writes. There are no `text-delta`
 * events: a reply is complete before any read can see it.
 */
import type { Context, Hono } from "hono";
import { approvalFrom, randomId, tokenHash } from "@poppy-lab/pap-client/core";
import type { Ctx } from "./context.ts";
import type { Tenancy } from "./tenancy.ts";
import {
  hash,
  SHARED_TENANT,
  type CompanyReply,
  type Conversation,
  type ConversationEvent,
  type ConversationMessage,
  type TurnResult,
} from "./types.ts";

const BASE = "/poppy/conversations";
const ID = /^[A-Za-z0-9_-]{1,256}$/;
const CURSOR = /^evt_(\d{1,9})_([A-Za-z0-9_-]{1,32})$/;
/**
 * Bounds: conversations per User and per tenant, and per conversation.
 * REQUESTS is how many request IDs a conversation keeps: more than its 40
 * messages and the request that started it, so only one that also asks for
 * a handoff or closes again and again drops its oldest.
 */
const PER_USER = 8,
  PER_TENANT = 200,
  MESSAGES = 40,
  REQUESTS = 64,
  EVENTS = 120,
  BYTES = 64 * 1024,
  PAGE = 50;
/**
 * §8.6: open streams per agent user and in all (each client a share, as for
 * Sessions), how often a stream checks that its reader may still read, and
 * how long it stays quiet before a comment keeps proxies from closing it.
 */
const STREAMS_PER_USER = 4,
  STREAMS = 100,
  STREAM_CHECK_MS = 5000,
  STREAM_BEAT_MS = 15000;

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
/** An event's number, from its ID. */
const seqOf = (e: ConversationEvent) => Number(CURSOR.exec(e.id)![1]);
/** §8.6: whether `Accept` asks for a stream (`text/event-stream`, not q=0). */
const wantsStream = (c: Context) =>
  (c.req.header("accept") ?? "")
    .split(",")
    .some((range) =>
      /^\s*text\/event-stream\s*(;(?!\s*q\s*=\s*0(\.0*)?\s*(;|$)).*)?$/i.test(
        range,
      ),
    );

class Refusal extends Error {
  constructor(
    public status: 400 | 401 | 404 | 409 | 410 | 429,
    public code: string,
    public headers: Record<string, string> = {},
    /** More members of the error body, such as `conversation_id`. */
    public extra: Record<string, unknown> = {},
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

  /** §8.6: the open streams, and what wakes each when its conversation changes. */
  const streams = new Set<{
    client: string;
    holder: string;
    until: number;
    end: () => void;
  }>();
  const listeners = new Map<string, Set<() => void>>();
  const streamMs = ctx.deploy.streamMs ?? 60000;

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
    for (const wake of listeners.get(conv.id) ?? []) wake();
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
    // §8.6: Last-Event-ID wins over `cursor`; an empty one names nothing.
    const cursor = c.req.header("last-event-id") || c.req.query("cursor");
    return { waiting: wait !== undefined, cursor };
  }
  /** The number of the last event before `cursor`, or a Refusal for it. */
  function after(conv: Conversation, cursor: string | undefined) {
    if (cursor === undefined) return 0;
    const m = CURSOR.exec(cursor);
    if (!m || m[2] !== conv.tag || Number(m[1]) > conv.seq)
      throw new Refusal(400, "invalid_cursor");
    const first = Number(CURSOR.exec(conv.events[0]?.id ?? "")?.[1] ?? 1);
    if (Number(m[1]) < first - 1) throw new Refusal(410, "cursor_expired");
    return Number(m[1]);
  }
  /** §8.5: events after the cursor, a page at a time, with the state. */
  function read(conv: Conversation, cursor: string | undefined) {
    const from = after(conv, cursor);
    const pending = conv.events.filter((e) => seqOf(e) > from);
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

  /**
   * §8.6: the events after event number `from` as server-sent events, then
   * each new one as it is added. `working` comes first, as an event with no
   * ID, and again only if it changes (here it never does). The stream ends
   * at its time, or as soon as the request could no longer read the
   * conversation: the access token, its grant or the Session ended, the
   * conversation now uses an account this request doesn't carry, or the
   * conversation or its tenant went. A closed conversation ends it once its
   * last events are sent. If events it hadn't sent were dropped meanwhile,
   * it ends too, and the reconnect gets `cursor_expired`.
   *
   * It only reads: woken by `add`, and checking every few seconds for what
   * changes without an event, it holds no lock and no write.
   */
  function stream(c: Context, conv: Conversation, from: number) {
    const who = caller(c);
    const now = Date.now();
    const holder = ctx.holderOf(who.client, who.user);
    // A stream whose response was never read has no cancel to let it go.
    for (const s of [...streams]) if (s.until < now) s.end();
    if (c.req.raw.signal?.aborted)
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    const mine = [...streams].filter((s) => s.holder === holder);
    if (
      mine.length >= STREAMS_PER_USER ||
      ctx.overShare(streams, who.client, STREAMS)
    ) {
      const soonest = Math.min(
        ...(mine.length >= STREAMS_PER_USER ? mine : [...streams]).map(
          (s) => s.until,
        ),
      );
      const retry = Number.isFinite(soonest)
        ? Math.max(1, Math.ceil((soonest - now) / 1000))
        : 60;
      throw new Refusal(429, "rate_limited", {
        "Retry-After": String(retry),
      });
    }
    const key = ctx.tenantKeys.get(c.req.raw) ?? SHARED_TENANT;
    const tenant = ctx.state.tenants[key];
    const sid = ctx.sessionKeys.get(c.req.raw);
    const [, , token] =
      /^(DPoP|Bearer) (\S+)$/.exec(c.req.header("authorization") ?? "") ?? [];
    const tokenKey = token ? tokenHash(token) : undefined;
    const record = tokenKey ? ctx.state.tokens[tokenKey] : undefined;
    const until = Math.min(
      now + streamMs,
      record?.expires ?? Infinity,
      (record && ctx.state.grants[record.grant]?.expires) ?? Infinity,
    );
    /** Whether this request could still read the conversation. */
    const readable = () => {
      const t = Date.now();
      if (ctx.flags.failed || t >= until) return false;
      if (ctx.state.tenants[key] !== tenant) return false;
      if (tenant?.conversations?.[conv.id] !== conv) return false;
      if (conv.account && conv.account !== who.account) return false;
      const session = sid ? ctx.state.sessions[sid] : undefined;
      if (!session || session.expires < t) return false;
      if (tokenKey) {
        const r = ctx.state.tokens[tokenKey];
        const g = r && ctx.state.grants[r.grant];
        if (!r || r.expires < t || !g || g.expires < t) return false;
      }
      return true;
    };
    let wake: (() => void) | undefined;
    const notify = () => wake?.();
    const woken = listeners.get(conv.id) ?? new Set();
    listeners.set(conv.id, woken);
    woken.add(notify);
    let over = false;
    const signal = c.req.raw.signal;
    const end = () => {
      if (over) return;
      over = true;
      signal?.removeEventListener("abort", end);
      streams.delete(slot);
      woken.delete(notify);
      if (!woken.size && listeners.get(conv.id) === woken)
        listeners.delete(conv.id);
      notify();
    };
    const slot = { client: who.client, holder, until, end };
    streams.add(slot);
    signal?.addEventListener("abort", end, { once: true });
    let working: boolean | undefined;
    /** What to send now: "" for nothing yet, null when the stream ends. */
    const next = (): string | null => {
      if (!readable()) return null;
      let out = "";
      // Replies are computed when a request is accepted (§8.7).
      const current: boolean = false;
      if (working !== current) {
        working = current;
        out += `event: working\ndata: ${JSON.stringify({ working })}\n\n`;
      }
      const pending = conv.events.filter((e) => seqOf(e) > from);
      if (pending.length && seqOf(pending[0]!) > from + 1) return null;
      for (const e of pending) {
        out += `id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`;
        from = seqOf(e);
      }
      return !out && conv.closed ? null : out;
    };
    const encoder = new TextEncoder();
    let quiet = Date.now();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!over) {
          const out = next();
          if (out === null) {
            end();
            break;
          }
          const t = Date.now();
          if (out || t - quiet >= STREAM_BEAT_MS) {
            quiet = t;
            controller.enqueue(encoder.encode(out || ": keep-alive\n\n"));
            return;
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(
              resolve,
              Math.max(
                0,
                Math.min(
                  STREAM_CHECK_MS,
                  until - t,
                  quiet + STREAM_BEAT_MS - t,
                ),
              ),
            );
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = undefined;
        }
        try {
          controller.close();
        } catch {
          // Already closed or cancelled.
        }
      },
      cancel: end,
    });
    return c.body(body, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    });
  }

  /**
   * Accepts one User-side message and runs the Company Agent on it. Without
   * a message, a Direct Conversation opened on the Company's invitation:
   * the Company speaks first (§8.10).
   */
  function accept(
    c: Context,
    conv: Conversation,
    requestId: string,
    message: UserMessage | undefined,
  ) {
    const who = caller(c);
    const { entry, conversations } = tenantOf(c);
    if (message) {
      conv.messages++;
      add(conv, {
        type: "message",
        created_at: now(),
        message: { id: requestId, role: "user", ...message },
      });
    }
    if (message?.context) {
      // Fields left out keep their values; null clears one (§8.4). A field
      // set again counts as new. The older ones come newest first, by the
      // age kept with the context: the object can't tell, it lists keys
      // like "2027" first. A field with no age kept counts as the oldest,
      // in the object's order (a conversation stored before ages were).
      const sent = message.context;
      const age = conv.contextOrder ?? [];
      const older = Object.keys(conv.context)
        .filter((k) => !Object.hasOwn(sent, k))
        .reverse()
        .sort((a, b) => age.indexOf(b) - age.indexOf(a));
      // Bounded to 20 fields and 4096 bytes, newest first: this message's
      // fields (at most 2048 bytes, so they fit), then each older one that
      // still fits. The Company Agent never loses what was just sent.
      const kept: Array<[string, unknown]> = [];
      for (const field of [
        ...Object.entries(sent).reverse(),
        ...older.map((k): [string, unknown] => [k, conv.context[k]]),
      ])
        if (
          field[1] !== null &&
          kept.length < 20 &&
          size(Object.fromEntries([...kept, field])) <= 4096
        )
          kept.push(field);
      kept.reverse();
      conv.context = Object.fromEntries(kept);
      conv.contextOrder = kept.map(([k]) => k);
    }
    // Operations v3 §2: extension content only when the request declares it.
    const approval =
      who.operations && message ? approvalOf(message) : undefined;
    // In a Direct Conversation the User speaks; a Company Agent that doesn't
    // handle that leaves the reply to the gateway, which can only say who to
    // call (nobody joins in this lab).
    const parent = conv.parent ? conversations[conv.parent] : undefined;
    if (conv.parent && !def.agent!.direct) {
      say(conv, def.agent!.handoff, requestId);
      return;
    }
    const handler = entry.converse;
    // What the consent granted beyond scopes, such as the accounts chosen.
    const resources = who.account ? tenancy.grantOf(c)?.resources : undefined;
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
            author: message?.author.type === "human" ? "human" : "agent",
            ...(message?.text !== undefined ? { text: message.text } : {}),
            ...(message?.data ? { data: message.data } : {}),
          },
          context: conv.context,
          ...(conv.parent
            ? {
                direct: {
                  requested: !!conv.requested,
                  parent: parent?.memory ?? {},
                },
              }
            : {}),
          ...(message ? {} : { opening: true }),
          ...(who.account ? { account: who.account } : {}),
          scopes: who.scopes,
          ...(resources ? { resources } : {}),
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
    // §8.10: only a parent invites the User; it changes no state.
    if (result.requestUser && !conv.parent && !conv.direct)
      add(conv, {
        type: "user_requested",
        created_at: now(),
        reason: result.requestUser.slice(0, 300),
      });
  }

  /** §8.10: a parent's open Direct Conversation, if it's still there. */
  function openDirect(c: Context, conv: Conversation) {
    const direct = conv.direct
      ? tenantOf(c).conversations[conv.direct]
      : undefined;
    if (direct && !direct.closed) return direct;
    delete conv.direct;
    return undefined;
  }
  /** While a Direct Conversation is open, its parent takes no messages. */
  function refuseWhileDirect(c: Context, conv: Conversation) {
    const direct = openDirect(c, conv);
    if (direct)
      throw new Refusal(
        409,
        "direct_conversation_open",
        {},
        { conversation_id: direct.id },
      );
  }
  /** Closes a conversation; a Direct one tells its parent, a parent closes its Direct one. */
  function close(c: Context, conv: Conversation) {
    if (conv.closed) return;
    const direct = openDirect(c, conv);
    if (direct) close(c, direct);
    conv.closed = true;
    conv.handoff = "none";
    state(conv);
    const parent = conv.parent
      ? tenantOf(c).conversations[conv.parent]
      : undefined;
    if (parent && parent.direct === conv.id) {
      delete parent.direct;
      add(parent, {
        type: "direct_closed",
        created_at: now(),
        conversation_id: conv.id,
      });
    }
  }

  /** Drops a conversation and the request IDs kept for it. */
  function forget(c: Context, id: string) {
    const { conversations, requests } = tenantOf(c);
    const conv = conversations[id];
    if (conv && !conv.closed) close(c, conv);
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
      const { requests } = tenantOf(c);
      requests[key] = { conversation: conv.id, path, digest, status };
      // Bounded on every route, closed or not: the conversation's oldest IDs
      // go first (records stay in the order they were accepted). A retry
      // that arrives after that many newer requests finds no record, so it
      // is taken as a new request, not replayed or checked for a conflict.
      const kept = Object.keys(requests).filter(
        (k) => requests[k]!.conversation === conv.id,
      );
      for (const k of kept.slice(0, -REQUESTS)) delete requests[k];
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
        return c.json({ error: e.code, ...e.extra }, e.status, e.headers);
      }
    };

  // POST {endpoint}: start a conversation with its first message (§8.3).
  app.post(
    BASE,
    guard(async (c) => {
      const q = query(c);
      const { body, id, seen, remember } = await post(c, BASE);
      if (seen) return answer(c, owned(c, seen.conversation), seen.status, q);
      const who = caller(c);
      const { conversations } = tenantOf(c);
      // §8.10: a Direct Conversation names its parent, and the invitation
      // it accepts, if any.
      let parent: Conversation | undefined;
      let invitation: string | undefined;
      if (body.parent_conversation_id !== undefined) {
        if (typeof body.parent_conversation_id !== "string")
          throw new Refusal(400, "invalid_request");
        parent = owned(c, body.parent_conversation_id);
        if (body.user_requested_event_id !== undefined) {
          const eventId = body.user_requested_event_id;
          if (
            typeof eventId !== "string" ||
            !parent.events.some(
              (e) => e.id === eventId && e.type === "user_requested",
            )
          )
            throw new Refusal(400, "invalid_request");
          invitation = eventId;
          // Accepting the same invitation again returns the same Direct
          // Conversation, without another message, even once it's closed.
          const earlier = parent.accepted?.[eventId];
          if (earlier && conversations[earlier]) {
            const direct = owned(c, earlier);
            if (q.waiting) after(direct, q.cursor);
            remember(direct, 201);
            return answer(c, direct, 201, q);
          }
        }
        if (parent.closed) throw new Refusal(409, "conversation_closed");
        if (parent.parent) throw new Refusal(400, "invalid_request");
        refuseWhileDirect(c, parent);
      } else if (body.user_requested_event_id !== undefined)
        throw new Refusal(400, "invalid_request");
      // Only accepting an invitation may leave the first message out.
      const message =
        body.message === undefined && invitation
          ? undefined
          : parseMessage(body.message);
      if (q.waiting && q.cursor !== undefined)
        throw new Refusal(400, "invalid_cursor");
      // Bounded per User and per tenant: closed, then least recently used.
      const evict = (list: Conversation[], max: number) =>
        [...list]
          .sort(
            (a, b) =>
              Number(b.closed) - Number(a.closed) || a.updated - b.updated,
          )
          .slice(0, Math.max(0, list.length - max + 1))
          .forEach((v) => forget(c, v.id));
      const others = (list: Conversation[]) =>
        list.filter((v) => v.id !== parent?.id);
      evict(
        others(
          Object.values(conversations).filter(
            (v) => v.client === who.client && v.user === who.user,
          ),
        ),
        PER_USER - (parent ? 1 : 0),
      );
      evict(others(Object.values(conversations)), PER_TENANT);
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
        ...(parent ? { parent: parent.id } : {}),
        ...(invitation ? { requested: invitation } : {}),
      };
      // A Direct Conversation keeps its parent's account binding (§8.2).
      if (parent?.account) conv.account = parent.account;
      conversations[conv.id] = conv;
      if (parent) {
        parent.direct = conv.id;
        if (invitation) (parent.accepted ??= {})[invitation] = conv.id;
        add(parent, {
          type: "direct_opened",
          created_at: now(),
          conversation_id: conv.id,
        });
      }
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
      refuseWhileDirect(c, conv);
      if (q.waiting) after(conv, q.cursor);
      if (conv.messages >= MESSAGES) {
        say(
          conv,
          {
            text: "This conversation reached its length limit and is now closed. Start a new one to continue.",
          },
          id,
        );
        close(c, conv);
        throw new Refusal(409, "conversation_closed");
      }
      accept(c, conv, id, message);
      remember(conv, 202);
      return answer(c, conv, 202, q);
    }),
  );

  // GET {endpoint}/{id}/events (§8.5), or a stream of them (§8.6).
  app.get(
    `${BASE}/:id/events`,
    guard((c) => {
      const q = query(c);
      const conv = owned(c, idOf(c));
      return wantsStream(c)
        ? stream(c, conv, after(conv, q.cursor))
        : c.json(read(conv, q.cursor), 200);
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
      refuseWhileDirect(c, conv);
      if (q.waiting) after(conv, q.cursor);
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
      refuseWhileDirect(c, conv);
      if (q.waiting) after(conv, q.cursor);
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
      if (!seen && q.waiting) after(conv, q.cursor);
      if (!seen) close(c, conv);
      if (!seen) remember(conv, 202);
      return answer(c, conv, 202, q);
    }),
  );
}

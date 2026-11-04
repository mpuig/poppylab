/**
 * Conversations (§8) with a deterministic Company Agent: the Personal Agent
 * sends messages (structured `data` or `text`), and the Company answers with
 * data, an `authorization` event when it needs the account (§8.11), or an
 * Operations v2 operation in `extensions.operations` that the User approves
 * in a later message. Replies are computed when the message is accepted, so
 * a conversation is never `working` and `wait` is capped at zero (§8.5).
 *
 * Ownership (§8.2) is the client, the User ID and, once a request carries an
 * access token, that account. Message IDs are unique per User: a retry with
 * the same content gets the original response (§8.3). A handoff (§8.9) finds
 * nobody in this lab: the status goes `queued` then back to `idle`, and the
 * Company Agent says how to call. Direct Conversations (§8.10) and streaming
 * (§8.6) are not offered: a stream request gets JSON.
 */
import type { Context, Hono } from "hono";
import { randomId } from "@poppy-lab/pap-client/core";
import type { Approval } from "../approvals.ts";
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
/** Canonical JSON (sorted keys), to compare a retried message's content. */
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

/** §8.4: a User-side message, or a Refusal for `invalid_request`. */
function parseMessage(raw: unknown): Omit<ConversationMessage, "role"> {
  const bad = () => new Refusal(400, "invalid_request");
  if (!object(raw)) throw bad();
  const { id, author, text, data, context, extensions } = raw;
  if (typeof id !== "string" || !ID.test(id)) throw bad();
  if (!object(author) || (author.type !== "agent" && author.type !== "human"))
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
    id,
    author: { type: author.type },
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

/** `extensions.operations.approval` (Operations v2 §6), when well formed. */
function approvalOf(message: Omit<ConversationMessage, "role">) {
  const ops = message.extensions?.operations;
  const approval = object(ops) ? ops.approval : undefined;
  return object(approval) &&
    typeof approval.operation_id === "string" &&
    ID.test(approval.operation_id) &&
    typeof approval.revision === "string" &&
    ID.test(approval.revision)
    ? ({
        operation_id: approval.operation_id,
        revision: approval.revision,
      } satisfies Approval)
    : undefined;
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
    entry.tenant.messageIds ??= {};
    return {
      entry,
      conversations: entry.tenant.conversations,
      messageIds: entry.tenant.messageIds,
    };
  };
  const messageKey = (who: { client: string; user: string }, id: string) =>
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
  const say = (conv: Conversation, reply: CompanyReply) =>
    add(conv, {
      type: "message",
      created_at: now(),
      message: {
        id: `msg_${randomId().slice(0, 16)}`,
        role: "company",
        author: { type: "agent", id: "aut_company_agent", name: agent.name },
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
  /** §8.5: events after the cursor, a page at a time. */
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
      status: conv.status,
      responder: "agent" as const,
    };
  }
  const answer = (
    c: Context,
    conv: Conversation,
    status: 200 | 201 | 202,
    q: ReturnType<typeof query>,
  ) =>
    c.json(
      q.waiting
        ? read(conv, q.cursor)
        : { conversation_id: conv.id, status: conv.status, responder: "agent" },
      status,
    );

  /** Accepts one User-side message and runs the Company Agent on it. */
  function accept(
    c: Context,
    conv: Conversation,
    message: Omit<ConversationMessage, "role">,
  ) {
    const who = caller(c);
    const { entry } = tenantOf(c);
    conv.messages++;
    add(conv, {
      type: "message",
      created_at: now(),
      message: { ...message, role: "user" },
    });
    if (message.context) {
      // Fields left out keep their values (§8.4); bounded overall.
      const merged = Object.fromEntries(
        Object.entries({ ...conv.context, ...message.context }).slice(0, 20),
      );
      conv.context = size(merged) <= 4096 ? merged : { ...message.context };
    }
    const handler = entry.converse;
    const turn = (): TurnResult =>
      handler!({
        conversation: conv.id,
        message: {
          author: message.author.type,
          ...(message.text !== undefined ? { text: message.text } : {}),
          ...(message.data ? { data: message.data } : {}),
        },
        context: conv.context,
        ...(who.account ? { account: who.account } : {}),
        scopes: who.scopes,
        memory: conv.memory,
        // Operations v2 §2: extension content only from an agent listing it.
        ...(who.operations && approvalOf(message)
          ? { approval: approvalOf(message)! }
          : {}),
        operations: who.operations,
        propose: (action) => {
          if (!who.account) throw Error("propose needs the account");
          // "In a conversation, the operation is the conversation's."
          return entry.engine.gate(
            { client: who.client, user: who.user, account: who.account },
            who.operations ? approvalOf(message) : undefined,
            { ...action, key: `conversation:${conv.id}:${action.key}` },
          );
        },
      });
    const unavailable = {
      replies: [
        {
          text: "The Company Agent couldn't handle that. Try again later.",
          data: { error: "agent_unavailable" },
        },
      ],
    };
    let result: TurnResult;
    try {
      result = handler ? turn() : unavailable;
    } catch {
      // The message stays accepted; the reply says the agent failed.
      console.error("company_agent_failed", def.name);
      result = unavailable;
    }
    if (size(conv.memory) > 4096) conv.memory = {};
    for (const reply of result.replies ?? []) say(conv, reply);
    if (result.authorization)
      add(conv, {
        type: "authorization",
        created_at: now(),
        error: "insufficient_scope",
        scope: result.authorization,
      });
  }

  /** A retried message ID: the original response, or a conflict (§8.3). */
  function retried(
    c: Context,
    message: Omit<ConversationMessage, "role">,
    path?: string,
  ) {
    const who = caller(c);
    const { messageIds } = tenantOf(c);
    const record = messageIds[messageKey(who, message.id)];
    if (!record) return undefined;
    if (
      record.digest !== hash(canonical(message)) ||
      (path !== undefined && record.conversation !== path)
    )
      throw new Refusal(409, "message_id_conflict");
    return record;
  }
  function remember(
    c: Context,
    conv: Conversation,
    message: Omit<ConversationMessage, "role">,
    started: boolean,
  ) {
    tenantOf(c).messageIds[messageKey(caller(c), message.id)] = {
      conversation: conv.id,
      digest: hash(canonical(message)),
      started,
    };
  }
  /** Drops a conversation and the message IDs kept for it. */
  function forget(c: Context, id: string) {
    const { conversations, messageIds } = tenantOf(c);
    delete conversations[id];
    for (const [k, r] of Object.entries(messageIds))
      if (r.conversation === id) delete messageIds[k];
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
  const body = async (c: Context) => {
    try {
      const b: unknown = await c.req.json();
      if (!object(b)) throw Error();
      return b;
    } catch {
      throw new Refusal(400, "invalid_request");
    }
  };

  // POST {endpoint}: start a conversation with its first message (§8.3).
  app.post(
    BASE,
    guard(async (c) => {
      const q = query(c);
      const b = await body(c);
      // Direct Conversations (§8.10) aren't offered by this lab yet.
      if (
        b.parent_conversation_id !== undefined ||
        b.user_requested_event_id !== undefined
      )
        throw new Refusal(400, "invalid_request");
      const message = parseMessage(b.message);
      const seen = retried(c, message);
      if (seen) {
        // That ID was a later message, not a conversation's first.
        if (!seen.started) throw new Refusal(409, "message_id_conflict");
        const conv = owned(c, seen.conversation);
        return answer(c, conv, seen.started ? 201 : 202, q);
      }
      const who = caller(c);
      const { conversations } = tenantOf(c);
      // Bounded per User and per tenant: closed, then least recently used.
      const evict = (list: Conversation[], max: number) =>
        [...list]
          .sort(
            (a, b) =>
              Number(b.status === "closed") - Number(a.status === "closed") ||
              a.updated - b.updated,
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
        status: "idle",
        seq: 0,
        events: [],
        context: {},
        memory: {},
        messages: 0,
        updated: Date.now(),
      };
      conversations[conv.id] = conv;
      accept(c, conv, message);
      remember(c, conv, message, true);
      return answer(c, conv, 201, q);
    }),
  );

  // POST {endpoint}/{id}/messages (§8.3).
  app.post(
    `${BASE}/:id/messages`,
    guard(async (c) => {
      const q = query(c);
      const id = idOf(c);
      const message = parseMessage((await body(c)).message);
      const conv = owned(c, id);
      const seen = retried(c, message, id);
      if (seen) return answer(c, conv, 202, q);
      if (conv.status === "closed")
        throw new Refusal(409, "conversation_closed");
      if (conv.messages >= MESSAGES) {
        say(conv, {
          text: "This conversation reached its length limit and is now closed. Start a new one to continue.",
        });
        conv.status = "closed";
        add(conv, {
          type: "state",
          created_at: now(),
          status: "closed",
          responder: "agent",
        });
        throw new Refusal(409, "conversation_closed");
      }
      accept(c, conv, message);
      remember(c, conv, message, false);
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
      await body(c);
      const conv = owned(c, idOf(c));
      if (conv.status === "closed")
        throw new Refusal(409, "conversation_closed");
      const state = (status: "queued" | "idle") =>
        add(conv, {
          type: "state",
          created_at: now(),
          status,
          responder: "agent",
        });
      state("queued");
      say(conv, agent.handoff);
      state("idle");
      return answer(c, conv, 202, q);
    }),
  );

  // POST {endpoint}/{id}/close (§8.12).
  app.post(
    `${BASE}/:id/close`,
    guard(async (c) => {
      const q = query(c);
      await body(c);
      const conv = owned(c, idOf(c));
      if (conv.status !== "closed") {
        conv.status = "closed";
        add(conv, {
          type: "state",
          created_at: now(),
          status: "closed",
          responder: "agent",
        });
      }
      return answer(c, conv, 200, q);
    }),
  );
}

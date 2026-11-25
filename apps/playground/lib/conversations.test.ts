import { describe, expect, it, vi } from "vitest";
import { ProtocolError } from "@poppy-lab/pap-client";
import type { DiscoveredCompany } from "@poppy-lab/pap-core";
import {
  approvalRequestId,
  approveInConversation,
  conversationEndpoint,
  conversationSession,
  conversationTools,
  type CompanyEntry,
} from "./conversations";
import type { Run } from "./runtime";

const endpoint = "https://food-demo.poppylab.dev/poppy/conversations";
const company = (protocols: Array<{ type: string; endpoint: string }>) =>
  ({
    requestedUrl: "https://food-demo.poppylab.dev",
    document: {
      protocol_version: "1.0",
      organization: {
        name: "Lantern Noodle Bar",
        domain: "food-demo.poppylab.dev",
      },
      agent: { protocols },
    },
  }) as unknown as DiscoveredCompany;
const newRun = () =>
  ({
    url: "https://food-demo.poppylab.dev",
    user: "usr_x",
    expires: Date.now() + 60000,
    calls: 0,
    busy: true,
    history: [],
    company: company([{ type: "poppy", endpoint }]),
  }) as Run;
const read = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  conversation_id: "cnv_1",
  events,
  cursor: (events.at(-1) as { id?: string } | undefined)?.id ?? null,
  has_more: false,
  working: false,
  handoff: "none",
  responder: "agent",
  closed: false,
  ...extra,
});
const said = (id: string, message: Record<string, unknown>) => ({
  id,
  type: "message",
  created_at: "2026-11-04T12:00:00Z",
  message: {
    id: `m_${id}`,
    role: "company",
    author: { type: "agent", name: "Lantern's automated agent" },
    ...message,
  },
});
const operation = {
  operation_id: "op_refund",
  revision: "1793800000-abc",
  summary: "Refund 1 × Pork gyoza (6) (USD 8.00).",
  terms: { order_id: "ord_LNB0907", refund_cents: 800, currency: "USD" },
  expires_at: new Date(Date.now() + 600000).toISOString(),
};
const approval = {
  operation_id: "op_refund",
  revision: "1793800000-abc",
  approver: "user" as const,
  approved_at: 1793800100,
  input_type: "tap",
  reference: "apr_test",
};
function tools(
  run: Run,
  respond: (url: string, body: unknown) => unknown,
  allowProposals = true,
) {
  const shown: CompanyEntry[] = [];
  const trace: string[] = [];
  const request = vi.fn(
    async (_r: Run, url: string, _m: string, body?: unknown) =>
      respond(url, body),
  );
  const t = conversationTools(run, {
    endpoint,
    request,
    allowProposals,
    trace: (l) => trace.push(l),
    shown,
  });
  return { t, shown, trace, request };
}

describe("conversations (§8) in Iris", () => {
  it("uses only a poppy endpoint on the Company's own domain", () => {
    expect(conversationEndpoint(company([{ type: "poppy", endpoint }]))).toBe(
      endpoint,
    );
    expect(
      conversationEndpoint(
        company([
          {
            type: "poppy",
            endpoint: "https://evil.example/poppy/conversations",
          },
        ]),
      ),
    ).toBeUndefined();
    expect(
      conversationEndpoint(company([{ type: "a2a", endpoint }])),
    ).toBeUndefined();
    // A domain with a port matches the endpoint's host with that port only.
    const local = (endpoint: string) =>
      conversationEndpoint({
        ...company([{ type: "poppy", endpoint }]),
        document: {
          ...company([{ type: "poppy", endpoint }]).document,
          organization: { name: "L", domain: "noodles.localhost:4200" },
        },
      } as DiscoveredCompany);
    expect(local("http://noodles.localhost:4200/poppy/conversations")).toBe(
      "http://noodles.localhost:4200/poppy/conversations",
    );
    expect(
      local("http://noodles.localhost:4300/poppy/conversations"),
    ).toBeUndefined();
  });

  it("starts a conversation, keeps the cursor, skips repeated events and shows Company content", async () => {
    const run = newRun();
    const { t, shown, request } = tools(run, (url) =>
      url.startsWith(`${endpoint}?`)
        ? read([
            {
              id: "e1",
              type: "message",
              message: {
                id: "x",
                role: "user",
                author: { type: "agent" },
                data: { request: "help" },
              },
            },
            said("e2", {
              text: "Lantern answers\u0007 structured requests.",
              data: { requests: [{ request: "order_status" }] },
            }),
          ])
        : read([
            said("e2", { text: "repeat" }),
            said("e3", { text: "Here are the kitchen hours." }),
          ]),
    );
    const first = (await t.company_agent_send!.execute({
      data: { request: "help" },
    })) as {
      untrusted_company_content: boolean;
      replies: Array<{ text: string; data?: unknown }>;
    };
    expect(first.untrusted_company_content).toBe(true);
    // Control characters are dropped; Iris's own message isn't a reply.
    expect(first.replies).toEqual([
      {
        author: "agent",
        name: "Lantern's automated agent",
        text: "Lantern answers structured requests.",
        data: { requests: [{ request: "order_status" }] },
      },
    ]);
    expect(run.conversation).toMatchObject({ id: "cnv_1", cursor: "e2" });
    const second = (await t.company_agent_send!.execute({
      data: { request: "opening_hours" },
    })) as {
      replies: Array<{ text: string }>;
    };
    expect(second.replies.map((r) => r.text)).toEqual([
      "Here are the kitchen hours.",
    ]);
    const [url, , body] = request.mock.calls[1]!.slice(1) as [
      string,
      string,
      { id: string; message: Record<string, unknown> },
    ];
    expect(url).toBe(`${endpoint}/cnv_1/messages?wait=10&cursor=e2`);
    // §8.3: the request carries the ID; the message says what it had read.
    expect(body.id).toMatch(/^req_[A-Za-z0-9_-]+$/);
    expect(body.message).toEqual({
      author: { type: "agent" },
      as_of_cursor: "e2",
      data: { request: "opening_hours" },
    });
    expect(shown.map((s) => s.author)).toEqual([
      "Lantern Noodle Bar · automated agent",
      "Lantern Noodle Bar · automated agent",
    ]);
  });

  it("turns an authorization event into the Sign in instruction", async () => {
    const run = newRun();
    const { t, shown } = tools(run, () =>
      read([
        said("e2", { text: "That needs your account." }),
        {
          id: "e3",
          type: "authorization",
          error: "insufficient_scope",
          scope: "orders:read",
        },
      ]),
    );
    const result = (await t.company_agent_send!.execute({
      data: { request: "order_status" },
    })) as {
      sign_in: { scope: string; instruction: string };
    };
    expect(result.sign_in.scope).toBe("orders:read");
    expect(result.sign_in.instruction).toContain("Sign in control");
    expect(shown.at(-1)!.note).toBe("Asked for sign-in (orders:read).");
  });

  it("records an operation in a message for the approval card, only where proposals are allowed", async () => {
    const run = newRun();
    const reply = () =>
      read([
        said("e2", {
          text: "I can refund it once you approve.",
          extensions: { operations: { operation } },
        }),
      ]);
    const { t } = tools(run, reply);
    const result = (await t.company_agent_send!.execute({
      data: { request: "report_missing_item" },
    })) as {
      approval: { status: string; operation_id: string };
    };
    expect(result.approval).toMatchObject({
      status: "approval_required",
      operation_id: "op_refund",
    });
    expect(run.operations!.op_refund).toMatchObject({
      state: "proposed",
      request: { conversation: { endpoint, id: "cnv_1" } },
    });
    const other = newRun();
    const blocked = tools(other, reply, false);
    const r = (await blocked.t.company_agent_send!.execute({
      data: { request: "x" },
    })) as {
      approval: { status: string };
    };
    expect(r.approval.status).toBe("unavailable");
    expect(other.operations).toBeUndefined();
  });

  it("resends a message once after a lost response, with the same ID", async () => {
    const run = newRun();
    let calls = 0;
    const { t, request } = tools(run, () => {
      if (++calls === 1) throw new Error("socket hang up");
      return read([said("e2", { text: "ok" })]);
    });
    await t.company_agent_send!.execute({ text: "hello" });
    const ids = request.mock.calls.map((c) => (c[3] as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    // A refusal is never resent.
    const refused = tools(newRun(), () => {
      throw new ProtocolError(409, "request_id_conflict");
    });
    await expect(
      refused.t.company_agent_send!.execute({ text: "x" }),
    ).rejects.toThrow();
    expect(refused.request).toHaveBeenCalledTimes(1);
  });

  it("starts over when the conversation is gone, and asks for sign-in on a challenge", async () => {
    const run = newRun();
    run.conversation = { endpoint, id: "cnv_old", seen: [] };
    const gone = tools(run, () => {
      throw new ProtocolError(404, "conversation_not_found");
    });
    expect(
      await gone.t.company_agent_send!.execute({ text: "x" }),
    ).toMatchObject({
      error: "conversation_not_found",
    });
    expect(run.conversation).toEqual({ endpoint, seen: [] });
    const challenged = tools(newRun(), () => {
      throw new ProtocolError(401, undefined);
    });
    expect(
      await challenged.t.company_agent_send!.execute({ text: "x" }),
    ).toMatchObject({
      error: "sign_in_required",
    });
  });

  it("approves in a message with a request ID derived from the approval, and reports new terms or a decline", async () => {
    const run = newRun();
    const op = {
      ...operation,
      state: "proposed" as const,
      request: { conversation: { endpoint, id: "cnv_1" } },
    };
    const request = vi.fn(async () =>
      read([said("e9", { text: "Refunded USD 8.00." })]),
    );
    expect(await approveInConversation(run, op, approval, request)).toEqual({
      summary: "Refunded USD 8.00.",
    });
    const [, url, , body] = request.mock.calls[0]! as unknown as [
      Run,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe(`${endpoint}/cnv_1/messages?wait=10`);
    expect(body).toEqual({
      id: approvalRequestId(approval),
      message: {
        author: { type: "agent" },
        text: "The user approved this operation.",
        extensions: { operations: { approval } },
      },
    });
    expect(approvalRequestId(approval)).toBe(
      approvalRequestId({ ...approval }),
    );
    // A repeated approval adds no reply: already performed.
    const quiet = vi.fn(async () => read([]));
    expect(
      (await approveInConversation(newRun(), op, approval, quiet)).summary,
    ).toContain("already performed");
    // New terms come back as approval_required, never approved for the user.
    const terms = vi.fn(async () =>
      read([
        said("e10", {
          text: "New terms.",
          extensions: {
            operations: { operation: { ...operation, revision: "2-new" } },
          },
        }),
      ]),
    );
    await expect(
      approveInConversation(newRun(), op, approval, terms),
    ).rejects.toMatchObject({ status: 403, code: "approval_required" });
    // A decline (Operations v3 §6): nothing performed, with the reason.
    const declined = vi.fn(async () =>
      read([
        said("e11", {
          text: "We can't do that.",
          extensions: {
            operations: {
              declined: {
                operation_id: "op_refund",
                revision: "1793800000-abc",
                reason: "Refunds over $5 need a person.",
              },
            },
          },
        }),
      ]),
    );
    await expect(
      approveInConversation(newRun(), op, approval, declined),
    ).rejects.toMatchObject({
      status: 403,
      code: "approval_declined",
      declined: { reason: "Refunds over $5 need a person." },
    });
  });

  it("sends the User's own approval as a new request after the Company declined Iris's, and a retry as the same one", async () => {
    const op = {
      ...operation,
      state: "proposed" as const,
      request: { conversation: { endpoint, id: "cnv_1" } },
    };
    const byIris = {
      operation_id: "op_refund",
      revision: "1793800000-abc",
      approver: "agent" as const,
      approved_at: 1793800090,
      reference: "apr_iris",
    };
    // The Company, as §8.3 has it: an ID it accepted is good for that body only.
    const accepted = new Map<string, string>();
    const request = vi.fn(
      async (_r: Run, _url: string, _m: string, body?: unknown) => {
        const { id, message } = body as {
          id: string;
          message: {
            extensions: { operations: { approval: { approver: string } } };
          };
        };
        const sent = JSON.stringify(body);
        if (accepted.has(id) && accepted.get(id) !== sent)
          throw new ProtocolError(409, "request_id_conflict");
        accepted.set(id, sent);
        return read([
          message.extensions.operations.approval.approver === "agent"
            ? said("e11", {
                as_of_request: id,
                text: "I need the customer's own approval for a refund.",
                extensions: {
                  operations: {
                    declined: {
                      operation_id: "op_refund",
                      revision: "1793800000-abc",
                    },
                  },
                },
              })
            : said("e12", { as_of_request: id, text: "Refunded USD 8.00." }),
        ]);
      },
    );
    const ids = () =>
      request.mock.calls.map((call) => (call[3] as { id: string }).id);
    await expect(
      approveInConversation(newRun(), op, byIris, request),
    ).rejects.toMatchObject({ code: "approval_declined" });
    // A lost response (Operations v3 §7): the same approval, the same request.
    await expect(
      approveInConversation(newRun(), op, byIris, request),
    ).rejects.toMatchObject({ code: "approval_declined" });
    expect(ids()[1]).toBe(ids()[0]);
    // The User's approval of the same revision is another message.
    await expect(
      approveInConversation(newRun(), op, approval, request),
    ).resolves.toEqual({ summary: "Refunded USD 8.00." });
    expect(ids()[2]).not.toBe(ids()[0]);
    // So is a second approval by the User, after one the Company didn't take.
    await expect(
      approveInConversation(
        newRun(),
        op,
        { ...approval, approved_at: 1793800200, reference: "apr_again" },
        request,
      ),
    ).resolves.toEqual({ summary: "Refunded USD 8.00." });
    expect(new Set(ids()).size).toBe(3);
  });

  it("reads the four state fields, treats unknown values safely, and withdraws a handoff", async () => {
    const run = newRun();
    run.conversation = { endpoint, id: "cnv_1", seen: [] };
    const { t, request } = tools(run, () =>
      read(
        [
          said("e5", {
            role: "future-role",
            text: "From a new kind of sender.",
          }),
        ],
        { working: true, handoff: "searching", responder: "bot" },
      ),
    );
    const result = (await t.company_agent_handoff!.execute()) as Record<
      string,
      unknown
    >;
    // §8.4, §8.7: unknown role is Company content; unknown handoff is
    // pending; unknown responder is a person.
    expect(result).toMatchObject({
      working: true,
      handoff: "pending",
      responder: "human",
      replies: [{ text: "From a new kind of sender." }],
      note: expect.stringContaining("company_agent_read"),
    });
    await t.company_agent_cancel_handoff!.execute();
    const [, url, , body] = request.mock.calls[1]! as unknown as [
      Run,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(url).toContain(`${endpoint}/cnv_1/handoff/cancel?wait=10`);
    expect(Object.keys(body)).toEqual(["id"]);
  });
});

describe("Direct Conversations (§8.10) in Iris", () => {
  const invite = {
    id: "evt_ur",
    type: "user_requested",
    created_at: "2026-11-25T12:00:00Z",
    reason: "Lantern wants to confirm order ord_LNB0907 never arrived.",
  };
  function session(respond: (url: string, body: unknown) => unknown) {
    const run = newRun();
    const shown: CompanyEntry[] = [];
    const trace: string[] = [];
    const request = vi.fn(
      async (_r: Run, url: string, _m: string, body?: unknown) =>
        respond(url, body),
    );
    const s = conversationSession(run, {
      endpoint,
      request,
      allowProposals: true,
      trace: (l) => trace.push(l),
      shown,
    });
    return { run, s, shown, request };
  }

  it("turns an invitation into a card, opens the User's own thread, sends their words as human, and closes it", async () => {
    const directRead = (events: unknown[]) =>
      read(events, { conversation_id: "cnv_d" });
    const { run, s, shown, request } = session((url, body) => {
      if (url.startsWith(`${endpoint}?`)) {
        const b = body as Record<string, unknown>;
        if (b.parent_conversation_id)
          return directRead([
            said("evt_d1", {
              text: "Hi, this is Lantern. Did none of order ord_LNB0907 arrive? Reply yes or no.",
            }),
          ]);
        return read([
          said("evt_1", { text: "I've asked to talk with you." }),
          invite,
        ]);
      }
      if (url.startsWith(`${endpoint}/cnv_1/messages`))
        throw new ProtocolError(409, "direct_conversation_open");
      if (url.startsWith(`${endpoint}/cnv_d/messages`))
        return directRead([said("evt_d2", { text: "Thanks." })]);
      if (url.startsWith(`${endpoint}/cnv_d/close`))
        return { ...directRead([]), closed: true };
      throw new Error(`unexpected ${url}`);
    });
    // The model never gets a way to start, answer or close one.
    expect(Object.keys(s.tools).some((k) => /direct/.test(k))).toBe(false);
    const first = (await s.tools.company_agent_send!.execute({
      data: { request: "order_not_delivered", order_id: "ord_LNB0907" },
    })) as { user_requested?: { reason?: string; note: string } };
    expect(first.user_requested?.reason).toContain("ord_LNB0907");
    expect(first.user_requested?.note).toContain("you can't start");
    expect(run.conversation?.invitation).toEqual({
      event: "evt_ur",
      reason: invite.reason,
    });
    expect(shown.at(-1)).toMatchObject({ invitation: true });

    await s.direct("accept");
    const opened = request.mock.calls.at(-1)!;
    expect(opened[1]).toMatch(new RegExp(`^${endpoint}\\?`));
    expect(opened[3]).toMatchObject({
      id: expect.stringMatching(/^dir_/),
      parent_conversation_id: "cnv_1",
      user_requested_event_id: "evt_ur",
    });
    expect(opened[3]).not.toHaveProperty("message");
    expect(run.conversation?.invitation).toBeUndefined();
    expect(run.conversation?.direct?.id).toBe("cnv_d");
    expect(shown.at(-1)).toMatchObject({ direct: true });

    // Meanwhile the model's messages to the parent are refused, as a note.
    const blocked = (await s.tools.company_agent_send!.execute({
      text: "Any news?",
    })) as { error?: string; note?: string };
    expect(blocked.error).toBe("direct_conversation_open");

    await s.direct("say", "Yes, nothing came.");
    const words = request.mock.calls.at(-1)!;
    expect(words[1]).toContain(`${endpoint}/cnv_d/messages`);
    expect(words[3]).toMatchObject({
      message: { author: { type: "human" }, text: "Yes, nothing came." },
    });

    await s.direct("close");
    expect(request.mock.calls.at(-1)![1]).toContain(`${endpoint}/cnv_d/close`);
    expect(run.conversation?.direct).toBeUndefined();
  });

  it("approves an operation from the Direct Conversation, ignoring the earlier proposal in the read", async () => {
    const run = newRun();
    run.conversation = {
      endpoint,
      id: "cnv_1",
      cursor: "evt_9",
      seen: [],
      direct: { id: "cnv_d", seen: [] },
    };
    const op = {
      ...operation,
      state: "proposed",
      request: { conversation: { endpoint, id: "cnv_d" } },
    } as unknown as Parameters<typeof approveInConversation>[1];
    const proposal = said("evt_d2", {
      as_of_request: "req_yes",
      text: "I can refund USD 37.00 once you approve.",
      extensions: { operations: { operation } },
    });
    const request = vi.fn(async (_r: Run, url: string) => {
      // Read without a cursor: the whole thread, the proposal included.
      expect(url).toContain(`${endpoint}/cnv_d/messages`);
      expect(url).not.toContain("cursor=evt_9");
      return read(
        [
          proposal,
          said("evt_d4", {
            as_of_request: approvalRequestId(approval),
            text: "Refunded USD 37.00.",
          }),
        ],
        { conversation_id: "cnv_d" },
      );
    });
    await expect(
      approveInConversation(run, op, approval, request),
    ).resolves.toEqual({ summary: "Refunded USD 37.00." });
    expect(run.conversation.direct?.cursor).toBe("evt_d4");
    // The parent's read position is untouched.
    expect(run.conversation.cursor).toBe("evt_9");
  });

  // The parent has read up to evt_9; the User's own thread up to evt_d3.
  const both = () => ({
    endpoint,
    id: "cnv_1",
    cursor: "evt_9",
    seen: ["evt_8", "evt_9"],
    direct: { id: "cnv_d", cursor: "evt_d3", seen: ["evt_d3"] },
  });
  const parentOnly = {
    endpoint,
    id: "cnv_1",
    cursor: "evt_9",
    seen: ["evt_8", "evt_9"],
  };

  it.each([
    ["say", 409, "conversation_closed"],
    ["say", 404, "conversation_not_found"],
    ["close", 404, "conversation_not_found"],
  ] as const)(
    "drops only the Direct Conversation when %s to it gets %i %s, and the parent carries on",
    async (action, status, code) => {
      const { run, s, request } = session((url) => {
        if (url.startsWith(`${endpoint}/cnv_d/`))
          throw new ProtocolError(status, code);
        return read([said("evt_10", { text: "Still here." })]);
      });
      run.conversation = both();
      const result = (await s.direct(action, "Are you there?")) as {
        error?: string;
        note?: string;
      };
      expect(result.error).toBe(code);
      expect(result.note).toContain("Iris is back");
      // The User is out of the Direct Conversation; the parent is as it was.
      expect(run.conversation).toEqual(parentOnly);
      expect(await s.direct("say", "Hello?")).toMatchObject({
        note: "No Direct Conversation is open.",
      });
      // The model's next message goes on in the same conversation.
      await s.tools.company_agent_send!.execute({ text: "Any news?" });
      const sent = request.mock.calls.at(-1)!;
      expect(sent[1]).toBe(`${endpoint}/cnv_1/messages?wait=10&cursor=evt_9`);
      expect(sent[3]).toMatchObject({ message: { as_of_cursor: "evt_9" } });
      expect(run.conversation).toMatchObject({ id: "cnv_1", cursor: "evt_10" });
    },
  );

  it("shows the Company's last words when the Direct Conversation it closed refuses the User's message", async () => {
    const { run, s, shown, request } = session((url) => {
      if (url.startsWith(`${endpoint}/cnv_d/messages`))
        throw new ProtocolError(409, "conversation_closed");
      // §8.12: a closed conversation's events stay readable.
      return read(
        [
          said("evt_d3", { text: "Anything else?" }),
          said("evt_d4", {
            text: "This conversation reached its length limit and is now closed.",
          }),
        ],
        { conversation_id: "cnv_d", closed: true },
      );
    });
    run.conversation = both();
    const result = (await s.direct("say", "One more thing")) as {
      error?: string;
      note?: string;
    };
    expect(result).toMatchObject({
      error: "conversation_closed",
      note: expect.stringContaining("Iris is back"),
    });
    // Only what the User hadn't seen, as said in their own thread.
    expect(shown).toEqual([
      {
        author: "Lantern Noodle Bar · automated agent",
        human: false,
        text: "This conversation reached its length limit and is now closed.",
        direct: true,
      },
    ]);
    // A read from where the thread was, and nothing sent.
    const [, url, method, body] = request.mock.calls.at(-1)!;
    expect(url).toBe(`${endpoint}/cnv_d/events?wait=10&cursor=evt_d3`);
    expect(method).toBe("GET");
    expect(body).toBeUndefined();
    expect(run.conversation).toEqual(parentOnly);
  });

  it("asks the User to sign in when their Direct Conversation needs the account, and keeps it open", async () => {
    const { run, s } = session(() => {
      throw new ProtocolError(401, undefined);
    });
    run.conversation = both();
    // The User reads this, not the model: Iris's line is never empty.
    expect(await s.direct("say", "Are you there?")).toMatchObject({
      error: "sign_in_required",
      note: expect.stringContaining("Sign in control"),
    });
    expect(run.conversation).toEqual(both());
  });

  it("forgets only the Direct Conversation's read position when its cursor expired", async () => {
    const { run, s } = session(() => {
      throw new ProtocolError(410, "cursor_expired");
    });
    run.conversation = both();
    expect(await s.direct("say", "Are you there?")).toMatchObject({
      error: "cursor_expired",
    });
    expect(run.conversation).toEqual({
      ...parentOnly,
      direct: { id: "cnv_d", seen: [] },
    });
  });

  it("still starts over, or reads again, when the error is about the parent", async () => {
    for (const code of ["conversation_closed", "conversation_not_found"]) {
      const { run, s } = session(() => {
        throw new ProtocolError(
          code === "conversation_closed" ? 409 : 404,
          code,
        );
      });
      run.conversation = both();
      expect(
        await s.tools.company_agent_send!.execute({ text: "x" }),
      ).toMatchObject({ error: code });
      expect(run.conversation).toEqual({ endpoint, seen: [] });
    }
    // Opening a Direct Conversation names the parent: a closed one is over.
    const opening = session(() => {
      throw new ProtocolError(409, "conversation_closed");
    });
    opening.run.conversation = { ...parentOnly };
    expect(await opening.s.direct("start", "Hello")).toMatchObject({
      error: "conversation_closed",
    });
    expect(opening.run.conversation).toEqual({ endpoint, seen: [] });
    // The parent's expired cursor leaves the User's thread where it was.
    const expired = session(() => {
      throw new ProtocolError(410, "cursor_expired");
    });
    expired.run.conversation = both();
    expect(await expired.s.tools.company_agent_read!.execute()).toMatchObject({
      error: "cursor_expired",
      note: expect.stringContaining("company_agent_read"),
    });
    expect(expired.run.conversation).toEqual({
      endpoint,
      id: "cnv_1",
      seen: [],
      direct: both().direct,
    });
  });

  // §8.13: the refusal names the Direct Conversation that is open.
  const alreadyOpen = (id: string) =>
    new ProtocolError(
      409,
      "direct_conversation_open",
      undefined,
      undefined,
      undefined,
      undefined,
      id,
    );

  it("puts the User back in the Direct Conversation a lost start left open, without sending their words twice", async () => {
    // The Company opened cnv_d on the first start; its answer never arrived.
    let lost = true;
    const { run, s, shown, request } = session((url, body) => {
      if (url.startsWith(`${endpoint}?`)) {
        if (lost) throw new Error("socket hang up");
        expect(body).toMatchObject({ parent_conversation_id: "cnv_1" });
        throw alreadyOpen("cnv_d");
      }
      if (url.startsWith(`${endpoint}/cnv_d/events`))
        return read(
          [said("evt_d1", { text: "Hi, this is Lantern. How can I help?" })],
          { conversation_id: "cnv_d" },
        );
      if (url.startsWith(`${endpoint}/cnv_d/messages`))
        return read([said("evt_d2", { text: "On its way." })], {
          conversation_id: "cnv_d",
        });
      throw new Error(`unexpected ${url}`);
    });
    run.conversation = { ...parentOnly };
    await expect(s.direct("start", "Where is my order?")).rejects.toThrow();
    expect(run.conversation).toEqual(parentOnly);

    lost = false;
    const result = (await s.direct("start", "Where is my order?")) as {
      note?: string;
    };
    expect(result.note).toContain("wasn't sent");
    // The thread is the one the Company named, read from its start.
    expect(run.conversation.direct).toMatchObject({
      id: "cnv_d",
      cursor: "evt_d1",
    });
    expect(shown).toEqual([
      {
        author: "Lantern Noodle Bar · automated agent",
        human: false,
        text: "Hi, this is Lantern. How can I help?",
        direct: true,
      },
    ]);
    const [, url, method] = request.mock.calls.at(-1)!;
    expect(url).toBe(`${endpoint}/cnv_d/events?wait=10`);
    expect(method).toBe("GET");
    // The parent keeps its place, and the User can talk and leave again.
    expect(run.conversation).toMatchObject(parentOnly);
    await s.direct("say", "Thanks.");
    expect(request.mock.calls.at(-1)![1]).toBe(
      `${endpoint}/cnv_d/messages?wait=10&cursor=evt_d1`,
    );
  });

  it("joins an open Direct Conversation only when the User starts one", async () => {
    // The model's message to the parent gets the same refusal: no joining.
    const sending = session(() => {
      throw alreadyOpen("cnv_d");
    });
    sending.run.conversation = { ...parentOnly };
    expect(
      await sending.s.tools.company_agent_send!.execute({ text: "Any news?" }),
    ).toMatchObject({ error: "direct_conversation_open" });
    expect(sending.run.conversation).toEqual(parentOnly);
    // An invitation is for another thread than the one that is open.
    const accepting = session(() => {
      throw alreadyOpen("cnv_d");
    });
    accepting.run.conversation = {
      ...parentOnly,
      invitation: { event: "evt_ur" },
    };
    expect(await accepting.s.direct("accept")).toMatchObject({
      error: "direct_conversation_open",
    });
    expect(accepting.run.conversation.direct).toBeUndefined();
    // A refusal that names no thread, or the parent itself, opens nothing.
    for (const error of [
      new ProtocolError(409, "direct_conversation_open"),
      alreadyOpen("cnv_1"),
    ]) {
      const unnamed = session(() => {
        throw error;
      });
      unnamed.run.conversation = { ...parentOnly };
      expect(await unnamed.s.direct("start", "Hello")).toMatchObject({
        error: "direct_conversation_open",
      });
      expect(unnamed.run.conversation).toEqual(parentOnly);
      expect(unnamed.request).toHaveBeenCalledTimes(1);
    }
  });

  it("tells the Company in the parent when the User declines", async () => {
    const { run, s, request } = session((url) =>
      url.startsWith(`${endpoint}?`)
        ? read([invite])
        : read([said("evt_2", { text: "Understood." })]),
    );
    await s.tools.company_agent_send!.execute({ data: { request: "help" } });
    await s.direct("decline");
    const sent = request.mock.calls.at(-1)!;
    expect(sent[1]).toContain(`${endpoint}/cnv_1/messages`);
    expect(sent[3]).toMatchObject({
      message: {
        author: { type: "agent" },
        data: { user_requested: "declined" },
      },
    });
    expect(run.conversation?.invitation).toBeUndefined();
    // Nothing to accept any more.
    expect(await s.direct("accept")).toMatchObject({
      note: expect.stringContaining("hasn't asked"),
    });
  });
});

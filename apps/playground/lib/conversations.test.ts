import { describe, expect, it, vi } from "vitest";
import { ProtocolError } from "@poppy-lab/pap-client";
import type { DiscoveredCompany } from "@poppy-lab/pap-core";
import {
  approvalRequestId,
  approveInConversation,
  conversationEndpoint,
  conversationTools,
  type CompanyEntry,
} from "./conversations";
import type { Run } from "./runtime";

const endpoint = "https://noodles.poppylab.dev/poppy/conversations";
const company = (protocols: Array<{ type: string; endpoint: string }>) =>
  ({
    requestedUrl: "https://noodles.poppylab.dev",
    document: {
      protocol_version: "1.0",
      organization: {
        name: "Lantern Noodle Bar",
        domain: "noodles.poppylab.dev",
      },
      agent: { protocols },
    },
  }) as unknown as DiscoveredCompany;
const newRun = () =>
  ({
    url: "https://noodles.poppylab.dev",
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

  it("approves in a message with a request ID derived from the revision, and reports new terms or a decline", async () => {
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
      id: approvalRequestId(op),
      message: {
        author: { type: "agent" },
        text: "The user approved this operation.",
        extensions: { operations: { approval } },
      },
    });
    expect(approvalRequestId(op)).toBe(approvalRequestId({ ...op }));
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

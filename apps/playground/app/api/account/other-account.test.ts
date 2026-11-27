/**
 * A proposal at one Company that a model prepared with what it read with
 * another Company's account. The model is sent the turns with every
 * Company, so its request to the bank can name an order it read at the
 * restaurant, and the bank's terms then repeat it. When the restaurant's
 * account is reset, the proposal goes with the rest: its summary, terms,
 * result and stored request, the model's line about how it ended, and the
 * Inspector's lines of its approval. The real runtime; only the network
 * and the model are replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() =>
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
);
const discover = vi.hoisted(() => vi.fn());
const model = vi.hoisted(() => vi.fn());
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: discover,
}));
vi.mock("@poppy-lab/llm-adapters/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/llm-adapters/server")>()),
  runModel: model,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.includes("visitor") ? { value: "v".repeat(43) } : undefined,
    set: vi.fn(),
  }),
}));
vi.mock("@poppy-lab/pap-agent/deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-agent/deployment")>()),
  serving: () => true,
  publicMode: () => false,
  isAccountCompany: () => true,
  proposalsAllowed: () => true,
}));
import {
  createIdentity,
  ProtocolError,
  type ApiTool,
} from "@poppy-lab/pap-client";
import { connected, discovered } from "@poppy-lab/pap-agent/company-fixture";
import { seedRun } from "@poppy-lab/pap-agent/runs";
import type { Run } from "@poppy-lab/pap-agent/runtime";
import { backToPublic } from "@poppy-lab/pap-agent/transcript";
import { POST as chat } from "../chat/route";
import { GET, POST } from "./route";

const food = "https://food.example";
const bank = "https://bank.example";
const names: Record<string, string> = {
  [food]: "Lantern Noodle Bar",
  [bank]: "Harborline Bank",
};
const harborline = { origin: bank, name: "Harborline Bank" };
const api = (origin: string) => ({
  servers: [{ url: origin }],
  paths:
    origin === bank
      ? {
          "/api/payments": {
            post: {
              operationId: "propose_payment",
              "x-poppy-proposal": true,
              "x-poppy-scopes": ["poppy:write"],
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        amount: { type: "string" },
                        memo: { type: "string" },
                      },
                    },
                  },
                },
              },
              responses: { "403": {} },
            },
          },
        }
      : {
          "/api/account/orders": {
            get: { operationId: "my_orders", "x-poppy-scopes": ["poppy:read"] },
          },
        },
});
/** The bank's terms repeat what the model put in its request. */
const terms = () => ({
  operation_id: "op_1",
  revision: "r1",
  summary: "Pay $23.40 with memo “Lantern order LNB-881”",
  terms: { amount: "23.40", memo: "Lantern order LNB-881" },
  expires_at: new Date(Date.now() + 600000).toISOString(),
});

/** The bank's answers to the payment request and its approvals, in order. */
let payments: Array<() => unknown> = [];
const refused = (operation: object) => () => {
  throw new ProtocolError(
    403,
    "approval_required",
    undefined,
    undefined,
    operation,
  );
};

let count = 0;
let id = "";
/** Signed in at both: Lantern to read, Harborline to read and change. */
async function conversation() {
  const run: Run = {
    protocol: "1.0",
    visitor: "",
    expires: Date.now() + 3600000,
    calls: 0,
    busy: false,
    history: [],
    connections: [
      connected(food, names[food]!, "poppy:read"),
      connected(bank, names[bank]!, "poppy:read poppy:write"),
    ],
  };
  for (const c of run.connections) c.dpop = (await createIdentity()).privateKey;
  id = `run_other_account_${String(++count).padStart(4, "0")}`;
  await seedRun("v".repeat(43), id, run);
  return run;
}
const headers = () => ({
  Origin: "http://localhost:3000",
  "Content-Type": "application/json",
  "X-Poppy-Conversation": id,
});
const say = async (
  message: string,
  company: string,
  provider = "anthropic",
) => {
  const response = await chat(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        message,
        company,
        provider,
        apiKey: "key",
        companies: true,
      }),
    }),
  );
  return { status: response.status, answer: await response.json() };
};
const act = async (body: Record<string, unknown>) => {
  const response = await POST(
    new Request("http://localhost:3000/api/account", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, answer: await response.json() };
};
const reload = async () =>
  (
    await GET(
      new Request(`http://localhost:3000/api/account?conversation=${id}`),
    )
  ).json();

/**
 * Lantern's account says an order, and the model then asks the bank to
 * pay it: the bank answers with terms that wait for the User.
 */
async function proposed() {
  const run = await conversation();
  model.mockResolvedValueOnce("Order LNB-881, $23.40");
  await say("what was my last order?", food);
  model.mockImplementationOnce(
    async (
      _provider: string,
      _turns: unknown,
      tools: Record<string, ApiTool>,
    ) => {
      await tools.propose_payment!.execute({
        amount: "23.40",
        memo: "Lantern order LNB-881",
      });
      return "The payment waits for your approval.";
    },
  );
  const turn = await say("pay that from my checking", bank);
  expect(turn.answer.operations).toHaveLength(1);
  return { run, turn };
}

let now = Date.now();
afterEach(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: (now += 61_000) });
  // The request is refused with the terms; its approval is performed.
  payments = [
    refused(terms()),
    () => ({ summary: "Paid $23.40, memo Lantern order LNB-881" }),
  ];
  transport.mockReset().mockImplementation(async (url) => {
    if (url.endsWith("/poppy/openapi.json")) return api(new URL(url).origin);
    if (url !== `${bank}/api/payments`) return { ok: true };
    return payments.shift()!();
  });
  discover
    .mockReset()
    .mockImplementation(async (url: string) =>
      discovered(new URL(url).origin, names[new URL(url).origin]!),
    );
  model.mockReset();
});

describe("a proposal at one Company, prepared with another Company's account", () => {
  it("goes when that account is signed out, with its outcome and its lines", async () => {
    const { run, turn } = await proposed();
    // The page is told the proposal as before, and not whose account is
    // in it.
    expect(turn.answer.operations[0]).toMatchObject({
      operation_id: "op_1",
      state: "proposed",
      terms: { memo: "Lantern order LNB-881" },
    });
    expect(JSON.stringify(turn.answer)).not.toContain("accounts");
    const approved = await act({
      action: "approve",
      company: bank,
      id: "op_1",
      revision: "r1",
    });
    expect(approved.answer.operation).toMatchObject({
      state: "succeeded",
      result: { summary: "Paid $23.40, memo Lantern order LNB-881" },
    });
    expect(JSON.stringify(approved.answer)).not.toContain("accounts");
    // The model's line and the Inspector's say whose account is in them.
    expect(run.history.at(-1)).toMatchObject({
      content:
        "Company operation succeeded: Paid $23.40, memo Lantern order LNB-881",
      company: bank,
      accounts: [bank, food],
    });
    expect(run.log!.at(-1)).toMatchObject({
      text: "Operation succeeded · revision r1",
      company: bank,
      accounts: [bank, food],
    });

    const out = await act({ action: "signout", company: food });
    expect(out.status).toBe(200);
    // Nothing of Lantern's order is left: not in the bank's proposal, the
    // model's context, the transcript or the Inspector's lines.
    const [, b] = run.connections;
    expect(b!.operations).toEqual({});
    expect(b!.accountToken).toBe("refresh-bank.example");
    expect(JSON.stringify(run)).not.toMatch(/LNB-881|23\.40/);
    expect(JSON.stringify(out.answer)).not.toMatch(/LNB-881|23\.40/);
    expect(
      run.log!.filter((line) => line.company === bank && !line.signedOut),
    ).toEqual([]);
    // The page is told why the card is gone, in a line of Iris's that
    // holds no account, and gets the Companies as they are now.
    const note =
      "A proposal from Harborline Bank that Iris showed here no longer shows: it could hold details from your Lantern Noodle Bar account, which Iris no longer keeps. What Harborline Bank already performed is not undone.";
    expect(out.answer.history.at(-1)).toEqual({
      role: "assistant",
      content: note,
      signedOut: true,
      from: harborline,
    });
    expect(
      out.answer.connections.map(
        (c: { operations: unknown[] }) => c.operations,
      ),
    ).toEqual([[], []]);
    const again = await reload();
    expect(JSON.stringify(again)).not.toMatch(/LNB-881|23\.40/);
    expect(again.connections[1].operations).toEqual([]);
    expect(again.history.at(-1).content).toBe(note);
  });

  it.each(["signout", "remove"])(
    "says that a proposal which waited was withdrawn, at “%s”",
    async (action) => {
      const { run } = await proposed();
      const done = await act({ action, company: food });
      expect(done.status).toBe(200);
      const b = run.connections.at(-1)!;
      expect(b.operations).toEqual({});
      expect(JSON.stringify(run)).not.toMatch(/LNB-881|23\.40/);
      expect(done.answer.history.at(-1)).toEqual({
        role: "assistant",
        content:
          "A proposal from Harborline Bank that waited for your approval no longer shows: it could hold details from your Lantern Noodle Bar account, which Iris no longer keeps. Nothing was approved. Ask Harborline Bank for the change again if you still want it.",
        signedOut: true,
        from: harborline,
      });
      expect(done.answer.connections.at(-1).operations).toEqual([]);
    },
  );

  it("goes at a new sign-in there, which may be for another account", async () => {
    const { run } = await proposed();
    // What the callback does for a sign-in at a Company already signed in.
    expect(backToPublic(run, run.connections[0]!)).toBe(true);
    expect(run.connections[1]!.operations).toEqual({});
    expect(JSON.stringify(run)).not.toMatch(/LNB-881|23\.40/);
    const again = await reload();
    expect(again.connections[1].operations).toEqual([]);
    expect(again.history.at(-1)).toMatchObject({
      content: expect.stringMatching(
        /^A proposal from Harborline Bank that waited for your approval no longer shows: /,
      ),
      from: harborline,
    });
  });

  it("goes when that Company takes the access back, and the answer says how every Company is left", async () => {
    const { run } = await proposed();
    transport.mockImplementation(async (url) => {
      if (url.endsWith("/poppy/openapi.json")) return api(new URL(url).origin);
      if (url === `${food}/api/account/orders`)
        throw new ProtocolError(401, "invalid_token");
      return { ok: true };
    });
    const turn = await say("my orders", food, "demo");
    expect(turn.status).toBe(401);
    expect(turn.answer).toMatchObject({
      code: "account_unavailable",
      from: { origin: food, name: "Lantern Noodle Bar" },
      // Lantern's own proposals, as before; none here.
      operations: [],
    });
    expect(run.connections[1]!.operations).toEqual({});
    expect(
      turn.answer.connections.map(
        (c: { operations: unknown[] }) => c.operations,
      ),
    ).toEqual([[], []]);
    expect(turn.answer.history.at(-1).content).toMatch(
      /^A proposal from Harborline Bank that waited for your approval no longer shows: /,
    );
    expect(JSON.stringify([run, turn.answer])).not.toMatch(/LNB-881|23\.40/);
  });

  it("follows the terms the bank answers an approval with, under another operation ID too", async () => {
    const { run } = await proposed();
    payments = [refused({ ...terms(), operation_id: "op_2", revision: "r2" })];
    const approved = await act({
      action: "approve",
      company: bank,
      id: "op_1",
      revision: "r1",
    });
    expect(approved.answer).toMatchObject({
      code: "terms_changed",
      operation: { operation_id: "op_2", state: "proposed" },
      replaced: { operation_id: "op_1", state: "superseded" },
    });
    await act({ action: "signout", company: food });
    expect(run.connections[1]!.operations).toEqual({});
    expect(run.connections[1]).not.toHaveProperty("operationAccounts");
    expect(JSON.stringify(run)).not.toMatch(/LNB-881|23\.40/);
  });

  it("keeps an approval whose outcome is unknown, as a Company's own reset does", async () => {
    const { run } = await proposed();
    const op = run.connections[1]!.operations!.op_1!;
    op.state = "uncertain";
    op.approval = { approved_at: 1, reference: "apr_1" };
    const out = await act({ action: "signout", company: food });
    expect(run.connections[1]!.operations!.op_1).toMatchObject({
      state: "uncertain",
      terms: { memo: "Lantern order LNB-881" },
    });
    // Nothing went, so Iris has nothing to say about it.
    expect(JSON.stringify(out.answer.history)).not.toContain("no longer");
    expect(out.answer).not.toHaveProperty("connections");
  });

  it("leaves a proposal the bank made from its own account alone", async () => {
    const run = await conversation();
    // No turn with Lantern's account was sent to the model.
    model.mockImplementationOnce(
      async (
        _provider: string,
        _turns: unknown,
        tools: Record<string, ApiTool>,
      ) => {
        await tools.propose_payment!.execute({ amount: "23.40" });
        return "The payment waits for your approval.";
      },
    );
    const turn = await say("pay 23.40 from my checking", bank);
    expect(turn.answer.operations).toHaveLength(1);
    expect(run.connections[1]!.operations!.op_1).not.toHaveProperty("accounts");
    const out = await act({ action: "signout", company: food });
    expect(run.connections[1]!.operations!.op_1).toMatchObject({
      state: "proposed",
    });
    expect(out.answer).not.toHaveProperty("connections");
  });
});

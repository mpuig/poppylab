import { it, expect, vi, beforeEach } from "vitest";
const transport = vi.hoisted(() =>
  vi
    .fn<(url: string, ...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ state: "succeeded" }),
);
const rediscover = vi.hoisted(() => vi.fn());
vi.mock("@poppy-lab/pap-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poppy-lab/pap-client")>()),
  protocolRequest: transport,
  discoverCompany: rediscover,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
  }),
}));
import { ProtocolError, createIdentity, type JWK } from "@poppy-lab/pap-client";
import { connect, type Operation } from "./runtime";
import { example } from "./runtime-fixture";

let dpop: JWK;
beforeEach(async () => {
  transport.mockReset().mockResolvedValue({ ok: true });
  dpop = (await createIdentity()).privateKey;
});

it("tells the model an API operation's terms, and its summary only when the Company sent one (Operations v3 §3)", async () => {
  // Not a sandbox Company: an account Company whose proposals are allowed.
  const r = example("shop", false);
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", "https://shop.papsandbox.com");
  try {
    rediscover.mockResolvedValueOnce(r.company!);
    transport.mockResolvedValueOnce({
      paths: {
        "/orders": {
          post: {
            operationId: "place_order",
            "x-poppy-proposal": true,
            responses: { "403": {} },
          },
        },
      },
    });
    const tools = await connect(r, []);
    const operation = {
      operation_id: "op_1",
      revision: "r1",
      terms: { item: "Tonkotsu ramen", total: "14.00 EUR" },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    const refuse = (op: object) =>
      transport.mockRejectedValueOnce(
        new ProtocolError(403, "approval_required", undefined, undefined, op),
      );
    refuse(operation);
    const bare = await tools.place_order!.execute({});
    expect(bare).toEqual({
      status: "approval_required",
      operation_id: "op_1",
      terms: operation.terms,
      expires_at: operation.expires_at,
      note: expect.stringContaining("Nothing was done"),
    });
    expect(bare).not.toHaveProperty("summary");
    refuse({ ...operation, operation_id: "op_2", summary: "One ramen." });
    expect(await tools.place_order!.execute({})).toMatchObject({
      operation_id: "op_2",
      summary: "One ramen.",
      terms: operation.terms,
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

it("tells the model the outcome is unknown, not that a proposal waits, when it asks again for an operation whose approval was sent (Operations v3 §7)", async () => {
  const r = example("shop", false);
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", "https://shop.papsandbox.com");
  try {
    rediscover.mockResolvedValueOnce(r.company!);
    transport.mockResolvedValueOnce({
      paths: {
        "/orders": {
          post: {
            operationId: "place_order",
            "x-poppy-proposal": true,
            responses: { "403": {} },
          },
        },
      },
    });
    const trace: string[] = [];
    const tools = await connect(r, trace);
    const operation = {
      operation_id: "op_1",
      revision: "r1",
      summary: "One ramen.",
      terms: { item: "Tonkotsu ramen", total: "14.00 EUR" },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    const refuse = (op: object) =>
      transport.mockRejectedValueOnce(
        new ProtocolError(403, "approval_required", undefined, undefined, op),
      );
    refuse(operation);
    await tools.place_order!.execute({});
    // The User approved, and the Company's answer was lost.
    const stored: Operation = {
      ...r.operations!.op_1!,
      state: "uncertain",
      approval: { approver: "user", approved_at: 1, reference: "a" },
    };
    r.operations!.op_1 = stored;
    for (const again of [
      operation,
      { ...operation, revision: "r2", terms: { total: "15.00 EUR" } },
    ]) {
      refuse(again);
      const told = (await tools.place_order!.execute({})) as { note: string };
      expect(told).toEqual({
        status: "outcome_unknown",
        operation_id: "op_1",
        summary: "One ramen.",
        terms: operation.terms,
        note: expect.stringContaining("outcome is unknown"),
      });
      expect(told.note).toContain("Nothing new was proposed");
      // The card keeps the one action it had: Retry, with the same approval.
      expect(r.operations).toEqual({ op_1: stored });
    }
    expect(trace.filter((line) => line.includes("Approval"))).toEqual([
      "Approval required · nothing performed",
      "Approval already sent · outcome not known yet · nothing new proposed",
      "Approval already sent · outcome not known yet · nothing new proposed",
    ]);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("writes no request line for a request Iris stops before asking, signed out or without the permission", async () => {
  const spec = {
    paths: {
      "/account/orders": {
        get: { operationId: "my_orders", "x-poppy-scopes": ["orders:read"] },
      },
      "/account/delivery-change": {
        post: {
          operationId: "propose_delivery_change",
          "x-poppy-proposal": true,
          "x-poppy-scopes": ["orders:write"],
          responses: { "403": {} },
        },
      },
    },
  };
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", "https://shop.papsandbox.com");
  try {
    // Signed out: an account read is never sent.
    const out = example("shop", false);
    rediscover.mockResolvedValueOnce(out.company!);
    transport.mockResolvedValueOnce(spec);
    const trace: string[] = [];
    let tools = await connect(out, trace);
    transport.mockClear();
    expect(await tools.my_orders!.execute({})).toEqual({
      error: "sign_in_required",
      sent: false,
      instruction: expect.stringContaining("Sign in"),
    });
    expect(transport).not.toHaveBeenCalled();
    expect(trace.at(-1)).toBe(
      "Not sent · GET /account/orders · sign-in needed",
    );
    expect(trace.filter((line) => /^(GET|POST) /.test(line))).toEqual([]);

    // Signed in to read only: the read is sent, the change is not.
    const reader = example("shop");
    reader.scopes = "orders:read";
    reader.dpop = dpop;
    rediscover.mockResolvedValueOnce(reader.company!);
    transport.mockResolvedValueOnce(spec);
    trace.length = 0;
    tools = await connect(reader, trace);
    transport.mockClear();
    expect(await tools.propose_delivery_change!.execute({})).toEqual({
      error: "insufficient_scope",
      sent: false,
      missing: ["orders:write"],
      instruction: expect.stringContaining("Request change permission"),
    });
    expect(transport).not.toHaveBeenCalled();
    expect(trace.at(-1)).toBe(
      "Not sent · POST /account/delivery-change · permission not granted",
    );
    await tools.my_orders!.execute({});
    expect(transport.mock.calls.map(([url]) => url)).toContain(
      "https://shop.papsandbox.com/account/orders",
    );
    expect(trace.filter((line) => /^(GET|POST) /.test(line))).toEqual([
      "GET /account/orders · Poppy Session",
    ]);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("resolves relative OpenAPI servers[].url in apiBase and tool requests", async () => {
  const r = example("shop", false);
  rediscover.mockResolvedValueOnce(r.company!);
  transport.mockResolvedValueOnce({
    servers: [{ url: "/api/v1" }],
    paths: {
      "/products": { get: { operationId: "list_products" } },
    },
  });
  const tools = await connect(r, []);
  expect(r.apiBase).toBe("https://shop.papsandbox.com/api/v1");
  transport.mockClear();
  await tools.list_products!.execute({});
  expect(transport.mock.calls[0]?.[0]).toBe(
    "https://shop.papsandbox.com/api/v1/products",
  );

  // An unsafe protocol-relative server is rejected without mutating apiBase.
  const bad = example("shop", false);
  bad.apiBase = "https://shop.papsandbox.com/existing";
  rediscover.mockResolvedValueOnce(bad.company!);
  transport.mockResolvedValueOnce({
    servers: [{ url: "//evil.example/api" }],
    paths: {
      "/products": { get: { operationId: "list_products" } },
    },
  });
  await expect(connect(bad, [])).rejects.toThrow("Unsafe OpenAPI server");
  expect(bad.apiBase).toBe("https://shop.papsandbox.com/existing");
});

it("logs a request the Company refused with its status and error code, never its words", async () => {
  const r = example("shop", false);
  vi.stubEnv("PAP_ACCOUNT_ORIGINS", "https://shop.papsandbox.com");
  try {
    rediscover.mockResolvedValueOnce(r.company!);
    transport.mockResolvedValueOnce({
      paths: {
        "/products": { get: { operationId: "list_products" } },
        "/payments": {
          post: {
            operationId: "request_payment",
            "x-poppy-proposal": true,
            responses: { "403": {} },
          },
        },
      },
    });
    const trace: string[] = [];
    const tools = await connect(r, trace);
    const body = {
      error: "insufficient_funds",
      available_cents: 321055,
      message: "Words of the Company's own.",
    };
    const refused = new ProtocolError(
      409,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      body,
      "insufficient_funds",
    );
    transport.mockRejectedValueOnce(refused);
    await expect(tools.request_payment!.execute({})).rejects.toBe(refused);
    // The body is asked for, so a number in it can be shown (chat route).
    expect(transport.mock.calls.at(-1)![4]).toEqual({ errorBody: true });
    // A code of the protocol's own, and no code at all.
    transport.mockRejectedValueOnce(new ProtocolError(400, "invalid_request"));
    await expect(tools.list_products!.execute({})).rejects.toThrow();
    transport.mockRejectedValueOnce(new ProtocolError(404, undefined));
    await expect(tools.list_products!.execute({})).rejects.toThrow();
    // Not a refusal: the Company failed to answer the request.
    transport.mockRejectedValueOnce(new ProtocolError(503, undefined));
    await expect(tools.list_products!.execute({})).rejects.toThrow();
    expect(trace.slice(-8)).toEqual([
      "POST /payments · Poppy Session",
      "POST /payments · refused by the Company · HTTP 409 insufficient_funds",
      "GET /products · Poppy Session",
      "GET /products · refused by the Company · HTTP 400 invalid_request",
      "GET /products · Poppy Session",
      "GET /products · refused by the Company · HTTP 404",
      "GET /products · Poppy Session",
      "GET /products · request failed · HTTP 503",
    ]);
    expect(trace.join("\n")).not.toContain("Words of the Company");
    expect(trace.join("\n")).not.toContain("321055");
  } finally {
    vi.unstubAllEnvs();
  }
});
